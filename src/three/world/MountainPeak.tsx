"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { heightAt } from "@/lib/terrain";
import { MOUNTAIN } from "@/config/world";
import { P } from "@/lib/palette";

const TIERS = [
  { r: 7, h: 15, color: P.canopy },
  { r: 5, h: 11, color: P.grassTip },
  { r: 3.2, h: 9, color: P.rock },
  { r: 1.4, h: 6, color: P.snow },
];

function CloudBand({ y }: { y: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(80 * 3);
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 9;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 3;
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    return arr;
  }, []);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.elapsedTime * 0.03;
  });
  return (
    <points ref={ref} position={[0, y, 0]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={1.4} transparent opacity={0.55} depthWrite={false} sizeAttenuation />
    </points>
  );
}

export default function MountainPeak({ clouds }: { clouds: boolean }) {
  const baseY = useMemo(() => heightAt(MOUNTAIN.x, MOUNTAIN.z), []);

  const segments = useMemo(() => {
    let y = baseY;
    return TIERS.map((tier) => {
      const bottom = y - tier.h * 0.28;
      const centerY = bottom + tier.h / 2;
      y = bottom + tier.h;
      return { ...tier, centerY };
    });
  }, [baseY]);

  return (
    <group position={[MOUNTAIN.x, 0, MOUNTAIN.z]}>
      {segments.map((seg, i) => (
        <mesh key={i} position={[0, seg.centerY, 0]}>
          <coneGeometry args={[seg.r, seg.h, 7]} />
          <meshStandardMaterial color={seg.color} emissive={seg.color} emissiveIntensity={0.22} flatShading roughness={0.95} />
        </mesh>
      ))}
      {clouds && <CloudBand y={baseY + 20} />}
    </group>
  );
}
