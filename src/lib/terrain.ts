// Island terrain: seeded-noise height function shared by everything —
// terrain displacement, object scatter, altitude clamping, blob shadow.
// Adapted from rishabhrathod01.github.io (MIT).
//
// Differences from upstream:
// - terrainSegments is a parameter (quality preset), not a layout constant.
// - scatter counts are parameters (quality preset).
// - keep-out zones cover only environmental landmarks (CV boards removed).

import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { WORLD, POND, PAD, BEACH, MOUNTAIN, WATERFALL } from "@/config/world";
import { P } from "@/lib/palette";

// Deterministic PRNG so the island is identical on every visit/build.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noise2D = createNoise2D(mulberry32(20240613));

function fbm(x: number, z: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 3; i++) {
    sum += amp * noise2D(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Blend height toward `target` inside a disc, with a smooth rim. */
function blendDisc(
  h: number,
  x: number,
  z: number,
  cx: number,
  cz: number,
  r: number,
  rim: number,
  target: number
): number {
  const d = Math.hypot(x - cx, z - cz);
  const w = 1 - smoothstep(r, r + rim, d);
  return h * (1 - w) + target * w;
}

/** The keystone: terrain height at any world (x, z). */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = fbm(x * 0.02, z * 0.02) * 4.0;
  // Island silhouette: edges sink below the water plane.
  const falloff = smoothstep(WORLD.hardRadius + 5, 45, r);
  h = h * falloff - (1 - falloff) * 2.0;
  // Flattened helipad apron + pond bowl.
  h = blendDisc(h, x, z, POND.x, POND.z, POND.r, POND.rim, POND.depth);
  h = blendDisc(h, x, z, PAD.x, PAD.z, PAD.r, PAD.rim, PAD.h);
  // Beach shelf sits far enough out that the edge falloff would otherwise
  // sink it below the water line — hold a dry sand shelf.
  h = blendDisc(h, x, z, BEACH.x, BEACH.z, BEACH.r * 0.6, BEACH.r * 0.6, 0.5);
  return h;
}

// ---------------------------------------------------------------------------
// Terrain geometry with vertex colours

const cLo = new THREE.Color(P.grassLo);
const cHi = new THREE.Color(P.grassHi);
const cTip = new THREE.Color(P.grassTip);
const cRock = new THREE.Color(P.rock);
const cSand = new THREE.Color(P.sand);

export function generateTerrainGeometry(segments: number): THREE.BufferGeometry {
  const size = WORLD.terrainSize;
  const segs = segments;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    // Colour by height with a touch of noise so it doesn't band.
    const t = Math.min(Math.max((h + 1.5) / 6, 0), 1);
    tmp.copy(cLo).lerp(cHi, t);
    if (h > 2.2) tmp.lerp(cTip, smoothstep(2.2, 4.5, h) * 0.6);
    if (h < -0.4) tmp.lerp(cRock, 0.5); // submerged rim reads as rock
    // Beach: warm sand tone feathering out from the shore.
    const beachW =
      1 - smoothstep(BEACH.r * 0.5, BEACH.r, Math.hypot(x - BEACH.x, z - BEACH.z));
    if (beachW > 0) tmp.lerp(cSand, beachW * 0.85);
    // Cheap baked AO under trees.
    const shade = treeShadeAt(x, z);
    tmp.multiplyScalar(1 - shade * 0.45);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Deterministic scatter (trees / rocks / grass) with keep-out zones

export interface ScatterItem {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

export interface Collider {
  x: number;
  z: number;
  r: number;
  /** World-space y of the obstacle's top — the drone flies over above this. */
  top: number;
}

export interface WorldData {
  trees: ScatterItem[];
  rocks: ScatterItem[];
  grass: ScatterItem[];
  colliders: Collider[];
}

export interface ScatterCounts {
  trees: number;
  rocks: number;
  grass: number;
}

// Keep-out discs: helipad, pond, landmarks. (CV boards removed.)
const KEEP_OUT: { x: number; z: number; r: number }[] = [
  { x: PAD.x, z: PAD.z, r: PAD.r + 3 },
  { x: POND.x, z: POND.z, r: POND.r + 2 },
  { x: MOUNTAIN.x, z: MOUNTAIN.z, r: MOUNTAIN.r + 4 },
  { x: WATERFALL.x, z: WATERFALL.z, r: WATERFALL.r + 3 },
  { x: BEACH.x, z: BEACH.z, r: BEACH.r + 2 },
];

function inKeepOut(x: number, z: number): boolean {
  for (const k of KEEP_OUT) {
    const dx = x - k.x;
    const dz = z - k.z;
    if (dx * dx + dz * dz < k.r * k.r) return true;
  }
  return false;
}

// Cached per counts-key so quality switches rebuild once.
const cache = new Map<string, WorldData>();

function scatter(
  rng: () => number,
  count: number,
  minScale: number,
  maxScale: number,
  minHeight: number,
  maxRadius: number
): ScatterItem[] {
  const items: ScatterItem[] = [];
  let attempts = 0;
  while (items.length < count && attempts < count * 12) {
    attempts++;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * maxRadius;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inKeepOut(x, z)) continue;
    const y = heightAt(x, z);
    if (y < minHeight) continue; // nothing grows in the water/pond
    items.push({
      x,
      y,
      z,
      scale: minScale + rng() * (maxScale - minScale),
      rotation: rng() * Math.PI * 2,
    });
  }
  return items;
}

export function getWorldData(counts: ScatterCounts): WorldData {
  const key = `${counts.trees}/${counts.rocks}/${counts.grass}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rng = mulberry32(77);
  const trees = scatter(rng, counts.trees, 0.7, 1.6, 0.25, WORLD.softRadius - 2);
  const rocks = scatter(rng, counts.rocks, 0.4, 1.4, 0.0, WORLD.softRadius + 4);
  const grass = scatter(rng, counts.grass, 0.6, 1.3, 0.15, WORLD.softRadius);

  const colliders: Collider[] = [
    ...trees.map((t) => ({ x: t.x, z: t.z, r: 0.9 * t.scale, top: t.y + 4.5 * t.scale })),
    ...rocks
      .filter((r) => r.scale > 0.8)
      .map((r) => ({ x: r.x, z: r.z, r: 0.8 * r.scale, top: r.y + 1.2 * r.scale })),
    // Solid landmarks: route around, not over.
    { x: MOUNTAIN.x, z: MOUNTAIN.z, r: MOUNTAIN.r, top: heightAt(MOUNTAIN.x, MOUNTAIN.z) + 40 },
    { x: WATERFALL.x, z: WATERFALL.z, r: WATERFALL.r, top: heightAt(WATERFALL.x, WATERFALL.z) + 8 },
  ];

  const data: WorldData = { trees, rocks, grass, colliders };
  cache.set(key, data);
  return data;
}

/** Fake baked AO under trees, sampled during terrain colour generation. */
function treeShadeAt(x: number, z: number): number {
  // Shade depends on tree layout; use the reference (high) layout so terrain
  // colours stay stable across quality tiers.
  const { trees } = getWorldData({ trees: 90, rocks: 45, grass: 250 });
  let shade = 0;
  for (const t of trees) {
    const dx = x - t.x;
    const dz = z - t.z;
    const rr = 2.6 * t.scale;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      shade = Math.max(shade, 1 - Math.sqrt(d2) / rr);
    }
  }
  return Math.min(shade, 0.9);
}
