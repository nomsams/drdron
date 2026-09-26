"use client";

import { Suspense, lazy, useEffect, useState } from "react";
import { useAdaptiveQuality } from "@/hooks/useAdaptiveQuality";
import { blog, blogErr } from "@/lib/bootlog";
import HUD from "@/ui/HUD";

// The 3D chunk stays out of the initial bundle — loaded on first paint only.
// (Same code-splitting idea as upstream's dynamic DroneExperience.)
// Retried 3×: a first-load failure (sleeping dev server, dropped wifi) used
// to hang on "warming up the island…" forever with zero explanation.

function loadDroneExperience(): Promise<typeof import("@/three/DroneExperience")> {
  let attempt = 0;
  const tryLoad = (): Promise<typeof import("@/three/DroneExperience")> => {
    attempt += 1;
    blog(`loading 3D chunk (attempt ${attempt}/3)…`);
    return import("@/three/DroneExperience").then(
      (m) => {
        blog("3D chunk loaded");
        return m;
      },
      (err) => {
        blogErr(err, `3D chunk attempt ${attempt}`);
        if (attempt < 3) {
          return new Promise((res) => setTimeout(res, 1500)).then(tryLoad);
        }
        throw err;
      }
    );
  };
  return tryLoad();
}

const DroneExperience = lazy(loadDroneExperience);

// Suspense fallback with a clock: past ~15 s the chunk is probably failing,
// so say so and offer a reload instead of spinning silently.
function ChunkFallback() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    blog("App mounted (HUD up) — waiting for 3D chunk…");
    const iv = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  if (secs < 15) {
    return (
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
        warming up the island… ({secs}s)
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 15,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        color: "#e8eaf6",
        background: "rgba(12,19,36,0.85)",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          The island is taking too long ({secs}s)
        </div>
        <div style={{ opacity: 0.7, marginBottom: 12 }}>
          Dev server asleep? Offline? Check the boot log (F12 console) for the
          chunk error, then retry.
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { level, auto, choose, order } = useAdaptiveQuality();

  useEffect(() => {
    blog(`App mounted — quality=${level} auto=${auto}`);
  }, [level, auto]);

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

      <Suspense fallback={<ChunkFallback />}>
        <DroneExperience level={level} />
      </Suspense>
      <HUD level={level} auto={auto} order={order} onQuality={choose} />
    </div>
  );
}
