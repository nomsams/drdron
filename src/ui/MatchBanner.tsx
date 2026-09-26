"use client";

import { useState } from "react";
import { TOMATO_TARGETS } from "@/config/tomato";
import { useMp } from "@/state/mp";
import { useTomato } from "@/state/tomato";

// Squad tomato match: first pilot to clear every bullseye (6 hits) takes the
// crown. Scores converge over the 10 Hz state channel, so every client agrees
// on the winner without any host. Rematch resets your own score — the banner
// follows whoever is still champion.

const WIN_HITS = TOMATO_TARGETS.length;

export default function MatchBanner() {
  const hits = useTomato((s) => s.hits);
  const reset = useTomato((s) => s.reset);
  const name = useMp((s) => s.name);
  const peers = useMp((s) => s.peers);
  const [ackKey, setAckKey] = useState<string | null>(null);

  const contenders = [
    ...peers.map((p) => ({ id: p.id, name: p.name, color: p.color, hits: p.tomatoHits })),
    { id: "self", name: name.trim() || "Pilot", color: "#e8eaf6", hits },
  ].filter((c) => c.hits >= WIN_HITS);
  contenders.sort((a, b) => b.hits - a.hits);
  const winner = contenders[0] ?? null;

  if (!winner) {
    if (ackKey !== null) setAckKey(null);
    return null;
  }
  const key = `${winner.id}:${winner.hits}`;
  if (ackKey === key) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 76,
        left: "50%",
        transform: "translateX(-50%)",
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "rgba(20,16,8,0.9)",
        border: "1px solid rgba(255,209,102,0.55)",
        borderRadius: 14,
        padding: "10px 14px",
        backdropFilter: "blur(8px)",
        fontSize: 13,
        maxWidth: "92vw",
        zIndex: 25,
      }}
    >
      <span style={{ fontSize: 20 }}>🏆</span>
      <span style={{ flex: 1 }}>
        <strong>
          {winner.id === "self" ? "You cleared" : `${winner.name} cleared`} every target!
        </strong>
        <span style={{ opacity: 0.65, fontSize: 11, display: "block" }}>
          First to {WIN_HITS} bullseyes · rematch resets your score
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          reset();
          setAckKey(key);
        }}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "none",
          background: "#ffd166",
          color: "#0c1324",
          fontWeight: 700,
          cursor: "pointer",
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        Rematch
      </button>
      <button
        type="button"
        onClick={() => setAckKey(key)}
        aria-label="Dismiss"
        style={{ background: "none", border: "none", color: "#e8eaf6", cursor: "pointer", fontSize: 14 }}
      >
        ✕
      </button>
    </div>
  );
}
