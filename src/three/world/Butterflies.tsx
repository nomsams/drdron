"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { heightAt } from "@/lib/terrain";

interface Flutter {
  cx: number;
  cz: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
  flap: number;
  color: string;
  scale: number;
}

// Butterflies: tiny two-triangle wings over meadow spots, wandering
// lissajous paths a metre off the ground. One useFrame for all. Toggleable.

const SPOTS: { x: number; z: number; color: string }[] = [
  { x: 10, z: -20, color: "#ff9a5c" },
  { x: -15, z: 5, color: "#c0c1ff" },
  { x: 25, z: 15, color: "#4edea3" },
  { x: -5, z: -30, color: "#ffd166" },
  { x: 35, z: 10, color: "#ff9a5c" },
  { x: 0, z: 35, color: "#c0c1ff" },
];

export default function Butterflies() {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<(THREE.Group | null)[]>([]);

  const items = useMemo<Flutter[]>(
    () =>
      SPOTS.map((s, i) => ({
        cx: s.x,
        cz: s.z,
        y: heightAt(s.x, s.z) + 1.1,
        r: 2 + (i % 3),
        speed: 0.5 + (i % 3) * 0.14,
        phase: i * 1.7,
        flap: 9 + (i % 3) * 2,
        color: s.color,
        scale: 0.8 + (i % 2) * 0.3,
      })),
    []
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    items.forEach((b, i) => {
      const g = groups.current[i];
      const w = wings.current[i];
      if (!g || !w) return;
      const a = t * b.speed + b.phase;
      const x = b.cx + Math.sin(a) * b.r + Math.sin(a * 2.3) * 0.5;
      const z = b.cz + Math.cos(a * 0.8) * b.r;
      const prevX = g.position.x;
      const prevZ = g.position.z;
      g.position.set(x, b.y + Math.sin(t * 1.3 + b.phase) * 0.35, z);
      // Face travel direction.
      const dx = x - prevX;
      const dz = z - prevZ;
      if (dx * dx + dz * dz > 1e-8) {
        const target = Math.atan2(dx, dz);
        let d = target - g.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        g.rotation.y += d * 0.15;
      }
      const flap = Math.sin(t * b.flap + b.phase);
      // Two pivots: index 0 = left (−X), 1 = right (+X). Mirrored so tips
      // rise together.
      const left = w.children[0];
      const right = w.children[1];
      if (left) left.rotation.z = -0.3 - flap * 0.9;
      if (right) right.rotation.z = 0.3 + flap * 0.9;
    });
  });

  return (
    <group>
      {items.map((b, i) => (
        <group
          key={i}
          ref={(el) => {
            groups.current[i] = el;
          }}
          scale={b.scale}
        >
          <group
            ref={(el) => {
              wings.current[i] = el;
            }}
          >
            <WingPivot side={-1} color={b.color} />
            <WingPivot side={1} color={b.color} />
          </group>
        </group>
      ))}
    </group>
  );
}

/** Wing hinged at the body: geometry inner edge at x=0 so pivot rotation.z
 *  flaps the tip up/down. Left wing mirrored. */
function WingPivot({ side, color }: { side: -1 | 1; color: string }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.2, 0.26);
    g.translate((0.1 * side) as number, 0, 0);
    return g;
  }, [side]);
  return (
    <group position={[(0.02 * side) as number, 0, 0]}>
      <mesh geometry={geo}>
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
