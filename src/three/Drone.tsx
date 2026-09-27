"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { flight, keys, useFlightStore } from "@/state/flight";
import { useSettings } from "@/state/settings";
import { applyHit, repairHull } from "@/state/hull";
import { engineAudio } from "@/lib/audio";
import { heightAt, getWorldData } from "@/lib/terrain";
import { WORLD, SPAWN, PAD } from "@/config/world";
import {
  HP_MAX,
  PAD_REPAIR_MAX_ALT,
  PAD_REPAIR_MAX_SPEED,
  PAD_REPAIR_PER_SEC,
} from "@/config/hull";
import { predictedRemote, remoteStates } from "@/net/mp";
import { updateWind } from "@/state/wind";
import { finishAttitude, stepFlight, updateSticks, type Sticks } from "@/lib/flightModel";
import ProceduralDrone from "./ProceduralDrone";
import { birdMarks, knockBird } from "./world/Birds";

// Flight model ported from rishabhrathod01.github.io (MIT).
// Simplified: idle hovers above the helipad (no DOM hero-anchor projection),
// so this component has no anchorRef prop and works on any page.

export const IDLE_CAM = new THREE.Vector3(0, 3.2, 12);

// FPV needs to NOT see the drone's own body — a camera glued to the nose is
// necessarily near/inside the fuselage/nose-cone/arm geometry, and any fixed
// offset that "clears" it during level flight ends up back inside it during
// a pitch/roll maneuver (the reported flicker). Rather than chase a moving
// target with an offset tweak, the local body renders on its own layer and
// the FPV camera simply doesn't have that layer enabled — see ChaseCamera.
export const OWN_BODY_LAYER = 1;

const LAUNCH_DURATION = 2.6;

/** Virtual stick positions (Angle/Acro) — see flightModel.updateSticks. */
const sticks: Sticks = { forward: 0, strafe: 0, vertical: 0, yaw: 0 };


// Battery: a fresh pack every takeoff, ~5 min to empty at a gentle hover,
// faster under throttle/sport. Cosmetic + a forced landing at 0% (mirrors a
// real FPV failsafe) — see the FPV goggle HUD for the readout.
const BATTERY_DRAIN_PER_SEC = 1 / 300;

// Collisions (hull damage lives in state/hull + config/hull).
const WATER_Y = -0.35;
/** Drone centre stays this far above the surface (ground or water). */
const HOVER_CLEARANCE = 0.8;
const BIRD_HIT_RADIUS = 1.1;
/** Two drones' centres closer than this are touching (~0.65 m each). */
const PILOT_HIT_RADIUS = 1.3;
/** Only pilots heard from recently count as solid. */
const PILOT_FRESH_MS = 1500;
/** Bounce: how much of the into-contact velocity is reflected. */
const PILOT_RESTITUTION = 0.6;

const _pilot = { x: 0, y: 0, z: 0 };

