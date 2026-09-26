"use client";

import { useEffect } from "react";
import { flight, useFlightStore } from "@/state/flight";
import { useSettings } from "@/state/settings";
import { engineAudio } from "@/lib/audio";
import { WATERFALL } from "@/config/world";

// Drives the waterfall rushing bed by proximity (5 Hz, no React churn).
// Silent unless the waterfall-audio setting is on and sound is enabled.

const FULL_AT = 8; // metres — full volume inside this radius
const SILENT_AT = 30; // metres — inaudible beyond this radius

export default function AmbientAudio() {
  const waterfallAudio = useSettings((s) => s.waterfallAudio);

  useEffect(() => {
    if (!waterfallAudio) {
      engineAudio.setFallLevel(0);
      return;
    }
    const iv = setInterval(() => {
      const st = useFlightStore.getState();
      if (!st.soundEnabled || (st.phase !== "flight" && st.phase !== "launching")) {
        engineAudio.setFallLevel(0);
        return;
      }
      const dx = flight.pos.x - WATERFALL.x;
      const dz = flight.pos.z - WATERFALL.z;
      const d = Math.hypot(dx, dz);
      const level = 1 - Math.min(Math.max((d - FULL_AT) / (SILENT_AT - FULL_AT), 0), 1);
      engineAudio.setFallLevel(level);
    }, 200);
    return () => {
      clearInterval(iv);
      engineAudio.setFallLevel(0);
    };
  }, [waterfallAudio]);

  return null;
}
