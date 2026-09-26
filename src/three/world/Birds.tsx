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

/** Latest bird positions (world x/z), published every frame for the minimap.
 *  Mutable module state — no React involved. Cleared when the flock unmounts. */
export const birdMarks: { x: number; z: number }[] = [];

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

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    specs.forEach((s, i) => {
      const g = groups.current[i];
      if (!g) return;
      // Wandering circle: breathing radius + modulated angular speed.
      const a = s.phase + t * s.speed * (1 + 0.15 * Math.sin(t * 0.11 + s.phase));
      const r = s.radius + Math.sin(t * 0.23 + s.phase * 2) * 1.6;
      const bx = BIRDS.x + Math.cos(a) * r;
      const bz = BIRDS.z + Math.sin(a) * r;
      g.position.set(
        bx,
        s.height + Math.sin(t * 0.5 + s.phase) * 0.9 + Math.sin(t * 1.7 + s.phase) * 0.15,
        bz
      );
      birdMarks[i] = { x: bx, z: bz };
      // Face travel direction; bank into the turn; slight pitch with climb.
      const dir = s.speed >= 0 ? 1 : -1;
      g.rotation.y = -a + (dir >= 0 ? 0 : Math.PI);
      g.rotation.z = dir * 0.18;
      g.rotation.x = Math.cos(t * 0.5 + s.phase) * 0.06;
      // Flap/glide cycle: envelope swells and dies instead of constant flap.
      const env = Math.pow(0.5 + 0.5 * Math.sin(t * s.glideRate + s.phase * 1.7), 2);
      const amp = 0.1 + 0.9 * env;
      const flap = Math.sin(t * s.flapSpeed + s.phase * 3) * 0.7 * amp;
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
    return () => {
      birdMarks.length = 0;
    };
  }, []);
  return null;
}
