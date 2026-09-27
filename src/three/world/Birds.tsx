"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BIRDS } from "@/config/world";

interface BirdSpec {
  radius: number;
  height: number;
  speed: number;
  phase: number;
  flapSpeed: number;
  glideRate: number;
  scale: number;
}

// Ambient bird bots confined to ONE area (above the pond). Each bird is a
// dart body + fanned tail + two tapered, swept wings in unlit silhouette
// material — reads as a real bird at distance and costs almost nothing
// (3 tiny meshes each, shared geometries/materials).
// Behaviour: flap/glide cycles (wings lock flat on the glide), wandering
// radius and banked turns instead of perfect circles. One useFrame drives
// the whole flock; no React state per frame.

const BODY = "#232b40";
const WING = "#2e3852";

/** Latest bird positions + velocities (world space), published every frame
 *  for the minimap and drone-bird collisions. Mutable module state — no
 *  React involved. Cleared when the flock unmounts. Index = bird index. */
export const birdMarks: { x: number; y: number; z: number; vx: number; vy: number; vz: number }[] = [];

// Bird strikes: a struck bird is flung away from the drone, flaps hard and
// tumbles, then glides back into its circle. `at` in performance.now() ms.
const KNOCK_MS = 2500;
const knocks: ({ at: number; dx: number; dy: number; dz: number } | undefined)[] = [];

/** Knock bird `i` away along (dx,dy,dz). Returns false if it was already hit
 *  recently — one strike per bird per knock, not one per frame of overlap. */
export function knockBird(i: number, dx: number, dy: number, dz: number): boolean {
  const now = performance.now();
  const k = knocks[i];
  if (k && now - k.at < KNOCK_MS) return false;
  const len = Math.hypot(dx, dy, dz) || 1;
  knocks[i] = { at: now, dx: dx / len, dy: dy / len, dz: dz / len };
  return true;
}

