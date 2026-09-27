"use client";

import { flight } from "@/state/flight";
import { HP_MAX } from "@/config/hull";
import { useHull } from "@/state/hull";
import { useToasts } from "@/state/toasts";

// HP bar (read live from flight.hp — the HUD already re-renders at 5 Hz while
// flying), a red edge flash on hits / teal flash on repairs, and the event
// toast stack. No cross icon anywhere: repairs are a wrench.

export function HullBar({ compact = false }: { compact?: boolean }) {
  const hp = Math.round(flight.hp);
  const frac = Math.max(0, Math.min(1, flight.hp / HP_MAX));
  const color = frac > 0.5 ? "#4edea3" : frac > 0.25 ? "#ffd166" : "#ff5a5a";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: compact ? 0 : 6 }}>
      <span style={{ fontWeight: 700, opacity: 0.8 }}>HP</span>
      <span
        style={{
          position: "relative",
          width: compact ? 90 : 140,
          height: 8,
          borderRadius: 4,
          background: "rgba(255,255,255,0.12)",
          overflow: "hidden",
          animation: frac <= 0.25 ? "flyjs-hp-blink 0.8s steps(2) infinite" : undefined,
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${frac * 100}%`,
            background: color,
            transition: "width 200ms, background 200ms",
          }}
        />
      </span>
      <span style={{ minWidth: 26, textAlign: "right" }}>{hp}</span>
      {flight.repairing && <span style={{ color: "#4edea3" }}>🔧 repairing…</span>}
      <style>{`@keyframes flyjs-hp-blink { 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}

export function HullFlash() {
  const hitVersion = useHull((s) => s.hitVersion);
  const healVersion = useHull((s) => s.healVersion);
  const edge = (rgba: string) =>
    `radial-gradient(ellipse at center, transparent 55%, ${rgba} 100%)`;
  return (
    <>
      {hitVersion > 0 && (
        <div
          key={`hit-${hitVersion}`}
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            background: edge("rgba(255,60,60,0.55)"),
            animation: "flyjs-flash 450ms ease-out forwards",
          }}
        />
      )}
      {healVersion > 0 && (
        <div
          key={`heal-${healVersion}`}
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            background: edge("rgba(78,222,163,0.45)"),
            animation: "flyjs-flash 600ms ease-out forwards",
          }}
        />
      )}
      <style>{`@keyframes flyjs-flash { from { opacity: 1; } to { opacity: 0; } }`}</style>
    </>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  if (toasts.length === 0) return null;
  const tone = { info: "rgba(192,193,255,0.5)", good: "rgba(78,222,163,0.6)", bad: "rgba(255,90,90,0.6)" };
  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        pointerEvents: "none",
        zIndex: 26,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: "rgba(12,19,36,0.88)",
            border: `1px solid ${tone[t.tone]}`,
            borderRadius: 999,
            padding: "5px 12px",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
