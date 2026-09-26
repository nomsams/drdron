"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  QUALITY_ORDER,
  initialQuality,
  saveQualityChoice,
  stepDown,
  stepUp,
  type QualityLevel,
} from "@/config/quality";

// Sliding-window FPS monitor. Only active while `auto` is on:
// sustained <45fps steps down, sustained >58fps for a while steps up.
// Manual selection disables auto (persisted to localStorage).

const WINDOW_MS = 2000;
const DOWN_FPS = 45;
const UP_FPS = 58;
const UP_STREAKS = 5;

export function useAdaptiveQuality() {
  const [state] = useState(initialQuality);
  const [level, setLevel] = useState<QualityLevel>(state.level);
  const [auto, setAuto] = useState(state.auto);
  const levelRef = useRef(level);
  levelRef.current = level;
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const frames = useRef<number[]>([]);
  const upStreak = useRef(0);

  useEffect(() => {
    if (!auto) return;
    let raf = 0;
    const tick = (now: number) => {
      const arr = frames.current;
      arr.push(now);
      const cutoff = now - WINDOW_MS;
      while (arr.length && arr[0] < cutoff) arr.shift();
      if (arr.length > 10) {
        const span = (arr[arr.length - 1] - arr[0]) / 1000;
        const fps = span > 0 ? (arr.length - 1) / span : 60;
        if (fps < DOWN_FPS) {
          const next = stepDown(levelRef.current);
          if (next !== levelRef.current) {
            levelRef.current = next;
            setLevel(next);
          }
          upStreak.current = 0;
          arr.length = 0;
        } else if (fps > UP_FPS) {
          upStreak.current += 1;
          if (upStreak.current >= UP_STREAKS) {
            const next = stepUp(levelRef.current);
            if (next !== levelRef.current) {
              levelRef.current = next;
              setLevel(next);
            }
            upStreak.current = 0;
            arr.length = 0;
          }
        } else {
          upStreak.current = 0;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [auto]);

  const choose = useCallback((next: QualityLevel | "auto") => {
    if (next === "auto") {
      setAuto(true);
      return;
    }
    setAuto(false);
    setLevel(next);
    saveQualityChoice(next);
  }, []);

  return { level, auto, choose, order: QUALITY_ORDER };
}
