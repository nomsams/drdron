// World coordinate table — generic island edition.
//
// Upstream (rishabhrathod01.github.io) carries ~15 CV content anchors here
// (experience trail, project billboards, nav signposts, video boards, race
// rings). All of those are dropped in this scaffold: the island keeps only
// environmental landmarks (pad, pond, mountain, waterfall, beach) plus a few
// generic pickup positions. Add your own anchors as needed.

export const WORLD = {
  /** Soft geofence pushback radius. */
  softRadius: 62,
  /** Hard clamp — unreachable in practice. */
  hardRadius: 70,
  maxAltitude: 26,
  /** Terrain plane size. Segment count comes from the quality preset. */
  terrainSize: 160,
} as const;

export const POND = { x: 30, z: -18, r: 12, rim: 6, depth: -0.6 } as const;
export const PAD = { x: 0, z: 20, r: 7, rim: 4, h: 0.4 } as const;

export const SPAWN = { x: 0, z: 20, hover: 2.2 } as const;

/** Generic collectible pickups (exploration easter egg, no CV meaning). */
export const PICKUPS: { id: string; x: number; z: number; yOffset: number }[] = [
  { id: "cell-1", x: 48, z: 14, yOffset: 3 },
  { id: "cell-2", x: 40, z: -34, yOffset: 4 },
  { id: "cell-3", x: 2, z: -52, yOffset: 5 },
  { id: "cell-4", x: -40, z: -35, yOffset: 3.5 },
  { id: "cell-5", x: -52, z: 4, yOffset: 4.5 },
  { id: "cell-6", x: -36, z: 40, yOffset: 3 },
];

/** Environmental set-pieces. */
export const MOUNTAIN = { x: 20, z: -58, r: 9 } as const;
export const WATERFALL = { x: 44, z: -16, r: 6 } as const;
export const BEACH = { x: 46, z: 34, r: 16 } as const;

/** Ambient bird flock: confined to one area (above the pond), so it reads
 *  as local wildlife rather than decoration scattered everywhere. */
export const BIRDS = {
  x: 30,
  z: -18,
  /** Circling band radius (birds spread between inner and outer). */
  inner: 6,
  outer: 13,
  /** Flight band altitude (above terrain, below the reward route). */
  low: 8,
  high: 13,
} as const;

/** Reward ring challenge: a scenic loop (pad → pond → beach → high pass →
 *  pad). `alt` is metres above the terrain at that spot. Toggleable in the
 *  HUD (and with the R key); score persists per session only. */
export const REWARD_POINTS = 100;
export const LAP_BONUS = 250;

export const REWARD_RINGS: {
  id: string;
  x: number;
  z: number;
  alt: number;
  radius: number;
}[] = [
  { id: "ring-1", x: 8, z: 8, alt: 5, radius: 3.6 }, // start, by the pad
  { id: "ring-2", x: 24, z: -6, alt: 6, radius: 3.2 }, // toward the pond
  // NOTE: keep clear of the waterfall cliff at (44,-16) — its rock pile has
  // a collision cylinder (r 6). This ring sits over open pond water instead.
  { id: "ring-3", x: 33, z: -25, alt: 7, radius: 3.2 }, // skimming the pond
  { id: "ring-4", x: 46, z: 8, alt: 7, radius: 3.2 }, // down the east shore
  { id: "ring-5", x: 42, z: 28, alt: 7, radius: 3.2 }, // Vagator Beach
  { id: "ring-6", x: 18, z: 30, alt: 9, radius: 3.4 }, // climbing inland
  { id: "ring-7", x: 4, z: -12, alt: 13, radius: 3.4 }, // high middle pass
  { id: "ring-8", x: -2, z: 12, alt: 6, radius: 4.2 }, // final, back at the pad
];
