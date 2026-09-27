"use client";

import { useEffect, useMemo, useRef } from "react";
import { flight, isPackDown, useFlightStore } from "@/state/flight";
import { remoteStates } from "@/net/mp";
import { birdMarks } from "@/three/world/Birds";
import { BEACH, PAD, PICKUPS, REWARD_RINGS, WORLD } from "@/config/world";
import { TOMATO_TARGETS } from "@/config/tomato";
import { isTargetDown, useTomato } from "@/state/tomato";
import { ball, useRace } from "@/state/race";
import { REPAIR_KITS } from "@/config/hull";
import { wind } from "@/state/wind";
import { isKitDown } from "@/state/hull";
import { useNarrow } from "@/hooks/useNarrow";
import { heightAt } from "@/lib/terrain";

// Top-down minimap on a 2D canvas: prerendered terrain once, live dots at
// 5 Hz. North (−Z) is up. Cheap enough to leave on; toggle in settings.
// Shrinks on phone widths so it stops covering the island.

function buildBase(size: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px / size) * WORLD.terrainSize - WORLD.terrainSize / 2;
      const z = (py / size) * WORLD.terrainSize - WORLD.terrainSize / 2;
      const h = heightAt(x, z);
      let r: number, g: number, b: number;
      if (h < -0.35) {
        r = 51; g = 96; b = 138; // water
      } else {
        const beachW = 1 - Math.min(Math.max((Math.hypot(x - BEACH.x, z - BEACH.z) - BEACH.r * 0.5) / (BEACH.r * 0.5), 0), 1);
        if (beachW > 0.4) {
          r = 150; g = 130; b = 90; // sand
        } else {
          const t = Math.min(Math.max((h + 1.5) / 6, 0), 1);
          r = Math.round(45 + t * 30);
          g = Math.round(74 + t * 47);
          b = Math.round(66 + t * 28);
        }
      }
      const i = (py * size + px) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Geofence ring + helipad marker baked in.
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, (WORLD.softRadius / WORLD.terrainSize) * size, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#c0c1ff";
  ctx.beginPath();
  ctx.arc(((PAD.x + 80) / WORLD.terrainSize) * size, ((PAD.z + 80) / WORLD.terrainSize) * size, 3, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

export default function Minimap() {
  const narrow = useNarrow();
  const size = narrow ? 124 : 168;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const base = useMemo(
    () => (typeof document !== "undefined" ? buildBase(size) : null),
    [size]
  );

  const toPx = (x: number, z: number): [number, number] => [
    ((x + WORLD.terrainSize / 2) / WORLD.terrainSize) * size,
    ((z + WORLD.terrainSize / 2) / WORLD.terrainSize) * size,
  ];

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !base) return;
    const ctx = cv.getContext("2d")!;
    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(base, 0, 0);
      const st = useFlightStore.getState();
      const passed = st.ringsPassed;
      // Rings (only when the course is on).
      if (st.rewardsEnabled) {
        REWARD_RINGS.forEach((r, i) => {
          const [x, y] = toPx(r.x, r.z);
          const done = passed.includes(r.id);
          const next = i === passed.length;
          ctx.fillStyle = done ? "#4edea3" : next ? "#ffd166" : "rgba(255,209,102,0.45)";
          ctx.beginPath();
          ctx.arc(x, y, next ? 4 : 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      // Pickups (uncollected).
      for (const c of PICKUPS) {
        if (isPackDown(c.id)) continue;
        const [x, y] = toPx(c.x, c.z);
        ctx.fillStyle = "#4edea3";
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      // Tomato bullseyes (standing only, mode on).
      if (useTomato.getState().enabled) {
        for (const t of TOMATO_TARGETS) {
          if (isTargetDown(t.id)) continue;
          const [x, y] = toPx(t.x, t.z);
          ctx.fillStyle = "#e23b2e";
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      // Repair kits (available only): teal diamonds.
      ctx.fillStyle = "#4edea3";
      for (const k of REPAIR_KITS) {
        if (isKitDown(k.id)) continue;
        const [x, y] = toPx(k.x, k.z);
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + 3.5, y);
        ctx.lineTo(x, y + 4);
        ctx.lineTo(x - 3.5, y);
        ctx.closePath();
        ctx.fill();
      }
      // Loose basketball: pulsing marker so a miss is easy to relocate.
      if (useRace.getState().enabled && ball.state === "loose") {
        const [x, y] = toPx(ball.x, ball.z);
        const pulse = 3 + Math.sin(Date.now() / 200) * 1.2;
        ctx.fillStyle = "#e67c3c";
        ctx.beginPath();
        ctx.arc(x, y, pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Birds.
      ctx.fillStyle = "rgba(200,205,230,0.8)";
      for (const m of birdMarks) {
        const [x, y] = toPx(m.x, m.z);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
      // Wind arrow, top-left corner (north-up, absolute): where it blows.
      if (wind.speed > 0.2) {
        const cx = 14;
        const cy = 14;
        const len = 5 + Math.min(1, wind.speed / 8) * 5;
        const ux = Math.cos(wind.dir);
        const uz = Math.sin(wind.dir);
        ctx.strokeStyle = "rgba(232,234,246,0.9)";
        ctx.fillStyle = "rgba(232,234,246,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - ux * len, cy - uz * len);
        ctx.lineTo(cx + ux * len, cy + uz * len);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + ux * (len + 2), cy + uz * (len + 2));
        ctx.lineTo(cx + ux * (len - 3) - uz * 3, cy + uz * (len - 3) + ux * 3);
        ctx.lineTo(cx + ux * (len - 3) + uz * 3, cy + uz * (len - 3) - ux * 3);
        ctx.closePath();
        ctx.fill();
      }
      // Drone triangle, rotated by heading (0 = north/up).
      const [dx, dy] = toPx(flight.pos.x, flight.pos.z);
      // Squad peers (pilot color dots, white ring).
      const now = Date.now();
      for (const st of remoteStates.values()) {
        if (now - st.seen > 3000) continue;
        const [px, py] = toPx(st.x, st.z);
        ctx.fillStyle = st.color || "#4edea3";
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(-flight.heading);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    draw();
    const iv = setInterval(draw, 200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, size]);

  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        right: 16,
        pointerEvents: "auto",
        background: "rgba(12,19,36,0.72)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: 6,
        backdropFilter: "blur(6px)",
      }}
    >
      <canvas ref={canvasRef} width={size} height={size} style={{ width: size, height: size, borderRadius: 8 }} />
    </div>
  );
}
