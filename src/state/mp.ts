"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Squad (P2P multiplayer) state. Pilot profile persists; room membership and
// the peer roster are session-only. Actual networking lives in @/net/mp.

export interface PeerInfo {
  id: string;
  name: string;
  color: string;
  score: number;
  lap: number;
  flying: boolean;
  /** Tomato bombing score / bullseyes (0 for older clients). */
  tomatoScore: number;
  tomatoHits: number;
  /** Basketball race progress (0 for older clients / race mode off). */
  raceHoop: number;
  raceLaps: number;
  /** Hull points (HP_MAX for older clients). */
  hp: number;
}

/** P2P link health, surfaced in the Squad panel. */
export type LinkStatus = "idle" | "connecting" | "connected" | "degraded" | "error";

interface MpState {
  /** Display name shown above your drone. */
  name: string;
  /** Pilot color (ghost beacon + nameplate + roster dot). */
  color: string;
  room: string | null;
  joined: boolean;
  peers: PeerInfo[];
  /** Transport-level WebRTC links (handshake done). May exceed `peers`
   *  briefly while first state packets are still in flight. */
  transportCount: number;
  /** Relay/handshake health for the Squad panel status line. */
  linkStatus: LinkStatus;
  lastError: string | null;
  setProfile: (patch: { name?: string; color?: string }) => void;
  setSession: (patch: { room?: string | null; joined?: boolean }) => void;
  setTransportCount: (n: number) => void;
  setLinkStatus: (status: LinkStatus) => void;
  setLastError: (err: string | null) => void;
  upsertPeer: (peer: PeerInfo) => void;
  removePeer: (id: string) => void;
  clearPeers: () => void;
}

export const PILOT_COLORS = [
  "#ffd166",
  "#4edea3",
  "#c0c1ff",
  "#ff6a5a",
  "#7fb98f",
  "#e8eaf6",
];

function defaultName(): string {
  try {
    const n = Math.floor(100 + Math.random() * 900);
    return `Pilot-${n}`;
  } catch {
    return "Pilot";
  }
}

export const useMp = create<MpState>()(
  persist(
    (set) => ({
      name: typeof window !== "undefined" ? defaultName() : "Pilot",
      color: PILOT_COLORS[0],
      room: null,
      joined: false,
      peers: [],
      transportCount: 0,
      linkStatus: "idle",
      lastError: null,
      setProfile: (patch) => set(patch),
      setSession: (patch) => set(patch),
      setTransportCount: (n) => set({ transportCount: n }),
      setLinkStatus: (status) => set({ linkStatus: status }),
      setLastError: (err) => set({ lastError: err }),
      upsertPeer: (peer) =>
        set((s) => {
          const i = s.peers.findIndex((p) => p.id === peer.id);
          if (i >= 0) {
            const peers = s.peers.slice();
            peers[i] = peer;
            return { peers };
          }
          return { peers: [...s.peers, peer] };
        }),
      removePeer: (id) => set((s) => ({ peers: s.peers.filter((p) => p.id !== id) })),
      clearPeers: () => set({ peers: [] }),
    }),
    {
      name: "flyjs-pilot-v1",
      // Only the pilot profile persists. Room membership, roster and
      // transport counts are session-only; functions never hit storage.
      partialize: (s) => ({ name: s.name, color: s.color }),
    }
  )
);
