// Flight state. Adapted from rishabhrathod01.github.io (MIT), stripped down:
//
// Kept: mutable per-frame `flight` object (no React re-renders in the loop),
// raw `keys` state, minimal zustand store (phase / sound / pickups).
// Dropped: focus mode, race trial, nav interactables, session resume,
// CV content registry. Pickups use a tiny local registry instead.

import { create } from "zustand";
import * as THREE from "three";
import { LAP_BONUS, REWARD_POINTS } from "@/config/world";
import { HP_MAX } from "@/config/hull";

export type FlightPhase = "idle" | "charging" | "launching" | "flight" | "landing";

// ---------------------------------------------------------------------------
// Per-frame mutable flight state. Lives OUTSIDE React — physics, camera and
// HUD read it every frame without triggering renders.

export const flight = {
  pos: new THREE.Vector3(0, 2, 0),
  vel: new THREE.Vector3(),
  /** Yaw heading in radians; 0 = facing north (−Z). */
  heading: 0,
  yawRate: 0,
  pitch: 0,
  roll: 0,
  throttleTotal: 0,
  sport: false,
  /** Visual prop spin, 0..1 (idle ≈ 0.15, flight = 1). */
  propSpin: 0.15,
  /** Long-press charge, 0..1. */
  charge: 0,
  /** Camera shake impulse, decays per frame. */
  shake: 0,
  speedKmh: 0,
  altitude: 0,
  /** Geofence overshoot warning flag, read by HUD. */
  geofence: false,
  /** Time of day: 0 = morning at takeoff → 1 = sunset after a long flight. */
  dayT: 0,
  /** Simulated flight-battery charge, 1 → 0. A fresh pack every takeoff;
   *  drains with flight time + throttle (read by the FPV goggle HUD). */
  battery: 1,
  /** Seconds since this flight's launch (FPV OSD timer). */
  flightElapsed: 0,
  /** Hull points, HP_MAX → 0. A fresh airframe every takeoff; crashes into
   *  trees/rocks/birds/pilots (and hard slams into ground/water) cost HP —
   *  see state/hull.ts. */
  hp: HP_MAX,
  /** HP hit 0: motors out, tumbling down (DroneExperience's crash sequence). */
  downed: false,
  /** Hovering low over the helipad, being repaired (HUD hint). */
  repairing: false,
  /** Camera tilt, 0 = looking forward → 1 = looking straight down (Q/E,
   *  HUD 📷 button). Kept across flights — it's a viewing preference. */
  camTilt: 0,
  /** Full 3D orientation — what's rendered and what the cameras follow.
   *  Easy/Angle modes build it from heading/pitch/roll (+ a flip trick);
   *  Acro integrates it directly from stick rates (it can go anywhere,
   *  loops included) and derives heading/pitch/roll back from it. */
  quat: new THREE.Quaternion(),
  /** Acro body angular velocity (rad/s): x pitch, y yaw, z roll. */
  angVel: new THREE.Vector3(),
  /** Flip trick progress (Easy/Angle, X key): 0 = idle, else 0→1. */
  flipT: 0,
  /** Body axis the flip spins about, and direction (+1/−1). */
  flipAxis: "x" as "x" | "z",
  flipSign: 1,
};

export function resetFlight() {
  flight.pos.set(0, 2, 0);
  flight.vel.set(0, 0, 0);
  flight.heading = 0;
  flight.yawRate = 0;
  flight.pitch = 0;
  flight.roll = 0;
  flight.throttleTotal = 0;
  flight.sport = false;
  flight.propSpin = 0.15;
  flight.charge = 0;
  flight.shake = 0;
  flight.geofence = false;
  flight.dayT = 0;
  flight.battery = 1;
  flight.flightElapsed = 0;
  flight.hp = HP_MAX;
  flight.downed = false;
  flight.repairing = false;
  flight.quat.identity();
  flight.angVel.set(0, 0, 0);
  flight.flipT = 0;
}

/** Raw key state, written by useFlightControls, read by physics. */
export const keys = {
  forward: false,
  back: false,
  yawLeft: false,
  yawRight: false,
  strafeLeft: false,
  strafeRight: false,
  up: false,
  down: false,
  sport: false,
  /** Hold to tilt the camera up (toward forward) / down (toward straight down). */
  camUp: false,
  camDown: false,
};

