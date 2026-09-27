"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { flight, useFlightStore } from "@/state/flight";
import { useSettings } from "@/state/settings";
import { IDLE_CAM, OWN_BODY_LAYER } from "./Drone";
import { cameraBus } from "./cameraBus";

// Chase camera ported from upstream (MIT). Focus-mode branch removed —
 // the scaffold has no boards to focus on. An FPV branch was added below:
 // a rigid goggle-style mount at the drone's nose, swapped in by the V key
 // / HUD toggle (see FpvOverlay.tsx for the goggle chrome).

const CHASE_OFFSET = new THREE.Vector3(0, 1.8, 5);
const LOOK_OFFSET = new THREE.Vector3(0, 0.5, -2);
const CHASE_LERP = 4.2;
const SPORT_CHASE_LERP = 3.4;
const BASE_FOV = 65;
const SPORT_FOV = 72;

// FPV: mounted just ahead of the nose, rigidly following the drone's full
// attitude (no lookAt smoothing — that's what makes a chase cam feel like a
// chase cam). A small upward mount-tilt keeps the horizon roughly level
// during a nose-down cruise, matching how real FPV cameras are angled on
// the frame. The own body/arms/props render on OWN_BODY_LAYER, which this
// camera doesn't enable — see Drone.tsx — so there's nothing to clip into
// even mid-maneuver. (A hint of propeller blur at the frame edges is drawn
// as a flat 2D overlay in FpvOverlay.tsx instead of real 3D geometry — at
// this FOV, exact corner placement in 3D is unreasonably fiddly for a
// purely decorative touch.)
const FPV_OFFSET = new THREE.Vector3(0, 0.02, -0.5);
const FPV_MOUNT_TILT = 0.32;
const FPV_POS_LERP = 15;
const FPV_FOV = 122;

const IDLE_LOOK = new THREE.Vector3(IDLE_CAM.x, IDLE_CAM.y, 8);

export default function ChaseCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const phase = useFlightStore((s) => s.phase);
  const cameraMode = useSettings((s) => s.cameraMode);

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
  const fpvEuler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const fpvOffsetWorld = useRef(new THREE.Vector3());

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const t = state.clock.elapsedTime;
    const targetPos = tmpPos.current;
    const targetLook = tmpLook.current;
    let posLerp = 4;
    let targetFov = BASE_FOV;

    const fpvActive = phase === "flight" && cameraMode === "fpv";
    // The own body/arms/props live on OWN_BODY_LAYER (see Drone.tsx) — hide
    // that layer from the nose-mounted FPV view, show it for every other
    // camera state (chase, idle, launch, landing).
    if (fpvActive) camera.layers.disable(OWN_BODY_LAYER);
    else camera.layers.enable(OWN_BODY_LAYER);

    if (fpvActive) {
      const h = flight.heading;
      // Rigid mount: rotate the offset by the drone's FULL attitude (not
      // just yaw), so the camera tracks the actual nose-mount point through
      // pitch and roll instead of drifting relative to it mid-maneuver.
      fpvEuler.current.set(flight.pitch, h, flight.roll, "YXZ");
      fpvOffsetWorld.current.copy(FPV_OFFSET).applyEuler(fpvEuler.current);
      targetPos.copy(flight.pos).add(fpvOffsetWorld.current);
      camera.position.lerp(targetPos, dt * FPV_POS_LERP);

      if (flight.shake > 0.001) {
        shakeOffset.current.set(
          Math.sin(t * 61) * flight.shake * 0.25,
          Math.cos(t * 47) * flight.shake * 0.2,
          0
        );
        camera.position.add(shakeOffset.current);
        flight.shake *= Math.exp(-dt * 6);
      }

      // Rigid mount: the camera's attitude IS the drone's attitude (plus a
      // fixed up-tilt), not a smoothed look-at — that tight coupling is
      // what reads as "goggles" instead of "chase cam, close up".
      fpvEuler.current.set(flight.pitch + FPV_MOUNT_TILT, h, flight.roll, "YXZ");
      camera.quaternion.setFromEuler(fpvEuler.current);

      // Keep `look` sane (a point ahead of the camera) so a mode switch
      // back to chase doesn't inherit a stale look-at target.
      targetLook.set(0, 0, -10).applyEuler(fpvEuler.current).add(camera.position);
      look.current.copy(targetLook);

      if (Math.abs(camera.fov - FPV_FOV) > 0.05) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, FPV_FOV, dt * 3);
        camera.updateProjectionMatrix();
      }
      return;
    }

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
