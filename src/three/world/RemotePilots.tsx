"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import ProceduralDrone from "../ProceduralDrone";
import { predictedRemote, remoteStates } from "@/net/mp";
import { useMp } from "@/state/mp";
import { spawnBurst } from "@/state/bursts";
import { HP_MAX } from "@/config/hull";
import { BALL_CARRY_DOWN, BALL_CARRY_FORWARD, BALL_RADIUS } from "@/config/race";

// Remote pilot ghosts: one procedural drone per peer, tinted beacon ring +
// canvas nameplate + HP bar in the pilot's color, plus their basketball when
// their race mode is on. Positions arrive ~10 Hz and are dead-reckoned from
// velocity between packets; stale (>3 s) peers hide. Grounded/idle peers are
// still shown (dimmed beacon) so squads can see each other on the pad.

const FRESH_MS = 3000;
const SNAP_DIST_SQ = 30 * 30;
const HP_BAR_W = 1.6;
const _pred = { x: 0, y: 0, z: 0 };
const _ballTarget = new THREE.Vector3();

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
  const label = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const hpFill = useRef<THREE.Sprite>(null);
  const hpFillMat = useRef<THREE.SpriteMaterial>(null);
  const carriedBall = useRef<THREE.Mesh>(null);
  const looseBall = useRef<THREE.Mesh>(null);
  const peer = useMp((s) => s.peers.find((p) => p.id === id));
  const name = peer?.name ?? "Pilot";
  const color = peer?.color ?? "#e8eaf6";
  const plate = useMemo(() => makeNameplate(name, color), [name, color]);
  useEffect(() => () => plate.dispose(), [plate]);

  const euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
  const targetQ = useMemo(() => new THREE.Quaternion(), []);
  const snapped = useRef(false);
  const lastHp = useRef(HP_MAX);
  const looseSnapped = useRef(false);

  useFrame((_, dtRaw) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(dtRaw, 0.1);
    const st = remoteStates.get(id);
    const fresh = !!st && Date.now() - st.seen < FRESH_MS;
    g.visible = fresh;
    if (label.current) label.current.visible = fresh;
    if (looseBall.current) looseBall.current.visible = fresh && !!st?.ball?.loose;
    if (!fresh || !st) return;

    // Dead reckoning: chase where they are NOW (last packet + velocity ×
    // time since), not where they were ~100 ms ago — ghosts stop trailing
    // their pilots, and fast flybys don't stutter between packets.
    const p = predictedRemote(st, _pred);
    if (!snapped.current) {
      g.position.set(p.x, p.y, p.z);
      euler.set(st.pitch, st.heading, st.roll);
      g.quaternion.setFromEuler(euler);
      snapped.current = true;
    } else {
      const dx = p.x - g.position.x;
      const dy = p.y - g.position.y;
      const dz = p.z - g.position.z;
      if (dx * dx + dy * dy + dz * dz > SNAP_DIST_SQ) {
        // Teleport on huge jumps (rejoin / respawn) — no fly-across-map.
        g.position.set(p.x, p.y, p.z);
      } else {
        const k = 1 - Math.exp(-12 * dt);
        g.position.x += dx * k;
        g.position.y += dy * k;
        g.position.z += dz * k;
        euler.set(st.pitch, st.heading, st.roll);
        targetQ.setFromEuler(euler);
        g.quaternion.slerp(targetQ, k);
      }
    }
    if (beacon.current) {
      beacon.current.opacity = st.flying ? 0.85 : 0.35;
    }
    label.current?.position.copy(g.position);

    // Hull: left-anchored bar under the nameplate; sparks when it drops.
    const frac = Math.max(0, Math.min(1, st.hp / HP_MAX));
    if (hpFill.current) hpFill.current.scale.x = HP_BAR_W * Math.max(frac, 0.001);
    hpFillMat.current?.color.set(frac > 0.5 ? "#4edea3" : frac > 0.25 ? "#ffd166" : "#ff5a5a");
    if (st.hp < lastHp.current) spawnBurst("sparks", g.position.x, g.position.y, g.position.z);
    lastHp.current = st.hp;

    // Their basketball: under their drone when carried, in the world when loose.
    if (carriedBall.current) carriedBall.current.visible = !!st.ball && !st.ball.loose;
    const lb = looseBall.current;
    if (lb && st.ball?.loose) {
      const b = st.ball;
      if (!looseSnapped.current || lb.position.distanceToSquared(_ballTarget.set(b.x, b.y, b.z)) > 25) {
        lb.position.set(b.x, b.y, b.z);
        looseSnapped.current = true;
      } else {
        lb.position.lerp(_ballTarget.set(b.x, b.y, b.z), 1 - Math.exp(-12 * dt));
      }
    } else {
      looseSnapped.current = false;
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
    <>
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
        {/* carried basketball — ghost-local, so it tilts with their drone */}
        <mesh ref={carriedBall} position={[0, -BALL_CARRY_DOWN, -BALL_CARRY_FORWARD]} visible={false}>
          <sphereGeometry args={[BALL_RADIUS, 12, 10]} />
          <meshStandardMaterial color="#e67c3c" roughness={0.55} />
        </mesh>
      </group>
      {/* Nameplate + HP bar: follows the ghost's position but NOT its
          rotation, so the left-anchored bar doesn't swing with heading. */}
      <group ref={label} visible={false}>
        <sprite position={[0, 1.35, 0]} scale={[2.6, 0.65, 1]}>
          <spriteMaterial map={plate} transparent depthWrite={false} />
        </sprite>
        <sprite position={[0, 0.95, 0]} scale={[HP_BAR_W + 0.08, 0.16, 1]} renderOrder={10}>
          <spriteMaterial color="#0a0f1e" transparent opacity={0.75} depthWrite={false} />
        </sprite>
        <sprite
          ref={hpFill}
          position={[-HP_BAR_W / 2, 0.95, 0]}
          center={[0, 0.5]}
          scale={[HP_BAR_W, 0.1, 1]}
          renderOrder={11}
        >
          <spriteMaterial ref={hpFillMat} color="#4edea3" transparent depthWrite={false} toneMapped={false} />
        </sprite>
      </group>
      <mesh ref={looseBall} visible={false}>
        <sphereGeometry args={[BALL_RADIUS, 12, 10]} />
        <meshStandardMaterial color="#e67c3c" roughness={0.55} />
      </mesh>
    </>
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
