"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { flight, useFlightStore } from "@/state/flight";
import { remoteStates } from "@/net/mp";
import { useMp } from "@/state/mp";
import { cameraBus } from "@/three/cameraBus";

// Floating squadmate markers: name + distance chips projected from the live
// camera, clamped into the viewport with an edge glow when the pilot is
// off-screen. The fun of a squad is finding each other — on a phone screen
// the island is big and ghosts are small, so these do the pointing.
// DOM-only, 7 Hz, pointer-transparent, flight phase only.

const TICK_MS = 150;
const FRESH_MS = 3000;

const tmpV = new THREE.Vector3();
const tmpP = new THREE.Vector3();

interface Chip {
  id: string;
  name: string;
  color: string;
  dist: number;
  x: number;
  y: number;
  offscreen: boolean;
}

function useTick(active: boolean, ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(iv);
  }, [active, ms]);
  return n;
}

export default function PeerMarkers() {
  const joined = useMp((s) => s.joined);
  const peers = useMp((s) => s.peers);
  const phase = useFlightStore((s) => s.phase);
  const tick = useTick(joined && phase === "flight" && peers.length > 0, TICK_MS);
  void tick;

  if (!joined || phase !== "flight" || peers.length === 0) return null;
  const cam = cameraBus.current;
  if (!cam) return null;

  const W = window.innerWidth;
  const H = window.innerHeight;
  const now = Date.now();
  tmpP.copy(flight.pos);

  const chips: Chip[] = [];
  for (const p of peers) {
    const st = remoteStates.get(p.id);
    if (!st || now - st.seen > FRESH_MS) continue;
    const dist = Math.round(tmpP.distanceTo(tmpV.set(st.x, st.y, st.z)));
    // Project above the ghost (nameplate height) so chips don't cover drones.
    tmpV.set(st.x, st.y + 1.6, st.z).project(cam);
    const behind = tmpV.z > 1;
    let x = (tmpV.x * 0.5 + 0.5) * W;
    let y = (-tmpV.y * 0.5 + 0.5) * H;
    if (behind) {
      x = W - x;
      y = H - 120;
    }
    const marginX = 70;
    const top = 120;
    const bottom = H - 150;
    const offscreen =
      behind || x < marginX || x > W - marginX || y < top || y > bottom;
    x = Math.min(W - marginX, Math.max(marginX, x));
    y = Math.min(bottom, Math.max(top, y));
    chips.push({ id: p.id, name: p.name, color: p.color, dist, x, y, offscreen });
  }

  if (chips.length === 0) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {chips.map((c) => (
        <div
          key={c.id}
          style={{
            position: "absolute",
            left: c.x,
            top: c.y,
            transform: "translate(-50%, -50%)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: c.offscreen
              ? "rgba(12,19,36,0.9)"
              : "rgba(12,19,36,0.66)",
            border: `1px solid ${c.offscreen ? c.color : "rgba(255,255,255,0.18)"}`,
            borderRadius: 999,
            padding: "4px 10px",
            fontSize: 11,
            whiteSpace: "nowrap",
            boxShadow: c.offscreen ? `0 0 12px ${c.color}66` : undefined,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: c.color,
              flexShrink: 0,
            }}
          />
          <span style={{ maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis" }}>
            {c.name}
          </span>
          <span style={{ opacity: 0.65 }}>{c.dist}m</span>
        </div>
      ))}
    </div>
  );
}
