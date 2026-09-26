"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

// Drifting clouds: a handful of flattened white puffs circling high above
// the island. Unlit + transparent, one useFrame for all. Toggle in settings.

interface Puff {
  x: number;
  y: number;
  z: number;
  scale: number;
  speed: number;
}

export default function Clouds({ count = 8 }: { count?: number }) {
  const group = useRef<THREE.Group>(null);

  const puffs = useMemo<Puff[]>(() => {
    const arr: Puff[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x: ((i * 53) % 140) - 70,
        y: 30 + ((i * 29) % 12),
        z: ((i * 91) % 140) - 70,
        scale: 5 + ((i * 17) % 6),
        speed: 0.5 + ((i * 13) % 5) * 0.12,
      });
    }
    return arr;
  }, [count]);

  useFrame((_, dtRaw) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(dtRaw, 0.1);
    g.children.forEach((child, i) => {
      const p = puffs[i];
      child.position.x += p.speed * dt;
      if (child.position.x > 85) child.position.x = -85;
    });
  });

  return (
    <group ref={group}>
      {puffs.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]} scale={[p.scale, p.scale * 0.42, p.scale * 0.7]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color="#f4f7ff" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
