"use client";

// P2P net layer (trystero, serverless signaling via public Nostr relays).
// No game server: after signaling, all state flows peer-to-peer over
// encrypted WebRTC data channels.
//
// Protocol (action "s", 10 Hz broadcast):
//   { v, id, p:[x,y,z], h, pi, ro, spin, f, name, color, score, lap,
//     ts?, th? }  (ts/th = tomato score/hits, optional for backwards compat)
// Ephemeral drops (action "tom", sent on release, no resend):
//   { v, p:[x,y,z] spawn, q:[x,y,z] velocity }
// Incoming packets are validated + clamped; unknowns and over-cap peers are
// dropped. Presence is derived from packets (roster) with a 4 s timeout.

import { joinRoom, selfId, type Room } from "trystero";
import { flight, useFlightStore } from "@/state/flight";
import { useMp } from "@/state/mp";
import { spawnRemoteTomato, useTomato } from "@/state/tomato";

export { selfId as mpSelfId };
export const MP_APP_ID = "flyjs-drone-v1";
const ACTION = "s";
/** Ephemeral tomato-drop events (visual-only ghosts on receivers). */
const TOM_ACTION = "tom";
const SEND_MS = 100;
const SEEN_TIMEOUT_MS = 4000;
const MAX_REMOTES = 7;

export interface RemoteState {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  spin: number;
  flying: boolean;
  name: string;
  color: string;
  score: number;
  lap: number;
  seen: number;
  tomatoScore: number;
  tomatoHits: number;
}

/** Live ghost states by peer id. Mutated outside React; RemotePilots reads it. */
export const remoteStates = new Map<string, RemoteState>();

let room: Room | null = null;
let roomCode: string | null = null;
let sendIv: ReturnType<typeof setInterval> | null = null;
let pruneIv: ReturnType<typeof setInterval> | null = null;

/** Wire-protocol packet (all JSON primitives — satisfies DataPayload). */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
interface StatePacket {
  v: 1;
  id: string;
  p: [number, number, number];
  h: number;
  pi: number;
  ro: number;
  spin: number;
  f: 0 | 1;
  name: string;
  color: string;
  score: number;
  lap: number;
  [key: string]: Json;
}

let sendPacket: ((data: StatePacket) => void) | null = null;
let sendTomatoPacket: ((data: TomatoDropPacket) => void) | null = null;

interface TomatoDropPacket {
  v: 1;
  /** spawn position */
  p: [number, number, number];
  /** initial velocity */
  q: [number, number, number];
  [key: string]: Json;
}

function validTomatoDrop(d: unknown): { pos: [number, number, number]; vel: [number, number, number] } | null {
  if (!d || typeof d !== "object") return null;
  const p = d as Record<string, unknown>;
  if (p.v !== 1) return null;
  const pos = p.p;
  const vel = p.q;
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isNum)) return null;
  if (!Array.isArray(vel) || vel.length !== 3 || !vel.every(isNum)) return null;
  const clampP = (v: number) => clamp(v, -200, 200);
  const clampV = (v: number) => clamp(v, -60, 60);
  return {
    pos: [clampP(pos[0]), clamp(pos[1], -50, 100), clampP(pos[2])],
    vel: [clampV(vel[0]), clampV(vel[1]), clampV(vel[2])],
  };
}

/** Broadcast a local tomato drop to the squad (visual-only for receivers). */
export function broadcastTomatoDrop(
  pos: [number, number, number],
  vel: [number, number, number]
): void {
  if (!sendTomatoPacket) return;
  try {
    sendTomatoPacket({ v: 1, p: pos, q: vel });
  } catch {
    /* transport not ready — drop stays local */
  }
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function validColor(c: unknown): string {
  if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) return c;
  return "#e8eaf6";
}

function validPacket(d: unknown): Omit<RemoteState, "seen"> | null {
  if (!d || typeof d !== "object") return null;
  const p = d as Record<string, unknown>;
  if (p.v !== 1 || typeof p.id !== "string" || p.id === selfId) return null;
  const pos = p.p;
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isNum)) return null;
  if (![p.h, p.pi, p.ro, p.spin].every(isNum)) return null;
  if (p.f !== 0 && p.f !== 1) return null;
  if (!isNum(p.score) || !isNum(p.lap)) return null;
  return {
    x: clamp(pos[0], -200, 200),
    y: clamp(pos[1], -50, 100),
    z: clamp(pos[2], -200, 200),
    heading: p.h as number,
    pitch: clamp(p.pi as number, -1, 1),
    roll: clamp(p.ro as number, -1, 1),
    spin: clamp(p.spin as number, 0, 1),
    flying: p.f === 1,
    name: typeof p.name === "string" ? p.name.slice(0, 24) || "Pilot" : "Pilot",
    color: validColor(p.color),
    score: Math.max(0, Math.floor(p.score)),
    lap: Math.max(1, Math.floor(p.lap)),
    // Optional (older clients omit them) — never NaN, never negative.
    tomatoScore: isNum(p.ts) ? Math.max(0, Math.floor(p.ts)) : 0,
    tomatoHits: isNum(p.th) ? Math.max(0, Math.floor(p.th)) : 0,
  };
}

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

