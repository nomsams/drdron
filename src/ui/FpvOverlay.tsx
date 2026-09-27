"use client";

import { useEffect, useState } from "react";
import { flight, useFlightStore } from "@/state/flight";
import { useSettings } from "@/state/settings";
import { useMp } from "@/state/mp";
import { PAD, WORLD } from "@/config/world";

// FPV goggle chrome: a digital-FPV-style OSD (on-screen display) over the
// rigid nose-cam view from ChaseCamera's fpv branch — vignette + scanlines
// for the "goggles" feel, plus the readouts real FPV goggles show: battery
// voltage, RSSI-style signal bars, a flight timer, and a center reticle.
// DOM-only, polled at 5 Hz — no per-frame React work.

const OSD_GREEN = "#8cffb8";
const OSD_AMBER = "#ffd166";
const OSD_RED = "#ff5a5a";

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function FpvOverlay() {
  const cameraMode = useSettings((s) => s.cameraMode);
  const phase = useFlightStore((s) => s.phase);
  const squadRoom = useMp((s) => s.room);
  const [, force] = useState(0);

  const active = phase === "flight" && cameraMode === "fpv";

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(iv);
  }, [active]);

  if (!active) return null;

  const pct = Math.round(flight.battery * 100);
  const voltage = (9.9 + flight.battery * 2.7).toFixed(1);
  const batColor = pct <= 10 ? OSD_RED : pct <= 20 ? OSD_AMBER : OSD_GREEN;
  const batBlink = pct <= 20;

  const distFromHome = Math.hypot(flight.pos.x - PAD.x, flight.pos.z - PAD.z);
  const sigRatio = Math.max(0, Math.min(1, 1 - distFromHome / (WORLD.softRadius * 1.15)));
  const bars = Math.max(1, Math.ceil(sigRatio * 4));
  const rssi = Math.round(-40 - (1 - sigRatio) * 55);

  const osdFont: React.CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    letterSpacing: 0.5,
    textShadow: "0 0 6px rgba(0,0,0,0.85)",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 18, pointerEvents: "none" }}>
      {/* Vignette — dark goggle-tube edges. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.72) 100%)",
        }}
      />
      {/* Faint scanlines. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.12,
          mixBlendMode: "multiply",
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.9) 0px, rgba(0,0,0,0.9) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {/* Center reticle. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 26,
          height: 26,
          transform: "translate(-50%, -50%)",
          opacity: 0.6,
        }}
      >
        <div style={{ position: "absolute", left: 0, top: "50%", width: "100%", height: 1.5, background: OSD_GREEN }} />
        <div style={{ position: "absolute", top: 0, left: "50%", height: "100%", width: 1.5, background: OSD_GREEN }} />
        <div
          style={{
            position: "absolute",
            inset: 8,
            border: `1px solid ${OSD_GREEN}`,
            borderRadius: "50%",
          }}
        />
      </div>

      {/* Top-center: callsign / room. */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: "50%",
          transform: "translateX(-50%)",
          color: OSD_GREEN,
          fontSize: 12,
          opacity: 0.85,
          ...osdFont,
        }}
      >
        {squadRoom ? `SQUAD ${squadRoom}` : "SOLO"} · CH:R2 5806
      </div>

      {/* Top-left: REC + timer. */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 16,
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: OSD_GREEN,
          fontSize: 13,
          ...osdFont,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: OSD_RED,
            animation: "flyjs-rec-blink 1.4s steps(2) infinite",
          }}
        />
        REC {fmtClock(flight.flightElapsed)}
      </div>

      {/* Top-right: signal bars. */}
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 16,
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          color: OSD_GREEN,
          fontSize: 11,
          ...osdFont,
        }}
      >
        <span style={{ marginRight: 4 }}>{rssi}dBm</span>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              width: 5,
              height: 5 + i * 3,
              background: i < bars ? OSD_GREEN : "rgba(140,255,184,0.25)",
            }}
          />
        ))}
      </div>

      {/* Bottom-left: battery. */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: batColor,
          fontSize: 13,
          ...osdFont,
          animation: batBlink ? "flyjs-batt-blink 0.9s steps(2) infinite" : undefined,
        }}
      >
        <span
          style={{
            position: "relative",
            display: "inline-block",
            width: 28,
            height: 14,
            border: `1.5px solid ${batColor}`,
            borderRadius: 2,
          }}
        >
          <span
            style={{
              position: "absolute",
              right: -4,
              top: 4,
              width: 3,
              height: 6,
              background: batColor,
            }}
          />
          <span
            style={{
              position: "absolute",
              left: 1,
              top: 1,
              bottom: 1,
              width: `${Math.max(4, pct)}%`,
              background: batColor,
            }}
          />
        </span>
        {pct}% · {voltage}V
      </div>

      {/* Bottom-right: speed / altitude. */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          right: 16,
          textAlign: "right",
          color: OSD_GREEN,
          fontSize: 13,
          lineHeight: 1.4,
          ...osdFont,
        }}
      >
        <div>{flight.speedKmh.toFixed(0)} km/h</div>
        <div>ALT {flight.altitude.toFixed(1)}m</div>
      </div>

      {pct <= 15 && (
        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: "50%",
            transform: "translateX(-50%)",
            color: OSD_RED,
            fontSize: 13,
            fontWeight: 700,
            ...osdFont,
            animation: "flyjs-batt-blink 0.6s steps(2) infinite",
          }}
        >
          ⚠ LOW VOLTAGE — LANDING SOON
        </div>
      )}

      <style>
        {`
        @keyframes flyjs-rec-blink { 50% { opacity: 0.15; } }
        @keyframes flyjs-batt-blink { 50% { opacity: 0.35; } }
        `}
      </style>
    </div>
  );
}
