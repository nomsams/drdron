// Basketball race mode: carry a ball around a loop of aerial hoops, releasing
// it to arc down through the rim. A make auto-recatches the ball so the run
// continues; a miss drops it to the ground and the pilot must fly down and
// hover close to pick it back up before retrying the same hoop.
//
// Positions form a loop distinct from the reward-ring course and tomato
// targets (different radius band, different angles) so all three toggleable
// modes stay visually readable when run at once.

export interface HoopDef {
  id: string;
  x: number;
  z: number;
  /** Rim height above terrain (m) — the scoring gate. */
  alt: number;
}

export const RACE_HOOPS: HoopDef[] = [
  { id: "hoop-1", x: -12, z: 34 }, // north field, near the pad approach
  { id: "hoop-2", x: -46, z: -4 }, // west shore
  { id: "hoop-3", x: -22, z: -46 }, // southwest
  { id: "hoop-4", x: 16, z: -34 }, // south, skirting the pond
  { id: "hoop-5", x: 40, z: 2 }, // east shore
  { id: "hoop-6", x: 20, z: 36 }, // back toward the pad
].map((h) => ({ ...h, alt: 7 }));

export const HOOP_RIM_RADIUS = 1.15;
export const HOOP_SCORE_POINTS = 300;
export const RACE_LAP_BONUS = 500;

/** Arcade gravity (m/s²) — a bit floatier than the tomato's for a "shot arc"
 *  that reads clearly at drone speeds. */
export const BALL_GRAVITY = 15;
/** Ground bounce energy retained (0..1). Basketballs bounce a lot. */
export const BALL_RESTITUTION = 0.55;
/** Horizontal speed retained per bounce (rolling friction). */
export const BALL_BOUNCE_FRICTION = 0.72;
/** Per-second horizontal air drag while loose. */
export const BALL_AIR_DRAG = 0.15;
/** Carry position: this far below the drone, and this far ahead along its
 *  facing direction (world-space, computed from flight.heading each frame). */
export const BALL_CARRY_DOWN = 0.95;
export const BALL_CARRY_FORWARD = 0.35;
export const BALL_RELEASE_FORWARD_KICK = 3;
export const BALL_RELEASE_DOWN_PUSH = 1;
export const BALL_RELEASE_COOLDOWN_MS = 350;
/** How close (xz) + how level (y) the drone must get to reclaim a loose ball. */
export const BALL_PICKUP_RADIUS = 2.4;
export const BALL_PICKUP_ALT = 1.8;
export const BALL_RADIUS = 0.32;
