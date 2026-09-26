"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PICKUPS } from "@/config/world";
import { heightAt } from "@/lib/terrain";
import { P } from "@/lib/palette";
import { flight, pickups, registerPickup, useFlightStore } from "@/state/flight";
import { engineAudio } from "@/lib/audio";

// Generic collectible pickups — the exploration easter egg without any CV
// meaning. Proximity is checked at 10 Hz (not per frame, no React churn).

function Cell({ id, x, z, yOffset }: { id: string; x: number; z: number; yOffset: number }) {
  const group = useRef<THREE.Group>(null);
  const y = heightAt(x, z) + yOffset;

  useEffect(() => registerPickup({ id, position: [x, y, z], radius: 1.6 }), [id, x, y, z]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y = t * 1.2;
      group.current.position.y = y + Math.sin(t * 1.6 + x) * 0.25;
    }
  });

  return (
    <group ref={group} position={[x, y, z]}>
      <mesh>
        <cylinderGeometry args={[0.35, 0.35, 0.8, 8]} />
        <meshStandardMaterial color={P.emerald} emissive={P.emerald} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.2, 8]} />
        <meshStandardMaterial color={P.emerald} emissive={P.emerald} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function Pickups() {
  const cells = useFlightStore((s) => s.cells);

  useEffect(() => {
    const iv = setInterval(() => {
      const st = useFlightStore.getState();
      if (st.phase !== "flight") return;
      const p = flight.pos;
      for (const item of pickupsFallback()) {
        if (st.cells.includes(item.id)) continue;
        const dx = p.x - item.position[0];
        const dy = p.y - item.position[1];
        const dz = p.z - item.position[2];
        if (dx * dx + dy * dy + dz * dz < item.radius * item.radius) {
          st.collectCell(item.id);
          engineAudio.playCollect();
        }
      }
    }, 100);
    return () => clearInterval(iv);
  }, []);

  return (
    <>
      {PICKUPS.filter((c) => !cells.includes(c.id)).map((c) => (
        <Cell key={c.id} id={c.id} x={c.x} z={c.z} yOffset={c.yOffset} />
      ))}
    </>
  );
}

// Read the live registry, falling back to static positions before mount.
function pickupsFallback() {
  if (pickups.size > 0) return Array.from(pickups.values());
  return PICKUPS.map((c) => ({
    id: c.id,
    position: [c.x, heightAt(c.x, c.z) + c.yOffset, c.z] as [number, number, number],
    radius: 1.6,
  }));
}
