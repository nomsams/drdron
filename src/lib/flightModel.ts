import * as THREE from "three";
import type { FlightMode } from "@/state/settings";

// The flight model, as pure functions over a plain body — no React, no
// stores, no scene — so it can be stepped headlessly (see the Node checks
// in the commit that introduced it) and Drone.tsx just calls it each frame.
//
// Three modes:
// - easy:  arcade. Velocity chases the sticks directly; tilt is cosmetic.
// - angle: real physics with self-levelling. The sticks set a tilt, and the
//          tilted thrust is what moves you — momentum, drift, wind.
// - acro:  rate mode, NO limiter. The sticks set rotation RATES and nothing
//          ever levels you out: hold ↓ and the nose keeps coming up, past
//          vertical, over the top and round. Thrust always points out of the
//          belly, so upside down it drives you toward the ground.

export interface StickInput {
  /** +1 forward (↑) … −1 back (↓). */
  forward: number;
  /** +1 right (→) … −1 left (←). */
  strafe: number;
  /** +1 up (W) … −1 down (S). */
  vertical: number;
  /** +1 yaw left (A) … −1 yaw right (D). */
  yaw: number;
  sport: boolean;
  /** Sensitivity multiplier from settings (0.5..2). */
  sens: number;
}

export interface FlightBody {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  angVel: THREE.Vector3;
  heading: number;
  pitch: number;
  roll: number;
  yawRate: number;
  flipT: number;
  flipAxis: "x" | "z";
  flipSign: number;
}

// --- Easy (arcade) ---
const BASE_SPEED = 0.15;
const FWD_FACTOR = 60;
const STRAFE_FACTOR = 45;
const VERT_FACTOR = 35;
const SPORT_MULTIPLIER = 1.8;
const VEL_LERP = 3.5;
const TILT_AMOUNT = 0.25;
const ROLL_AMOUNT = 0.35;
const TILT_LERP = 5;
const YAW_SPEED = 1.8;
const YAW_LERP = 4;
const YAW_BANK = 0.18;
/** Fraction of the wind that drifts the drone in Easy. */
const EASY_WIND_DRIFT = 0.45;

// --- Angle / Acro: thrust along the body's up axis, gravity, and air drag
// relative to the wind. ---
export const GRAVITY = 9.81;
/** Linear air drag (1/s) against velocity relative to the air. */
const AIR_DRAG = 0.5;
/** Angle: max tilt (rad) normal / sport — sets top speed (~9.5 / ~17 m/s). */
const ANGLE_MAX_TILT = 0.45;
const ANGLE_SPORT_TILT = 0.72;
/** Angle: vertical acceleration from W/S (m/s²) + altitude-hold damping. */
const ANGLE_CLIMB_ACC = 6;
const ANGLE_VZ_DAMP = 1.6;
const ANGLE_ATTITUDE_RATE = 7;
/** Acro: full-stick rates (rad/s) — 200°/s pitch/roll, a loop in ~2 s;
 *  expo() keeps small deflections gentle (a tap ≈ 25°/s). */
export const ACRO_RATE = 3.5;
const ACRO_YAW_RATE = 2.2;
const ACRO_RATE_RESPONSE = 12;
/** Acro thrust in g: throttle up / sport / neutral (hover when level) / cut. */
const ACRO_THRUST_MAX = 2.2;
const ACRO_THRUST_SPORT = 2.8;
const ACRO_THRUST_IDLE = 1;
const ACRO_THRUST_CUT = 0.08;

/** Flip trick (Easy/Angle, X key): a full 360 spun on top of the attitude. */
const FLIP_DURATION = 0.75;

const _up = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Air drag toward the wind: velocity relaxes to the air's velocity. */
function applyAirDrag(vel: THREE.Vector3, air: { x: number; z: number }, dt: number) {
  const k = 1 - Math.exp(-AIR_DRAG * dt);
  vel.x += (air.x - vel.x) * k;
  vel.y += (0 - vel.y) * k;
  vel.z += (air.z - vel.z) * k;
}

/** Integrate one step of flight physics (collisions come after, in the
 *  caller). Updates velocity, position and — in Acro — the orientation. */
