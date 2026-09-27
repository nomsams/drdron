"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  BALL_AIR_DRAG,
  BALL_BOUNCE_FRICTION,
  BALL_CARRY_DOWN,
  BALL_CARRY_FORWARD,
  BALL_GRAVITY,
  BALL_RADIUS,
  BALL_RESTITUTION,
  HOOP_RIM_RADIUS,
  RACE_HOOPS,
} from "@/config/race";
import { heightAt } from "@/lib/terrain";
import { engineAudio } from "@/lib/audio";
import {
  ball,
  predictBallDrop,
  tryPickupBall,
  tryReleaseBall,
  useRace,
} from "@/state/race";
import { flight, useFlightStore } from "@/state/flight";
import { wind } from "@/state/wind";

// The basketball: a single persistent ball (not a consumable, unlike
// tomatoes) that's either `carried` (riding under the drone, physics
// disabled) or `loose` (real projectile — gravity, air drag, ground bounce).
// Release with G / the HUD 🏀 button; it auto-recatches on a made hoop, or
// waits on the ground for the drone to fly down and hover close (state/race
// handles the pickup radius check).
//
// One useFrame drives everything (no per-frame React work): carry position,
// loose-ball integration, hoop swish detection (current target hoop only),
// bounce, and pickup polling.

const WATER_Y = -0.35;

function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported — ignore */
  }
}

export default function Basketball() {
  const enabled = useRace((s) => s.enabled);
  // Re-render on score/miss/reset (hoop glow, telemetry) — ball position
  // itself is always imperative, never React state.
  const version = useRace((s) => s.version);
  void version;

  const ballGroup = useRef<THREE.Group>(null);
  const lastPickupCheck = useRef(0);

  // G to release (skipped while typing in inputs — same guard as tomatoes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyG") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (tryReleaseBall()) {
        engineAudio.init();
        engineAudio.playDrop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame((_, dtRaw) => {
    if (!enabled) return;
    const dt = Math.min(dtRaw, 0.05);
    const phase = useFlightStore.getState().phase;

    if (ball.state === "carried") {
      const fwdX = -Math.sin(flight.heading);
      const fwdZ = -Math.cos(flight.heading);
      ball.x = flight.pos.x + fwdX * BALL_CARRY_FORWARD;
      ball.y = flight.pos.y - BALL_CARRY_DOWN;
      ball.z = flight.pos.z + fwdZ * BALL_CARRY_FORWARD;
      ball.py = ball.y;
      ball.vx = ball.vy = ball.vz = 0;
    } else {
      // Loose: arcade gravity + air drag toward the wind (a crosswind
      // carries the shot — the predictor arc accounts for it).
      ball.py = ball.y;
      ball.vy -= BALL_GRAVITY * dt;
      const drag = 1 - Math.exp(-BALL_AIR_DRAG * dt);
      ball.vx += (wind.x - ball.vx) * drag;
      ball.vz += (wind.z - ball.vz) * drag;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.z += ball.vz * dt;

      // Hoop swish: crossing the rim plane downward, inside the current
      // target hoop's radius only (in sequence, like the reward rings).
      const race = useRace.getState();
      const hoop = RACE_HOOPS[race.hoopIndex];
      if (hoop) {
        const hoopY = heightAt(hoop.x, hoop.z) + hoop.alt;
        if (ball.vy < 0 && ball.py >= hoopY && ball.y < hoopY) {
          const dx = ball.x - hoop.x;
          const dz = ball.z - hoop.z;
          if (dx * dx + dz * dz < HOOP_RIM_RADIUS * HOOP_RIM_RADIUS) {
            race.scoreHoop();
            engineAudio.playBullseye();
            buzz(60);
            flight.shake = Math.min(0.6, flight.shake + 0.22);
          }
        }
      }

      // Ground / water bounce (only if it didn't just swish and get
      // re-carried above).
      if (ball.state === "loose") {
        const floor = Math.max(heightAt(ball.x, ball.z), WATER_Y) + BALL_RADIUS;
        if (ball.y <= floor) {
          ball.y = floor;
          ball.landed = true;
          if (Math.abs(ball.vy) > 0.6) {
            ball.vy = -ball.vy * BALL_RESTITUTION;
            ball.vx *= BALL_BOUNCE_FRICTION;
            ball.vz *= BALL_BOUNCE_FRICTION;
            if (ball.py > floor + 1) {
              // First real impact after falling — count the miss once.
              useRace.getState().addMiss();
              engineAudio.playSplat();
            }
          } else {
            ball.vy = 0;
            ball.vx *= 0.85;
            ball.vz *= 0.85;
          }
        }
      }

      // Pickup poll at ~10 Hz.
      lastPickupCheck.current += dt;
      if (lastPickupCheck.current > 0.1) {
        lastPickupCheck.current = 0;
        if (phase === "flight" && tryPickupBall()) {
          engineAudio.playCollect();
        }
      }
    }

    const g = ballGroup.current;
    if (g) {
      g.position.set(ball.x, ball.y, ball.z);
      if (ball.state === "loose") {
        g.rotation.x += ball.vz * dt * 0.6;
        g.rotation.z -= ball.vx * dt * 0.6;
      }
    }
  });

  if (!enabled) return null;

  return (
    <group>
      <group ref={ballGroup}>
        <mesh>
          <sphereGeometry args={[BALL_RADIUS, 16, 14]} />
          <meshStandardMaterial color="#e67c3c" roughness={0.55} />
        </mesh>
        {/* Seam lines — cheap flair that reads as "basketball" at a glance. */}
        <mesh rotation={[0, 0, 0]}>
          <torusGeometry args={[BALL_RADIUS, 0.012, 6, 20]} />
          <meshBasicMaterial color="#2a1810" />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[BALL_RADIUS, 0.012, 6, 20]} />
          <meshBasicMaterial color="#2a1810" />
        </mesh>
      </group>
      <BallPredictor />
    </group>
  );
}

