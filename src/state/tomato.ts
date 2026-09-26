"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { flight, useFlightStore } from "@/state/flight";
import { heightAt } from "@/lib/terrain";
import {
  DROP_COOLDOWN_MS,
  DROP_DOWN_PUSH,
  DROP_FORWARD_KICK,
  MAX_SPLATS,
  MAX_TOMATOES,
  SPLAT_LIFE_MS,
  TARGET_HIT_HEIGHT,
  TARGET_RADIUS,
  TARGET_RESPAWN_MS,
  TOMATO_GRAVITY,
  TOMATO_HIT_POINTS,
} from "@/config/tomato";

// Tomato bombing state.
//
// Two layers (same pattern as flight.ts):
// - mutable module-level arrays (`tomatoes`, `splats`) — physics + rendering
//   read/write these every frame with zero React re-renders.
// - tiny zustand store (`useTomato`) — mode toggle, score, roster of knocked
//   targets (low-frequency UI updates only).
//
// Scoring is local: your drops score on your client. Squadmates receive your
// drops via the "tom" P2P action and render them as visual-only ghosts that
// splat but never score (avoids shared-state conflicts without a host).

export interface FlyingTomato {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Pilot color tint for MP ghosts; local drops are always tomato red. */
  color: string;
  /** Ghost drops from squadmates never score or knock targets. */
  remote: boolean;
}

export interface Splat {
  id: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  born: number;
  /** Bullseye splats paint bigger + gold-flecked. */
  hit: boolean;
}

/** Live tomatoes. Mutated outside React; Tomatoes.tsx advances them. */
export const tomatoes: FlyingTomato[] = [];
/** Ground splats. Mutated outside React; rendered from a version counter. */
export const splats: Splat[] = [];

export interface Shock {
  id: number;
  x: number;
  y: number;
  z: number;
  born: number;
}

/** Bullseye shockwaves (600 ms life). Mutated outside React. */
export const shocks: Shock[] = [];
export const SHOCK_LIFE_MS = 600;

export function spawnShock(x: number, y: number, z: number): void {
  shocks.push({ id: nextId++, x, y, z, born: Date.now() });
  while (shocks.length > 8) shocks.shift();
}

export function removeShock(id: number): void {
  const i = shocks.findIndex((s) => s.id === id);
  if (i >= 0) shocks.splice(i, 1);
}

let nextId = 1;
let lastDropAt = 0;
/** targetId -> timestamp (ms) when it pops back up. */
const downUntil = new Map<string, number>();

function defaultEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("tomatoes") === "0") return false;
  } catch {
    /* ignore */
  }
  return true;
}

interface TomatoStore {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  /** Session drops / bullseyes (local pilot only). */
  drops: number;
  hits: number;
  score: number;
  /** Bumped to re-render splats/targets on hits, fades and respawns. */
  version: number;
  addDrop: () => void;
  addHit: () => void;
  knockTarget: (id: string) => void;
  /** Score a bullseye + knock the target in ONE store update (one render). */
  registerHit: (id: string) => void;
  bump: () => void;
  reset: () => void;
}

export const useTomato = create<TomatoStore>()(
  persist(
    (set, get) => ({
      enabled: typeof window !== "undefined" ? defaultEnabled() : true,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
      setEnabled: (v) => set({ enabled: v }),
      drops: 0,
      hits: 0,
      score: 0,
      version: 0,
      addDrop: () => set((s) => ({ drops: s.drops + 1, version: s.version + 1 })),
      addHit: () =>
        set((s) => ({
          hits: s.hits + 1,
          score: s.score + TOMATO_HIT_POINTS,
          version: s.version + 1,
        })),
      knockTarget: (id) => {
        downUntil.set(id, Date.now() + TARGET_RESPAWN_MS);
        set((s) => ({ version: s.version + 1 }));
      },
      registerHit: (id) => {
        downUntil.set(id, Date.now() + TARGET_RESPAWN_MS);
        set((s) => ({
          hits: s.hits + 1,
          score: s.score + TOMATO_HIT_POINTS,
          version: s.version + 1,
        }));
      },
      bump: () => set((s) => ({ version: s.version + 1 })),
      reset: () => {
        tomatoes.length = 0;
        splats.length = 0;
        shocks.length = 0;
        downUntil.clear();
        set({ drops: 0, hits: 0, score: 0, version: get().version + 1 });
      },
    }),
    {
      name: "flyjs-tomato-v1",
      partialize: (s) => ({ enabled: s.enabled }),
    }
  )
);

/** Is the target currently smashed (waiting to respawn)? */
export function isTargetDown(id: string): boolean {
  const until = downUntil.get(id);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    downUntil.delete(id);
    return false;
  }
  return true;
}

/** Sweep expired targets + splats. Called ~1 Hz; bumps version on change. */
export function sweepTomatoWorld(maxSplats: number = MAX_SPLATS): void {
  const now = Date.now();
  let changed = false;
  for (const [id, until] of downUntil) {
    if (now >= until) {
      downUntil.delete(id);
      changed = true;
    }
  }
  while (splats.length > maxSplats) {
    splats.shift();
    changed = true;
  }
  for (let i = splats.length - 1; i >= 0; i--) {
    if (now - splats[i].born > SPLAT_LIFE_MS) {
      splats.splice(i, 1);
      changed = true;
    }
  }
  if (changed) useTomato.getState().bump();
}

