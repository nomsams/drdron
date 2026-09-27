"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { flight, keys, useFlightStore } from "@/state/flight";
import { useSettings } from "@/state/settings";
import { engineAudio } from "@/lib/audio";
import { heightAt, getWorldData } from "@/lib/terrain";
import { WORLD, SPAWN } from "@/config/world";
import ProceduralDrone from "./ProceduralDrone";

// Flight model ported from rishabhrathod01.github.io (MIT).
// Simplified: idle hovers above the helipad (no DOM hero-anchor projection),
// so this component has no anchorRef prop and works on any page.

export const IDLE_CAM = new THREE.Vector3(0, 3.2, 12);

const LAUNCH_DURATION = 2.6;

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

// Battery: a fresh pack every takeoff, ~5 min to empty at a gentle hover,
// faster under throttle/sport. Cosmetic + a forced landing at 0% (mirrors a
// real FPV failsafe) — see the FPV goggle HUD for the readout.
const BATTERY_DRAIN_PER_SEC = 1 / 300;

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export default function Drone({ scatter }: { scatter: { trees: number; rocks: number; grass: number } }) {
  const group = useRef<THREE.Group>(null);
  const phase = useFlightStore((s) => s.phase);
  const setPhase = useFlightStore((s) => s.setPhase);

  const launch = useRef({ t: 0, from: new THREE.Vector3(), active: false });
  const crashCooldown = useRef(0);
  const batteryLandTriggered = useRef(false);
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
    if (group.current) group.current.rotation.order = "YXZ";
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
        setPhase("flight");
      }
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

    // phase === "flight": full physics
    const throttleF = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
    const throttleS = (keys.strafeRight ? 1 : 0) - (keys.strafeLeft ? 1 : 0);
    const throttleY = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const yawInput = (keys.yawLeft ? 1 : 0) - (keys.yawRight ? 1 : 0);
    flight.sport = keys.sport;

    const speedMul = flight.sport ? SPORT_MULTIPLIER : 1;
    const sens = useSettings.getState().sensitivity;
    const tvF = throttleF * BASE_SPEED * FWD_FACTOR * speedMul * sens;
    const tvS = throttleS * BASE_SPEED * STRAFE_FACTOR * speedMul * sens;
    const tvY = throttleY * BASE_SPEED * VERT_FACTOR * speedMul * sens;

    flight.yawRate = THREE.MathUtils.lerp(flight.yawRate, yawInput * YAW_SPEED * sens, dt * YAW_LERP);
    flight.heading += flight.yawRate * dt;

    const h = flight.heading;
    const fwdX = -Math.sin(h);
    const fwdZ = -Math.cos(h);
    const rightX = Math.cos(h);
    const rightZ = -Math.sin(h);

    const vel = flight.vel;
    vel.x = THREE.MathUtils.lerp(vel.x, fwdX * tvF + rightX * tvS, dt * VEL_LERP);
    vel.z = THREE.MathUtils.lerp(vel.z, fwdZ * tvF + rightZ * tvS, dt * VEL_LERP);
    vel.y = THREE.MathUtils.lerp(vel.y, tvY, dt * VEL_LERP);

    const pos = flight.pos;
    pos.addScaledVector(vel, dt);

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

    // Terrain clamp (heightAt is the collision engine).
    const ground = heightAt(pos.x, pos.z);
    const minY = ground + 0.8;
    if (pos.y < minY) {
      if (vel.y < -6 && crashCooldown.current <= 0) {
        engineAudio.playCrash();
        flight.shake = 0.4;
        crashCooldown.current = 0.8;
      }
      pos.y = minY;
      if (vel.y < 0) vel.y = 0;
    }
    pos.y = Math.min(pos.y, WORLD.maxAltitude);

    // Obstacle cylinders (trees/rocks/landmarks), brute-force 2D.
    crashCooldown.current -= dt;
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
          if (Math.abs(vdotn) > 3 && crashCooldown.current <= 0) {
            engineAudio.playCrash();
            flight.shake = 0.3;
            crashCooldown.current = 0.8;
          }
        }
      }
    }

    const targetPitch = -throttleF * TILT_AMOUNT;
    const targetRoll = -throttleS * ROLL_AMOUNT + flight.yawRate * YAW_BANK;
    flight.pitch = THREE.MathUtils.lerp(flight.pitch, targetPitch, dt * TILT_LERP);
    flight.roll = THREE.MathUtils.lerp(flight.roll, targetRoll, dt * TILT_LERP);

    g.position.copy(pos);
    g.rotation.set(flight.pitch, flight.heading, flight.roll);

    const speed = vel.length();
    flight.speedKmh = speed * 3.6;
    flight.altitude = Math.max(pos.y - ground, 0);
    flight.propSpin = Math.min(1, 0.55 + speed / 25);
    flight.throttleTotal =
      Math.abs(throttleF) + Math.abs(throttleS) + Math.abs(throttleY) + Math.abs(yawInput) * 0.5;
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
