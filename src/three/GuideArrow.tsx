"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { REWARD_RINGS } from "@/config/world";
import { heightAt } from "@/lib/terrain";
import { P } from "@/lib/palette";
import { flight, useFlightStore } from "@/state/flight";

// Guide arrow: a small gold chevron hovering above the drone, leaning toward
// the next expected ring. Cheaper and more reliable than projecting to DOM,
// and it works at any camera angle. Hidden when rings are off, when idle,
// or when right on top of the target.

const UP = new THREE.Vector3(0, 1, 0);

export default function GuideArrow() {
  const group = useRef<THREE.Group>(null);
  const cone = useRef<THREE.Mesh>(null);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  const targets = useMemo(
    () =>
      REWARD_RINGS.map(
        (r) => new THREE.Vector3(r.x, heightAt(r.x, r.z) + r.alt, r.z)
      ),
    []
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const st = useFlightStore.getState();
    const show =
      st.rewardsEnabled && st.phase === "flight" && st.ringsPassed.length < targets.length;
    g.visible = show;
    if (!show) return;
    target.copy(targets[st.ringsPassed.length]);
    dir.subVectors(target, flight.pos);
    const dist = dir.length();
    // Park overhead and lean toward the target; tuck away when inside it.
    g.visible = dist > 2.5;
    if (!g.visible) return;
    g.position.set(flight.pos.x, flight.pos.y + 1.5, flight.pos.z);
    dir.normalize();
    // Lean the up-vector toward the target (banked pointer feel).
    up.copy(UP).lerp(dir, 0.55).normalize();
    quat.setFromUnitVectors(UP, up);
    g.quaternion.slerp(quat, 0.12);
    const s = 1 + Math.sin(state.clock.elapsedTime * 4) * 0.12;
    g.scale.setScalar(s);
  });

  return (
    <group ref={group} visible={false}>
      <mesh ref={cone}>
        <coneGeometry args={[0.28, 0.7, 6]} />
        <meshBasicMaterial color={P.gold} transparent opacity={0.9} toneMapped={false} />
      </mesh>
    </group>
  );
}