export function spawnTomato(
  pos: [number, number, number],
  vel: [number, number, number],
  opts?: { remote?: boolean; color?: string }
): FlyingTomato | null {
  if (tomatoes.length >= MAX_TOMATOES) return null;
  const t: FlyingTomato = {
    id: nextId++,
    x: pos[0],
    y: pos[1],
    z: pos[2],
    vx: vel[0],
    vy: vel[1],
    vz: vel[2],
    color: opts?.color ?? "#e23b2e",
    remote: opts?.remote ?? false,
  };
  tomatoes.push(t);
  return t;
}

/** Called by net/mp when a squadmate's drop arrives — visual only. */
export function spawnRemoteTomato(
  pos: [number, number, number],
  vel: [number, number, number]
): void {
  spawnTomato(pos, vel, { remote: true });
}

export function removeTomato(id: number): void {
  const i = tomatoes.findIndex((t) => t.id === id);
  if (i >= 0) tomatoes.splice(i, 1);
}

export function spawnSplat(x: number, y: number, z: number, hit: boolean): void {
  splats.push({
    id: nextId++,
    x,
    y,
    z,
    scale: hit ? 1.6 + Math.random() * 0.7 : 0.8 + Math.random() * 0.7,
    rot: Math.random() * Math.PI * 2,
    born: Date.now(),
    hit,
  });
  while (splats.length > MAX_SPLATS) splats.shift();
}

export interface DropResult {
  pos: [number, number, number];
  vel: [number, number, number];
}

/**
 * Release one tomato below the drone. Returns its spawn so the caller can
 * play the sound + broadcast to the squad. Null when on cooldown, capped,
 * grounded, or the mode is off.
 */
export function tryDropLocal(): DropResult | null {
  const ts = useTomato.getState();
  if (!ts.enabled) return null;
  if (useFlightStore.getState().phase !== "flight") return null;
  const now = Date.now();
  if (now - lastDropAt < DROP_COOLDOWN_MS) return null;
  if (tomatoes.length >= MAX_TOMATOES) return null;
  lastDropAt = now;

  const h = flight.heading;
  const fwdX = -Math.sin(h);
  const fwdZ = -Math.cos(h);
  const pos: [number, number, number] = [flight.pos.x, flight.pos.y - 0.8, flight.pos.z];
  const vel: [number, number, number] = [
    flight.vel.x + fwdX * DROP_FORWARD_KICK,
    flight.vel.y - DROP_DOWN_PUSH,
    flight.vel.z + fwdZ * DROP_FORWARD_KICK,
  ];
  const t = spawnTomato(pos, vel);
  if (!t) return null;
  ts.addDrop();
  return { pos, vel };
}

// Debug handle (dev only).
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__flyjsTomato = {
    useTomato,
    tomatoes,
    splats,
    tryDropLocal,
  };
}

// ---------------------------------------------------------------------------
// Aim prediction. Mirrors tryDropLocal's release math, then marches the same
// semi-implicit Euler integrator at fixed 1/30 steps until ground impact.
// Pure (no side effects) — the Predictor arc shares it with future throw UI.

export interface PredictedTarget {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface DropPrediction {
  points: [number, number, number][];
  impact: { x: number; y: number; z: number };
  /** Standing target the arc will smash, if any. */
  targetId: string | null;
}

const PREDICT_DT = 1 / 30;
const PREDICT_STEPS = 90;

export function predictDrop(targets: PredictedTarget[]): DropPrediction | null {
  if (!useTomato.getState().enabled) return null;
  if (useFlightStore.getState().phase !== "flight") return null;
  const h = flight.heading;
  const fwdX = -Math.sin(h);
  const fwdZ = -Math.cos(h);
  let x = flight.pos.x;
  let y = flight.pos.y - 0.8;
  let z = flight.pos.z;
  const vx = flight.vel.x + fwdX * DROP_FORWARD_KICK;
  let vy = flight.vel.y - DROP_DOWN_PUSH;
  const vz = flight.vel.z + fwdZ * DROP_FORWARD_KICK;

  const points: [number, number, number][] = [[x, y, z]];
  let targetId: string | null = null;
  for (let i = 0; i < PREDICT_STEPS; i++) {
    vy -= TOMATO_GRAVITY * PREDICT_DT;
    x += vx * PREDICT_DT;
    y += vy * PREDICT_DT;
    z += vz * PREDICT_DT;
    if (i % 3 === 0) points.push([x, y, z]);
    if (!targetId) {
      for (const p of targets) {
        if (isTargetDown(p.id)) continue;
        const dx = x - p.x;
        const dz = z - p.z;
        if (
          dx * dx + dz * dz < TARGET_RADIUS * TARGET_RADIUS &&
          y < p.y + TARGET_HIT_HEIGHT + 0.45 &&
          y > p.y - 0.5
        ) {
          targetId = p.id;
          break;
        }
      }
    }
    const floor = Math.max(heightAt(x, z), -0.35);
    if (y <= floor + 0.15) {
      points.push([x, floor + 0.15, z]);
      return { points, impact: { x, y: floor, z }, targetId };
    }
  }
  return { points, impact: { x, y, z }, targetId };
}
