"use client";

import { flight, keys, useFlightStore } from "@/state/flight";
import { useSettings, type FlightMode } from "@/state/settings";
import { engineAudio } from "@/lib/audio";
import { toast } from "@/state/toasts";

// Pilot tricks + mode switches that the HUD and keyboard both trigger. Kept
// out of the 3D chunk so the HUD can call them without importing Drone.tsx.

/** Upward kick at the start of a flip so it doesn't cost altitude. */
const FLIP_HOP = 5;

/** Start a flip trick in the held direction — backflip ("360 upwards") by
 *  default, front flip while holding ↑, barrel roll while holding ←/→.
 *  Easy/Angle only: in Acro you flip with the sticks. Drone.tsx animates it. */
export function requestFlip(): boolean {
  if (useFlightStore.getState().phase !== "flight" || flight.downed || flight.flipT > 0) return false;
  if (useSettings.getState().flightMode === "acro") {
    toast("In Acro, flip with the sticks — hold ↓ for a loop", "info");
    return false;
  }
  if (keys.strafeLeft || keys.strafeRight) {
    flight.flipAxis = "z";
    flight.flipSign = keys.strafeRight ? -1 : 1;
  } else {
    flight.flipAxis = "x";
    flight.flipSign = keys.forward ? -1 : 1;
  }
  flight.flipT = 1e-4;
  flight.vel.y = Math.max(flight.vel.y, 0) + FLIP_HOP;
  engineAudio.init();
  engineAudio.playDrop();
  return true;
}

const MODE_ORDER: FlightMode[] = ["easy", "angle", "acro"];
const MODE_TOAST: Record<FlightMode, string> = {
  easy: "🎮 Easy — arcade controls, X for flips",
  angle: "🎮 Angle — real thrust physics, self-levelling, X for flips",
  acro: "🎮 Acro — rate mode, no self-level: hold ↓ to loop, W throttle, S cut",
};

export function cycleFlightMode(): FlightMode {
  const s = useSettings.getState();
  const next = MODE_ORDER[(MODE_ORDER.indexOf(s.flightMode) + 1) % MODE_ORDER.length];
  s.set({ flightMode: next });
  toast(MODE_TOAST[next], "info");
  return next;
}

export function toggleView(): void {
  const s = useSettings.getState();
  const next = s.cameraMode === "fpv" ? "chase" : "fpv";
  s.set({ cameraMode: next });
  toast(next === "fpv" ? "🥽 FPV goggles (V)" : "🎥 Chase view (V)", "info");
}

const TILT_PRESETS = [0, 0.5, 1];
const TILT_LABEL = ["forward", "45° down", "straight down"];

/** HUD 📷 button: snap the camera tilt to the next preset (Q/E fine-tune). */
export function cycleCamTilt(): void {
  const i = TILT_PRESETS.findIndex((p) => p > flight.camTilt + 0.05);
  const next = i < 0 ? 0 : i;
  flight.camTilt = TILT_PRESETS[next];
  toast(`📷 Camera ${TILT_LABEL[next]} (Q/E to adjust)`, "info");
}
