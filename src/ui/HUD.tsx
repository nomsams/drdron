"use client";

import { useEffect, useState } from "react";
import { flight, requestTakeoff, useFlightStore } from "@/state/flight";
import { engineAudio } from "@/lib/audio";
import { REWARD_RINGS } from "@/config/world";
import { QUALITY_PRESETS, type QualityLevel } from "@/config/quality";
import { touchActive, useSettings } from "@/state/settings";
import { useMp } from "@/state/mp";
import { joinSquad, broadcastTomatoDrop, normalizeRoomCode } from "@/net/mp";
import { tryDropLocal, useTomato } from "@/state/tomato";
import { RACE_HOOPS } from "@/config/race";
import { hasBall, tryReleaseBall, useRace } from "@/state/race";
import { useNarrow } from "@/hooks/useNarrow";
import Minimap from "./Minimap";
import TouchSticks from "./TouchSticks";
import PeerMarkers from "./PeerMarkers";
import MatchBanner from "./MatchBanner";
import SettingsPanel from "./SettingsPanel";
import SquadPanel from "./SquadPanel";
import FpvOverlay from "./FpvOverlay";
import { BatteryBar, HullBar, HullFlash, Toasts, WindReadout } from "./HullBar";
import { cycleCamTilt, cycleFlightMode, requestFlip, toggleView } from "@/state/tricks";

// Minimal DOM overlay. Replaces the upstream FlightHUD + FocusPanel +
// RaceResults + TakeoffPrompt + IdleInteractionLayer (~25 KB of CV-specific
// UI) with telemetry, takeoff/land, sound + quality controls, and help.
// Telemetry polls the mutable `flight` object at 5 Hz — no per-frame renders.

function useTelemetry(active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(iv);
  }, [active]);
}

