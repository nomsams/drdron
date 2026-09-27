"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { flight, keys, useFlightStore } from "@/state/flight";
import { useSettings } from "@/state/settings";
import { IDLE_CAM, OWN_BODY_LAYER } from "./Drone";
import { cameraBus } from "./cameraBus";

// Chase camera ported from upstream (MIT). Focus-mode branch removed —
// the scaffold has no boards to focus on. Added since:
// - FPV (V key / HUD toggle): a rigid goggle-style mount at the drone's nose
//   (see FpvOverlay.tsx for the goggle chrome).
// - Camera tilt (Q/E held, HUD 📷 button): forward → straight down. In FPV
//   it's the camera gimbal pitching down; in chase view the camera rises to
//   a near top-down view — handy for lining up basketball and tomato drops.
// - Acro tail cam: in Acro flight mode the chase camera rides in the drone's
//   own frame, so it rolls and loops with it (a heading-only chase cam would
//   whip 180° every time the drone passes upside down).

const CHASE_OFFSET = new THREE.Vector3(0, 1.8, 5);
const LOOK_OFFSET = new THREE.Vector3(0, 0.5, -2);
/** Camera tilted fully down: high above and just behind, looking down. */
const TOP_OFFSET = new THREE.Vector3(0, 10, 2.2);
const TOP_LOOK_OFFSET = new THREE.Vector3(0, -0.5, -0.9);
const CHASE_LERP = 4.2;
const SPORT_CHASE_LERP = 3.4;
const BASE_FOV = 65;
const SPORT_FOV = 72;
/** Q/E tilt speed (full range per second ≈ 1.1 s). */
const CAM_TILT_SPEED = 0.9;
const ACRO_CAM_POS_RESPONSE = 6;
const ACRO_CAM_ROT_RESPONSE = 7;

// FPV: mounted just ahead of the nose, rigidly following the drone's full
// orientation (no lookAt smoothing — that's what makes a chase cam feel like
// a chase cam). A small upward mount-tilt keeps the horizon roughly level
// during a nose-down cruise, matching how real FPV cameras are angled on the
// frame. The own body/arms/props render on OWN_BODY_LAYER, which this camera
// doesn't enable — see Drone.tsx — so there's nothing to clip into even
// mid-maneuver. (A hint of propeller blur at the frame edges is drawn as a
// flat 2D overlay in FpvOverlay.tsx instead of real 3D geometry.)
const FPV_OFFSET = new THREE.Vector3(0, 0.02, -0.5);
const FPV_MOUNT_TILT = 0.32;
const FPV_POS_LERP = 15;
const FPV_FOV = 122;

const IDLE_LOOK = new THREE.Vector3(IDLE_CAM.x, IDLE_CAM.y, 8);
const X_AXIS = new THREE.Vector3(1, 0, 0);

const _offset = new THREE.Vector3();
const _lookOffset = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qTarget = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();

export default function ChaseCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const phase = useFlightStore((s) => s.phase);
  const cameraMode = useSettings((s) => s.cameraMode);
  const flightMode = useSettings((s) => s.flightMode);

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

    // Camera tilt: Q/E held (the HUD button snaps between presets).
    if (keys.camDown) flight.camTilt = Math.min(1, flight.camTilt + dt * CAM_TILT_SPEED);
    if (keys.camUp) flight.camTilt = Math.max(0, flight.camTilt - dt * CAM_TILT_SPEED);
    const tilt = flight.camTilt;

    const applyShake = () => {
      if (flight.shake <= 0.001) return;
      shakeOffset.current.set(
        Math.sin(t * 61) * flight.shake * 0.25,
        Math.cos(t * 47) * flight.shake * 0.2,
        0
      );
      camera.position.add(shakeOffset.current);
      flight.shake *= Math.exp(-dt * 6);
    };
    const easeFov = (fov: number) => {
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, fov, dt * 3);
        camera.updateProjectionMatrix();
      }
    };

    const fpvActive = phase === "flight" && cameraMode === "fpv";
    // The own body/arms/props live on OWN_BODY_LAYER (see Drone.tsx) — hide
    // that layer from the nose-mounted FPV view, show it for every other
    // camera state (chase, idle, launch, landing).
    if (fpvActive) camera.layers.disable(OWN_BODY_LAYER);
    else camera.layers.enable(OWN_BODY_LAYER);

    if (fpvActive) {
      // Rigid mount: the offset and the attitude both come from the drone's
      // full orientation, so loops and flips play out in first person.
      _offset.copy(FPV_OFFSET).applyQuaternion(flight.quat);
      targetPos.copy(flight.pos).add(_offset);
      // Exponential smoothing, not `dt * rate`: at this stiffness a plain
      // lerp factor passes 1 below ~15 fps and overshoots, swinging the
      // camera off the nose (the carried ball then floats mid-view).
      camera.position.lerp(targetPos, 1 - Math.exp(-FPV_POS_LERP * dt));
      applyShake();
      // Gimbal: the fixed up-tilt when looking forward, down to straight
      // down at full tilt.
      _qTilt.setFromAxisAngle(X_AXIS, THREE.MathUtils.lerp(FPV_MOUNT_TILT, -Math.PI / 2, tilt));
      camera.quaternion.copy(flight.quat).multiply(_qTilt);
      // Keep `look` sane (a point ahead of the camera) so a mode switch
      // back to chase doesn't inherit a stale look-at target.
      targetLook.set(0, 0, -10).applyQuaternion(camera.quaternion).add(camera.position);
      look.current.copy(targetLook);
      easeFov(FPV_FOV);
      return;
    }

    _offset.lerpVectors(CHASE_OFFSET, TOP_OFFSET, tilt);
    _lookOffset.lerpVectors(LOOK_OFFSET, TOP_LOOK_OFFSET, tilt);

    if (phase === "flight" && flightMode === "acro") {
      // Acro tail cam: offsets in the drone's own frame, up = the drone's up.
      targetPos.copy(_offset).applyQuaternion(flight.quat).add(flight.pos);
      camera.position.lerp(targetPos, 1 - Math.exp(-ACRO_CAM_POS_RESPONSE * dt));
      _look.copy(_lookOffset).applyQuaternion(flight.quat).add(flight.pos);
      _up.set(0, 1, 0).applyQuaternion(flight.quat);
      _m.lookAt(camera.position, _look, _up);
      _qTarget.setFromRotationMatrix(_m);
      camera.quaternion.slerp(_qTarget, 1 - Math.exp(-ACRO_CAM_ROT_RESPONSE * dt));
      look.current.copy(_look);
      applyShake();
      easeFov(flight.sport ? SPORT_FOV : BASE_FOV);
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
        flight.pos.x + _offset.x * cos + _offset.z * sin,
        flight.pos.y + _offset.y,
        flight.pos.z - _offset.x * sin + _offset.z * cos
      );
      targetLook.set(
        flight.pos.x + _lookOffset.x * cos + _lookOffset.z * sin,
        flight.pos.y + _lookOffset.y,
        flight.pos.z - _lookOffset.x * sin + _lookOffset.z * cos
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
    applyShake();
    camera.lookAt(look.current);
    easeFov(targetFov);
  });

  return null;
}