/** Terrain surface normal via central differences on heightAt. */
function terrainNormal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.5;
  const dhdx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dhdz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return out.set(-dhdx, 1, -dhdz).normalize();
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export default function Drone({ scatter }: { scatter: { trees: number; rocks: number; grass: number } }) {
  const group = useRef<THREE.Group>(null);
  const phase = useFlightStore((s) => s.phase);
  const setPhase = useFlightStore((s) => s.setPhase);

  const launch = useRef({ t: 0, from: new THREE.Vector3(), active: false });
  const batteryLandTriggered = useRef(false);
  const surfaceN = useMemo(() => new THREE.Vector3(), []);
  // Idle hover sits in front of the camera (which looks at IDLE_LOOK), so the
  // hero shot always shows the drone. Right of the copy on desktop, near
  // center on small screens. Launch arcs from here to the pad.
  const [idleX, setIdleX] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 900 ? 0.4 : 2.4
  );
  useEffect(() => {
    const onResize = () => setIdleX(window.innerWidth < 900 ? 0.4 : 2.4);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const idleHover = useMemo(() => new THREE.Vector3(idleX, 3.0, 8), [idleX]);
  const spawnPos = useMemo(
    () => new THREE.Vector3(SPAWN.x, heightAt(SPAWN.x, SPAWN.z) + SPAWN.hover + 3.8, SPAWN.z),
    []
  );

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.rotation.order = "YXZ";
    // Own body on its own layer (see OWN_BODY_LAYER) so the FPV camera —
    // which only enables the default layer — never renders it.
    g.traverse((o) => o.layers.set(OWN_BODY_LAYER));
  }, []);

  useEffect(() => {
    if (phase === "launching" && group.current) {
      launch.current.t = 0;
      launch.current.from.copy(group.current.position);
      launch.current.active = true;
      batteryLandTriggered.current = false;
    }
  }, [phase]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const t = state.clock.elapsedTime;
    const g = group.current;
    if (!g) return;

    if (phase === "idle" || phase === "charging") {
      // Gentle hover at eye level. Base yaw 0.65 shows the sunlit right flank
      // (the hero sun sits at +X); a slow sway keeps it alive. A straight
      // rear view would be all dark battery/carbon, so never settle at 0.
      const bobY = Math.sin(t * 1.2) * 0.12;
      const swayX = Math.sin(t * 0.3) * 0.25;
      g.position.set(idleHover.x + swayX, idleHover.y + bobY, idleHover.z);
      g.rotation.y = 0.65 + Math.sin(t * 0.35) * 0.3;
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, phase === "charging" ? -0.06 : 0, dt * 4);
      g.rotation.z = 0;
      flight.propSpin = phase === "charging" ? 0.15 + flight.charge * 0.65 : 0.15;
      if (phase === "charging") {
        engineAudio.setHum(flight.charge * 0.7);
        engineAudio.setThrottle(flight.charge * 0.8);
      }
      flight.pos.copy(g.position);
      return;
    }

    if (phase === "launching") {
      launch.current.t += dt;
      const e = Math.min(launch.current.t / LAUNCH_DURATION, 1);
      const k = easeInOutCubic(e);
      g.position.lerpVectors(launch.current.from, spawnPos, k);
      g.position.y += Math.sin(k * Math.PI) * 2.2;
      g.rotation.x = Math.sin(k * Math.PI) * -0.14;
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, 0, k);
      g.rotation.z = 0;
      flight.propSpin = Math.min(1, 0.15 + e * 1.6);
      engineAudio.setHum(Math.min(1, 0.3 + e));
      engineAudio.setThrottle(0.8 + e * 1.2);
      flight.pos.copy(g.position);
      if (e >= 1) {
        flight.pos.copy(spawnPos);
        flight.vel.set(0, 0, 0);
        flight.heading = 0;
        flight.pitch = 0;
        flight.roll = 0;
        flight.quat.identity();
        flight.angVel.set(0, 0, 0);
        setPhase("flight");
      }
      return;
    }

    if (phase === "landing" && flight.downed) {
      // HP hit 0: motors out. Tumble and fall under gravity (keeping some of
      // the crash momentum) until it hits the surface, then lie there until
      // the respawn fade (DroneExperience's crash sequence).
      const v = flight.vel;
      v.y -= 18 * dt;
      v.x *= 1 - dt * 0.8;
      v.z *= 1 - dt * 0.8;
      flight.pos.addScaledVector(v, dt);
      const floor = Math.max(heightAt(flight.pos.x, flight.pos.z), WATER_Y) + 0.3;
      if (flight.pos.y <= floor) {
        flight.pos.y = floor;
        v.set(0, 0, 0);
      } else {
        g.rotation.x += dt * 3.4;
        g.rotation.z += dt * 2.2;
      }
      g.position.copy(flight.pos);
      flight.propSpin = THREE.MathUtils.lerp(flight.propSpin, 0, dt * 2.5);
      engineAudio.setHum(0);
      return;
    }

    if (phase === "landing") {
      flight.propSpin = THREE.MathUtils.lerp(flight.propSpin, 0.45, dt * 3);
      g.position.set(flight.pos.x, flight.pos.y + Math.sin(t * 1.4) * 0.06, flight.pos.z);
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, 0, dt * 4);
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, flight.heading, dt * 4);
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, 0, dt * 4);
      engineAudio.setHum(0.5);
      engineAudio.setThrottle(0.3);
      return;
    }

    // phase === "flight": full physics (src/lib/flightModel.ts)
    const raw = {
      forward: (keys.forward ? 1 : 0) - (keys.back ? 1 : 0),
      strafe: (keys.strafeRight ? 1 : 0) - (keys.strafeLeft ? 1 : 0),
      vertical: (keys.up ? 1 : 0) - (keys.down ? 1 : 0),
      yaw: (keys.yawLeft ? 1 : 0) - (keys.yawRight ? 1 : 0),
    };
    flight.sport = keys.sport;

    const settings = useSettings.getState();
    const mode = settings.flightMode;
    // Easy keeps its crisp on/off feel; Angle/Acro get virtual stick travel
    // (tap = small correction, hold = full deflection) — see updateSticks.
    updateSticks(sticks, raw, dt);
    const input = { ...(mode === "easy" ? raw : sticks), sport: flight.sport, sens: settings.sensitivity };
    const w = updateWind();
    const vel = flight.vel;
    const pos = flight.pos;
    stepFlight(mode, flight, input, w, dt);


    // Geofence: soft inward push past the soft radius.
    const r = Math.hypot(pos.x, pos.z);
    if (r > WORLD.softRadius) {
      const inward = -(r - WORLD.softRadius) * 2.2;
      vel.x += (pos.x / r) * inward * dt * 10;
      vel.z += (pos.z / r) * inward * dt * 10;
      flight.geofence = true;
    } else {
      flight.geofence = false;
    }
    if (r > WORLD.hardRadius) {
      const s = WORLD.hardRadius / r;
      pos.x *= s;
      pos.z *= s;
    }

    // Surface clamp: terrain, or the water plane where terrain dips below it
    // (heightAt is the collision engine). Impact speed is the velocity into
    // the surface along its normal — skimming low over flat ground is free,
    // a hard descent or flying fast into a hillside is not (config/hull).
    const terrain = heightAt(pos.x, pos.z);
    const onWater = terrain < WATER_Y;
    const surface = onWater ? WATER_Y : terrain;
    const minY = surface + HOVER_CLEARANCE;
    if (pos.y < minY) {
      const n = onWater ? surfaceN.set(0, 1, 0) : terrainNormal(pos.x, pos.z, surfaceN);
      const into = -vel.dot(n);
      if (into > 0) applyHit(onWater ? "water" : "ground", into, { x: pos.x, y: surface + 0.1, z: pos.z });
      pos.y = minY;
      if (vel.y < 0) vel.y = 0;
    }
    pos.y = Math.min(pos.y, WORLD.maxAltitude);

    // Obstacle cylinders (trees/rocks/landmarks), brute-force 2D.
    const { colliders } = getWorldData(scatter);
    for (const c of colliders) {
      if (pos.y > c.top) continue;
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const rr = c.r + 0.45;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        pos.x = c.x + nx * rr;
        pos.z = c.z + nz * rr;
        const vdotn = vel.x * nx + vel.z * nz;
        if (vdotn < 0) {
          vel.x = (vel.x - 2 * vdotn * nx) * 0.45;
          vel.z = (vel.z - 2 * vdotn * nz) * 0.45;
          applyHit(c.kind, -vdotn, { x: c.x + nx * c.r, y: pos.y, z: c.z + nz * c.r });
        }
      }
    }

    // Bird strikes (only while the flock is mounted). Relative speed, since
    // a bird flying into you hurts as much as you flying into it.
    for (let i = 0; i < birdMarks.length; i++) {
      const b = birdMarks[i];
      if (!b) continue;
      const bx = b.x - pos.x;
      const by = b.y - pos.y;
      const bz = b.z - pos.z;
      if (bx * bx + by * by + bz * bz > BIRD_HIT_RADIUS * BIRD_HIT_RADIUS) continue;
      if (!knockBird(i, bx, by, bz)) continue; // this bird was just hit
      const rel = Math.hypot(vel.x - b.vx, vel.y - b.vy, vel.z - b.vz);
      applyHit("bird", rel, { x: pos.x + bx / 2, y: pos.y + by / 2, z: pos.z + bz / 2 });
      vel.multiplyScalar(0.8);
    }

    // Pilot-vs-pilot bumps. Each client resolves its own side against the
    // other's dead-reckoned ghost, so both drones bounce and both take the
    // hit without any authority deciding who hit whom.
    const nowMs = Date.now();
    for (const st of remoteStates.values()) {
      if (!st.flying || st.hp <= 0 || nowMs - st.seen > PILOT_FRESH_MS) continue;
      const p = predictedRemote(st, _pilot);
      const px = pos.x - p.x;
      const py = pos.y - p.y;
      const pz = pos.z - p.z;
      const d2 = px * px + py * py + pz * pz;
      if (d2 >= PILOT_HIT_RADIUS * PILOT_HIT_RADIUS || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = px / d;
      const ny = py / d;
      const nz = pz / d;
      pos.set(p.x + nx * PILOT_HIT_RADIUS, p.y + ny * PILOT_HIT_RADIUS, p.z + nz * PILOT_HIT_RADIUS);
      const vn = (vel.x - st.vx) * nx + (vel.y - st.vy) * ny + (vel.z - st.vz) * nz;
      if (vn < 0) {
        const k = -(1 + PILOT_RESTITUTION) * vn * 0.5;
        vel.x += nx * k;
        vel.y += ny * k;
        vel.z += nz * k;
        applyHit("pilot", -vn, { x: p.x + nx * 0.65, y: p.y + ny * 0.65, z: p.z + nz * 0.65 });
      }
    }

    finishAttitude(mode, flight, input, dt);

    g.position.copy(pos);
    g.quaternion.copy(flight.quat);

    const speed = vel.length();
    flight.speedKmh = speed * 3.6;
    flight.altitude = Math.max(pos.y - surface, 0);

    // Helipad pit stop: hover low and slow over the pad to repair.
    const padDist = Math.hypot(pos.x - PAD.x, pos.z - PAD.z);
    flight.repairing =
      flight.hp < HP_MAX &&
      padDist < PAD.r &&
      flight.altitude < PAD_REPAIR_MAX_ALT &&
      speed < PAD_REPAIR_MAX_SPEED;
    if (flight.repairing) repairHull(PAD_REPAIR_PER_SEC * dt, { quiet: true });
    flight.propSpin = Math.min(1, 0.55 + speed / 25);
    flight.throttleTotal =
      Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.vertical) + Math.abs(input.yaw) * 0.5;
    engineAudio.setHum(1);
    engineAudio.setThrottle(flight.throttleTotal * (flight.sport ? 1.4 : 1));

    flight.flightElapsed += dt;
    const drain =
      BATTERY_DRAIN_PER_SEC * (0.55 + 0.9 * flight.throttleTotal) * (flight.sport ? 1.35 : 1);
    flight.battery = Math.max(0, flight.battery - drain * dt);
    if (flight.battery <= 0 && !batteryLandTriggered.current) {
      batteryLandTriggered.current = true;
      (window as unknown as { __flyjsLand?: () => void }).__flyjsLand?.();
    }
  });

  return (
    <group ref={group}>
      <ProceduralDrone />
    </group>
  );
}
