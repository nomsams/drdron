"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  MAX_SPLATS,
  SPLAT_LIFE_MS,
  TARGET_HIT_HEIGHT,
  TARGET_RADIUS,
  TOMATO_GRAVITY,
  TOMATO_TARGETS,
} from "@/config/tomato";
import { heightAt } from "@/lib/terrain";
import { engineAudio } from "@/lib/audio";
import { broadcastTomatoDrop } from "@/net/mp";
import {
  isTargetDown,
  predictDrop,
  removeShock,
  removeTomato,
  shocks,
  SHOCK_LIFE_MS,
  spawnShock,
  spawnSplat,
  splats,
  sweepTomatoWorld,
  tomatoes,
  tryDropLocal,
  useTomato,
  type FlyingTomato,
} from "@/state/tomato";
import { flight, useFlightStore } from "@/state/flight";

// Flying tomatoes + ground splats.
//
// Physics runs in ONE useFrame here (no per-frame React work): each tomato
// integrates arcade gravity, checks bullseyes (local drops only — remote
// ghosts splat but never score), then splats on terrain/water. Mesh positions
// are written imperatively via a ref map; React only re-renders the lists on
// drops/hits/expiry (the `version` counter).
//
// Drop input: T / B keys (hold for barrage, cooldown-governed) + the HUD 🍅
// button (mouse + touch). Drops only count in `flight` phase.

const WATER_Y = -0.35;

/** Best-effort haptics (Android): thump on bullseye, ignored on desktop. */
function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported — ignore */
  }
}

interface TargetPose {
  id: string;
  x: number;
  y: number;
  z: number;
}

