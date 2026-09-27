"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cameraBus } from "@/three/cameraBus";

// FPV OSD instruments, drawn every frame on one canvas (a DOM rAF loop — no
// React work per frame):
//
// - Artificial horizon: a split bar through the crosshair area showing where
//   the REAL horizon is in the goggle image — tilts with roll, slides with
//   pitch, like a Betaflight OSD. It's computed from the live camera
//   (orientation + fov + gimbal tilt), not guessed from pitch/roll, so it
//   lines up with the rendered world in any attitude, loops included. When
//   the horizon is out of frame it pins to the edge band and dims, pointing
//   the way back to level. Short ±10°/±20° ladder rungs give scale.
// - Compass tape: heading ticks sliding under a fixed centre marker, with
//   N/E/S/W and a numeric heading readout, like real FPV goggles.

const OSD = "rgba(140,255,184,0.92)";
const OSD_DIM = "rgba(140,255,184,0.4)";
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export default function FpvInstruments() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = canvas.current;
      const cam = cameraBus.current as THREE.PerspectiveCamera | null;
      if (!cv || !cam) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 3;

      drawHorizon(ctx, cam, W, H);
      drawCompass(ctx, cam, W);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvas}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 19 }}
    />
  );
}

/**
 * Horizon from the camera: world-up expressed in camera space is u. A screen
 * point (sx, sy) — pixels from centre, y down — looks along (sx, −sy, −f),
 * and it's ON the horizon when that direction is horizontal: u·d = 0, i.e.
 *   ux·sx − uy·sy = uz·f.
 * That's a line with normal n = (ux, −uy); its closest point to the centre
 * is n·(uz·f/|n|²), and n points toward the sky side of the screen. Ladder
 * rungs at elevation a sit (approximately) f·tan(a) further along n.
 */
function drawHorizon(ctx: CanvasRenderingContext2D, cam: THREE.PerspectiveCamera, W: number, H: number) {
  _q.copy(cam.quaternion).invert();
  _v.set(0, 1, 0).applyQuaternion(_q);
  const ux = _v.x;
  const uy = _v.y;
  const uz = _v.z;
  const nLen2 = ux * ux + uy * uy;
  if (nLen2 < 1e-4) return; // looking straight up/down: no horizon direction
  const nLen = Math.sqrt(nLen2);
  const f = H / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  const nx = ux / nLen;
  const ny = -uy / nLen;
  // Signed distance of the horizon from the centre along n.
  const dist = (uz * f) / nLen;
  const cx = W / 2;
  const cy = H / 2;
  // Line direction (perpendicular to n), and its on-screen angle.
  const tx = -ny;
  const ty = nx;

  const limit = H * 0.36;
  const clamped = Math.abs(dist) > limit;
  const d = Math.max(-limit, Math.min(limit, dist));
  const hx = cx + nx * d;
  const hy = cy + ny * d;

  // Main split bar: two long arms with a gap for the crosshair.
  const gap = 26;
  const arm = Math.min(120, W * 0.14);
  ctx.strokeStyle = clamped ? OSD_DIM : OSD;
  ctx.lineWidth = 2.5;
  ctx.setLineDash(clamped ? [6, 5] : []);
  ctx.beginPath();
  ctx.moveTo(hx - tx * (gap + arm), hy - ty * (gap + arm));
  ctx.lineTo(hx - tx * gap, hy - ty * gap);
  ctx.moveTo(hx + tx * gap, hy + ty * gap);
  ctx.lineTo(hx + tx * (gap + arm), hy + ty * (gap + arm));
  ctx.stroke();
  // End ticks point toward the sky side (+n), so a pinned bar still says "up".
  ctx.beginPath();
  for (const s of [-1, 1]) {
    const ex = hx + tx * s * (gap + arm);
    const ey = hy + ty * s * (gap + arm);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + nx * 8, ey + ny * 8);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (clamped) return;
  // Pitch ladder: ±10°, ±20° rungs (dashed below the horizon, like a HUD).
  ctx.lineWidth = 1.5;
  ctx.font = "600 10px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillStyle = OSD;
  for (const a of [-20, -10, 10, 20]) {
    const off = f * Math.tan(THREE.MathUtils.degToRad(a));
    const rx = hx + nx * off;
    const ry = hy + ny * off;
    if (Math.hypot(rx - cx, ry - cy) > H * 0.42) continue;
    const half = a > 0 ? 34 : 28;
    ctx.strokeStyle = OSD_DIM;
    ctx.setLineDash(a < 0 ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(rx - tx * half, ry - ty * half);
    ctx.lineTo(rx - tx * 12, ry - ty * 12);
    ctx.moveTo(rx + tx * 12, ry + ty * 12);
    ctx.lineTo(rx + tx * half, ry + ty * half);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(String(Math.abs(a)), rx + tx * (half + 4) - 6, ry + ty * (half + 4) + 3);
  }
}

/** Compass tape: bearing of where the camera looks (north = −Z). If it's
 *  looking nearly straight down, use the top-of-frame direction instead. */
function drawCompass(ctx: CanvasRenderingContext2D, cam: THREE.PerspectiveCamera, W: number) {
  _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
  if (Math.hypot(_v.x, _v.z) < 0.2) _v.set(0, 1, 0).applyQuaternion(cam.quaternion);
  const bearing = ((Math.atan2(_v.x, -_v.z) * 180) / Math.PI + 360) % 360;

  const cx = W / 2;
  // Top centre on wide screens; lower on narrow ones, where the HUD's
  // top-right button cluster reaches the middle.
  const y = W < 1100 ? 140 : 46;
  const span = 120; // degrees visible across the tape
  const width = Math.min(300, W * 0.5);
  const pxPerDeg = width / span;
  const labels: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - width / 2, y - 14, width, 30);
  ctx.clip();
  ctx.strokeStyle = OSD;
  ctx.fillStyle = OSD;
  ctx.lineWidth = 1.5;
  ctx.font = "700 11px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  const first = Math.ceil((bearing - span / 2) / 5) * 5;
  for (let a = first; a <= bearing + span / 2; a += 5) {
    const x = cx + (a - bearing) * pxPerDeg;
    const norm = ((a % 360) + 360) % 360;
    const major = norm % 45 === 0;
    const mid = norm % 15 === 0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - (major ? 9 : mid ? 6 : 3));
    ctx.stroke();
    if (labels[norm] !== undefined) ctx.fillText(labels[norm], x, y + 12);
  }
  ctx.restore();

  // Fixed centre marker + numeric heading box.
  ctx.fillStyle = OSD;
  ctx.beginPath();
  ctx.moveTo(cx, y + 2);
  ctx.lineTo(cx - 5, y - 7);
  ctx.lineTo(cx + 5, y - 7);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 12px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${String(Math.round(bearing) % 360).padStart(3, "0")}°`, cx, y + 30);
}
