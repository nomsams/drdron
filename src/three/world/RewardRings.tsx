"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { REWARD_RINGS } from "@/config/world";
import { heightAt } from "@/lib/terrain";
import { P } from "@/lib/palette";
import { flight, useFlightStore } from "@/state/flight";
import { engineAudio } from "@/lib/audio";

// Reward ring challenge (airplane-game style): fly through the glowing rings
// in any order. Each is worth points; clearing the loop grants a lap bonus
// and re-arms every ring. A dotted guide path connects them. Toggleable via
// the HUD or the R key — unmounts visuals and detection when off.
//
// Cost: N torus draws + 1 instanced dot path. Detection runs at 10 Hz.

interface RingPose {
  id: string;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  radius: number;
}

const cGold = new THREE.Color(P.gold);
const cPassed = new THREE.Color(P.emerald);

function GuidePath({ points }: { points: THREE.Vector3[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dots = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.4);
    const len = curve.getLength();
    const n = Math.max(24, Math.floor(len / 2.2));
    return curve.getSpacedPoints(n);
  }, [points]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    dots.forEach((p, i) => {
      dummy.position.copy(p);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = dots.length;
  }, [dots]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(dots.length, 1)]} frustumCulled={false}>
      <sphereGeometry args={[0.14, 6, 5]} />
      <meshBasicMaterial color={P.emerald} transparent opacity={0.55} depthWrite={false} />
    </instancedMesh>
  );
}

export default function RewardRings() {
  const enabled = useFlightStore((s) => s.rewardsEnabled);
  const ringsPassed = useFlightStore((s) => s.ringsPassed);

  const rings = useMemo<RingPose[]>(() => {
    const centers = REWARD_RINGS.map(
      (r) => new THREE.Vector3(r.x, heightAt(r.x, r.z) + r.alt, r.z)
    );
    return REWARD_RINGS.map((r, i) => {
      const from = centers[(i - 1 + centers.length) % centers.length];
      const to = centers[(i + 1) % centers.length];
      const tangent = new THREE.Vector3().subVectors(to, from);
      if (tangent.lengthSq() < 1e-6) tangent.set(0, 0, 1);
      tangent.normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        tangent
      );
      return { id: r.id, pos: centers[i], quat, radius: r.radius };
    });
  }, []);

  const matRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  // Ring glow: the expected ring breathes bright gold, other pending rings
  // sit dimmer, passed rings rest emerald.
  useFrame((state) => {
    const passed = useFlightStore.getState().ringsPassed;
    const nextId = REWARD_RINGS[passed.length]?.id;
    const pulse = 0.75 + Math.sin(state.clock.elapsedTime * 2.4) * 0.35;
    rings.forEach((ring, i) => {
      const mat = matRefs.current[i];
      if (!mat) return;
      const done = passed.includes(ring.id);
      const isNext = ring.id === nextId;
      const target = done ? cPassed : cGold;
      mat.color.lerp(target, 0.1);
      mat.emissive.lerp(target, 0.1);
      mat.emissiveIntensity = done ? 0.7 : isNext ? 1.9 * pulse : 0.8;
    });
  });

  // Fly-through detection at 10 Hz — rings count IN SEQUENCE (airplane-game
  // style): only the expected ring can be collected. No per-frame React work.
  useEffect(() => {
    if (!enabled) return;
    const iv = setInterval(() => {
      const st = useFlightStore.getState();
      if (st.phase !== "flight") return;
      const expected = REWARD_RINGS[st.ringsPassed.length];
      if (!expected) return;
      const ring = rings.find((r) => r.id === expected.id);
      if (!ring) return;
      if (flight.pos.distanceTo(ring.pos) < ring.radius) {
        st.collectRing(ring.id, rings.length);
        engineAudio.playCollect();
      }
    }, 100);
    return () => clearInterval(iv);
  }, [enabled, rings]);

  // Next-ring beacon: a soft light pillar so the target is visible far away.
  // Index derives from ringsPassed (re-renders only on collect).
  const expectedId = REWARD_RINGS[ringsPassed.length]?.id;
  const expected = rings.find((r) => r.id === expectedId);

  if (!enabled) return null;

  return (
    <group>
      {rings.map((ring, i) => (
        <mesh key={ring.id} position={ring.pos} quaternion={ring.quat}>
          <torusGeometry args={[ring.radius, 0.26, 10, 28]} />
          <meshStandardMaterial
            ref={(el) => {
              matRefs.current[i] = el;
            }}
            color={P.gold}
            emissive={P.gold}
            emissiveIntensity={1.3}
            toneMapped={false}
            roughness={0.4}
          />
        </mesh>
      ))}
      <GuidePath points={rings.map((r) => r.pos)} />
      {expected && (
        <mesh position={[expected.pos.x, expected.pos.y + 12, expected.pos.z]}>
          <cylinderGeometry args={[0.5, 0.9, 26, 10, 1, true]} />
          <meshBasicMaterial
            color={P.gold}
            transparent
            opacity={0.22}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}
