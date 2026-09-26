"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { flight, useFlightStore } from "@/state/flight";
import { DAY_CYCLE } from "@/lib/palette";

// One light rig for both contexts: neutral close-up setup for the idle drone,
// cross-fading into the world rig which animates morning → sunset with flight
// time. No shadow maps anywhere (blob shadow instead). Ported from upstream.

const HERO = {
  hemiSky: new THREE.Color("#8fa3c8"),
  hemiGround: new THREE.Color("#2a3044"),
  hemi: 0.9,
  sun: new THREE.Color("#e8ecff"),
  sunIntensity: 1.6,
  sunPos: new THREE.Vector3(6, 8, 6),
};

const M = DAY_CYCLE.morning;
const S = DAY_CYCLE.sunset;

export default function Lighting() {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);

  const keys = useMemo(
    () => ({
      hemiSky: [new THREE.Color(M.hemiSky), new THREE.Color(S.hemiSky)],
      hemiGround: [new THREE.Color(M.hemiGround), new THREE.Color(S.hemiGround)],
      sun: [new THREE.Color(M.sun), new THREE.Color(S.sun)],
      sunPos: [new THREE.Vector3(...M.sunPos), new THREE.Vector3(...S.sunPos)],
      tmpColor: new THREE.Color(),
      tmpPos: new THREE.Vector3(),
    }),
    []
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const phase = useFlightStore.getState().phase;
    const inHero = phase === "idle" || phase === "charging";
    const k = dt * 2;
    const t = flight.dayT;

    if (hemi.current) {
      const h = hemi.current;
      if (inHero) {
        h.intensity = THREE.MathUtils.lerp(h.intensity, HERO.hemi, k);
        h.color.lerp(HERO.hemiSky, k);
        h.groundColor.lerp(HERO.hemiGround, k);
      } else {
        const target = THREE.MathUtils.lerp(M.hemiIntensity, S.hemiIntensity, t);
        h.intensity = THREE.MathUtils.lerp(h.intensity, target, k);
        h.color.lerp(keys.tmpColor.lerpColors(keys.hemiSky[0], keys.hemiSky[1], t), k);
        h.groundColor.lerp(keys.tmpColor.lerpColors(keys.hemiGround[0], keys.hemiGround[1], t), k);
      }
    }
    if (sun.current) {
      const s = sun.current;
      if (inHero) {
        s.intensity = THREE.MathUtils.lerp(s.intensity, HERO.sunIntensity, k);
        s.color.lerp(HERO.sun, k);
        s.position.lerp(HERO.sunPos, k);
      } else {
        const target = THREE.MathUtils.lerp(M.sunIntensity, S.sunIntensity, t);
        s.intensity = THREE.MathUtils.lerp(s.intensity, target, k);
        s.color.lerp(keys.tmpColor.lerpColors(keys.sun[0], keys.sun[1], t), k);
        s.position.lerp(keys.tmpPos.lerpVectors(keys.sunPos[0], keys.sunPos[1], t), k);
      }
    }
    if (fill.current) {
      // Hero fill: frontal fill from behind the idle camera so the hovering
      // drone reads instead of going silhouette. Fades out on takeoff so the
      // world keeps its day-cycle mood. No shadows — still cheap.
      const target = inHero ? 0.55 : 0;
      fill.current.intensity = THREE.MathUtils.lerp(fill.current.intensity, target, k);
    }
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={[HERO.hemiSky, HERO.hemiGround, HERO.hemi]} />
      <directionalLight
        ref={sun}
        color={HERO.sun}
        intensity={HERO.sunIntensity}
        position={HERO.sunPos.toArray()}
      />
      <directionalLight ref={fill} color="#e6ecff" intensity={0.55} position={[0, 3.5, 14]} />
    </>
  );
}
