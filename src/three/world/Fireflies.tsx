"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { flight } from "@/state/flight";
import { P } from "@/lib/palette";

// Fireflies as a raw Points cloud (upstream uses drei <Sparkles> — same look,
// no extra dependency). Only mounted on high/ultra tiers and after sunset.

export default function Fireflies({ count = 110 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const seed = useMemo(() => {
    const arr = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 130;
      arr[i * 3 + 1] = 1 + Math.random() * 7;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 130;
      phase[i] = Math.random() * Math.PI * 2;
    }
    return { arr, phase };
  }, [count]);

  useFrame((state) => {
    const pts = ref.current;
    if (!pts) return;
    pts.rotation.y = state.clock.elapsedTime * 0.02;
    const mat = pts.material as THREE.PointsMaterial;
    mat.opacity = 0.45 + Math.sin(state.clock.elapsedTime * 1.4) * 0.2;
  });

  // Gate on day cycle at the parent level; this component just renders.
  void flight;
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[seed.arr, 3]} />
      </bufferGeometry>
      <pointsMaterial color={P.emerald} size={0.35} transparent opacity={0.6} depthWrite={false} sizeAttenuation />
    </points>
  );
}
