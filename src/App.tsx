"use client";

import { Suspense, lazy } from "react";
import { useAdaptiveQuality } from "@/hooks/useAdaptiveQuality";
import HUD from "@/ui/HUD";

// The 3D chunk stays out of the initial bundle — loaded on first paint only.
// (Same code-splitting idea as upstream's dynamic DroneExperience.)
const DroneExperience = lazy(() => import("@/three/DroneExperience"));

export default function App() {
  const { level, auto, choose, order } = useAdaptiveQuality();

  return (
    <div style={{ background: "#0c1324", color: "#e8eaf6", minHeight: "100vh" }}>
      {/* Page content behind the canvas (visible while idle). */}
      <main className="hero">
        <h1 style={{ fontSize: 40, margin: "0 0 8px" }}>flyjs</h1>
        <p style={{ opacity: 0.8, fontSize: 17, lineHeight: 1.55 }}>
          A lightweight flyable-drone + procedural-island scaffold.
          <br />
          Drone physics and island terrain adapted from{" "}
          <a href="https://github.com/rishabhrathod01/rishabhrathod01.github.io" style={{ color: "#c0c1ff" }}>
            rishabhrathod01.github.io
          </a>{" "}
          (MIT) — CV boards, race mode and blog/travel content removed.
        </p>
        <p style={{ opacity: 0.6, fontSize: 13 }}>
          Rendering tier: <strong>{level}</strong>
          {auto ? " (auto — adapts to measured FPS)" : " (manual)"} · try{" "}
          <code>?quality=potato|balanced|high|ultra</code>
        </p>
      </main>

      <Suspense
        fallback={
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 15,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              fontSize: 13,
              opacity: 0.6,
            }}
          >
            warming up the island…
          </div>
        }
      >
        <DroneExperience level={level} />
      </Suspense>
      <HUD level={level} auto={auto} order={order} onQuality={choose} />
    </div>
  );
}
