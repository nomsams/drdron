"use client";

import { useRef, useState } from "react";
import { keys } from "@/state/flight";

// Virtual joysticks for touch devices (the keyboard scheme has no touch
// equivalent). They write the same shared `keys` object the physics reads,
// so no flight-code changes were needed. Left stick: ascend/descend + yaw.
// Right stick: fly forward/back + strafe. Dead-zoned, auto-centering.

const RADIUS = 48;
const DEAD = 0.3;

type Pair = [neg: keyof typeof keys, pos: keyof typeof keys];

function Stick({ xPair, yPair, side }: { xPair: Pair; yPair: Pair; side: "left" | "right" }) {
  const zone = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pid = useRef<number | null>(null);

  const apply = (nx: number, ny: number) => {
    keys[xPair[0]] = nx < -DEAD;
    keys[xPair[1]] = nx > DEAD;
    keys[yPair[0]] = ny < -DEAD;
    keys[yPair[1]] = ny > DEAD;
  };

  const move = (clientX: number, clientY: number) => {
    const el = zone.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = (clientX - (r.left + r.width / 2)) / RADIUS;
    let dy = (clientY - (r.top + r.height / 2)) / RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    setKnob({ x: dx * RADIUS, y: dy * RADIUS });
    apply(dx, dy);
  };

  const end = (e: React.PointerEvent) => {
    if (pid.current !== e.pointerId) return;
    pid.current = null;
    setKnob({ x: 0, y: 0 });
    keys[xPair[0]] = keys[xPair[1]] = false;
    keys[yPair[0]] = keys[yPair[1]] = false;
  };

  return (
    <div
      ref={zone}
      onPointerDown={(e) => {
        pid.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        move(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (pid.current === e.pointerId) move(e.clientX, e.clientY);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      style={{
        width: RADIUS * 2 + 24,
        height: RADIUS * 2 + 24,
        borderRadius: "50%",
        background: "rgba(12,19,36,0.55)",
        border: "1px solid rgba(255,255,255,0.18)",
        position: "relative",
        touchAction: "none",
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: "rgba(192,193,255,0.75)",
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -20,
          width: "100%",
          textAlign: "center",
          fontSize: 11,
          opacity: 0.7,
        }}
      >
        {side === "left" ? "↑↓ · yaw" : "fly · strafe"}
      </div>
    </div>
  );
}

export default function TouchSticks() {
  const [sport, setSport] = useState(false);
  const setSportKey = (v: boolean) => {
    keys.sport = v;
    setSport(v);
  };
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 64,
        zIndex: 20,
        display: "flex",
        justifyContent: "space-between",
        padding: "0 18px",
        pointerEvents: "none",
        alignItems: "flex-end",
      }}
    >
      <Stick xPair={["yawLeft", "yawRight"]} yPair={["up", "down"]} side="left" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onPointerDown={() => setSportKey(true)}
          onPointerUp={() => setSportKey(false)}
          onPointerCancel={() => setSportKey(false)}
          onPointerLeave={() => setSportKey(false)}
          style={{
            pointerEvents: "auto",
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: "1px solid rgba(255,209,102,0.5)",
            background: sport ? "rgba(255,209,102,0.45)" : "rgba(12,19,36,0.55)",
            color: "#ffd166",
            fontWeight: 700,
            fontSize: 12,
            touchAction: "none",
            userSelect: "none",
          }}
        >
          SPORT
        </button>
        <Stick xPair={["strafeLeft", "strafeRight"]} yPair={["forward", "back"]} side="right" />
      </div>
    </div>
  );
}
