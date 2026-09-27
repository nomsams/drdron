// Drone hull (HP): what hurts, how much, and how you get it back.
//
// Impact speed is always the velocity component INTO the thing you hit
// (terrain normal, collider normal, relative velocity for birds/pilots) —
// so skimming low over flat ground at full speed is fine, but slamming into
// a hillside or dropping onto the pad at sport speed is not.

export const HP_MAX = 100;

/** After a damaging hit, ignore further hits for this long — one crash is
 *  one hit, not one hit per frame of overlap. */
export const HIT_INVULN_MS = 600;

/** Ground / water: slower touches than this (m/s into the surface) are
 *  harmless — landing, hovering low, brushing a slope. Only real slams hurt. */
export const SURFACE_SAFE_SPEED = 4;

/** Trees / rocks / pilots: below this it's resting contact (leaning on a
 *  trunk), not a crash. Above it, any hit costs HP. */
export const OBSTACLE_MIN_SPEED = 0.8;

export type HitSource = "tree" | "rock" | "bird" | "pilot" | "ground" | "water";

/** HP lost for an impact. Super-linear in speed — the faster you hit, the
 *  disproportionately worse it gets. Reference points at normal max speed
 *  (~9 m/s) head-on: tree ≈ 18, rock ≈ 21, pilot ≈ 14; at sport speed
 *  (~16 m/s): tree ≈ 37, rock ≈ 44. A full-throttle sport dive into the
 *  ground (~9.5 m/s down) ≈ 17. */
export function hitDamage(source: HitSource, speed: number): number {
  let dmg = 0;
  switch (source) {
    case "ground":
    case "water":
      if (speed < SURFACE_SAFE_SPEED) return 0;
      dmg = 3 + 1.1 * Math.pow(speed - SURFACE_SAFE_SPEED, 1.5);
      break;
    case "tree":
      if (speed < OBSTACLE_MIN_SPEED) return 0;
      dmg = 3 + 0.7 * Math.pow(speed, 1.4);
      break;
    case "rock":
      if (speed < OBSTACLE_MIN_SPEED) return 0;
      dmg = (3 + 0.7 * Math.pow(speed, 1.4)) * 1.2;
      break;
    case "bird":
      // Birds are soft, but they always count — even a slow bump.
      dmg = 2 + 0.5 * Math.pow(speed, 1.4);
      break;
    case "pilot":
      if (speed < OBSTACLE_MIN_SPEED) return 0;
      dmg = 2 + 0.55 * Math.pow(speed, 1.4);
      break;
  }
  return Math.max(1, Math.round(dmg));
}

// --- Getting HP back ---------------------------------------------------------

/** Floating repair kits (wrench pickups). Consumed only if you're damaged. */
export const REPAIR_KITS: { id: string; x: number; z: number }[] = [
  { id: "kit-1", x: -26, z: 4 }, // west meadow
  { id: "kit-2", x: 28, z: 16 }, // east, between the ring loop and beach
  { id: "kit-3", x: -4, z: -26 }, // north-centre field
  { id: "kit-4", x: -44, z: 22 }, // southwest
  { id: "kit-5", x: 30, z: -44 }, // north-east, below the mountain
];
export const REPAIR_KIT_HEAL = 30;
export const REPAIR_KIT_RESPAWN_MS = 30000;
export const REPAIR_KIT_RADIUS = 1.8;
/** Kits float this high above terrain — or above any tree/rock top within
 *  reach, so you never have to fly into a canopy to grab one. */
export const REPAIR_KIT_HOVER = 3;

/** Hovering low + slow over the helipad repairs continuously. */
export const PAD_REPAIR_PER_SEC = 12;
export const PAD_REPAIR_MAX_ALT = 3.5;
export const PAD_REPAIR_MAX_SPEED = 3;

/** Seconds the drone tumbles after hitting 0 HP before the respawn fade. */
export const DOWNED_FALL_MS = 1500;
