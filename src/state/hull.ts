"use client";

import { create } from "zustand";
import { flight, useFlightStore } from "@/state/flight";
import { engineAudio } from "@/lib/audio";
import { spawnBurst, type BurstKind } from "@/state/bursts";
import { toast } from "@/state/toasts";
import { HIT_INVULN_MS, HP_MAX, hitDamage, type HitSource } from "@/config/hull";

// Hull (HP) state. The number itself lives on the mutable `flight` object
// (flight.hp — physics writes it, HUD polls it at 5 Hz, net/mp broadcasts
// it), same as battery. This store only carries low-frequency EVENTS the
// UI reacts to: a hit (red flash), a repair (teal flash), a crash.

interface HullStore {
  /** Bumped on every damaging hit — the HUD keys its red flash off this. */
  hitVersion: number;
  lastHit: { amount: number; source: HitSource } | null;
  /** Bumped on every repair tick that actually restored HP. */
  healVersion: number;
}

export const useHull = create<HullStore>(() => ({
  hitVersion: 0,
  lastHit: null,
  healVersion: 0,
}));

const BURST_FOR: Record<HitSource, BurstKind> = {
  tree: "leaves",
  rock: "rock",
  bird: "feathers",
  pilot: "sparks",
  ground: "dust",
  water: "splash",
};

let invulnUntil = 0;

/**
 * Register an impact. `speed` is the velocity component into the thing hit
 * (m/s). Returns HP lost (0 if harmless, invulnerable, or not flying).
 * At 0 HP the drone goes down (DroneExperience's crash sequence).
 */
export function applyHit(
  source: HitSource,
  speed: number,
  at: { x: number; y: number; z: number } = flight.pos
): number {
  if (useFlightStore.getState().phase !== "flight" || flight.downed) return 0;
  const amount = hitDamage(source, speed);
  if (amount <= 0) return 0;
  const now = performance.now();
  if (now < invulnUntil) return 0;
  invulnUntil = now + HIT_INVULN_MS;

  flight.hp = Math.max(0, flight.hp - amount);
  flight.shake = Math.min(0.75, flight.shake + 0.12 + amount / 55);
  engineAudio.playHit(Math.min(1, amount / 35), source === "water");
  if (source === "bird") engineAudio.playSquawk();
  spawnBurst(BURST_FOR[source], at.x, at.y, at.z);
  try {
    navigator.vibrate?.(Math.min(120, 20 + amount * 3));
  } catch {
    /* unsupported — ignore */
  }
  useHull.setState((s) => ({ hitVersion: s.hitVersion + 1, lastHit: { amount, source } }));

  if (flight.hp <= 0) {
    engineAudio.playCrash();
    toast("💥 Drone down! Take off again for a fresh airframe", "bad");
    (window as unknown as { __flyjsCrash?: () => void }).__flyjsCrash?.();
  }
  return amount;
}

/** Restore HP (capped). Returns HP actually restored. `quiet` skips the
 *  teal flash event — for continuous per-frame repair (helipad), where the
 *  HUD shows a steady "repairing" hint instead of flashing every frame. */
export function repairHull(amount: number, opts: { quiet?: boolean } = {}): number {
  if (flight.downed) return 0;
  const before = flight.hp;
  flight.hp = Math.min(HP_MAX, flight.hp + amount);
  const restored = flight.hp - before;
  if (restored > 0 && !opts.quiet) useHull.setState((s) => ({ healVersion: s.healVersion + 1 }));
  return restored;
}

export function hullDamaged(): boolean {
  return flight.hp < HP_MAX && !flight.downed;
}

// --- Repair kits -------------------------------------------------------------
// Which kits are taken (and until when). Plain module state, no three.js, so
// the minimap (main bundle) can read it without pulling in the 3D chunk.

const kitDownUntil = new Map<string, number>();

export function isKitDown(id: string): boolean {
  const until = kitDownUntil.get(id);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    kitDownUntil.delete(id);
    return false;
  }
  return true;
}

export function takeKit(id: string, respawnMs: number): void {
  kitDownUntil.set(id, Date.now() + respawnMs);
}

// Debug handle (dev only).
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__flyjsHull = { useHull, applyHit, repairHull };
}
