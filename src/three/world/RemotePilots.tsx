"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import ProceduralDrone from "../ProceduralDrone";
import { remoteStates } from "@/net/mp";
import { useMp } from "@/state/mp";

// Remote pilot ghosts: one procedural drone per peer, tinted beacon ring +
// canvas nameplate in the pilot's color. Positions arrive ~10 Hz and are
// interpolated every frame; stale (>3 s) peers hide. Grounded/idle peers are
// still shown (dimmed beacon) so squads can see each other on the pad.

const FRESH_MS = 3000;
const SNAP_DIST_SQ = 30 * 30;

function makeNameplate(name: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const r = 14;
  ctx.fillStyle = "rgba(10,15,30,0.72)";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(2, 6, 252, 52, r);
    ctx.fill();
  } else {
    ctx.fillRect(2, 6, 252, 52);
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(30, 32, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8eaf6";
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const label = name.length > 14 ? name.slice(0, 13) + "…" : name;
  ctx.fillText(label, 50, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Ghost({ id }: { id: string }) {
  const group = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const peer = useMp((s) => s.peers.find((p) => p.id === id));
  const name = peer?.name ?? "Pilot";
  const color = peer?.color ?? "#e8eaf6";
  const plate = useMemo(() => makeNameplate(name, color), [name, color]);
  useEffect(() => () => plate.dispose(), [plate]);

  const euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
  const targetQ = useMemo(() => new THREE.Quaternion(), []);
  const snapped = useRef(false);

  useFrame((_, dtRaw) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(dtRaw, 0.1);
    const st = remoteStates.get(id);
    const fresh = !!st && Date.now() - st.seen < FRESH_MS;
    g.visible = fresh;
    if (!fresh || !st) return;
    if (!snapped.current) {
      g.position.set(st.x, st.y, st.z);
      euler.set(st.pitch, st.heading, st.roll);
      g.quaternion.setFromEuler(euler);
      snapped.current = true;
      return;
    }
    const dx = st.x - g.position.x;
    const dy = st.y - g.position.y;
    const dz = st.z - g.position.z;
    if (dx * dx + dy * dy + dz * dz > SNAP_DIST_SQ) {
      // Teleport on huge jumps (rejoin / geofence snap) — no fly-across-map.
      g.position.set(st.x, st.y, st.z);
    } else {
      const k = 1 - Math.exp(-8 * dt);
      g.position.x += dx * k;
      g.position.y += dy * k;
      g.position.z += dz * k;
      euler.set(st.pitch, st.heading, st.roll);
      targetQ.setFromEuler(euler);
      g.quaternion.slerp(targetQ, k);
    }
    if (beacon.current) {
      beacon.current.opacity = st.flying ? 0.85 : 0.35;
    }
  });

  // Spin is read live (no re-render) so props track the remote pilot.
  const spin = useMemo(
    () => ({
      get current() {
        return remoteStates.get(id)?.spin ?? 0.45;
      },
    }),
    [id]
  );

  return (
    <group ref={group} visible={false}>
      <GhostDrone spinRef={spin} />
      {/* pilot-color beacon ring for visibility at distance */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.0, 0]}>
        <torusGeometry args={[1.0, 0.07, 8, 24]} />
        <meshBasicMaterial
          ref={beacon}
          color={color}
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </mesh>
      <sprite position={[0, 1.35, 0]} scale={[2.6, 0.65, 1]}>
        <spriteMaterial map={plate} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

// ProceduralDrone takes a plain number — mirror the live spin at 5 Hz
// instead of re-rendering every frame.
function GhostDrone({ spinRef }: { spinRef: { readonly current: number } }) {
  const [spin, setSpin] = useState(0.45);
  useEffect(() => {
    const iv = setInterval(() => setSpin(spinRef.current), 200);
    return () => clearInterval(iv);
  }, [spinRef]);
  return <ProceduralDrone spin={spin} />;
}

export default function RemotePilots() {
  const peers = useMp((s) => s.peers);
  if (peers.length === 0) return null;
  return (
    <group>
      {peers.slice(0, 7).map((p) => (
        <Ghost key={p.id} id={p.id} />
      ))}
    </group>
  );
}