export function stepFlight(
  mode: FlightMode,
  b: FlightBody,
  input: StickInput,
  air: { x: number; z: number },
  dt: number
): void {
  const { sens } = input;
  if (mode === "acro") {
    // Expo: gentle rates near centre (a short tap nudges the nose a few
    // degrees and it STAYS there — that's how you fly forward in acro),
    // full flip rate only at full stick.
    const rate = ACRO_RATE * sens * (input.sport ? 1.3 : 1);
    const av = b.angVel;
    const kr = 1 - Math.exp(-ACRO_RATE_RESPONSE * dt);
    av.x += (-expo(input.forward) * rate - av.x) * kr; // ↑ nose down, ↓ nose up
    av.y += (expo(input.yaw) * ACRO_YAW_RATE * sens - av.y) * kr;
    av.z += (-expo(input.strafe) * rate - av.z) * kr; // → roll right
    const angle = av.length() * dt;
    if (angle > 1e-6) {
      _q.setFromAxisAngle(_axis.copy(av).normalize(), angle);
      b.quat.multiply(_q).normalize(); // body-frame rotation — no limits
    }
    const thrustG =
      input.vertical > 0
        ? input.sport
          ? ACRO_THRUST_SPORT
          : ACRO_THRUST_MAX
        : input.vertical < 0
          ? ACRO_THRUST_CUT
          : ACRO_THRUST_IDLE;
    _up.set(0, 1, 0).applyQuaternion(b.quat);
    b.vel.addScaledVector(_up, thrustG * GRAVITY * dt);
    b.vel.y -= GRAVITY * dt;
    applyAirDrag(b.vel, air, dt);
    // Everything else (release direction, minimap, chase camera, packets)
    // still thinks in heading/pitch/roll — derive them.
    _euler.setFromQuaternion(b.quat, "YXZ");
    b.pitch = _euler.x;
    b.heading = _euler.y;
    b.roll = _euler.z;
    b.yawRate = av.y;
  } else {
    b.yawRate = THREE.MathUtils.lerp(b.yawRate, input.yaw * YAW_SPEED * sens, dt * YAW_LERP);
    b.heading += b.yawRate * dt;
    if (mode === "angle") {
      const maxTilt = input.sport ? ANGLE_SPORT_TILT : ANGLE_MAX_TILT;
      const ka = 1 - Math.exp(-ANGLE_ATTITUDE_RATE * dt);
      b.pitch += (-input.forward * maxTilt - b.pitch) * ka;
      b.roll += (-input.strafe * maxTilt + b.yawRate * YAW_BANK * 0.5 - b.roll) * ka;
      _euler.set(b.pitch, b.heading, b.roll, "YXZ");
      _q.setFromEuler(_euler);
      _up.set(0, 1, 0).applyQuaternion(_q);
      // Throttle compensates tilt and damps vertical speed (altitude hold).
      const climb =
        input.vertical * ANGLE_CLIMB_ACC * sens * (input.sport ? 1.3 : 1) - b.vel.y * ANGLE_VZ_DAMP;
      const thrust = Math.max(0, (GRAVITY + climb) / Math.max(_up.y, 0.5));
      b.vel.addScaledVector(_up, thrust * dt);
      b.vel.y -= GRAVITY * dt;
      applyAirDrag(b.vel, air, dt);
    } else {
      const speedMul = input.sport ? SPORT_MULTIPLIER : 1;
      const tvF = input.forward * BASE_SPEED * FWD_FACTOR * speedMul * sens;
      const tvS = input.strafe * BASE_SPEED * STRAFE_FACTOR * speedMul * sens;
      const tvY = input.vertical * BASE_SPEED * VERT_FACTOR * speedMul * sens;
      const h = b.heading;
      const fwdX = -Math.sin(h);
      const fwdZ = -Math.cos(h);
      const rightX = Math.cos(h);
      const rightZ = -Math.sin(h);
      b.vel.x = THREE.MathUtils.lerp(b.vel.x, fwdX * tvF + rightX * tvS + air.x * EASY_WIND_DRIFT, dt * VEL_LERP);
      b.vel.z = THREE.MathUtils.lerp(b.vel.z, fwdZ * tvF + rightZ * tvS + air.z * EASY_WIND_DRIFT, dt * VEL_LERP);
      b.vel.y = THREE.MathUtils.lerp(b.vel.y, tvY, dt * VEL_LERP);
    }
  }
  b.pos.addScaledVector(b.vel, dt);
}

// --- Virtual sticks -----------------------------------------------------------
// Keys are on/off, but a real transmitter stick has travel. Holding a key
// pushes the virtual stick out over STICK_RISE_S; letting go springs it back
// fast. Combined with expo() this is what makes Acro controllable from a
// keyboard: tap = small correction, hold = flip.

export interface Sticks {
  forward: number;
  strafe: number;
  vertical: number;
  yaw: number;
}

/** Seconds from centre to full deflection while a key is held. */
const STICK_RISE_S = 0.45;
/** Seconds from full deflection back to centre on release (spring). */
const STICK_FALL_S = 0.12;

export function updateSticks(s: Sticks, target: Sticks, dt: number): Sticks {
  (Object.keys(s) as (keyof Sticks)[]).forEach((k) => {
    const cur = s[k];
    const tgt = target[k];
    // Heading back toward centre (released, or reversed) springs fast; once
    // past centre on a reversal it's travelling outward again at rise speed.
    const returning = Math.abs(tgt) < Math.abs(cur) || (cur !== 0 && Math.sign(tgt) !== Math.sign(cur));
    const step = dt / (returning ? STICK_FALL_S : STICK_RISE_S);
    s[k] = cur < tgt ? Math.min(tgt, cur + step) : Math.max(tgt, cur - step);
  });
  return s;
}

/** Rate expo: output = e·x³ + (1−e)·x. At 30% stick → ~14% rate. */
const EXPO = 0.6;
export function expo(x: number): number {
  return EXPO * x * x * x + (1 - EXPO) * x;
}

/** After collisions: Easy's cosmetic tilt, and (Easy/Angle) the rendered
 *  orientation from heading/pitch/roll with the flip trick spun on top. */
export function finishAttitude(mode: FlightMode, b: FlightBody, input: StickInput, dt: number): void {
  if (mode === "easy") {
    const targetPitch = -input.forward * TILT_AMOUNT;
    const targetRoll = -input.strafe * ROLL_AMOUNT + b.yawRate * YAW_BANK;
    b.pitch = THREE.MathUtils.lerp(b.pitch, targetPitch, dt * TILT_LERP);
    b.roll = THREE.MathUtils.lerp(b.roll, targetRoll, dt * TILT_LERP);
  }
  if (mode === "acro") return;
  _euler.set(b.pitch, b.heading, b.roll, "YXZ");
  b.quat.setFromEuler(_euler);
  if (b.flipT > 0) {
    b.flipT = Math.min(1, b.flipT + dt / FLIP_DURATION);
    const turn = easeInOutCubic(b.flipT) * Math.PI * 2 * b.flipSign;
    _q.setFromAxisAngle(b.flipAxis === "x" ? X_AXIS : Z_AXIS, turn);
    b.quat.multiply(_q);
    if (b.flipT >= 1) b.flipT = 0;
  }
  b.angVel.set(0, 0, 0);
}
