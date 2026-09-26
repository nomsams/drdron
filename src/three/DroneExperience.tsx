"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { flight, resetFlight, setTakeoffRequestHandler, useFlightStore } from "@/state/flight";
import { engineAudio } from "@/lib/audio";
import { blog } from "@/lib/bootlog";
import { QUALITY_PRESETS, type QualityLevel } from "@/config/quality";
import Drone from "./Drone";
import ChaseCamera from "./ChaseCamera";
import Lighting from "./Lighting";
import FlightScene from "./FlightScene";
import RemotePilots from "./world/RemotePilots";
import { useFlightControls } from "@/hooks/useFlightControls";
import { useMp } from "@/state/mp";

const CHARGE_SECONDS = 1.1;

function SquadGhosts() {
  const joined = useMp((s) => s.joined);
  if (!joined) return null;
  return <RemotePilots />;
}

// One-shot boot marker: proves the WebGL loop is alive (vs. a hung Canvas).
function FirstFrameLog() {
  const done = useRef(false);
  useFrame(() => {
    if (!done.current) {
      done.current = true;
      blog("first 3D frame rendered — boot complete");
    }
  });
  return null;
}

export default function DroneExperience({ level }: { level: QualityLevel }) {
  const quality = QUALITY_PRESETS[level];
  const phase = useFlightStore((s) => s.phase);
  const setPhase = useFlightStore((s) => s.setPhase);
  const soundEnabled = useFlightStore((s) => s.soundEnabled);

  const [worldMounted, setWorldMounted] = useState(false);
  const [shutter, setShutter] = useState(false);
  const [frameActive, setFrameActive] = useState(true);

  const chargeRaf = useRef(0);
  const scatter = useRef({ trees: quality.trees, rocks: quality.rocks, grass: quality.grass });
  scatter.current = { trees: quality.trees, rocks: quality.rocks, grass: quality.grass };

  useFlightControls();

  useEffect(() => {
    blog(`DroneExperience mounted (quality=${level})`);
  }, [level]);

  // --- Long-press charge machine ---
  const beginCharge = useCallback(() => {
    const st = useFlightStore.getState();
    if (st.phase !== "idle") return;
    engineAudio.init();
    setWorldMounted(true); // warm the lazy world chunk during the hold
    st.setPhase("charging");
    cancelAnimationFrame(chargeRaf.current);
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      flight.charge = Math.min(1, flight.charge + dt / CHARGE_SECONDS);
      if (flight.charge >= 1) {
        useFlightStore.getState().setPhase("launching");
        return;
      }
      chargeRaf.current = requestAnimationFrame(step);
    };
    chargeRaf.current = requestAnimationFrame(step);
  }, []);

  const cancelCharge = useCallback(() => {
    if (useFlightStore.getState().phase !== "charging") return;
    cancelAnimationFrame(chargeRaf.current);
    let last = performance.now();
    const decay = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      flight.charge = Math.max(0, flight.charge - dt * 2);
      if (flight.charge <= 0) {
        engineAudio.setHum(0);
        useFlightStore.getState().setPhase("idle");
        return;
      }
      chargeRaf.current = requestAnimationFrame(decay);
    };
    chargeRaf.current = requestAnimationFrame(decay);
  }, []);

  // F key hold to charge (keyboard alternative to the hold button).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyF" && !e.repeat) beginCharge();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyF") cancelCharge();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [beginCharge, cancelCharge]);

  useEffect(() => {
    setTakeoffRequestHandler(beginCharge);
    return () => setTakeoffRequestHandler(null);
  }, [beginCharge]);

  // --- Landing (Esc or HUD button) ---
  const beginLanding = useCallback(() => {
    if (useFlightStore.getState().phase !== "flight") return;
    useFlightStore.getState().setPhase("landing");
    setShutter(true);
    setTimeout(() => {
      resetFlight();
      engineAudio.setHum(0);
      useFlightStore.getState().setPhase("idle");
      setTimeout(() => setShutter(false), 120);
    }, 380);
  }, []);

  useEffect(() => {
    (window as unknown as { __flyjsLand?: () => void }).__flyjsLand = beginLanding;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useFlightStore.getState().phase === "flight") beginLanding();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      delete (window as unknown as { __flyjsLand?: () => void }).__flyjsLand;
    };
  }, [beginLanding]);

  // --- Scroll lock while flying ---
  useEffect(() => {
    const lock = phase !== "idle" && phase !== "charging";
    document.body.style.overflow = lock ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [phase]);

  // --- Frameloop + audio gating ---
  useEffect(() => {
    const update = () => setFrameActive(!document.hidden);
    const onVis = () => {
      if (document.hidden) engineAudio.suspend();
      else engineAudio.resume();
      update();
    };
    document.addEventListener("visibilitychange", onVis);
    update();
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // --- Screen wake lock while flying (mobile: stops the screen sleeping
  // mid-flight). Best-effort: unsupported browsers just skip it.
  useEffect(() => {
    if (phase !== "flight") return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: string) => Promise<{ release: () => Promise<void> }> };
      };
      nav.wakeLock
        ?.request("screen")
        .then((s) => {
          if (cancelled) s.release().catch(() => {});
          else sentinel = s;
        })
        .catch(() => {});
    } catch {
      /* unsupported — ignore */
    }
    return () => {
      cancelled = true;
      sentinel?.release().catch(() => {});
    };
  }, [phase]);

  useEffect(() => {
    engineAudio.setEnabled(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => () => engineAudio.dispose(), []);

  // Demo hook: ?autofly=1 takes off automatically (screenshots, demos).
  // No user gesture, so audio may stay suspended — visuals are unaffected.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("autofly")) {
        const id = setTimeout(() => beginCharge(), 1200);
        return () => clearTimeout(id);
      }
    } catch {
      /* ignore */
    }
  }, [beginCharge]);

  const inWorld = phase === "launching" || phase === "flight" || phase === "landing";

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 10 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#0c1324",
          transition: "opacity 700ms",
          opacity: inWorld ? 1 : 0,
        }}
      />
      <Canvas
        camera={{ fov: 65, near: 0.1, far: 260, position: [0, 3.2, 12] }}
        dpr={quality.dpr}
        frameloop={frameActive ? "always" : "never"}
        gl={{
          alpha: true,
          antialias: quality.antialias,
          powerPreference: level === "potato" ? "low-power" : "high-performance",
          toneMappingExposure: 1.15,
        }}
        style={{ pointerEvents: "none" }}
      >
        {/* NOTE: drei <PerformanceMonitor> intentionally not used — the
            useAdaptiveQuality hook (DOM rAF loop) handles step-downs without
            pulling in the whole drei dependency tree. */}
        <Lighting />
        <Drone scatter={scatter.current} />
        <ChaseCamera />
        <SquadGhosts />
        <FirstFrameLog />
        {worldMounted && (
          <Suspense fallback={null}>
            <FlightScene quality={quality} />
          </Suspense>
        )}
      </Canvas>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#0c1324",
          transition: "opacity 300ms",
          opacity: shutter ? 1 : 0,
        }}
      />
    </div>
  );
}