// Aim predictor: a gold arc + impact marker showing where the ball will go
// on release, turning emerald when it would swish the current hoop. Only
// meaningful while carried (there's nothing to predict once it's loose).
const PREDICT_MAX_PTS = 34;

function BallPredictor() {
  const phase = useFlightStore((s) => s.phase);
  const enabled = useRace((s) => s.enabled);
  const marker = useRef<THREE.Group>(null);
  const markerMat = useRef<THREE.MeshBasicMaterial>(null);
  const lineMat = useRef<THREE.LineBasicMaterial>(null);

  const positions = useMemo(() => new Float32Array(PREDICT_MAX_PTS * 3), []);
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setDrawRange(0, 0);
    const m = new THREE.LineBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.85, depthWrite: false });
    const l = new THREE.Line(g, m);
    l.frustumCulled = false;
    return l;
  }, [positions]);

  useEffect(
    () => () => {
      lineObj.geometry.dispose();
      (lineObj.material as THREE.Material).dispose();
    },
    [lineObj]
  );

  useFrame(() => {
    const show = enabled && phase === "flight" && ball.state === "carried";
    lineObj.visible = show;
    if (marker.current) marker.current.visible = show;
    if (!show) return;
    const pred = predictBallDrop();
    if (!pred) {
      lineObj.visible = false;
      if (marker.current) marker.current.visible = false;
      return;
    }
    const n = Math.min(pred.points.length, PREDICT_MAX_PTS);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = pred.points[i][0];
      positions[i * 3 + 1] = pred.points[i][1];
      positions[i * 3 + 2] = pred.points[i][2];
    }
    lineObj.geometry.setDrawRange(0, n);
    (lineObj.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    if (lineMat.current) lineMat.current.color.set(pred.scores ? "#4edea3" : "#ffd166");
    const mk = marker.current;
    if (mk) mk.position.set(pred.impact.x, pred.impact.y + 0.1, pred.impact.z);
    if (markerMat.current) markerMat.current.color.set(pred.scores ? "#4edea3" : "#e8eaf6");
  });

  return (
    <>
      <primitive object={lineObj} ref={(l: THREE.Line | null) => {
        if (l) lineMat.current = l.material as THREE.LineBasicMaterial;
      }} />
      <group ref={marker} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.7, 20]} />
          <meshBasicMaterial ref={markerMat} color="#e8eaf6" transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}
