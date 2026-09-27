"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  BATTERY_PACK_CHARGE,
  BATTERY_PACK_RADIUS,
  BATTERY_PACK_RESPAWN_MS,
  PICKUPS,
} from "@/config/world";
import { heightAt } from "@/lib/terrain";
import { P } from "@/lib/palette";
import { flight, isPackDown, takePack, useFlightStore } from "@/state/flight";
import { spawnBurst } from "@/state/bursts";
import { toast } from "@/state/toasts";
import { engineAudio } from "@/lib/audio";

// Battery packs: glowing green cells floating around the island. Fly through
// one to recharge the flight battery (+30%). Left alone when you're already
// full, so they're there when you need them; respawn after a while.
// Proximity is checked at 10 Hz (not per frame, no React churn).

function Cell({ x, z, yOffset }: { x: number; z: number; yOffset: number }) {
  const group = useRef<THREE.Group>(null);
  const y = heightAt(x, z) + yOffset;

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
  const [, setVersion] = useState(0);

  useEffect(() => {
    const down = new Set<string>();
    const iv = setInterval(() => {
      let changed = false;
      const flying = useFlightStore.getState().phase === "flight";
      for (const c of PICKUPS) {
        const isDown = isPackDown(c.id);
        if (isDown !== down.has(c.id)) {
          changed = true;
          if (isDown) down.add(c.id);
          else down.delete(c.id);
        }
        // Full battery: leave it for later instead of wasting it.
        if (isDown || !flying || flight.battery >= 0.99) continue;
        const cy = heightAt(c.x, c.z) + c.yOffset;
        const dx = flight.pos.x - c.x;
        const dy = flight.pos.y - cy;
        const dz = flight.pos.z - c.z;
        if (dx * dx + dy * dy + dz * dz > BATTERY_PACK_RADIUS * BATTERY_PACK_RADIUS) continue;
        const before = flight.battery;
        flight.battery = Math.min(1, flight.battery + BATTERY_PACK_CHARGE);
        takePack(c.id, BATTERY_PACK_RESPAWN_MS);
        down.add(c.id);
        changed = true;
        useFlightStore.getState().collectPack();
        engineAudio.playCollect();
        spawnBurst("repair", c.x, cy, c.z);
        toast(`🔋 Battery pack +${Math.round((flight.battery - before) * 100)}%`, "good");
      }
      if (changed) setVersion((v) => v + 1);
    }, 100);
    return () => clearInterval(iv);
  }, []);

  return (
    <>
      {PICKUPS.filter((c) => !isPackDown(c.id)).map((c) => (
        <Cell key={c.id} x={c.x} z={c.z} yOffset={c.yOffset} />
      ))}
    </>
  );
}
