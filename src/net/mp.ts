"use client";

// P2P net layer (trystero, serverless signaling via public Nostr relays).
// No game server: after signaling, all state flows peer-to-peer over
// encrypted WebRTC data channels.
//
// Protocol (action "s", 10 Hz broadcast):
//   { v, id, p:[x,y,z], h, pi, ro, spin, f, name, color, score, lap,
//     ts?, th?, rh?, rl?, vel?:[x,y,z], hp?, b?:[x,y,z,loose] }
//   (ts/th = tomato score/hits, rh/rl = race hoop index/laps, vel = velocity
//   for dead reckoning, hp = hull, b = basketball — all optional, for
//   backwards compat with older clients that omit them)
// Ephemeral drops (action "tom", sent on release, no resend):
//   { v, p:[x,y,z] spawn, q:[x,y,z] velocity }
// Incoming packets are validated + clamped; unknowns and over-cap peers are
// dropped. Presence is derived from packets (roster) with a 4 s timeout.
//
// Quick Join: public rooms PUB1..PUB6, filled in order — if the shard you
// land in already has more pilots than we render (MAX_REMOTES), hop to the
// next one. No server; the shard's own transport count is the signal.

import { joinRoom, selfId, type Room, type RelayConfig, type TurnServerConfig } from "trystero";
import { flight, useFlightStore } from "@/state/flight";
import { useMp } from "@/state/mp";
import { spawnRemoteTomato, useTomato } from "@/state/tomato";
import { ball, useRace } from "@/state/race";
import { toast } from "@/state/toasts";
import { HP_MAX } from "@/config/hull";

export { selfId as mpSelfId };
export const MP_APP_ID = "flyjs-drone-v1";
const ACTION = "s";
/** Ephemeral tomato-drop events (visual-only ghosts on receivers). */
const TOM_ACTION = "tom";
const SEND_MS = 100;
const SEEN_TIMEOUT_MS = 4000;
const MAX_REMOTES = 7;
/** Grace period after join before an empty transport counts as "degraded"
 *  (vs. still connecting) — relays can take a couple seconds to answer. */
const LINK_DEGRADED_AFTER_MS = 7000;

// Curated relay set: trystero's own default list carries some relays that
// are slow or offline (observed: chorus.pjv.me). These are commonly-used
// public Nostr relays with a track record of uptime — picking a smaller,
// known-good set means faster peer discovery instead of waiting out timeouts
// on dead ones. `redundancy` queries several at once so one flaky relay
// doesn't stall the handshake.
const CURATED_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://offchain.pub",
  "wss://relay.snort.social",
  "wss://nostr.mom",
  "wss://relay.primal.net",
];

const RELAY_CONFIG: RelayConfig = {
  urls: CURATED_RELAYS,
  redundancy: 4,
  warnOnRelayFailure: true,
};

/**
 * Optional TURN relay for strict NATs (symmetric NAT, locked-down corporate
 * networks) where plain STUN can't punch through. Off by default — no TURN
 * credentials ship with this project. To enable, set in `.env.local`:
 *   VITE_TURN_URLS=turn:your-host:3478
 *   VITE_TURN_USERNAME=...
 *   VITE_TURN_CREDENTIAL=...
 * (a free option: metered.ca's TURN tier). Multiple URLs: comma-separated.
 */
function turnConfigFromEnv(): TurnServerConfig[] | undefined {
  try {
    const raw = import.meta.env.VITE_TURN_URLS as string | undefined;
    if (!raw) return undefined;
    const urls = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0) return undefined;
    return [
      {
        urls,
        username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
        credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
      },
    ];
  } catch {
    return undefined;
  }
}

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
  raceHoop: number;
  raceLaps: number;
  /** Velocity (m/s) — ghosts dead-reckon between 10 Hz packets, and
   *  pilot-vs-pilot bumps use it for relative impact speed. 0 for older
   *  clients (they just interpolate, as before). */
  vx: number;
  vy: number;
  vz: number;
  /** Hull points (HP_MAX for older clients). */
  hp: number;
  /** Their basketball, when their race mode is on. */
  ball: { x: number; y: number; z: number; loose: boolean } | null;
}

/** Live ghost states by peer id. Mutated outside React; RemotePilots reads it. */
export const remoteStates = new Map<string, RemoteState>();

/** Dead-reckoned position of a remote pilot right now: last packet position
 *  + velocity × time since, capped so a dropped packet can't fling a ghost
 *  across the map. Shared by the ghost renderer and pilot collisions. */
export const MAX_EXTRAPOLATE_S = 0.3;
export function predictedRemote(st: RemoteState, out: { x: number; y: number; z: number }) {
  const age = Math.min((Date.now() - st.seen) / 1000, MAX_EXTRAPOLATE_S);
  out.x = st.x + st.vx * age;
  out.y = st.y + st.vy * age;
  out.z = st.z + st.vz * age;
  return out;
}

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
    raceHoop: isNum(p.rh) ? Math.max(0, Math.floor(p.rh)) : 0,
    raceLaps: isNum(p.rl) ? Math.max(0, Math.floor(p.rl)) : 0,
    ...validVel(p.vel),
    hp: isNum(p.hp) ? clamp(Math.round(p.hp), 0, HP_MAX) : HP_MAX,
    ball: validBall(p.b),
  };
}

function validVel(v: unknown): { vx: number; vy: number; vz: number } {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) return { vx: 0, vy: 0, vz: 0 };
  return { vx: clamp(v[0], -60, 60), vy: clamp(v[1], -60, 60), vz: clamp(v[2], -60, 60) };
}

