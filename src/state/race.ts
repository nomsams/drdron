"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { flight, useFlightStore } from "@/state/flight";
import { heightAt } from "@/lib/terrain";
import {
  BALL_AIR_DRAG,
  BALL_GRAVITY,
  BALL_PICKUP_ALT,
  BALL_PICKUP_RADIUS,
  BALL_RELEASE_COOLDOWN_MS,
  BALL_RELEASE_DOWN_PUSH,
  BALL_RELEASE_FORWARD_KICK,
  HOOP_RIM_RADIUS,
  HOOP_SCORE_POINTS,
  RACE_HOOPS,
  RACE_LAP_BONUS,
} from "@/config/race";

// Basketball race mode state.
//
// Same two-layer pattern as flight.ts / tomato.ts:
// - `ball`, a mutable module-level object — Basketball.tsx integrates its
//   physics every frame with zero React re-renders.
// - `useRace`, a tiny zustand store — mode toggle, hoop progress, score and
//   lap timing (low-frequency UI updates only).
//
// Like tomato bombing, this is local-authoritative: your run scores on your
// client. Squadmates see your hoop progress on the roster (rh/rl fields on
// the 10 Hz state packet) but not a live ball ghost — see net/mp.ts.

export type BallState = "carried" | "loose";

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Previous-frame y, for the hoop pass-through (crossing) check. */
  py: number;
  state: BallState;
  /** Has this loose ball touched the ground at least once? A release starts
   *  right at the drone, well within the pickup radius/altitude — without
   *  this, the very next pickup poll (100 ms later) would re-catch a ball
   *  that's still in the air a few centimetres below the drone. Pickup only
   *  counts once it's actually landed (the "go get it" of a miss). */
  landed: boolean;
}

/** Live ball. Mutated outside React; Basketball.tsx reads/writes it. */
export const ball: Ball = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  py: 0,
  state: "carried",
  landed: false,
};

let lastReleaseAt = 0;

function defaultEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("race") === "0") return false;
  } catch {
    /* ignore */
  }
  return true;
}

const BEST_LAP_KEY = "flyjs-best-race-lap-v1";

