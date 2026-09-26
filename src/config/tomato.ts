// Tomato bombing mode: throw tomatoes from the drone onto ground targets.
//
// Targets are static discs on the island (positions below). Drops inherit the
// drone's velocity plus a small forward kick, then fall with arcade gravity.
// Scoring is local per pilot (your drops score on your client only); drops
// are broadcast to the squad as visual-only ghosts (see net/mp "tom" action).

export interface TomatoTargetDef {
  id: string;
  x: number;
  z: number;
}

export const TOMATO_TARGETS: TomatoTargetDef[] = [
  { id: "tom-1", x: 10, z: 26 }, // meadow by the pad — easy opener
  { id: "tom-2", x: 28, z: -2 }, // toward the pond
  { id: "tom-3", x: 44, z: 22 }, // beach sand
  { id: "tom-4", x: -18, z: -28 }, // west-north field
  { id: "tom-5", x: -34, z: 18 }, // west-south field
  { id: "tom-6", x: 6, z: -38 }, // north field
];

/** Flat bullseye radius (m) — generous, tomatoes are hard to aim. */
export const TARGET_RADIUS = 2.6;
/** Extra height above the target base that still counts as a hit. */
export const TARGET_HIT_HEIGHT = 1.6;
/** ms a smashed target stays down before popping back up. */
export const TARGET_RESPAWN_MS = 8000;
/** Points per bullseye. */
export const TOMATO_HIT_POINTS = 150;

/** Arcade gravity (m/s²) — snappier than 9.8 at this world scale. */
export const TOMATO_GRAVITY = 18;
/** Forward kick added in the drone's facing direction on release. */
export const DROP_FORWARD_KICK = 4;
/** Small downward push so drops clear the skids. */
export const DROP_DOWN_PUSH = 1.5;
/** ms between drops (also rate-limits key-hold). */
export const DROP_COOLDOWN_MS = 280;
/** Max flying tomatoes at once (perf + spam guard). */
export const MAX_TOMATOES = 24;
/** Max ground splats kept (potato tier uses fewer). */
export const MAX_SPLATS = 30;
export const MAX_SPLATS_POTATO = 15;
/** ms a splat stays painted before fading out. */
export const SPLAT_LIFE_MS = 12000;
