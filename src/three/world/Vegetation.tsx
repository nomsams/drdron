"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getWorldData } from "@/lib/terrain";
import { P } from "@/lib/palette";

// Instanced vegetation — still 3 draw calls total (trees / rocks / grass),
// even on potato. Realism comes from geometry and per-instance colour, not
// from more draw calls:
// - pines have 3 canopy tiers + per-instance tint/tilt (no two alike),
// - grass is crossed gradient blades instead of cones,
// - rocks get a grey tint spread.
// (Upstream uses drei <Instances>; raw instancedMesh avoids the dependency.)

function colorize(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildPine(): THREE.BufferGeometry {
  const trunk = colorize(
    new THREE.CylinderGeometry(0.13, 0.22, 1.3, 6).translate(0, 0.65, 0),
    P.trunk
  );
  const lower = colorize(new THREE.ConeGeometry(1.25, 2.2, 7).translate(0, 2.0, 0), P.canopy);
  const mid = colorize(new THREE.ConeGeometry(0.92, 1.8, 7).translate(0, 3.1, 0), "#35704f");
  const top = colorize(new THREE.ConeGeometry(0.55, 1.4, 6).translate(0, 4.1, 0), P.grassTip);
  const merged = mergeGeometries([trunk, lower, mid, top]);
  merged.computeVertexNormals();
  return merged;
}

/** Grass tuft: 3 crossed vertical quads with a dark-base → light-tip
 *  gradient baked into vertex colours. 6 triangles — cheaper than the old
 *  cone, and reads as blades instead of a spike. */
function buildTuft(): THREE.BufferGeometry {
  const quads: THREE.BufferGeometry[] = [];
  const base = new THREE.Color("#1f3a30");
  const tip = new THREE.Color("#7fb98f");
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(0.55, 0.85, 1, 2);
    g.translate(0, 0.42, 0);
    g.rotateY((k / 3) * Math.PI);
    // Taper: pinch top vertices toward the centre blade.
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const f = THREE.MathUtils.clamp(y / 0.85, 0, 1);
      pos.setX(i, pos.getX(i) * (1 - f * 0.8));
      c.copy(base).lerp(tip, f);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    quads.push(g);
  }
  const merged = mergeGeometries(quads);
  merged.computeVertexNormals();
  return merged;
}

// Deterministic per-instance tint so the forest isn't a flat fill colour.
// Seeded by index — stable across renders and quality switches.
function tint(out: THREE.Color, i: number, spread: number, shift = 0): THREE.Color {
  const r = Math.sin(i * 127.1 + shift) * 43758.5;
  const f = r - Math.floor(r); // 0..1 hash
  const s = 1 - spread / 2 + f * spread;
  return out.setScalar(s);
}

interface Item {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

function useVegetationInstances(
  ref: React.RefObject<THREE.InstancedMesh | null>,
  items: Item[],
  opts: {
    yOffset: (s: number) => number;
    scaleY?: (s: number) => number;
    tilt?: number;
    tintSpread?: number;
    tintShift?: number;
  }
) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y + opts.yOffset(it.scale), it.z);
      const tilt = opts.tilt ?? 0;
      dummy.rotation.set(
        Math.sin(i * 3.7) * tilt,
        it.rotation,
        Math.cos(i * 2.3) * tilt
      );
      const sy = opts.scaleY ? opts.scaleY(it.scale) : it.scale;
      dummy.scale.set(it.scale, sy, it.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (opts.tintSpread) {
        mesh.setColorAt(i, tint(col, i, opts.tintSpread, opts.tintShift ?? 0));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = items.length;
  }, [ref, items, opts]);
}

export default function Vegetation({
  counts,
}: {
  counts: { trees: number; rocks: number; grass: number };
}) {
  const { trees, rocks, grass } = useMemo(
    () => getWorldData(counts),
    [counts.trees, counts.rocks, counts.grass]
  );
  const pine = useMemo(buildPine, []);
  const rock = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const tuft = useMemo(buildTuft, []);

  const treesRef = useRef<THREE.InstancedMesh>(null);
  const rocksRef = useRef<THREE.InstancedMesh>(null);
  const grassRef = useRef<THREE.InstancedMesh>(null);

  const treeOpts = useMemo(
    () => ({ yOffset: (_: number) => -0.1, tilt: 0.05, tintSpread: 0.3, tintShift: 11 }),
    []
  );
  const rockOpts = useMemo(
    () => ({
      yOffset: (s: number) => 0.15 * s,
      scaleY: (s: number) => s * 0.7,
      tintSpread: 0.35,
      tintShift: 47,
    }),
    []
  );
  const grassOpts = useMemo(
    () => ({ yOffset: (_: number) => 0, tintSpread: 0.4, tintShift: 83 }),
    []
  );
  useVegetationInstances(treesRef, trees, treeOpts);
  useVegetationInstances(rocksRef, rocks, rockOpts);
  useVegetationInstances(grassRef, grass, grassOpts);

  return (
    <>
      <instancedMesh ref={treesRef} args={[pine, undefined, Math.max(trees.length, 1)]} frustumCulled={false}>
        <meshStandardMaterial vertexColors flatShading roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={rocksRef} args={[rock, undefined, Math.max(rocks.length, 1)]} frustumCulled={false}>
        <meshStandardMaterial color={P.rock} flatShading roughness={0.95} />
      </instancedMesh>
      {grass.length > 0 && (
        <instancedMesh ref={grassRef} args={[tuft, undefined, Math.max(grass.length, 1)]} frustumCulled={false}>
          <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={1} />
        </instancedMesh>
      )}
    </>
  );
}