function validBall(b: unknown): RemoteState["ball"] {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum)) return null;
  return {
    x: clamp(b[0], -200, 200),
    y: clamp(b[1], -50, 100),
    z: clamp(b[2], -200, 200),
    loose: b[3] === 1,
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
  const race = useRace.getState();
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
    rh: race.hoopIndex,
    rl: race.laps,
    vel: [round2(flight.vel.x), round2(flight.vel.y), round2(flight.vel.z)],
    hp: Math.round(flight.hp),
    ...(race.enabled
      ? { b: [round2(ball.x), round2(ball.y), round2(ball.z), ball.state === "loose" ? 1 : 0] }
      : {}),
  };
}

/** Two decimals is plenty for 10 Hz state and keeps packets small. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
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
    const mpState = useMp.getState();
    mpState.setTransportCount(n);
    if (n > 0 && mpState.linkStatus !== "connected") {
      mpState.setLinkStatus("connected");
    }
  } catch {
    /* ignore */
  }
}

let degradedCheck: ReturnType<typeof setTimeout> | null = null;

export function joinSquad(code: string): void {
  const clean = normalizeRoomCode(code);
  if (!clean || clean === roomCode) return;
  leaveSquad();
  roomCode = clean;
  const mpState = useMp.getState();
  mpState.setLinkStatus("connecting");
  mpState.setLastError(null);
  try {
    room = joinRoom(
      {
        appId: MP_APP_ID,
        relayConfig: RELAY_CONFIG,
        turnConfig: turnConfigFromEnv(),
      },
      `flyjs-${clean}`,
      {
        onJoinError: (details) => {
          console.warn(`[squad] join error in ${details.roomId}: ${details.error}`);
          useMp.getState().setLastError(String(details.error));
          if (useMp.getState().transportCount === 0) {
            useMp.getState().setLinkStatus("degraded");
          }
        },
      }
    );
  } catch (err) {
    console.warn("[squad] joinRoom failed:", err);
    useMp.getState().setLinkStatus("error");
    useMp.getState().setLastError(err instanceof Error ? err.message : String(err));
    roomCode = null;
    return;
  }

  // If no relay has answered with a peer within the grace period, the room
  // is reachable but empty (normal for the first pilot) or the relays are
  // unresponsive (network/firewall) — surface "degraded" either way so a
  // stuck "waiting for pilots…" has a next step (Retry) instead of silence.
  degradedCheck = setTimeout(() => {
    const st = useMp.getState();
    if (st.linkStatus === "connecting") {
      st.setLinkStatus(st.transportCount > 0 ? "connected" : "degraded");
    }
  }, LINK_DEGRADED_AFTER_MS);

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
    const prev = remoteStates.get(peerId);
    if (!prev && remoteStates.size >= MAX_REMOTES) return;
    if (!prev) toast(`✈ ${st.name} joined the sky`, "info");
    else if (prev.hp > 0 && st.hp <= 0) toast(`💥 ${st.name} went down`, "bad");
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
      raceHoop: st.raceHoop,
      raceLaps: st.raceLaps,
      hp: st.hp,
    });
  };

  room.onPeerJoin = () => {
    refreshTransportCount();
    // Fast hello: the newcomer gets our state immediately instead of
    // waiting up to 100 ms for the next broadcast tick.
    broadcastNow();
  };
  room.onPeerLeave = (peerId: string) => {
    dropPeer(peerId, "left");
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
      if (now - st.seen > SEEN_TIMEOUT_MS) dropPeer(id, "lost signal");
    }
  }, 2000);

  useMp.getState().setSession({ room: clean, joined: true });
}

function dropPeer(peerId: string, why: "left" | "lost signal"): void {
  const st = remoteStates.get(peerId);
  if (!st) return;
  remoteStates.delete(peerId);
  useMp.getState().removePeer(peerId);
  toast(`${st.name} ${why}`, "info");
}

// --- Quick Join --------------------------------------------------------------

const PUBLIC_SHARDS = 6;
/** Let relays + handshakes settle before judging a shard full. */
const SHARD_SETTLE_MS = 6000;
let shardTimer: ReturnType<typeof setTimeout> | null = null;

export function isPublicRoom(code: string | null): boolean {
  return !!code && /^PUB[1-9]$/.test(code);
}

/** Join the first public lobby shard with room to spare — no code needed. */
export function quickJoin(): void {
  hopToShard(1);
}

function hopToShard(n: number): void {
  joinSquad(`PUB${n}`);
  shardTimer = setTimeout(() => {
    shardTimer = null;
    if (currentRoom() !== `PUB${n}`) return; // user moved on
    // More connected pilots than we render → this shard is full; next one.
    if (useMp.getState().transportCount > MAX_REMOTES && n < PUBLIC_SHARDS) {
      toast(`Lobby PUB${n} is full — trying PUB${n + 1}`, "info");
      hopToShard(n + 1);
    }
  }, SHARD_SETTLE_MS);
}

export function leaveSquad(): void {
  if (sendIv) clearInterval(sendIv);
  if (pruneIv) clearInterval(pruneIv);
  if (degradedCheck) clearTimeout(degradedCheck);
  if (shardTimer) clearTimeout(shardTimer);
  sendIv = pruneIv = degradedCheck = shardTimer = null;
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
  useMp.getState().setLinkStatus("idle");
  useMp.getState().setLastError(null);
  useMp.getState().setSession({ room: null, joined: false });
}

/** Retry the current room from scratch (drop + rejoin) — the panel's Retry
 *  button, for a stuck "degraded" link. */
export function retrySquad(): void {
  const code = roomCode;
  if (!code) return;
  roomCode = null; // bypass joinSquad's "already in this room" no-op guard
  joinSquad(code);
}
