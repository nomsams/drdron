"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { HOOP_RIM_RADIUS, RACE_HOOPS } from "@/config/race";
import { heightAt } from "@/lib/terrain";
import { P } from "@/lib/palette";
import { useRace } from "@/state/race";

// Basketball hoops for the race mode: pole + backboard + rim + net, one per
// station. Same "next target glows gold, done rests emerald" language as
// RewardRings, so the two toggleable courses read consistently at a glance.

const cGold = new THREE.Color(P.gold);
const cPassed = new THREE.Color(P.emerald);

interface HoopPose {
  id: string;
  x: number;
  y: number; // rim world-space height
  z: number;
  groundY: number;
  quat: THREE.Quaternion;
}

export default function BasketballHoops() {
  const enabled = useRace((s) => s.enabled);
  const hoopIndex = useRace((s) => s.hoopIndex);

  const hoops = useMemo<HoopPose[]>(() => {
    const centers = RACE_HOOPS.map((h) => new THREE.Vector3(h.x, heightAt(h.x, h.z) + h.alt, h.z));
    return RACE_HOOPS.map((h, i) => {
      const from = centers[(i - 1 + centers.length) % centers.length];
      const to = centers[(i + 1) % centers.length];
      const tangent = new THREE.Vector3().subVectors(to, from);
      if (tangent.lengthSq() < 1e-6) tangent.set(0, 0, 1);
      tangent.normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      return {
        id: h.id,
        x: h.x,
        y: centers[i].y,
        z: h.z,
        groundY: heightAt(h.x, h.z),
        quat,
      };
    });
  }, []);

  const rimMatRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const boardMatRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  useFrame((state) => {
    const idx = useRace.getState().hoopIndex;
    const pulse = 0.75 + Math.sin(state.clock.elapsedTime * 2.4) * 0.35;
    hoops.forEach((hoop, i) => {
      const rim = rimMatRefs.current[i];
      const board = boardMatRefs.current[i];
      // "Done" only really applies mid-lap (index < i means not yet reached
      // this loop); every hoop is "next" the instant it becomes idx again.
      const isNext = i === idx;
      const target = isNext ? cGold : cPassed;
      if (rim) {
        rim.color.lerp(target, 0.1);
        rim.emissive.lerp(target, 0.1);
        rim.emissiveIntensity = isNext ? 1.9 * pulse : 0.6;
      }
      if (board) {
        board.emissive.lerp(target, 0.08);
        board.emissiveIntensity = isNext ? 0.9 * pulse : 0.25;
      }
    });
  });

  if (!enabled) return null;

  return (
    <group>
      {hoops.map((hoop, i) => (
        <group key={hoop.id} position={[hoop.x, 0, hoop.z]}>
          {/* Pole from the ground up to just under the rim. */}
          <mesh position={[0, (hoop.groundY + hoop.y - 0.3) / 2, 0]}>
            <cylinderGeometry args={[0.14, 0.18, Math.max(hoop.y - hoop.groundY - 0.3, 0.5), 10]} />
            <meshStandardMaterial color="#3d434b" roughness={0.6} metalness={0.3} />
          </mesh>
          <group position={[0, hoop.y, 0]} quaternion={hoop.quat}>
            {/* Backboard, offset to the far side of the approach tangent. */}
            <mesh position={[0, 0.55, -0.55]}>
              <boxGeometry args={[1.5, 1.1, 0.06]} />
              <meshStandardMaterial
                ref={(el) => {
                  boardMatRefs.current[i] = el;
                }}
                color="#e8eaf6"
                transparent
                opacity={0.35}
                emissive={P.gold}
                emissiveIntensity={0.3}
                toneMapped={false}
              />
            </mesh>
            {/* Rim. */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[HOOP_RIM_RADIUS, 0.05, 8, 24]} />
              <meshStandardMaterial
                ref={(el) => {
                  rimMatRefs.current[i] = el;
                }}
                color={P.gold}
                emissive={P.gold}
                emissiveIntensity={1.3}
                toneMapped={false}
                roughness={0.4}
              />
            </mesh>
            {/* Net: an open-bottomed cone in wireframe reads fine at speed
                and costs nothing extra. */}
            <mesh position={[0, -0.4, 0]}>
              <coneGeometry args={[HOOP_RIM_RADIUS * 0.85, 0.8, 10, 4, true]} />
              <meshBasicMaterial color="#e8eaf6" wireframe transparent opacity={0.5} />
            </mesh>
          </group>
          {/* Next-hoop beacon: a soft light pillar, visible from far away. */}
          {i === hoopIndex && (
            <mesh position={[0, hoop.y + 12, 0]}>
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
      ))}
    </group>
  );
}
