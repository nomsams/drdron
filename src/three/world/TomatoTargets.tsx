"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { TOMATO_TARGETS } from "@/config/tomato";
import { heightAt } from "@/lib/terrain";
import { isTargetDown, useTomato } from "@/state/tomato";

// Bullseye targets for tomato bombing: a soil disc + white ring + red heart,
// with a flag pole so they read over ridges and a gentle emissive pulse at
// distance. Smashed targets hide until the respawn sweep (see Tomatoes.tsx
// interval calling sweepTomatoWorld) pops them back. Toggle via HUD 🍅.

interface Pose {
  id: string;
  x: number;
  y: number;
  z: number;
}

function Target({ pose, centerRef }: { pose: Pose; centerRef: (el: THREE.MeshStandardMaterial | null) => void }) {
  return (
    <group position={[pose.x, pose.y, pose.z]}>
      {/* soil disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <circleGeometry args={[2.6, 24]} />
        <meshStandardMaterial color="#4a3a28" roughness={1} />
      </mesh>
      {/* white ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
        <ringGeometry args={[1.0, 1.8, 24]} />
        <meshStandardMaterial color="#f2ead8" roughness={0.8} />
      </mesh>
      {/* red heart */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.95, 1.0, 0.3, 20]} />
        <meshStandardMaterial
          ref={centerRef}
          color="#d43a2a"
          emissive="#d43a2a"
          emissiveIntensity={0.7}
          roughness={0.6}
        />
      </mesh>
      {/* marker pole + flag so targets are visible over ridges */}
      <mesh position={[0, 1.4, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 2.4, 6]} />
        <meshStandardMaterial color="#8a7a5a" roughness={0.9} />
      </mesh>
      <mesh position={[0.45, 2.3, 0]}>
        <boxGeometry args={[0.9, 0.55, 0.04]} />
        <meshStandardMaterial
          color="#e23b2e"
          emissive="#e23b2e"
          emissiveIntensity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export default function TomatoTargets() {
  const enabled = useTomato((s) => s.enabled);
  // Re-render on hits / respawns / reset.
  useTomato((s) => s.version);

  const poses = useMemo<Pose[]>(
    () =>
      TOMATO_TARGETS.map((t) => ({
        id: t.id,
        x: t.x,
        y: heightAt(t.x, t.z),
        z: t.z,
      })),
    []
  );

  const centerMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  useFrame((state) => {
    const pulse = 0.55 + (Math.sin(state.clock.elapsedTime * 2.2) * 0.5 + 0.5) * 0.5;
    for (const m of centerMats.current) {
      if (m) m.emissiveIntensity = pulse;
    }
  });

  if (!enabled) return null;

  const standing = poses.filter((p) => !isTargetDown(p.id));
  if (standing.length === 0) return null;

  return (
    <group>
      {standing.map((p, i) => (
        <Target
          key={p.id}
          pose={p}
          centerRef={(el) => {
            centerMats.current[i] = el;
          }}
        />
      ))}
    </group>
  );
}
