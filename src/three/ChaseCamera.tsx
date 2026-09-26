"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { flight, useFlightStore } from "@/state/flight";
import { IDLE_CAM } from "./Drone";
import { cameraBus } from "./cameraBus";

// Chase camera ported from upstream (MIT). Focus-mode branch removed —
 // the scaffold has no boards to focus on.

const CHASE_OFFSET = new THREE.Vector3(0, 1.8, 5);
const LOOK_OFFSET = new THREE.Vector3(0, 0.5, -2);
const CHASE_LERP = 4.2;
const SPORT_CHASE_LERP = 3.4;
const BASE_FOV = 65;
const SPORT_FOV = 72;

const IDLE_LOOK = new THREE.Vector3(IDLE_CAM.x, IDLE_CAM.y, 8);

export default function ChaseCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const phase = useFlightStore((s) => s.phase);

  // Publish for DOM overlays (peer markers).
  useEffect(() => {
    cameraBus.current = camera;
    return () => {
      if (cameraBus.current === camera) cameraBus.current = null;
    };
  }, [camera]);

  const look = useRef(new THREE.Vector3().copy(IDLE_LOOK));
  const tmpPos = useRef(new THREE.Vector3());
  const tmpLook = useRef(new THREE.Vector3());
  const shakeOffset = useRef(new THREE.Vector3());

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const t = state.clock.elapsedTime;
    const targetPos = tmpPos.current;
    const targetLook = tmpLook.current;
    let posLerp = 4;
    let targetFov = BASE_FOV;

    if (phase === "idle" || phase === "charging") {
      targetPos.copy(IDLE_CAM);
      targetLook.copy(IDLE_LOOK);
      posLerp = 6;
    } else {
      const h = flight.heading;
      const cos = Math.cos(h);
      const sin = Math.sin(h);
      targetPos.set(
        flight.pos.x + CHASE_OFFSET.x * cos + CHASE_OFFSET.z * sin,
        flight.pos.y + CHASE_OFFSET.y,
        flight.pos.z - CHASE_OFFSET.x * sin + CHASE_OFFSET.z * cos
      );
      targetLook.set(
        flight.pos.x + LOOK_OFFSET.x * cos + LOOK_OFFSET.z * sin,
        flight.pos.y + LOOK_OFFSET.y,
        flight.pos.z - LOOK_OFFSET.x * sin + LOOK_OFFSET.z * cos
      );
      if (phase === "flight") {
        posLerp = flight.sport ? SPORT_CHASE_LERP : CHASE_LERP;
        if (flight.sport) targetFov = SPORT_FOV;
      } else {
        posLerp = 2.4;
      }
    }

    camera.position.lerp(targetPos, dt * posLerp);
    look.current.lerp(targetLook, dt * 8);

    if (flight.shake > 0.001) {
      shakeOffset.current.set(
        Math.sin(t * 61) * flight.shake * 0.25,
        Math.cos(t * 47) * flight.shake * 0.2,
        0
      );
      camera.position.add(shakeOffset.current);
      flight.shake *= Math.exp(-dt * 6);
    }

    camera.lookAt(look.current);

    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, dt * 3);
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
