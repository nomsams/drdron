"use client";

import { useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { WINDSOCKS, WINDSOCK_POLE_H } from "@/config/world";
import { heightAt } from "@/lib/terrain";
import { updateWind, wind } from "@/state/wind";

// Airfield windsocks: a striped orange/white sock on a steel pole. It swings
// to point DOWNWIND and lifts with wind speed — hanging limp in calm air,
// streaming straight out at ~8 m/s — and flutters harder in gusts. Built as
// a chain of tapering segments, each drooping a little more than the last,
// so a half-filled sock sags into a curve the way a real one does.

const SEGMENTS = 5;
const SEG_LEN = 0.46;
const MOUTH_R = 0.32;
const TAIL_R = 0.13;
/** Wind speed (m/s) at which the sock streams fully horizontal. */
const FULL_SPEED = 8;
/** Droop (rad) of the whole sock in dead calm. */
const CALM_DROOP = 1.35;

function Sock({ x, z }: { x: number; z: number }) {
  const base = useMemo(() => heightAt(x, z), [x, z]);
  const pivot = useRef<THREE.Group>(null);
  const segs = useRef<(THREE.Group | null)[]>([]);

  const materials = useMemo(
    () => [
      new THREE.MeshStandardMaterial({ color: "#ff6a2b", side: THREE.DoubleSide, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: "#f2f2ee", side: THREE.DoubleSide, roughness: 0.7 }),
    ],
    []
  );
  const geos = useMemo(
    () =>
      Array.from({ length: SEGMENTS }, (_, i) => {
        const r0 = MOUTH_R + ((TAIL_R - MOUTH_R) * i) / SEGMENTS;
        const r1 = MOUTH_R + ((TAIL_R - MOUTH_R) * (i + 1)) / SEGMENTS;
        // Cylinder axis is Y; lay it along +X, starting at the group origin.
        const g = new THREE.CylinderGeometry(r1, r0, SEG_LEN, 12, 1, true);
        g.rotateZ(-Math.PI / 2);
        g.translate(SEG_LEN / 2, 0, 0);
        return g;
      }),
    []
  );

  useFrame((state) => {
    updateWind();
    const t = state.clock.elapsedTime;
    const s = Math.min(1, wind.speed / FULL_SPEED);
    const flutter = (0.04 + 0.1 * s + wind.gust * 0.25) * (s > 0.05 ? 1 : 0.2);
    if (pivot.current) {
      // Sock is built along +X; rotating by −dir about Y points it along
      // (cos dir, 0, sin dir) — the direction the wind blows toward.
      pivot.current.rotation.y = -wind.dir + Math.sin(t * (3 + 5 * s)) * flutter * 0.6;
    }
    const droop = (1 - s) * CALM_DROOP;
    segs.current.forEach((g, i) => {
      if (!g) return;
      // Later segments sag more (a half-full sock curves down at the tail).
      const share = (droop * (0.6 + 0.2 * i)) / SEGMENTS;
      g.rotation.z = -share + Math.sin(t * (6 + 6 * s) + i * 0.9) * flutter * 0.35;
    });
  });

  // Chain the segments: each is a child of the previous one's tip.
  let chain: ReactElement | null = null;
  for (let i = SEGMENTS - 1; i >= 0; i--) {
    chain = (
      <group
        key={i}
        position={[i === 0 ? 0 : SEG_LEN, 0, 0]}
        ref={(el) => {
          segs.current[i] = el;
        }}
      >
        <mesh geometry={geos[i]} material={materials[i % 2]} />
        {chain}
      </group>
    );
  }

  return (
    <group position={[x, base, z]}>
      <mesh position={[0, WINDSOCK_POLE_H / 2, 0]}>
        <cylinderGeometry args={[0.06, 0.09, WINDSOCK_POLE_H, 8]} />
        <meshStandardMaterial color="#9aa3ad" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.35, 0.4, 0.2, 10]} />
        <meshStandardMaterial color="#6b7385" roughness={0.8} />
      </mesh>
      <group ref={pivot} position={[0, WINDSOCK_POLE_H - 0.15, 0]}>
        {/* swivel collar + mouth ring */}
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[MOUTH_R, 0.025, 6, 20]} />
          <meshStandardMaterial color="#c9ced6" metalness={0.5} roughness={0.4} />
        </mesh>
        {chain}
      </group>
    </group>
  );
}

export default function Windsocks() {
  return (
    <>
      {WINDSOCKS.map((w) => (
        <Sock key={w.id} x={w.x} z={w.z} />
      ))}
    </>
  );
}