function loadBestLap(): number | null {
  try {
    const raw = localStorage.getItem(BEST_LAP_KEY);
    const v = raw !== null ? parseFloat(raw) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

interface RaceStore {
  enabled: boolean;
  toggle: () => void;
  /** Index into RACE_HOOPS of the hoop currently being attempted. */
  hoopIndex: number;
  score: number;
  makes: number;
  misses: number;
  laps: number;
  lapStartMs: number | null;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** Bumped on any change Basketball.tsx needs to re-render for (ball
   *  mesh mount/unmount doesn't need this — position updates are imperative). */
  version: number;
  /** Score the current hoop: advances progress, grants the lap bonus + timer
   *  on loop completion, and re-attaches the ball to the drone. */
  scoreHoop: () => void;
  addMiss: () => void;
  reset: () => void;
}

export const useRace = create<RaceStore>()(
  persist(
    (set, get) => ({
      enabled: typeof window !== "undefined" ? defaultEnabled() : true,
      toggle: () =>
        set((s) => {
          const enabled = !s.enabled;
          if (enabled) {
            ball.state = "carried";
            return { enabled, hoopIndex: 0, lapStartMs: null, version: s.version + 1 };
          }
          return { enabled };
        }),
      hoopIndex: 0,
      score: 0,
      makes: 0,
      misses: 0,
      laps: 0,
      lapStartMs: null,
      lastLapMs: null,
      bestLapMs: typeof window !== "undefined" ? loadBestLap() : null,
      version: 0,
      scoreHoop: () => {
        const s = get();
        const nextIndex = s.hoopIndex + 1;
        const lapStartMs = s.lapStartMs ?? Date.now();
        ball.state = "carried";
        if (nextIndex >= RACE_HOOPS.length) {
          const now = Date.now();
          const lapMs = now - lapStartMs;
          const bestLapMs =
            s.bestLapMs === null || lapMs < s.bestLapMs ? lapMs : s.bestLapMs;
          if (bestLapMs !== s.bestLapMs) {
            try {
              localStorage.setItem(BEST_LAP_KEY, String(bestLapMs));
            } catch {
              /* ignore */
            }
          }
          set({
            hoopIndex: 0,
            makes: s.makes + 1,
            score: s.score + HOOP_SCORE_POINTS + RACE_LAP_BONUS,
            laps: s.laps + 1,
            lapStartMs: null,
            lastLapMs: lapMs,
            bestLapMs,
            version: s.version + 1,
          });
        } else {
          set({
            hoopIndex: nextIndex,
            makes: s.makes + 1,
            score: s.score + HOOP_SCORE_POINTS,
            lapStartMs,
            version: s.version + 1,
          });
        }
      },
      addMiss: () => set((s) => ({ misses: s.misses + 1, version: s.version + 1 })),
      reset: () => {
        ball.state = "carried";
        set((s) => ({
          hoopIndex: 0,
          score: 0,
          makes: 0,
          misses: 0,
          laps: 0,
          lapStartMs: null,
          lastLapMs: null,
          version: s.version + 1,
        }));
      },
    }),
    {
      name: "flyjs-race-v1",
      partialize: (s) => ({ enabled: s.enabled, bestLapMs: s.bestLapMs }),
    }
  )
);

/** Release the carried ball with the drone's velocity + a forward/down kick.
 *  Mirrors tryDropLocal's release math. Null when not holding, on cooldown,
 *  or grounded/idle. */
export function tryReleaseBall(): boolean {
  if (!useRace.getState().enabled) return false;
  if (useFlightStore.getState().phase !== "flight") return false;
  if (ball.state !== "carried") return false;
  const now = Date.now();
  if (now - lastReleaseAt < BALL_RELEASE_COOLDOWN_MS) return false;
  lastReleaseAt = now;

  const h = flight.heading;
  const fwdX = -Math.sin(h);
  const fwdZ = -Math.cos(h);
  ball.x = flight.pos.x;
  ball.y = flight.pos.y - 0.9;
  ball.z = flight.pos.z;
  ball.py = ball.y;
  ball.vx = flight.vel.x + fwdX * BALL_RELEASE_FORWARD_KICK;
  ball.vy = flight.vel.y - BALL_RELEASE_DOWN_PUSH;
  ball.vz = flight.vel.z + fwdZ * BALL_RELEASE_FORWARD_KICK;
  ball.state = "loose";
  ball.landed = false;
  return true;
}

/** Are you currently holding the ball? (Poll this for UI feedback — a
 *  release only ever does something while this is true; once it's loose on
 *  the ground, pressing the button again is correctly a no-op until you
 *  fly back down and reclaim it.) */
export function hasBall(): boolean {
  return ball.state === "carried";
}

/** Reclaim a loose ball if the drone is close and roughly level with it.
 *  Only once it's actually landed — see the `landed` field's note. */
export function tryPickupBall(): boolean {
  if (ball.state !== "loose" || !ball.landed) return false;
  if (useFlightStore.getState().phase !== "flight") return false;
  const dx = flight.pos.x - ball.x;
  const dz = flight.pos.z - ball.z;
  const dy = Math.abs(flight.pos.y - ball.y);
  if (dx * dx + dz * dz > BALL_PICKUP_RADIUS * BALL_PICKUP_RADIUS) return false;
  if (dy > BALL_PICKUP_ALT) return false;
  ball.state = "carried";
  useRace.setState((s) => ({ version: s.version + 1 }));
  return true;
}

// ---------------------------------------------------------------------------
// Aim prediction. Mirrors tryReleaseBall's release math, then marches the
// same semi-implicit Euler integrator (plus air drag) at fixed 1/30 steps
// until ground impact or a hoop swish — so the on-screen arc is exactly what
// will happen if you release now.

export interface BallDropPrediction {
  points: [number, number, number][];
  impact: { x: number; y: number; z: number };
  /** Would this release swish the current target hoop? */
  scores: boolean;
}

const PREDICT_DT = 1 / 30;
const PREDICT_STEPS = 100;

export function predictBallDrop(): BallDropPrediction | null {
  if (!useRace.getState().enabled) return null;
  if (useFlightStore.getState().phase !== "flight") return null;
  if (ball.state !== "carried") return null;

  const hoop = RACE_HOOPS[useRace.getState().hoopIndex];
  const h = flight.heading;
  const fwdX = -Math.sin(h);
  const fwdZ = -Math.cos(h);
  let x = flight.pos.x;
  let y = flight.pos.y - 0.9;
  let z = flight.pos.z;
  let vx = flight.vel.x + fwdX * BALL_RELEASE_FORWARD_KICK;
  let vy = flight.vel.y - BALL_RELEASE_DOWN_PUSH;
  let vz = flight.vel.z + fwdZ * BALL_RELEASE_FORWARD_KICK;

  const hoopY = hoop ? heightAt(hoop.x, hoop.z) + hoop.alt : null;
  let prevY = y;
  const points: [number, number, number][] = [[x, y, z]];
  let scores = false;
  for (let i = 0; i < PREDICT_STEPS; i++) {
    vy -= BALL_GRAVITY * PREDICT_DT;
    const drag = Math.max(0, 1 - BALL_AIR_DRAG * PREDICT_DT);
    vx *= drag;
    vz *= drag;
    prevY = y;
    x += vx * PREDICT_DT;
    y += vy * PREDICT_DT;
    z += vz * PREDICT_DT;
    if (i % 3 === 0) points.push([x, y, z]);

    if (hoop && hoopY !== null && !scores && vy < 0 && prevY >= hoopY && y < hoopY) {
      const dx = x - hoop.x;
      const dz = z - hoop.z;
      if (dx * dx + dz * dz < HOOP_RIM_RADIUS * HOOP_RIM_RADIUS) scores = true;
    }

    const floor = Math.max(heightAt(x, z), -0.35);
    if (y <= floor + 0.15) {
      points.push([x, floor + 0.15, z]);
      return { points, impact: { x, y: floor, z }, scores };
    }
  }
  return { points, impact: { x, y, z }, scores };
}

// Debug handle (dev only).
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__flyjsRace = {
    useRace,
    ball,
    tryReleaseBall,
    tryPickupBall,
    predictBallDrop,
  };
}
