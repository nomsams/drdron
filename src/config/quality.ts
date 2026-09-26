// Graphics "generations" — named quality tiers that scale GPU/CPU cost.
//
// potato   = gen-1 / integrated graphics, old laptops, phones.
//            Lowest geometry, no particles, DPR 1, no antialias.
// balanced = gen-2 / average laptop. The default auto pick for most machines.
// high     = gen-3 / discrete GPU or Apple Silicon. Close to the upstream look.
// ultra    = gen-4 / gaming GPU. Upstream fidelity + headroom (DPR up to 2).
//
// Override order: ?quality=xxx URL param > localStorage > auto-detect.

export type QualityLevel = "potato" | "balanced" | "high" | "ultra";

export interface QualityPreset {
  label: string;
  /** Device-pixel-ratio cap. Single number keeps the frame cost predictable. */
  dpr: number;
  antialias: boolean;
  /** Terrain plane segments (verts ≈ (n+1)^2). Cost grows quadratically. */
  terrainSegments: number;
  trees: number;
  rocks: number;
  grass: number;
  /** Ambient bird count (one flock area — cheap silhouette meshes). */
  birds: number;
  /** Sky dome sphere segments [width, height]. */
  skySegments: [number, number];
  fireflies: boolean;
  waterfallMist: boolean;
  cloudBand: boolean;
  /** Helipad point light (one of the few dynamic lights — off on potato). */
  helipadLight: boolean;
  /** Water material quality. false = cheap lambert-ish standard, true = metalness sheen. */
  waterSheen: boolean;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  potato: {
    label: "Potato",
    dpr: 1,
    antialias: false,
    terrainSegments: 48,
    trees: 35,
    rocks: 18,
    grass: 80,
    birds: 4,
    skySegments: [16, 8],
    fireflies: false,
    waterfallMist: false,
    cloudBand: false,
    helipadLight: false,
    waterSheen: false,
  },
  balanced: {
    label: "Balanced",
    dpr: 1.5,
    antialias: true,
    terrainSegments: 64,
    trees: 60,
    rocks: 30,
    grass: 150,
    birds: 6,
    skySegments: [24, 12],
    fireflies: false,
    waterfallMist: true,
    cloudBand: false,
    helipadLight: true,
    waterSheen: false,
  },
  high: {
    label: "High",
    dpr: 2,
    antialias: true,
    terrainSegments: 96,
    trees: 90,
    rocks: 45,
    grass: 250,
    birds: 8,
    skySegments: [32, 16],
    fireflies: true,
    waterfallMist: true,
    cloudBand: true,
    helipadLight: true,
    waterSheen: true,
  },
  ultra: {
    label: "Ultra",
    dpr: 2,
    antialias: true,
    terrainSegments: 128,
    trees: 120,
    rocks: 60,
    grass: 350,
    birds: 10,
    skySegments: [48, 24],
    fireflies: true,
    waterfallMist: true,
    cloudBand: true,
    helipadLight: true,
    waterSheen: true,
  },
};

export const QUALITY_ORDER: QualityLevel[] = ["potato", "balanced", "high", "ultra"];

const STORAGE_KEY = "flyjs-quality-v1";

function fromUrl(): QualityLevel | null {
  try {
    const q = new URLSearchParams(window.location.search).get("quality");
    if (q === "auto") return null;
    if (q && q in QUALITY_PRESETS) return q as QualityLevel;
  } catch {
    /* ignore */
  }
  return null;
}

function fromStorage(): QualityLevel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw in QUALITY_PRESETS) return raw as QualityLevel;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveQualityChoice(level: QualityLevel) {
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    /* private mode — non-essential */
  }
}

/** First-paint guess from hardware hints. Runtime FPS monitor may adjust later. */
export function autoDetectQuality(): QualityLevel {
  try {
    const mobile = window.matchMedia("(pointer: coarse)").matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 500;
    const cores = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (mobile || small) return "potato";
    if ((mem !== undefined && mem <= 4) || cores <= 4) return "balanced";
    if (cores >= 8) return "high";
    return "balanced";
  } catch {
    return "balanced";
  }
}

/** Resolve the effective starting tier. */
export function initialQuality(): { level: QualityLevel; auto: boolean } {
  const url = typeof window !== "undefined" ? fromUrl() : null;
  if (url) return { level: url, auto: false };
  const stored = typeof window !== "undefined" ? fromStorage() : null;
  if (stored) return { level: stored, auto: false };
  return {
    level: typeof window !== "undefined" ? autoDetectQuality() : "balanced",
    auto: true,
  };
}

export function stepDown(level: QualityLevel): QualityLevel {
  const i = QUALITY_ORDER.indexOf(level);
  return QUALITY_ORDER[Math.max(0, i - 1)];
}

export function stepUp(level: QualityLevel): QualityLevel {
  const i = QUALITY_ORDER.indexOf(level);
  return QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, i + 1)];
}