export function resetKeys() {
  (Object.keys(keys) as (keyof typeof keys)[]).forEach((k) => (keys[k] = false));
}

// ---------------------------------------------------------------------------
// React-visible state (low-frequency updates only).

interface FlightStore {
  phase: FlightPhase;
  setPhase: (phase: FlightPhase) => void;
  soundEnabled: boolean;
  toggleSound: () => void;
  /** Battery packs picked up this session (HUD counter). */
  packsCollected: number;
  collectPack: () => void;
  // -- Reward ring challenge (toggleable, score per session) --
  rewardsEnabled: boolean;
  toggleRewards: () => void;
  score: number;
  lap: number;
  ringsPassed: string[];
  /** Timestamp (ms) when the current lap's first ring was taken. */
  lapStartMs: number | null;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** Collect one ring (+points). Completing the full loop grants the lap
   *  bonus, records the lap time, bumps the lap counter and re-arms. */
  collectRing: (id: string, ringCount: number) => void;
  resetRewards: () => void;
}

const BEST_LAP_KEY = "flyjs-best-lap-v1";

function loadBestLap(): number | null {
  try {
    const raw = localStorage.getItem(BEST_LAP_KEY);
    const v = raw !== null ? parseFloat(raw) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export const useFlightStore = create<FlightStore>((set, get) => ({
  phase: "idle",
  setPhase: (phase) => set({ phase }),
  soundEnabled: true,
  toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),
  packsCollected: 0,
  collectPack: () => set((s) => ({ packsCollected: s.packsCollected + 1 })),
  rewardsEnabled: true,
  toggleRewards: () =>
    set((s) => ({
      rewardsEnabled: !s.rewardsEnabled,
      // Fresh lap whenever the course is switched back on.
      ringsPassed: [],
      lapStartMs: null,
    })),
  score: 0,
  lap: 1,
  ringsPassed: [],
  lapStartMs: null,
  lastLapMs: null,
  bestLapMs: typeof window !== "undefined" ? loadBestLap() : null,
  collectRing: (id, ringCount) => {
    const st = get();
    if (st.ringsPassed.includes(id)) return;
    const ringsPassed = [...st.ringsPassed, id];
    const patch: Partial<{ score: number; lap: number; ringsPassed: string[]; lapStartMs: number | null; lastLapMs: number | null; bestLapMs: number | null }> = {
      ringsPassed,
      score: st.score + REWARD_POINTS,
      lapStartMs: st.lapStartMs ?? Date.now(),
    };
    if (ringsPassed.length >= ringCount) {
      const now = Date.now();
      const lapMs = st.lapStartMs !== null ? now - st.lapStartMs : null;
      const bestLapMs =
        lapMs !== null && (st.bestLapMs === null || lapMs < st.bestLapMs) ? lapMs : st.bestLapMs;
      if (bestLapMs !== st.bestLapMs) {
        try {
          localStorage.setItem(BEST_LAP_KEY, String(bestLapMs));
        } catch {
          /* ignore */
        }
      }
      patch.ringsPassed = [];
      patch.score = st.score + REWARD_POINTS + LAP_BONUS;
      patch.lap = st.lap + 1;
      patch.lapStartMs = null;
      patch.lastLapMs = lapMs;
      patch.bestLapMs = bestLapMs;
    }
    set(patch);
  },
  resetRewards: () => set({ score: 0, lap: 1, ringsPassed: [], lapStartMs: null, lastLapMs: null }),
}));

// ---------------------------------------------------------------------------
// Battery packs (the glowing green cells on the island): which are taken and
// until when. Plain module state so the minimap can read it; Pickups.tsx
// does the 10 Hz proximity check and the recharge.

const packDownUntil = new Map<string, number>();

export function isPackDown(id: string): boolean {
  const until = packDownUntil.get(id);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    packDownUntil.delete(id);
    return false;
  }
  return true;
}

export function takePack(id: string, respawnMs: number): void {
  packDownUntil.set(id, Date.now() + respawnMs);
}

// Hero UI can request takeoff without reaching into DroneExperience.
let takeoffRequestHandler: (() => void) | null = null;

export function setTakeoffRequestHandler(handler: (() => void) | null) {
  takeoffRequestHandler = handler;
}

export function requestTakeoff() {
  takeoffRequestHandler?.();
}

// Debug handle (dev only).
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__flyjs = {
    useFlightStore,
    flight,
    keys,
  };
}
