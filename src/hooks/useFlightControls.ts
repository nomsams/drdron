"use client";

import { useEffect } from "react";
import { keys, resetKeys, useFlightStore } from "@/state/flight";
import { engineAudio } from "@/lib/audio";

// Flight scheme: W/S ascend/descend, A/D yaw, arrows fly (fwd/back/strafe),
// Space/C also vertical, Shift = sport mode.
const FLIGHT_MAP: Record<string, keyof typeof keys> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "yawLeft",
  KeyD: "yawRight",
  ArrowUp: "forward",
  ArrowDown: "back",
  ArrowLeft: "strafeLeft",
  ArrowRight: "strafeRight",
  Space: "up",
  KeyC: "down",
  ControlLeft: "down",
  ControlRight: "down",
  ShiftLeft: "sport",
  ShiftRight: "sport",
};

// Idle scheme: gentle 2D hover nudge. Excludes Space/Shift/Ctrl so page
// shortcuts keep working.
const IDLE_MAP: Record<string, keyof typeof keys> = {
  KeyW: "forward",
  KeyS: "back",
  KeyA: "strafeLeft",
  KeyD: "strafeRight",
  ArrowUp: "forward",
  ArrowDown: "back",
  ArrowLeft: "strafeLeft",
  ArrowRight: "strafeRight",
};

export function useFlightControls() {
  const phase = useFlightStore((s) => s.phase);
  const mode =
    phase === "flight" ? "flight" : phase === "idle" || phase === "charging" ? "idle" : null;

  useEffect(() => {
    if (!mode) {
      resetKeys();
      return;
    }
    const map = mode === "flight" ? FLIGHT_MAP : IDLE_MAP;
    const down = (e: KeyboardEvent) => {
      const key = map[e.code];
      if (!key) return;
      e.preventDefault();
      if (mode === "idle") engineAudio.init();
      keys[key] = true;
    };
    const up = (e: KeyboardEvent) => {
      const key = map[e.code];
      if (!key) return;
      keys[key] = false;
    };
    const blur = () => resetKeys();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      resetKeys();
    };
  }, [mode]);
}
