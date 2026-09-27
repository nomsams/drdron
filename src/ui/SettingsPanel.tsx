"use client";

import { useSettings, type FlightMode, type TouchMode, type WindLevel } from "@/state/settings";

// Settings panel: every ambient/feature system toggleable for performance,
// plus sensitivity and touch mode. Persisted to localStorage.

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 0",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      <span>
        {label}
        {hint && <span style={{ display: "block", fontSize: 11, opacity: 0.6 }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      style={{ width: 18, height: 18, accentColor: "#c0c1ff", cursor: "pointer" }}
    />
  );
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        right: 16,
        width: 264,
        pointerEvents: "auto",
        background: "rgba(12,19,36,0.92)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 12,
        padding: "12px 14px",
        backdropFilter: "blur(8px)",
        fontSize: 13,
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <strong>Settings</strong>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#e8eaf6", cursor: "pointer", fontSize: 16 }}
        >
          ✕
        </button>
      </div>
      <Row label="Flight mode" hint="M key cycles · X flips (Easy/Angle)">
        <select
          value={s.flightMode}
          onChange={(e) => s.set({ flightMode: e.target.value as FlightMode })}
          style={{ background: "#1a2440", color: "#e8eaf6", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", padding: "4px 6px", fontSize: 12 }}
        >
          <option value="easy">Easy (arcade)</option>
          <option value="angle">Angle (real physics)</option>
          <option value="acro">Acro (full flips)</option>
        </select>
      </Row>
      <Row label="Wind" hint="drifts drone + ball; windsocks show it">
        <select
          value={s.wind}
          onChange={(e) => s.set({ wind: e.target.value as WindLevel })}
          style={{ background: "#1a2440", color: "#e8eaf6", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", padding: "4px 6px", fontSize: 12 }}
        >
          <option value="off">Off</option>
          <option value="light">Light</option>
          <option value="strong">Strong</option>
        </select>
      </Row>
      <Row label="Birds" hint="flock over the pond">
        <Toggle value={s.birds} onChange={(v) => s.set({ birds: v })} />
      </Row>
      <Row label="Butterflies" hint="meadow flutter">
        <Toggle value={s.butterflies} onChange={(v) => s.set({ butterflies: v })} />
      </Row>
      <Row label="Clouds" hint="drifting puffs">
        <Toggle value={s.clouds} onChange={(v) => s.set({ clouds: v })} />
      </Row>
      <Row label="Water ripples" hint="pond + shore rings">
        <Toggle value={s.ripples} onChange={(v) => s.set({ ripples: v })} />
      </Row>
      <Row label="Waterfall audio" hint="proximity rushing">
        <Toggle value={s.waterfallAudio} onChange={(v) => s.set({ waterfallAudio: v })} />
      </Row>
      <Row label="Fireflies" hint="after sunset, high tiers">
        <Toggle value={s.fireflies} onChange={(v) => s.set({ fireflies: v })} />
      </Row>
      <Row label="Minimap" hint="top-down tracker">
        <Toggle value={s.minimap} onChange={(v) => s.set({ minimap: v })} />
      </Row>
      <Row label="FPS meter" hint="top-right readout">
        <Toggle value={s.showFps} onChange={(v) => s.set({ showFps: v })} />
      </Row>
      <Row label="Touch sticks" hint="phones + tablets">
        <select
          value={s.touch}
          onChange={(e) => s.set({ touch: e.target.value as TouchMode })}
          style={{ background: "#1a2440", color: "#e8eaf6", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", padding: "4px 6px", fontSize: 12 }}
        >
          <option value="auto">Auto</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </Row>
      <Row label={`Sensitivity ${s.sensitivity.toFixed(1)}×`} hint="0.5 gentle … 2.0 wild">
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={s.sensitivity}
          onChange={(e) => s.set({ sensitivity: parseFloat(e.target.value) })}
          style={{ width: 110, accentColor: "#c0c1ff" }}
        />
      </Row>
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
        Rings have their own ★ toggle (HUD / R key). Geometry density lives in the quality tier selector.
      </div>
      <button
        type="button"
        onClick={() => s.reset()}
        style={{
          marginTop: 8,
          width: "100%",
          padding: "8px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.2)",
          background: "none",
          color: "#e8eaf6",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Reset defaults
      </button>
    </div>
  );
}
