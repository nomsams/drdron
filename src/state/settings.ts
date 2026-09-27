"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Global feature toggles + pilot preferences, persisted to localStorage.
// Everything visual beyond the core drone/island can be switched off here,
// so weak machines can trade beauty for frames without touching quality tiers
// (rings keep their own HUD toggle + R key).

export type TouchMode = "auto" | "on" | "off";
export type CameraMode = "chase" | "fpv";
/** easy = arcade (velocity follows the sticks), angle = real thrust-vector
 *  physics with self-levelling, acro = rate mode (no self-levelling — full
 *  flips and loops, you manage throttle). */
export type FlightMode = "easy" | "angle" | "acro";
export type WindLevel = "off" | "light" | "strong";

interface SettingsState {
  birds: boolean;
  butterflies: boolean;
  clouds: boolean;
  ripples: boolean;
  waterfallAudio: boolean;
  minimap: boolean;
  showFps: boolean;
  fireflies: boolean;
  touch: TouchMode;
  /** Control sensitivity multiplier, 0.5..2. */
  sensitivity: number;
  /** Chase (third-person) or FPV (goggle-style first-person). */
  cameraMode: CameraMode;
  flightMode: FlightMode;
  wind: WindLevel;
  set: (patch: Partial<SettingsState>) => void;
  reset: () => void;
}

const DEFAULTS = {
  birds: true,
  butterflies: true,
  clouds: true,
  ripples: true,
  waterfallAudio: true,
  minimap: true,
  showFps: true,
  fireflies: true,
  touch: "auto" as TouchMode,
  sensitivity: 1,
  cameraMode: "chase" as CameraMode,
  flightMode: "easy" as FlightMode,
  wind: "light" as WindLevel,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULTS }),
    }),
    { name: "flyjs-settings-v1" }
  )
);

/** Should the touch sticks show? "auto" = coarse pointer only. */
export function touchActive(touch: TouchMode): boolean {
  if (touch === "on") return true;
  if (touch === "off") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