/** Tapered, swept wing quad: wide chord at the shoulder, narrow at the tip. */
function buildWing(sign: 1 | -1): THREE.BufferGeometry {
  const span = 0.95;
  const rootChord = 0.42;
  const tipChord = 0.16;
  const sweep = 0.22; // tip sits further back
  const x0 = 0.04 * sign;
  const x1 = (0.04 + span) * sign;
  // Two triangles: (rootLead, rootTrail, tipLead), (rootTrail, tipTrail, tipLead)
  const verts = new Float32Array([
    x0, 0, -rootChord / 2,
    x0, 0, rootChord / 2,
    x1, 0, -tipChord / 2 + sweep,
    x0, 0, rootChord / 2,
    x1, 0, rootChord / 2 + sweep,
    x1, 0, -tipChord / 2 + sweep,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Dart body + fanned tail merged into one static geometry. Nose faces +Z. */
function buildBody(): THREE.BufferGeometry {
  const body = new THREE.ConeGeometry(0.09, 0.6, 6);
  body.rotateX(Math.PI / 2); // tip forward (+Z)
  const tail = new THREE.PlaneGeometry(0.3, 0.22);
  tail.rotateX(-Math.PI / 2); // lie flat
  tail.translate(0, 0.01, 0.38); // fan out behind
  const merged = mergeGeometries([body, tail]);
  merged.computeVertexNormals();
  return merged;
}

function Bird({ spec, bodyGeo, wingLGeo, wingRGeo, groupRef, wingLRef, wingRRef, index }: {
  spec: BirdSpec;
  bodyGeo: THREE.BufferGeometry;
  wingLGeo: THREE.BufferGeometry;
  wingRGeo: THREE.BufferGeometry;
  groupRef: (el: THREE.Group | null) => void;
  wingLRef: (el: THREE.Mesh | null) => void;
  wingRRef: (el: THREE.Mesh | null) => void;
  index: number;
}) {
  return (
    <group ref={groupRef} scale={spec.scale} key={index}>
      <mesh geometry={bodyGeo}>
        <meshBasicMaterial color={BODY} />
      </mesh>
      <group position={[-0.05, 0.04, -0.02]}>
        <mesh ref={wingLRef} geometry={wingLGeo}>
          <meshBasicMaterial color={WING} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <group position={[0.05, 0.04, -0.02]}>
        <mesh ref={wingRRef} geometry={wingRGeo}>
          <meshBasicMaterial color={WING} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

export default function Birds({ count }: { count: number }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const wingsL = useRef<(THREE.Mesh | null)[]>([]);
  const wingsR = useRef<(THREE.Mesh | null)[]>([]);

  const bodyGeo = useMemo(buildBody, []);
  const wingLGeo = useMemo(() => buildWing(-1), []);
  const wingRGeo = useMemo(() => buildWing(1), []);

  const specs = useMemo<BirdSpec[]>(() => {
    const arr: BirdSpec[] = [];
    for (let i = 0; i < count; i++) {
      const f = count === 1 ? 0.5 : i / (count - 1);
      arr.push({
        radius: BIRDS.inner + f * (BIRDS.outer - BIRDS.inner) + (i % 2) * 1.2,
        height: BIRDS.low + ((i * 37) % 10) * 0.1 * (BIRDS.high - BIRDS.low),
        speed: (0.14 + (i % 3) * 0.03) * (i % 2 === 0 ? 1 : -1),
        phase: (i / Math.max(count, 1)) * Math.PI * 2,
        flapSpeed: 7 + (i % 4),
        glideRate: 0.35 + ((i * 29) % 10) * 0.03,
        scale: 1.1 + ((i * 13) % 10) * 0.05,
      });
    }
    return arr;
  }, [count]);

  useFrame((state, dtRaw) => {
    const t = state.clock.elapsedTime;
    const dt = Math.max(1e-3, Math.min(dtRaw, 0.1));
    const now = performance.now();
    specs.forEach((s, i) => {
      const g = groups.current[i];
      if (!g) return;
      // Wandering circle: breathing radius + modulated angular speed.
      const a = s.phase + t * s.speed * (1 + 0.15 * Math.sin(t * 0.11 + s.phase));
      const r = s.radius + Math.sin(t * 0.23 + s.phase * 2) * 1.6;
      let bx = BIRDS.x + Math.cos(a) * r;
      let by = s.height + Math.sin(t * 0.5 + s.phase) * 0.9 + Math.sin(t * 1.7 + s.phase) * 0.15;
      let bz = BIRDS.z + Math.sin(a) * r;
      // Struck: flung out along the knock direction, easing back home.
      const k = knocks[i];
      const tau = k ? (now - k.at) / 1000 : Infinity;
      const knocked = tau < KNOCK_MS / 1000;
      if (k && knocked) {
        const push = 3.2 * (1 - Math.exp(-7 * tau)) * Math.exp(-1.1 * tau);
        bx += k.dx * push;
        by += k.dy * push + 0.8 * push;
        bz += k.dz * push;
      }
      const prev = birdMarks[i];
      g.position.set(bx, by, bz);
      birdMarks[i] = {
        x: bx,
        y: by,
        z: bz,
        vx: prev ? (bx - prev.x) / dt : 0,
        vy: prev ? (by - prev.y) / dt : 0,
        vz: prev ? (bz - prev.z) / dt : 0,
      };
      // Face travel direction; bank into the turn; slight pitch with climb.
      const dir = s.speed >= 0 ? 1 : -1;
      g.rotation.y = -a + (dir >= 0 ? 0 : Math.PI);
      g.rotation.z = dir * 0.18 + (knocked ? Math.sin(tau * 20) * 0.6 * Math.exp(-2 * tau) : 0);
      g.rotation.x = Math.cos(t * 0.5 + s.phase) * 0.06;
      // Flap/glide cycle: envelope swells and dies instead of constant flap.
      // A struck bird flaps hard until it recovers.
      const env = Math.pow(0.5 + 0.5 * Math.sin(t * s.glideRate + s.phase * 1.7), 2);
      const amp = knocked ? 1 : 0.1 + 0.9 * env;
      const flap = Math.sin(t * s.flapSpeed * (knocked ? 1.8 : 1) + s.phase * 3) * 0.7 * amp;
      const wl = wingsL.current[i];
      const wr = wingsR.current[i];
      // Mirrored signs: left wing extends −X so it needs the negative angle
      // for both tips to rise together.
      if (wl) wl.rotation.z = -0.12 - flap;
      if (wr) wr.rotation.z = 0.12 + flap;
    });
  });

  if (count <= 0) return null;
  return (
    <>
      <FlockCleanup />
      <group>
      {specs.map((s, i) => (
        <Bird
          key={i}
          index={i}
          spec={s}
          bodyGeo={bodyGeo}
          wingLGeo={wingLGeo}
          wingRGeo={wingRGeo}
          groupRef={(el) => {
            groups.current[i] = el;
          }}
          wingLRef={(el) => {
            wingsL.current[i] = el;
          }}
          wingRRef={(el) => {
            wingsR.current[i] = el;
          }}
        />
      ))}
      </group>
    </>
  );
}

/** Clears stale minimap marks when the flock (un)mounts. */
function FlockCleanup() {
  useEffect(() => {
    birdMarks.length = 0;
    knocks.length = 0;
    return () => {
      birdMarks.length = 0;
      knocks.length = 0;
    };
  }, []);
  return null;
}