export function randomRoomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 4; i++) s += chars[buf[i] % chars.length];
  return s;
}

export function currentRoom(): string | null {
  return roomCode;
}

function buildPacket(): StatePacket {
  const fs = useFlightStore.getState();
  const mp = useMp.getState();
  const phase = fs.phase;
  const name = mp.name.trim().slice(0, 24) || "Pilot";
  const tom = useTomato.getState();
  return {
    v: 1,
    id: selfId,
    p: [flight.pos.x, flight.pos.y, flight.pos.z],
    h: flight.heading,
    pi: flight.pitch,
    ro: flight.roll,
    spin: flight.propSpin,
    f: phase === "flight" || phase === "launching" || phase === "landing" ? 1 : 0,
    name,
    color: mp.color,
    score: fs.score,
    lap: fs.lap,
    ts: tom.score,
    th: tom.hits,
  };
}

function broadcastNow(): void {
  if (!sendPacket) return;
  try {
    sendPacket(buildPacket());
  } catch {
    /* transport not ready — next 100 ms tick retries */
  }
}

function refreshTransportCount(): void {
  try {
    const n = room ? Object.keys(room.getPeers()).length : 0;
    useMp.getState().setTransportCount(n);
  } catch {
    /* ignore */
  }
}

export function joinSquad(code: string): void {
  const clean = normalizeRoomCode(code);
  if (!clean || clean === roomCode) return;
  leaveSquad();
  roomCode = clean;
  try {
    room = joinRoom({ appId: MP_APP_ID }, `flyjs-${clean}`, {
      onJoinError: (details) => {
        console.warn(`[squad] join error in ${details.roomId}: ${details.error}`);
      },
    });
  } catch (err) {
    console.warn("[squad] joinRoom failed:", err);
    roomCode = null;
    return;
  }

  const action = room.makeAction<StatePacket>(ACTION);
  sendPacket = (data) => {
    action.send(data).catch(() => {
      /* transport hiccup — next tick retries */
    });
  };

  const tomAction = room.makeAction<TomatoDropPacket>(TOM_ACTION);
  sendTomatoPacket = (data) => {
    tomAction.send(data).catch(() => {
      /* ephemeral — dropped on failure */
    });
  };
  tomAction.onMessage = (data) => {
    const drop = validTomatoDrop(data);
    if (!drop) return;
    spawnRemoteTomato(drop.pos, drop.vel);
  };

  action.onMessage = (data, context) => {
    const peerId = context.peerId;
    const st = validPacket(data);
    if (!st) return;
    // Peer cap (excluding self): ignore ghosts beyond the cap.
    if (!remoteStates.has(peerId) && remoteStates.size >= MAX_REMOTES) return;
    remoteStates.set(peerId, { ...st, seen: Date.now() });
    useMp.getState().upsertPeer({
      id: peerId,
      name: st.name,
      color: st.color,
      score: st.score,
      lap: st.lap,
      flying: st.flying,
      tomatoScore: st.tomatoScore,
      tomatoHits: st.tomatoHits,
    });
  };

  room.onPeerJoin = () => {
    refreshTransportCount();
    // Fast hello: the newcomer gets our state immediately instead of
    // waiting up to 100 ms for the next broadcast tick.
    broadcastNow();
  };
  room.onPeerLeave = (peerId: string) => {
    remoteStates.delete(peerId);
    useMp.getState().removePeer(peerId);
    refreshTransportCount();
  };
  // Setter replays already-connected peers, so count is correct even on
  // fast re-join.
  refreshTransportCount();

  // Announce ourselves right away (presence) + start the 10 Hz loop.
  broadcastNow();
  sendIv = setInterval(broadcastNow, SEND_MS);

  pruneIv = setInterval(() => {
    const now = Date.now();
    for (const [id, st] of remoteStates) {
      if (now - st.seen > SEEN_TIMEOUT_MS) {
        remoteStates.delete(id);
        useMp.getState().removePeer(id);
      }
    }
  }, 2000);

  useMp.getState().setSession({ room: clean, joined: true });
}

export function leaveSquad(): void {
  if (sendIv) clearInterval(sendIv);
  if (pruneIv) clearInterval(pruneIv);
  sendIv = pruneIv = null;
  sendPacket = null;
  sendTomatoPacket = null;
  if (room) {
    const r = room;
    room = null;
    r.leave().catch(() => {
      /* ignore */
    });
  } else {
    room = null;
  }
  roomCode = null;
  remoteStates.clear();
  useMp.getState().clearPeers();
  useMp.getState().setTransportCount(0);
  useMp.getState().setSession({ room: null, joined: false });
}
