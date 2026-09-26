"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { POND, BEACH } from "@/config/world";

// Living water without shaders: expanding ripple rings on the pond and the
// beach shallows. 5 flat additive rings cycling scale + fade. Toggleable.

interface Ripple {
  x: number;
  z: number;
  maxR: number;
  speed: number;
  offset: number;
}

export default function WaterRipples() {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  const ripples = useMemo<Ripple[]>(
    () => [
      { x: POND.x, z: POND.z, maxR: 9, speed: 0.22, offset: 0 },
      { x: POND.x + 3, z: POND.z - 2, maxR: 6, speed: 0.3, offset: 0.4 },
      { x: BEACH.x - 4, z: BEACH.z + 2, maxR: 10, speed: 0.18, offset: 0.2 },
      { x: BEACH.x + 5, z: BEACH.z - 4, maxR: 7, speed: 0.26, offset: 0.7 },
      { x: 0, z: -30, maxR: 12, speed: 0.15, offset: 0.5 }, // open water south
    ],
    []
  );

  // Water disc sits at y=-0.35 (see Island); ripples float just above it.

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ripples.forEach((r, i) => {
      const m = refs.current[i];
      const mat = mats.current[i];
      if (!m || !mat) return;
      const k = (t * r.speed + r.offset) % 1;
      const s = 1 + k * r.maxR;
      m.scale.set(s, s, 1);
      mat.opacity = 0.4 * (1 - k);
    });
  });

  return (
    <group>
      {ripples.map((r, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[r.x, -0.3, r.z]}
        >
          <ringGeometry args={[0.85, 1, 40]} />
          <meshBasicMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            color="#bfe3ff"
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
