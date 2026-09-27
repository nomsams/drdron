"use client";

import { useEffect, useState } from "react";
import { PILOT_COLORS, useMp } from "@/state/mp";
import { useTomato } from "@/state/tomato";
import {
  isPublicRoom,
  joinSquad,
  leaveSquad,
  mpSelfId,
  normalizeRoomCode,
  quickJoin,
  randomRoomCode,
  retrySquad,
} from "@/net/mp";
import { useRace } from "@/state/race";
import { flight } from "@/state/flight";
import { HP_MAX } from "@/config/hull";

// Squad panel: P2P multiplayer via room codes. No account, no server —
// pilots exchange a 4-letter code (or invite link) and connect directly.
// (?room=CODE auto-join lives in HUD so it runs even with the panel closed.)

export default function SquadPanel({ onClose }: { onClose: () => void }) {
  const name = useMp((s) => s.name);
  const color = useMp((s) => s.color);
  const room = useMp((s) => s.room);
  const joined = useMp((s) => s.joined);
  const peers = useMp((s) => s.peers);
  const transportCount = useMp((s) => s.transportCount);
  const linkStatus = useMp((s) => s.linkStatus);
  const lastError = useMp((s) => s.lastError);
  const localTomatoHits = useTomato((s) => s.hits);
  const localRaceHoop = useRace((s) => s.hoopIndex);
  const localRaceLaps = useRace((s) => s.laps);
  const setProfile = useMp((s) => s.setProfile);
  const [code, setCode] = useState(room ?? "");
  const [copied, setCopied] = useState(false);
  // Your own HP is a mutable field (flight.hp) — refresh the roster row at
  // 2 Hz so it isn't stale when you're alone in the room.
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(iv);
  }, []);

  const activeCode = room ?? normalizeRoomCode(code);

  const inviteLink = () => {
    if (!activeCode) return "";
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("room", activeCode);
      return url.toString();
    } catch {
      return "";
    }
  };

  const copyInvite = async () => {
    const link = inviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy invite link:", link);
    }
  };

  // Native share sheet on mobile (WhatsApp, Messages, …) — clipboard fallback.
  const shareInvite = async () => {
    const link = inviteLink();
    if (!link) return;
    try {
      const nav = navigator as Navigator & {
        share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      };
      if (typeof nav.share === "function") {
        await nav.share({
          title: "Join my flyjs squad",
          text: `Fly with me — squad room ${activeCode}`,
          url: link,
        });
        return;
      }
    } catch (e) {
      // Dismissing the sheet is not an error — stay quiet.
      if ((e as Error | null)?.name === "AbortError") return;
    }
    copyInvite();
  };

  const copyCode = async () => {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Room code:", activeCode);
    }
  };

  const searching = joined && peers.length === 0;

  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        right: 16,
        width: 280,
        pointerEvents: "auto",
        background: "rgba(12,19,36,0.92)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 12,
        padding: "12px 14px",
        backdropFilter: "blur(8px)",
        fontSize: 13,
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong>👥 Squad (P2P)</strong>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#e8eaf6", cursor: "pointer", fontSize: 16 }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={name}
          maxLength={24}
          onChange={(e) => setProfile({ name: e.target.value })}
          placeholder="Pilot name"
          style={{
            flex: 1,
            minWidth: 0,
            background: "#1a2440",
            color: "#e8eaf6",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.15)",
            padding: "6px 8px",
            fontSize: 13,
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {PILOT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setProfile({ color: c })}
            title={c}
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: c,
              border: color === c ? "2px solid #fff" : "2px solid transparent",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>

      {!joined ? (
        <div>
          <div style={{ display: "flex", gap: 8 }}>
          <input
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            placeholder="ROOM"
            maxLength={12}
            style={{
              flex: 1,
              minWidth: 0,
              background: "#1a2440",
              color: "#e8eaf6",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              padding: "6px 8px",
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          />
          <button
            type="button"
            onClick={() => code && joinSquad(code)}
            disabled={!normalizeRoomCode(code)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              background: "#c0c1ff",
              color: "#0c1324",
              fontWeight: 700,
              cursor: normalizeRoomCode(code) ? "pointer" : "default",
              opacity: normalizeRoomCode(code) ? 1 : 0.5,
            }}
          >
            Join
          </button>
          <button
            type="button"
            onClick={() => {
              const fresh = randomRoomCode();
              setCode(fresh);
              joinSquad(fresh);
            }}
            title="Create a new room"
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "none",
              color: "#e8eaf6",
              cursor: "pointer",
            }}
          >
            New
          </button>
          </div>
          <button
            type="button"
            onClick={() => quickJoin()}
            title="Join the public lobby — no code needed"
            style={{
              width: "100%",
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(78,222,163,0.45)",
              background: "rgba(78,222,163,0.14)",
              color: "#4edea3",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            ⚡ Quick join — public lobby
          </button>
        </div>
      ) : (
        <div>
          {isPublicRoom(room) && (
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
              🌐 Public lobby — anyone on Quick join lands here
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={copyCode}
              title="Copy room code"
              style={{
                background: "rgba(78,222,163,0.12)",
                border: "1px solid rgba(78,222,163,0.35)",
                borderRadius: 8,
                color: "#4edea3",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: 2,
                padding: "4px 10px",
              }}
            >
              {room}
            </button>
            <button
              type="button"
              onClick={shareInvite}
              style={{
                padding: "4px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "none",
                color: "#e8eaf6",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {copied ? "Copied!" : "Share invite"}
            </button>
            <button
              type="button"
              onClick={() => leaveSquad()}
              style={{
                padding: "4px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,90,90,0.5)",
                background: "none",
                color: "#ff9a9a",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Leave
            </button>
          </div>
          {(linkStatus === "degraded" || linkStatus === "error") && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
                padding: "6px 8px",
                borderRadius: 8,
                background: "rgba(255,90,90,0.12)",
                border: "1px solid rgba(255,90,90,0.35)",
              }}
            >
              <span style={{ fontSize: 11, flex: 1, color: "#ff9a9a" }}>
                {linkStatus === "error"
                  ? `Couldn't reach a relay${lastError ? `: ${lastError}` : ""}.`
                  : "No relay response yet — check network/firewall (WebRTC needs UDP)."}
              </span>
              <button
                type="button"
                onClick={() => retrySquad()}
                style={{
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(255,154,154,0.5)",
                  background: "none",
                  color: "#ff9a9a",
                  cursor: "pointer",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                Retry
              </button>
            </div>
          )}
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
            {searching
              ? transportCount > 0
                ? `Linking… ${transportCount} connected, waiting for flight data…`
                : linkStatus === "connecting"
                  ? "Share the code — waiting for pilots…"
                  : linkStatus === "degraded"
                    ? "Waiting for pilots (relay is slow to respond)…"
                    : "Share the code — waiting for pilots…"
              : `In this sky (${peers.length + 1}):`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflowY: "auto" }}>
            <RosterRow
              name={`${name.trim() || "Pilot"} (you)`}
              color={color}
              score={-1}
              lap={-1}
              flying={false}
              tomatoHits={localTomatoHits}
              raceHoop={localRaceHoop}
              raceLaps={localRaceLaps}
              hp={flight.hp}
              self
            />
            {peers.map((p) => (
              <RosterRow
                key={p.id}
                name={p.name}
                color={p.color}
                score={p.score}
                lap={p.lap}
                flying={p.flying}
                tomatoHits={p.tomatoHits}
                raceHoop={p.raceHoop}
                raceLaps={p.raceLaps}
                hp={p.hp}
              />
            ))}
          </div>
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>
            you: {String(mpSelfId).slice(0, 6)}… · {transportCount} link{transportCount === 1 ? "" : "s"}
          </div>
        </div>
      )}
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
        Direct peer-to-peer (WebRTC). No server sees your flight — only public relays help pilots find each other.
      </div>
    </div>
  );
}

function RosterRow({ name, color, score, lap, flying, tomatoHits, raceHoop, raceLaps, hp, self }: {
  name: string;
  color: string;
  score: number;
  lap: number;
  flying: boolean;
  tomatoHits: number;
  raceHoop?: number;
  raceLaps?: number;
  hp: number;
  self?: boolean;
}) {
  const raceTag =
    raceLaps || raceHoop
      ? ` · 🏀 ${(raceLaps ?? 0) > 0 ? `lap ${raceLaps}` : `hoop ${(raceHoop ?? 0) + 1}`}`
      : "";
  const frac = Math.max(0, Math.min(1, hp / HP_MAX));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      <span
        title={`HP ${Math.round(hp)}`}
        style={{
          position: "relative",
          width: 28,
          height: 5,
          borderRadius: 3,
          background: "rgba(255,255,255,0.12)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${frac * 100}%`,
            background: frac > 0.5 ? "#4edea3" : frac > 0.25 ? "#ffd166" : "#ff5a5a",
          }}
        />
      </span>
      {self ? (
        <span style={{ opacity: 0.6 }}>
          {tomatoHits > 0 ? `🍅 ${tomatoHits} · ` : ""}
          {"you"}
          {raceTag}
        </span>
      ) : (
        <span style={{ opacity: 0.75 }}>
          ★ {score} · lap {lap}{flying ? " · ✈" : " · 🛬"}{tomatoHits > 0 ? ` · 🍅 ${tomatoHits}` : ""}{raceTag}
        </span>
      )}
    </div>
  );
}
