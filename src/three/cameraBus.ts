"use client";

import type * as THREE from "three";

// The live R3F camera, published for DOM overlays (peer markers) that need
// to project world positions without living inside the Canvas. Set by
// ChaseCamera on mount; read at low frequency — never in a render loop.

export const cameraBus: { current: THREE.Camera | null } = { current: null };
