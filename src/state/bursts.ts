"use client";

// Impact bursts: a short particle puff at a crash point — leaves off a tree,
// grit off a rock, feathers off a bird, a splash off water, sparks off a
// squadmate. Mutable module state (same pattern as tomato shocks), rendered
// by ImpactBursts.tsx in one instanced draw call.

export type BurstKind = "leaves" | "rock" | "dust" | "splash" | "feathers" | "sparks" | "repair";

export interface Burst {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: BurstKind;
  born: number;
  /** Per-burst seed so particle directions differ between bursts. */
  seed: number;
}

export const BURST_LIFE_MS = 750;
export const MAX_BURSTS = 8;
export const BURST_PARTICLES = 10;

export const bursts: Burst[] = [];
let nextId = 1;

export function spawnBurst(kind: BurstKind, x: number, y: number, z: number): void {
  bursts.push({ id: nextId++, x, y, z, kind, born: performance.now(), seed: Math.random() * 1000 });
  while (bursts.length > MAX_BURSTS) bursts.shift();
}
