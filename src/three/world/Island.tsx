"use client";

import { useMemo } from "react";
import { generateTerrainGeometry } from "@/lib/terrain";
import { P } from "@/lib/palette";

// Terrain mesh + one water disc (pond + sea in a single draw call).
// Segment count comes from the quality preset.

export default function Island({
  terrainSegments,
  waterSheen,
}: {
  terrainSegments: number;
  waterSheen: boolean;
}) {
  const geometry = useMemo(() => generateTerrainGeometry(terrainSegments), [terrainSegments]);
  return (
    <>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          flatShading
          roughness={0.95}
          emissive={P.grassHi}
          emissiveIntensity={0.1}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.35, 0]}>
        <circleGeometry args={[90, waterSheen ? 48 : 24]} />
        <meshStandardMaterial
          color={P.water}
          metalness={waterSheen ? 0.75 : 0.1}
          roughness={waterSheen ? 0.2 : 0.8}
          transparent
          opacity={0.9}
        />
      </mesh>
    </>
  );
}
