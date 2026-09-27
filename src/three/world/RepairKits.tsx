"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  REPAIR_KITS,
  REPAIR_KIT_HEAL,
  REPAIR_KIT_HOVER,
  REPAIR_KIT_RADIUS,
  REPAIR_KIT_RESPAWN_MS,
} from "@/config/hull";
import { getWorldData, heightAt, type ScatterCounts } from "@/lib/terrain";
import { engineAudio } from "@/lib/audio";
import { flight, useFlightStore } from "@/state/flight";
import { hullDamaged, isKitDown, repairHull, takeKit } from "@/state/hull";
import { spawnBurst } from "@/state/bursts";
import { toast } from "@/state/toasts";

// Floating repair kits: a spinning teal-glowing wrench inside a halo ring.
// Fly through one while damaged to restore HP; it respawns after a while.
// At full HP they're left alone (not wasted). Proximity checks at 10 Hz.

const WATER_Y = -0.35;
const TEAL = "#4edea3";

interface KitPose {
  id: string;
  x: number;
  y: number;
  z: number;
}

function Wrench() {
  // Combination wrench: handle + open-end jaw (torus arc) + ring end.
  return (
    <group rotation={[0, 0, Math.PI / 5]}>
      <mesh>
        <boxGeometry args={[0.9, 0.12, 0.06]} />
        <meshStandardMaterial color="#d9e4ea" metalness={0.6} roughness={0.3} emissive={TEAL} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0.52, 0, 0]} rotation={[0, 0, Math.PI * 0.25]}>
        <torusGeometry args={[0.15, 0.05, 8, 16, Math.PI * 1.5]} />
        <meshStandardMaterial color="#d9e4ea" metalness={0.6} roughness={0.3} emissive={TEAL} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[-0.52, 0, 0]}>
        <torusGeometry args={[0.12, 0.045, 8, 18]} />
        <meshStandardMaterial color="#d9e4ea" metalness={0.6} roughness={0.3} emissive={TEAL} emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

function Kit({ pose }: { pose: KitPose }) {
  const spin = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (spin.current) {
      spin.current.rotation.y = t * 1.6;
      spin.current.position.y = Math.sin(t * 1.8 + pose.x) * 0.2;
    }
    if (halo.current) halo.current.rotation.z = -t * 0.8;
  });
  return (
    <group position={[pose.x, pose.y, pose.z]}>
      <group ref={spin}>
        <Wrench />
      </group>
      <mesh ref={halo} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.8, 0.035, 6, 32]} />
        <meshBasicMaterial color={TEAL} transparent opacity={0.7} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function RepairKits({ scatter }: { scatter: ScatterCounts }) {
  const [, setVersion] = useState(0);

  // Hover above terrain — and above any tree/rock top within reach, so a kit
  // never sits inside a canopy you'd have to crash through to reach it.
  const poses = useMemo<KitPose[]>(() => {
    const { colliders } = getWorldData(scatter);
    return REPAIR_KITS.map((k) => {
      let y = Math.max(heightAt(k.x, k.z), WATER_Y) + REPAIR_KIT_HOVER;
      for (const c of colliders) {
        if (Math.hypot(c.x - k.x, c.z - k.z) < c.r + 2.5) y = Math.max(y, c.top + 1.2);
      }
      return { id: k.id, x: k.x, y, z: k.z };
    });
  }, [scatter]);

  useEffect(() => {
    const down = new Set<string>();
    const iv = setInterval(() => {
      let changed = false;
      for (const k of poses) {
        const wasDown = down.has(k.id);
        const isDown = isKitDown(k.id);
        if (wasDown !== isDown) {
          changed = true;
          if (isDown) down.add(k.id);
          else down.delete(k.id);
        }
        if (isDown || useFlightStore.getState().phase !== "flight" || !hullDamaged()) continue;
        const dx = flight.pos.x - k.x;
        const dy = flight.pos.y - k.y;
        const dz = flight.pos.z - k.z;
        if (dx * dx + dy * dy + dz * dz > REPAIR_KIT_RADIUS * REPAIR_KIT_RADIUS) continue;
        const restored = Math.round(repairHull(REPAIR_KIT_HEAL));
        takeKit(k.id, REPAIR_KIT_RESPAWN_MS);
        down.add(k.id);
        changed = true;
        engineAudio.playRepair();
        spawnBurst("repair", k.x, k.y, k.z);
        toast(`🔧 Repair kit +${restored} HP`, "good");
      }
      if (changed) setVersion((v) => v + 1);
    }, 100);
    return () => clearInterval(iv);
  }, [poses]);

  return (
    <>
      {poses
        .filter((k) => !isKitDown(k.id))
        .map((k) => (
          <Kit key={k.id} pose={k} />
        ))}
    </>
  );
}
