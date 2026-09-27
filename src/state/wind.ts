"use client";

import { useSettings, type WindLevel } from "@/state/settings";

// Wind: a slowly veering direction, a breathing base speed, and occasional
// gusts. It's a pure function of wall-clock time (sums of incommensurate
// sines — smooth, never repeats in a way you'd notice), so every squadmate
// with the same wind setting flies in the same weather without any sync.
//
// `wind` is mutable module state refreshed by updateWind() (cheap; called
// from the drone's frame loop and the windsocks). x/z is the velocity of
// the air in m/s, blowing TOWARD `dir` (radians, 0 = +X).

export const wind = { x: 0, z: 0, speed: 0, dir: 0, gust: 0 };

/** Typical base speed (m/s) per setting; gusts add up to ~60% on top. */
const LEVEL_SPEED: Record<WindLevel, number> = { off: 0, light: 3.5, strong: 8 };

export function updateWind(nowMs: number = Date.now()): typeof wind {
  const level = LEVEL_SPEED[useSettings.getState().wind];
  const t = nowMs / 1000;
  const dir = 1.2 + 1.6 * Math.sin(t / 173) + 0.7 * Math.sin(t / 61 + 1.3);
  const base = 0.55 + 0.3 * Math.sin(t / 47 + 0.4) + 0.15 * Math.sin(t / 19 + 2.1);
  const gust = Math.max(0, Math.sin(t / 5.3) * Math.sin(t / 2.1 + 0.7)) * 0.6;
  const speed = level * (base + gust);
  wind.dir = dir;
  wind.speed = speed;
  wind.gust = level > 0 ? gust : 0;
  wind.x = Math.cos(dir) * speed;
  wind.z = Math.sin(dir) * speed;
  return wind;
}

/** Compass name for a direction the wind blows TOWARD (−Z is north). */
export function windFromLabel(dir: number): string {
  // Wind is conventionally named for where it comes FROM.
  const fromX = -Math.cos(dir);
  const fromZ = -Math.sin(dir);
  const deg = ((Math.atan2(fromX, -fromZ) * 180) / Math.PI + 360) % 360;
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(deg / 45) % 8];
}
