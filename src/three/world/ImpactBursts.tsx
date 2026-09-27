"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  BURST_LIFE_MS,
  BURST_PARTICLES,
  MAX_BURSTS,
  bursts,
  type BurstKind,
} from "@/state/bursts";

// Impact bursts (state/bursts): every live burst's particles in ONE
// instanced draw call. Particle motion is a closed-form ballistic arc from a
// per-burst seed — no per-particle state to allocate or step.

const PALETTE: Record<BurstKind, string[]> = {
  leaves: ["#3f8f4d", "#5aa864", "#2e6b3a"],
  rock: ["#8a92a3", "#6b7385", "#a9b0bd"],
  dust: ["#a58a63", "#8c7550", "#c2a97f"],
  splash: ["#cfe8ff", "#9cc9f0", "#ffffff"],
  feathers: ["#e8eaf6", "#2e3852", "#c9cde0"],
  sparks: ["#ffd166", "#ffb347", "#fff1c1"],
  repair: ["#4edea3", "#8cffb8", "#c0fff0"],
};

/** Per kind: launch speed (m/s), gravity (m/s², negative floats up), size (m). */
const MOTION: Record<BurstKind, { speed: number; gravity: number; size: number }> = {
  leaves: { speed: 3.2, gravity: 3, size: 0.13 },
  rock: { speed: 4.5, gravity: 14, size: 0.11 },
  dust: { speed: 2.4, gravity: 3, size: 0.16 },
  splash: { speed: 4.8, gravity: 12, size: 0.1 },
  feathers: { speed: 2.2, gravity: 1.2, size: 0.12 },
  sparks: { speed: 6, gravity: 9, size: 0.06 },
  repair: { speed: 1.8, gravity: -2, size: 0.09 },
};

const CAP = MAX_BURSTS * BURST_PARTICLES;

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

export default function ImpactBursts() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  // instanceColor must exist before the first render compiles the shader.
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    for (let i = 0; i < CAP; i++) m.setColorAt(i, color.set("#ffffff"));
    m.count = 0;
  }, [color]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    for (let i = bursts.length - 1; i >= 0; i--) {
      if (now - bursts[i].born > BURST_LIFE_MS) bursts.splice(i, 1);
    }
    let n = 0;
    for (const b of bursts) {
      const age = (now - b.born) / 1000;
      const k = Math.min(1, (now - b.born) / BURST_LIFE_MS);
      const mo = MOTION[b.kind];
      const pal = PALETTE[b.kind];
      for (let p = 0; p < BURST_PARTICLES; p++) {
        const r1 = hash(b.seed + p * 12.9898);
        const r2 = hash(b.seed + p * 78.233);
        const r3 = hash(b.seed + p * 37.719);
        const theta = r1 * Math.PI * 2;
        const up = 0.25 + r2 * 0.75;
        const horiz = Math.sqrt(1 - up * up);
        const sp = mo.speed * (0.5 + r3 * 0.8);
        dummy.position.set(
          b.x + Math.cos(theta) * horiz * sp * age,
          b.y + up * sp * age - 0.5 * mo.gravity * age * age,
          b.z + Math.sin(theta) * horiz * sp * age
        );
        dummy.rotation.set(age * (4 + r1 * 8), age * (3 + r2 * 6), 0);
        dummy.scale.setScalar(mo.size * (1 - k * 0.85));
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
        m.setColorAt(n, color.set(pal[p % pal.length]));
        n++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CAP]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
