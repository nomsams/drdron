# flyjs — drone scaffold

Lightweight flyable-drone + procedural-island starter. 
https://nomsams.github.io/drdron

(MIT licensed — see Attribution), keeping **only the drone flight + world** parts.

## What was kept

- Flight model (`src/three/Drone.tsx`): velocity-lerp physics, yaw inertia,
  banked turns, sport mode, geofence, terrain clamp, cylinder colliders.
- Chase camera + day-cycle lighting rig (no shadow maps — blob shadow instead).
- Procedural drone mesh (zero assets: no glb, no Draco decoder).
- Procedural island: seeded simplex terrain, instanced trees/rocks/grass,
  gradient sky dome, helipad, waterfall, beach palms, mountain, pickups.
- Synthesized engine audio (Web Audio, no samples — optional, muted safe).

## What was deliberately dropped

- All CV content: experience trail, project billboards, blog/travel/video
  boards, about board, nav signposts, focus panel, Instagram embeds.
- Race time-trial (rings, briefing board, results, race store).
- Next.js, Tailwind, framer-motion, lucide, MDX/blog system, analytics,
  `drei` (Text/Sparkles/Instances/PerformanceMonitor/useGLTF) — the heaviest
  dependency. Replaced with hand-rolled `instancedMesh`, `Points` clouds and
  a DOM FPS monitor.
- Hero DOM-anchor projection (drone now idles over the helipad — no page
  coupling), session resume, router navigation.

## Graphics generations (quality tiers)

`src/config/quality.ts` — four presets scaling GPU/CPU cost:

| tier | dpr | AA | terrain | trees/rocks/grass | sky | extras |
|---|---|---|---|---|---|---|
| `potato` | 1 | off | 48² | 35/18/0 | 16×8 | no mist, clouds, fireflies, pad light, sheen |
| `balanced` (default-ish) | 1.5 | on | 64² | 60/30/120 | 24×12 | mist + pad light |
| `high` (≈ upstream) | 2 | on | 96² | 90/45/250 | 32×16 | all effects + water sheen |
| `ultra` | 2 | on | 128² | 120/60/350 | 48×24 | all effects, denser |

Auto behaviour: first paint guesses from cores/memory/pointer type, then
`useAdaptiveQuality` measures real FPS and steps down (<45 fps) or up
(>58 fps sustained). Manual choice in the HUD persists to localStorage.
`?quality=potato|balanced|high|ultra` forces a tier (handy for testing).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build → dist/
```

Note: first `dev` load compiles three.js on demand and can take a while —
the boot splash + "warming up the island…" fallback cover that gap, and the
production build has no such delay.

## Controls

- **Take Off**: button or hold `F` (1.1 s charge) · **Land**: button or `Esc`
- In flight: `W/S` ascend/descend · `A/D` yaw · arrows fly/strafe ·
  `Shift` sport · `R` toggle reward rings · `T`/`B` or the 🍅 button drops a
  tomato · `Esc` land
- Idle: `WASD`/arrows nudge the hovering drone
- URL hooks: `?quality=potato|balanced|high|ultra` forces a tier,
  `?autofly=1` takes off automatically (demos, screenshots),
  `?tomatoes=0` starts with tomato mode off, `?room=CODE` auto-joins a squad

## Island life & reward rings

- **Vegetation** (3 draw calls at every tier): 3-tier pines with
  per-instance tint/tilt, crossed-quad grass tufts with baked gradients,
  tinted rocks. Potato gets fewer instances, not uglier geometry.
- **Birds** (`src/three/world/Birds.tsx`): a small flock circling one area
  (above the pond) — unlit silhouette meshes, one `useFrame` for all.
  Count scales with the quality tier.
- **Reward rings** (`src/three/world/RewardRings.tsx`): 8 glowing rings on a
  scenic loop (pad → pond → pond skim → east shore → beach → inland climb →
   high pass → pad) with a dotted guide path, airplane-game style. Fly through for
   100 pts each, clear the loop for a 250-pt lap bonus. Toggle in the HUD or
   with `R`; score is per-session. Detection runs at 10 Hz, glow animates in
   the render loop — no per-frame React work.
- **Tomato bombing** (`src/three/world/Tomato{,s}.tsx`, `src/state/tomato.ts`,
  `src/config/tomato.ts`): 6 bullseye targets (soil disc + flag, 8 s respawn,
  150 pts each). Drops inherit drone velocity + forward kick with arcade
  gravity; splats paint the terrain and fade after 12 s. Toggle with the 🍅
  HUD button, drop with `T`/`B` or the 🍅 button (touch-friendly). A gold
  predictor arc + impact ring (red over a bullseye) shows where the next
  tomato lands; bullseyes fire a shockwave, a thump, and a camera kick.
  Drops are broadcast over the squad P2P channel as visual-only ghosts that
  splat but never score, while tomato score/hits ride the 10 Hz state packet
  (`ts`/`th`, optional for backwards compat) so the squad roster is a live
  tomato leaderboard.
- **Squad match**: first pilot to all 6 bullseyes takes the crown — a 🏆
  banner names the winner on every client (scores converge over P2P, no host),
  with one-tap Rematch. Floating name + distance markers track squadmates in
  3D (edge-glow when off-screen), so you can actually find each other.

## Mobile

- Touch sticks (left: ascend/yaw, right: fly/strafe) + SPORT hold + a 64 px
  🍅 drop button, all pointer-capture safe.
- Squad invites use the native share sheet (WhatsApp, Messages, …) with
  clipboard fallback — no typing room codes on a phone keyboard.
- Screen wake lock while flying, haptic thump on bullseyes, minimap shrinks
  to 124 px under 640 px widths, HUD bars wrap, no pinch-zoom or
  pull-to-refresh mid-flight (`maximum-scale`, `overscroll-behavior`).

## Files you actually need to copy into your project

```
src/config/{quality,world}.ts
src/lib/{terrain,palette,audio}.ts
src/state/flight.ts
src/hooks/{useFlightControls,useAdaptiveQuality}.ts
src/three/{DroneExperience,Drone,ChaseCamera,Lighting,FlightScene,ProceduralDrone}.tsx
src/three/world/*.tsx
src/ui/{HUD,ErrorBoundary}.tsx   (or replace with your own UI)
```

Needs only `three`, `@react-three/fiber`, `zustand`, `simplex-noise`.

## Porting to Next.js App Router

- `npm i three @react-three/fiber zustand simplex-noise`
- Copy the folders above under `@/…`, load the experience with
  `dynamic(() => import(...), { ssr: false })` (three.js is client-only).
- React 19 requires `@react-three/fiber@9` (v8 crashes on React 19).

## Attribution

Drone physics, terrain math, palette, audio synth and component structure
adapted from rishabhrathod01.github.io © Rishabh Rathod, MIT License.
This scaffold is a fresh, reduced rewrite — not a fork — with all
portfolio content and game modes removed.