/** mm:ss.d — lap timer formatting. */
export function fmtLap(ms: number | null): string {
  if (ms === null) return "--:--";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

// Cheap FPS meter (own rAF loop, 2 Hz state updates) so pilots can see what
// the auto quality tier is reacting to.
function useFps() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames++;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

export default function HUD({
  level,
  auto,
  order,
  onQuality,
}: {
  level: QualityLevel;
  auto: boolean;
  order: QualityLevel[];
  onQuality: (q: QualityLevel | "auto") => void;
}) {
  const phase = useFlightStore((s) => s.phase);
  const packsCollected = useFlightStore((s) => s.packsCollected);
  const soundEnabled = useFlightStore((s) => s.soundEnabled);
  const toggleSound = useFlightStore((s) => s.toggleSound);
  const rewardsEnabled = useFlightStore((s) => s.rewardsEnabled);
  const toggleRewards = useFlightStore((s) => s.toggleRewards);
  const score = useFlightStore((s) => s.score);
  const lap = useFlightStore((s) => s.lap);
  const ringsPassed = useFlightStore((s) => s.ringsPassed);
  const lapStartMs = useFlightStore((s) => s.lapStartMs);
  const lastLapMs = useFlightStore((s) => s.lastLapMs);
  const bestLapMs = useFlightStore((s) => s.bestLapMs);
  const fps = useFps();
  const showFps = useSettings((s) => s.showFps);
  const minimapOn = useSettings((s) => s.minimap);
  const touchMode = useSettings((s) => s.touch);
  const cameraMode = useSettings((s) => s.cameraMode);
  const flightMode = useSettings((s) => s.flightMode);
  const squadJoined = useMp((s) => s.joined);
  const squadRoom = useMp((s) => s.room);
  const squadPeerCount = useMp((s) => s.peers.length);
  const tomatoOn = useTomato((s) => s.enabled);
  const tomatoToggle = useTomato((s) => s.toggle);
  const tomatoDrops = useTomato((s) => s.drops);
  const tomatoHits = useTomato((s) => s.hits);
  const tomatoScore = useTomato((s) => s.score);
  const raceOn = useRace((s) => s.enabled);
  const raceToggle = useRace((s) => s.toggle);
  const raceScore = useRace((s) => s.score);
  const raceHoopIndex = useRace((s) => s.hoopIndex);
  const raceLaps = useRace((s) => s.laps);
  const raceLapStartMs = useRace((s) => s.lapStartMs);
  const raceLastLapMs = useRace((s) => s.lastLapMs);
  const raceBestLapMs = useRace((s) => s.bestLapMs);
  // Not reactive state — ball.state is a plain mutable field (see
  // state/race.ts) — but useTelemetry already forces a re-render at 5 Hz
  // while flying, so this reads fresh on every one of those.
  const ballHeld = hasBall();
  const narrow = useNarrow();
  const fpvActive = cameraMode === "fpv" && phase === "flight";
  const [panel, setPanel] = useState<"none" | "settings" | "squad">("none");
  const [, bump] = useState(0);
  useTelemetry(phase === "flight");

  // R toggles the reward rings + guide path.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyR" && !e.repeat) useFlightStore.getState().toggleRewards();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // One-shot keys: V view (chase/FPV), M flight mode, X flip trick.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.code === "KeyV") toggleView();
      else if (e.code === "KeyM") cycleFlightMode();
      else if (e.code === "KeyX") requestFlip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ?room=CODE invite links auto-join (runs even with the panel closed).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("room");
      const clean = normalizeRoomCode(q ?? "");
      if (clean && !useMp.getState().joined) {
        joinSquad(clean);
        setPanel("squad");
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const land = () =>
    (window as unknown as { __flyjsLand?: () => void }).__flyjsLand?.();

  const flying = phase === "flight";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        color: "#e8eaf6",
      }}
    >
      {/* top-left: title + telemetry (replaced by the goggle OSD in FPV) */}
      <div style={{ position: "absolute", top: 16, left: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {!fpvActive && (
          <div
            style={{
              pointerEvents: "auto",
              background: "rgba(12,19,36,0.72)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              padding: "10px 14px",
              backdropFilter: "blur(6px)",
              maxWidth: narrow ? 220 : 300,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: narrow ? 13 : 15 }}>flyjs — drone scaffold</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {flying
                ? `${flight.speedKmh.toFixed(0)} km/h · alt ${flight.altitude.toFixed(1)} m${
                    flight.geofence ? " · GEOFENCE" : ""
                  }${packsCollected > 0 ? ` · 🔋×${packsCollected}` : ""}${
                    rewardsEnabled
                      ? ` · ★ ${score} (${ringsPassed.length}/${REWARD_RINGS.length} · lap ${lap}${
                          lapStartMs !== null ? ` · ⏱ ${fmtLap(Date.now() - lapStartMs)}` : ""
                        }${bestLapMs !== null ? ` · best ${fmtLap(bestLapMs)}` : ""}${
                          lastLapMs !== null && lapStartMs === null ? ` · last ${fmtLap(lastLapMs)}` : ""
                        })`
                      : ""
                  }${tomatoOn ? ` · 🍅 ${tomatoScore} (${tomatoHits}/${tomatoDrops || "—"})` : ""}${
                    raceOn
                      ? ` · 🏀 ${raceScore} (hoop ${raceHoopIndex + 1}/${RACE_HOOPS.length}${
                          raceLaps > 0 ? ` · lap ${raceLaps}` : ""
                        }${raceLapStartMs !== null ? ` · ⏱ ${fmtLap(Date.now() - raceLapStartMs)}` : ""}${
                          raceBestLapMs !== null ? ` · best ${fmtLap(raceBestLapMs)}` : ""
                        }${
                          raceLastLapMs !== null && raceLapStartMs === null ? ` · last ${fmtLap(raceLastLapMs)}` : ""
                        }${ballHeld ? "" : " · ball on ground, go get it!"})`
                      : ""
                  }`
                : phase === "idle"
                  ? "Hold TAKE OFF (or hold F) to launch"
                  : phase.charAt(0).toUpperCase() + phase.slice(1) + "…"}
            </div>
            {flying && <HullBar />}
            {flying && <BatteryBar />}
            {flying && <WindReadout />}
          </div>
        )}
        {fpvActive && (
          <div style={{ marginTop: 28, color: "#8cffb8", fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>
            <HullBar compact />
            <WindReadout osd />
            <div style={{ fontSize: 12, marginTop: 4 }}>
              CAM {flight.camTilt < 0.02 ? "FWD" : `-${Math.round(flight.camTilt * 90)}°`} ·{" "}
              {flightMode.toUpperCase()}
            </div>
          </div>
        )}

        {(phase === "idle" || phase === "charging") && (
          <button
            type="button"
            onClick={() => {
              engineAudio.init();
              requestTakeoff();
            }}
            style={{
              pointerEvents: "auto",
              padding: "12px 22px",
              fontSize: 16,
              fontWeight: 700,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: "#c0c1ff",
              color: "#0c1324",
            }}
          >
            {phase === "charging" ? "Launching…" : "Take Off"}
          </button>
        )}
        {flying && (
          <button
            type="button"
            onClick={land}
            style={{
              pointerEvents: "auto",
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.2)",
              cursor: "pointer",
              background: "rgba(12,19,36,0.72)",
              color: "#e8eaf6",
            }}
          >
            Land (Esc)
          </button>
        )}
      </div>

      {/* top-right: sound + quality */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          display: "flex",
          gap: 8,
          pointerEvents: "auto",
          alignItems: "center",
          background: "rgba(12,19,36,0.72)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: "8px 10px",
          backdropFilter: "blur(6px)",
          fontSize: 12,
          flexWrap: "wrap",
          justifyContent: "flex-end",
          maxWidth: narrow ? "52vw" : undefined,
        }}
      >
        <button
          type="button"
          onClick={toggleSound}
          title="Toggle sound"
          style={{ background: "none", border: "none", color: "#e8eaf6", cursor: "pointer", fontSize: 14 }}
        >
          {soundEnabled ? "🔊" : "🔇"}
        </button>
        <button
          type="button"
          onClick={toggleRewards}
          title="Toggle reward rings (R)"
          style={{
            background: rewardsEnabled ? "rgba(255,209,102,0.18)" : "none",
            border: "1px solid rgba(255,209,102,0.35)",
            borderRadius: 8,
            color: "#ffd166",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 8px",
          }}
        >
          ★ {rewardsEnabled ? "on" : "off"}
        </button>
        <button
          type="button"
          onClick={tomatoToggle}
          title="Tomato bombing: drop tomatoes on bullseyes (T)"
          style={{
            background: tomatoOn ? "rgba(226,59,46,0.18)" : "none",
            border: "1px solid rgba(226,59,46,0.45)",
            borderRadius: 8,
            color: "#ff8a7a",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 8px",
          }}
        >
          🍅 {tomatoOn ? "on" : "off"}
        </button>
        <button
          type="button"
          onClick={raceToggle}
          title="Basketball race: carry the ball through the hoop loop (G to release)"
          style={{
            background: raceOn ? "rgba(230,124,60,0.18)" : "none",
            border: "1px solid rgba(230,124,60,0.5)",
            borderRadius: 8,
            color: "#e6975c",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 8px",
          }}
        >
          🏀 {raceOn ? "on" : "off"}
        </button>
        <button
          type="button"
          onClick={toggleView}
          title="Toggle chase / FPV goggle view (V)"
          style={{
            background: cameraMode === "fpv" ? "rgba(192,193,255,0.18)" : "none",
            border: "1px solid rgba(192,193,255,0.4)",
            borderRadius: 8,
            color: "#c0c1ff",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 8px",
          }}
        >
          🥽 {cameraMode === "fpv" ? "FPV" : "Chase"} <span style={{ opacity: 0.55 }}>V</span>
        </button>
        <button
          type="button"
          onClick={() => {
            cycleCamTilt();
            bump((n) => n + 1); // camTilt is mutable state — refresh the label now
          }}
          title="Tilt camera: forward → 45° → straight down (hold Q/E to fine-tune)"
          style={{
            background: flight.camTilt > 0.05 ? "rgba(192,193,255,0.18)" : "none",
            border: "1px solid rgba(192,193,255,0.4)",
            borderRadius: 8,
            color: "#c0c1ff",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 8px",
          }}
        >
          📷 {flight.camTilt < 0.05 ? "fwd" : `${Math.round(flight.camTilt * 90)}°↓`}
        </button>
        <button
          type="button"
          onClick={cycleFlightMode}
          title="Flight mode (M): Easy arcade · Angle real physics · Acro full flips"
          style={{
            background: flightMode !== "easy" ? "rgba(255,209,102,0.16)" : "none",
            border: "1px solid rgba(255,209,102,0.4)",
            borderRadius: 8,
            color: "#ffd166",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 8px",
          }}
        >
          🎮 {flightMode === "easy" ? "Easy" : flightMode === "angle" ? "Angle" : "Acro"}{" "}
          <span style={{ opacity: 0.55 }}>M</span>
        </button>
        <button
          type="button"
          onClick={() => setPanel((p) => (p === "settings" ? "none" : "settings"))}
          title="Settings"
          style={{
            background: panel === "settings" ? "rgba(192,193,255,0.18)" : "none",
            border: "none",
            borderRadius: 8,
            color: "#e8eaf6",
            cursor: "pointer",
            fontSize: 14,
            padding: "4px 6px",
          }}
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => setPanel((p) => (p === "squad" ? "none" : "squad"))}
          title={squadJoined ? `Squad ${squadRoom} — P2P multiplayer` : "Squad (P2P multiplayer)"}
          style={{
            background: panel === "squad" || squadJoined ? "rgba(78,222,163,0.18)" : "none",
            border: "none",
            borderRadius: 8,
            color: "#4edea3",
            cursor: "pointer",
            fontSize: 13,
            padding: "4px 6px",
          }}
        >
          👥{squadJoined ? ` ${squadPeerCount + 1}` : ""}
        </button>
        {showFps && (
          <span style={{ opacity: 0.6 }}>
            {fps} fps · {auto ? `auto:${QUALITY_PRESETS[level].label}` : QUALITY_PRESETS[level].label}
          </span>
        )}
        {!showFps && (
          <span style={{ opacity: 0.6 }}>
            {auto ? `auto:${QUALITY_PRESETS[level].label}` : QUALITY_PRESETS[level].label}
          </span>
        )}
        <select
          value={auto ? "auto" : level}
          onChange={(e) => onQuality(e.target.value as QualityLevel | "auto")}
          style={{ background: "#1a2440", color: "#e8eaf6", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", padding: "4px 6px", fontSize: 12 }}
        >
          <option value="auto">Auto</option>
          {order.map((q) => (
            <option key={q} value={q}>
              {QUALITY_PRESETS[q].label}
            </option>
          ))}
        </select>
      </div>

      {/* bottom: controls legend */}
      <div
        style={{
          position: "absolute",
          bottom: 14,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(12,19,36,0.66)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: "8px 14px",
          fontSize: 12,
          opacity: flying ? 0.95 : 0.7,
          whiteSpace: "nowrap",
          maxWidth: "94vw",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {flying
          ? narrow
            ? "Sticks fly · V view · X flip · M mode · 📷 cam"
            : flightMode === "acro"
              ? "Acro: ↑↓ pitch · ←→ roll · A/D yaw · W throttle · S cut · V view · Q/E cam · M mode · G 🏀 · Esc land"
              : "W/S ↑↓ · A/D yaw · ←→↑↓ fly · Shift sport · X flip · V view · Q/E cam · M mode · G 🏀 · T 🍅 · Esc land"
          : "WASD nudge the hovering drone · hold F or the button to fly"}
      </div>

      {panel === "settings" && <SettingsPanel onClose={() => setPanel("none")} />}
      {panel === "squad" && <SquadPanel onClose={() => setPanel("none")} />}
      {minimapOn && !fpvActive && <Minimap />}
      <PeerMarkers />
      <MatchBanner />
      <FpvOverlay />
      <HullFlash />
      <Toasts />
      {touchActive(touchMode) && <TouchSticks />}
      {/* flip trick (mouse + touch) — Easy/Angle only; Acro flips by stick */}
      {flying && flightMode !== "acro" && (
        <button
          type="button"
          onPointerDown={() => requestFlip()}
          title="Flip! (X) — backflip; hold ↑ for a front flip, ←/→ for a roll"
          style={{
            position: "absolute",
            bottom: 340,
            right: 90,
            pointerEvents: "auto",
            width: 52,
            height: 52,
            borderRadius: "50%",
            border: "2px solid rgba(192,193,255,0.55)",
            background: "rgba(12,19,36,0.72)",
            fontSize: 22,
            cursor: "pointer",
            backdropFilter: "blur(6px)",
          }}
        >
          🔄
        </button>
      )}
      {/* basketball release button (mouse + touch) — dims + relabels when
          you're not holding it, so "nothing happens" reads as "go get the
          ball" instead of "the button is broken". */}
      {flying && raceOn && (
        <button
          type="button"
          onPointerDown={() => {
            if (tryReleaseBall()) {
              engineAudio.init();
              engineAudio.playDrop();
            }
          }}
          title={ballHeld ? "Release the ball (G)" : "Ball's on the ground — fly down and hover close to it"}
          style={{
            position: "absolute",
            bottom: 340,
            right: 18,
            pointerEvents: "auto",
            width: 60,
            height: 60,
            borderRadius: "50%",
            border: `2px solid rgba(230,124,60,${ballHeld ? 0.6 : 0.25})`,
            background: "rgba(12,19,36,0.72)",
            fontSize: 26,
            cursor: "pointer",
            opacity: ballHeld ? 1 : 0.45,
            backdropFilter: "blur(6px)",
          }}
        >
          {ballHeld ? "🏀" : "📍"}
        </button>
      )}
      {/* tomato drop button (mouse + touch) */}
      {flying && tomatoOn && (
        <button
          type="button"
          onPointerDown={() => {
            const res = tryDropLocal();
            if (res) {
              engineAudio.init();
              engineAudio.playDrop();
              broadcastTomatoDrop(res.pos, res.vel);
            }
          }}
          title="Drop tomato (T)"
          style={{
            position: "absolute",
            bottom: 268,
            right: 18,
            pointerEvents: "auto",
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: "2px solid rgba(226,59,46,0.6)",
            background: "rgba(12,19,36,0.72)",
            fontSize: 28,
            cursor: "pointer",
            backdropFilter: "blur(6px)",
          }}
        >
          🍅
        </button>
      )}
    </div>
  );
}