export default function Tomatoes({ splatCap = MAX_SPLATS }: { splatCap?: number }) {
  const enabled = useTomato((s) => s.enabled);
  // Re-render tomato/splat lists on drops, hits, fades, respawns, reset.
  const version = useTomato((s) => s.version);
  void version;

  const poses = useMemo<TargetPose[]>(
    () =>
      TOMATO_TARGETS.map((t) => {
        const y = heightAt(t.x, t.z);
        return { id: t.id, x: t.x, y, z: t.z };
      }),
    []
  );

  const tomatoGroups = useRef(new Map<number, THREE.Group>());
  const splatMats = useRef(new Map<number, THREE.MeshBasicMaterial>());
  const shockGroups = useRef(new Map<number, THREE.Group>());
  const shockMats = useRef(new Map<number, THREE.MeshBasicMaterial>());

  // T / B to drop (hold for barrage). Skipped while typing in inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyT" && e.code !== "KeyB") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      const res = tryDropLocal();
      if (res) {
        engineAudio.init();
        engineAudio.playDrop();
        broadcastTomatoDrop(res.pos, res.vel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 1 Hz housekeeping: target respawns, splat expiry + cap.
  useEffect(() => {
    const iv = setInterval(() => sweepTomatoWorld(splatCap), 1000);
    return () => clearInterval(iv);
  }, [splatCap]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const ts = useTomato.getState();
    const t = state.clock.elapsedTime;

    for (let i = tomatoes.length - 1; i >= 0; i--) {
      const tm = tomatoes[i];
      tm.vy -= TOMATO_GRAVITY * dt;
      tm.x += tm.vx * dt;
      tm.y += tm.vy * dt;
      tm.z += tm.vz * dt;

      // Bullseye check (local drops only, standing targets only).
      if (!tm.remote && ts.enabled) {
        const hit = poses.find(
          (p) =>
            !isTargetDown(p.id) &&
            (tm.x - p.x) * (tm.x - p.x) + (tm.z - p.z) * (tm.z - p.z) <
              TARGET_RADIUS * TARGET_RADIUS &&
            tm.y < p.y + TARGET_HIT_HEIGHT + 0.45 &&
            tm.y > p.y - 0.5
        );
        if (hit) {
          ts.registerHit(hit.id);
          spawnSplat(hit.x, hit.y + 0.14, hit.z, true);
          spawnShock(hit.x, hit.y + 0.5, hit.z);
          engineAudio.playBullseye();
          buzz(60);
          flight.shake = Math.min(0.6, flight.shake + 0.22);
          tomatoGroups.current.delete(tm.id);
          removeTomato(tm.id);
          continue;
        }
      }

      // Ground / water impact.
      const floor = Math.max(heightAt(tm.x, tm.z), WATER_Y);
      if (tm.y <= floor + 0.15) {
        spawnSplat(tm.x, floor + 0.07, tm.z, false);
        ts.bump();
        engineAudio.playSplat();
        tomatoGroups.current.delete(tm.id);
        removeTomato(tm.id);
        continue;
      }

      const g = tomatoGroups.current.get(tm.id);
      if (g) {
        g.position.set(tm.x, tm.y, tm.z);
        g.rotation.x += dt * 7;
        g.rotation.z += dt * 5;
      }
    }

    // Splat fade-out (imperative — no re-renders).
    const now = Date.now();
    for (const s of splats) {
      const m = splatMats.current.get(s.id);
      if (!m) continue;
      const age = now - s.born;
      const k = age / SPLAT_LIFE_MS;
      m.opacity = k < 0.7 ? 0.95 : 0.95 * (1 - (k - 0.7) / 0.3);
    }

    // Shockwave expand + fade (imperative); expired ones leave the scene.
    let shocksChanged = false;
    for (let i = shocks.length - 1; i >= 0; i--) {
      const sh = shocks[i];
      const age = now - sh.born;
      const k = age / SHOCK_LIFE_MS;
      if (k >= 1) {
        shockGroups.current.delete(sh.id);
        shockMats.current.delete(sh.id);
        shocks.splice(i, 1);
        shocksChanged = true;
        continue;
      }
      const g = shockGroups.current.get(sh.id);
      const m = shockMats.current.get(sh.id);
      if (g) {
        const s = 1 + k * 3.2;
        g.scale.set(s, s, s);
      }
      if (m) m.opacity = 0.85 * (1 - k);
    }
    if (shocksChanged) ts.bump();
    void t;
  });

  if (!enabled && tomatoes.length === 0 && splats.length === 0) return null;

  return (
    <group>
      {tomatoes.map((tm) => (
        <TomatoMesh
          key={tm.id}
          tm={tm}
          register={(id, g) => {
            if (g) tomatoGroups.current.set(id, g);
            else tomatoGroups.current.delete(id);
          }}
        />
      ))}
      {splats.map((s) => (
        <mesh
          key={s.id}
          rotation={[-Math.PI / 2, 0, s.rot]}
          position={[s.x, s.y, s.z]}
        >
          <circleGeometry args={[0.9 * s.scale, 14]} />
          <meshBasicMaterial
            ref={(el) => {
              if (el) splatMats.current.set(s.id, el);
              else splatMats.current.delete(s.id);
            }}
            color={s.hit ? "#e0512e" : "#b8281e"}
            transparent
            opacity={0.95}
            depthWrite={false}
          />
        </mesh>
      ))}
      {shocks.map((sh) => (
        <group
          key={sh.id}
          position={[sh.x, sh.y, sh.z]}
          ref={(g) => {
            if (g) shockGroups.current.set(sh.id, g);
            else shockGroups.current.delete(sh.id);
          }}
        >
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.9, 1.15, 28]} />
            <meshBasicMaterial
              ref={(el) => {
                if (el) shockMats.current.set(sh.id, el);
                else shockMats.current.delete(sh.id);
              }}
              color="#ffd166"
              transparent
              opacity={0.85}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
      <Predictor poses={poses} />
    </group>
  );
}

// Aim predictor: a gold arc + impact ring showing where the next tomato will
// land, turning red over a bullseye. Same integrator as the real drops, so
// what you see is what you splat. Visible only in flight with mode on.
const PREDICT_MAX_PTS = 32;

function Predictor({ poses }: { poses: TargetPose[] }) {
  const phase = useFlightStore((s) => s.phase);
  const enabled = useTomato((s) => s.enabled);
  const marker = useRef<THREE.Group>(null);
  const markerMat = useRef<THREE.MeshBasicMaterial>(null);

  const positions = useMemo(() => new Float32Array(PREDICT_MAX_PTS * 3), []);
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setDrawRange(0, 0);
    const m = new THREE.LineBasicMaterial({
      color: "#ffd166",
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const l = new THREE.Line(g, m);
    l.frustumCulled = false;
    return l;
  }, [positions]);

  useEffect(
    () => () => {
      lineObj.geometry.dispose();
      (lineObj.material as THREE.Material).dispose();
    },
    [lineObj]
  );

  useFrame((state) => {
    const show = enabled && phase === "flight";
    lineObj.visible = show;
    if (marker.current) marker.current.visible = show;
    if (!show) return;
    const pred = predictDrop(poses);
    if (!pred) {
      lineObj.visible = false;
      if (marker.current) marker.current.visible = false;
      return;
    }
    const n = Math.min(pred.points.length, PREDICT_MAX_PTS);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = pred.points[i][0];
      positions[i * 3 + 1] = pred.points[i][1];
      positions[i * 3 + 2] = pred.points[i][2];
    }
    lineObj.geometry.setDrawRange(0, n);
    (lineObj.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    const mk = marker.current;
    if (mk) {
      mk.position.set(pred.impact.x, pred.impact.y + 0.12, pred.impact.z);
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 6) * 0.12;
      mk.scale.set(pulse, pulse, pulse);
    }
    if (markerMat.current) {
      markerMat.current.color.set(pred.targetId ? "#e23b2e" : "#e8eaf6");
    }
  });

  return (
    <>
      <primitive object={lineObj} />
      <group ref={marker} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.7, 0.95, 24]} />
          <meshBasicMaterial
            ref={markerMat}
            color="#e8eaf6"
            transparent
            opacity={0.9}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </>
  );
}

function TomatoMesh({
  tm,
  register,
}: {
  tm: FlyingTomato;
  register: (id: number, g: THREE.Group | null) => void;
}) {
  return (
    <group
      ref={(g) => {
        register(tm.id, g);
        if (g) g.position.set(tm.x, tm.y, tm.z);
      }}
      position={[tm.x, tm.y, tm.z]}
    >
      <mesh>
        <sphereGeometry args={[0.28, 12, 10]} />
        <meshStandardMaterial color={tm.remote ? tm.color : "#e23b2e"} roughness={0.35} />
      </mesh>
      {/* stem */}
      <mesh position={[0, 0.3, 0]}>
        <coneGeometry args={[0.09, 0.18, 6]} />
        <meshStandardMaterial color="#3f9e4d" roughness={0.8} />
      </mesh>
    </group>
  );
}
