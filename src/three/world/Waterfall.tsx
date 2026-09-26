"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { heightAt } from "@/lib/terrain";
import { WATERFALL } from "@/config/world";
import { P } from "@/lib/palette";

const ROCKS = [
  { x: 0, z: 0, s: 3.2, h: 8, rot: 0 },
  { x: -2.4, z: 1.4, s: 2.1, h: 5.5, rot: 1.1 },
  { x: 2.6, z: 1.1, s: 2.4, h: 6, rot: 2.3 },
];

const CASCADES = [
  { x: -0.5, z: 0.4, w: 1.1, topY: 7.2, botY: 0.3 },
  { x: 0.7, z: -0.1, w: 0.9, topY: 6.3, botY: 0.3 },
];

/** Small tileable streak texture, scrolled each frame for a flowing look. */
function buildStreakTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#bfe3ff";
  ctx.fillRect(0, 0, 32, 64);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const x = (i * 7) % 32;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 4, 64);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  return tex;
}

/** Cheap mist sprite: a Points cloud drifting upward, no shader needed. */
function Mist({ count = 40 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 4;
      arr[i * 3 + 1] = Math.random() * 2;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    return arr;
  }, [count]);
  useFrame((state) => {
    const pts = ref.current;
    if (!pts) return;
    pts.rotation.y = state.clock.elapsedTime * 0.15;
    pts.position.y = 0.6 + Math.sin(state.clock.elapsedTime * 0.8) * 0.15;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={0.35} transparent opacity={0.6} depthWrite={false} sizeAttenuation />
    </points>
  );
}

export default function Waterfall({ mist }: { mist: boolean }) {
  const baseY = useMemo(() => heightAt(WATERFALL.x, WATERFALL.z), []);
  const texture = useMemo(buildStreakTexture, []);

  useFrame((_, dt) => {
    texture.offset.y -= dt * 0.6;
  });

  return (
    <group position={[WATERFALL.x, baseY, WATERFALL.z]}>
      {ROCKS.map((r, i) => (
        <mesh key={i} position={[r.x, r.h / 2 - 0.3, r.z]} scale={[r.s, r.h / 3, r.s]} rotation={[0.15, r.rot, 0.08]}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={P.rock} emissive={P.rock} emissiveIntensity={0.18} flatShading roughness={0.9} />
        </mesh>
      ))}
      {CASCADES.map((c, i) => (
        <mesh key={i} position={[c.x, (c.topY + c.botY) / 2, c.z]}>
          <planeGeometry args={[c.w, c.topY - c.botY]} />
          <meshBasicMaterial map={texture} transparent opacity={0.85} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {mist && <Mist />}
    </group>
  );
}
