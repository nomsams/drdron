"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { flight, useFlightStore } from "@/state/flight";
import { DAY_CYCLE } from "@/lib/palette";
import type { QualityPreset } from "@/config/quality";
import SkyDome from "./world/SkyDome";
import Island from "./world/Island";
import Vegetation from "./world/Vegetation";
import Fireflies from "./world/Fireflies";
import Helipad from "./world/Helipad";
import Waterfall from "./world/Waterfall";
import Beach from "./world/Beach";
import MountainPeak from "./world/MountainPeak";
import Pickups from "./world/Pickups";
import Birds from "./world/Birds";
import Butterflies from "./world/Butterflies";
import Clouds from "./world/Clouds";
import WaterRipples from "./world/WaterRipples";
import RewardRings from "./world/RewardRings";
import TomatoTargets from "./world/TomatoTargets";
import Tomatoes from "./world/Tomatoes";
import BasketballHoops from "./world/BasketballHoops";
import Basketball from "./world/Basketball";
import RepairKits from "./world/RepairKits";
import ImpactBursts from "./world/ImpactBursts";
import Windsocks from "./world/Windsock";
import BlobShadow from "./world/BlobShadow";
import GuideArrow from "./GuideArrow";
import AmbientAudio from "./AmbientAudio";
import { useSettings } from "@/state/settings";

// Minutes of flying until the world reaches full sunset.
const SUNSET_AFTER_SECONDS = 180;

const FOG_MORNING = new THREE.Color(DAY_CYCLE.morning.fog);
const FOG_SUNSET = new THREE.Color(DAY_CYCLE.sunset.fog);

// The world chunk. Mounted during the long-press warm-up; visible from
// `launching` onward. Fog starts tight and recedes — the island "streams in"
// out of the morning haze.

export default function FlightScene({ quality }: { quality: QualityPreset }) {
  const phase = useFlightStore((s) => s.phase);
  const visible = phase !== "idle" && phase !== "charging";
  const scene = useThree((s) => s.scene);
  const fog = useMemo(() => new THREE.Fog(DAY_CYCLE.morning.fog, 6, 32), []);
  const revealed = useRef(false);
  const [firefliesOut, setFirefliesOut] = useState(false);

  useEffect(() => {
    if (visible) {
      if (!revealed.current) {
        fog.near = 6;
        fog.far = 32;
      }
      scene.fog = fog;
    } else {
      scene.fog = null;
      revealed.current = false;
    }
    return () => {
      scene.fog = null;
    };
  }, [visible, scene, fog]);

  useEffect(() => {
    if (!quality.fireflies) {
      setFirefliesOut(false);
      return;
    }
    const iv = setInterval(() => setFirefliesOut(flight.dayT > 0.5), 1000);
    return () => clearInterval(iv);
  }, [quality.fireflies]);

  useFrame((_, dtRaw) => {
    if (!visible) return;
    const dt = Math.min(dtRaw, 0.1);
    fog.near = THREE.MathUtils.lerp(fog.near, 45, dt * 0.9);
    fog.far = THREE.MathUtils.lerp(fog.far, 150, dt * 0.9);
    if (fog.far > 140) revealed.current = true;
    if (phase === "flight") {
      flight.dayT = Math.min(1, flight.dayT + dt / SUNSET_AFTER_SECONDS);
    }
    fog.color.lerpColors(FOG_MORNING, FOG_SUNSET, flight.dayT);
  });

  const scatter = useMemo(
    () => ({ trees: quality.trees, rocks: quality.rocks, grass: quality.grass }),
    [quality.trees, quality.rocks, quality.grass]
  );

  // Feature gates — every ambient system can be switched off in settings.
  const birds = useSettings((s) => s.birds);
  const butterflies = useSettings((s) => s.butterflies);
  const clouds = useSettings((s) => s.clouds);
  const ripples = useSettings((s) => s.ripples);
  const firefliesSetting = useSettings((s) => s.fireflies);
  const showFireflies = firefliesOut && firefliesSetting;

  return (
    <group visible={visible}>
      <SkyDome segments={quality.skySegments} />
      <Island terrainSegments={quality.terrainSegments} waterSheen={quality.waterSheen} />
      <Vegetation counts={scatter} />
      {showFireflies && <Fireflies />}
      <Helipad light={quality.helipadLight} />
      <MountainPeak clouds={quality.cloudBand} />
      <Waterfall mist={quality.waterfallMist} />
      <Beach />
      <Pickups />
      {birds && <Birds count={quality.birds} />}
      {butterflies && <Butterflies />}
      {clouds && <Clouds />}
      {ripples && <WaterRipples />}
      <RewardRings />
      <TomatoTargets />
      <Tomatoes splatCap={quality.terrainSegments <= 48 ? 15 : 30} />
      <BasketballHoops />
      <Basketball />
      <RepairKits scatter={scatter} />
      <ImpactBursts />
      <Windsocks />
      <GuideArrow />
      {/* NOTE: RemotePilots renders at the Canvas root (DroneExperience) so
          squad ghosts stay visible while idle/charging and before the world
          chunk streams in. */}
      <AmbientAudio />
      <BlobShadow />
    </group>
  );
}
