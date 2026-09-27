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

## Deploy (GitHub Pages → https://nomsams.github.io/drdron/)

`vite.config.ts` pins `base: "/drdron/"` so chunks load from the project
subpath. **Publish the contents of `dist/`, never the repo root** — the root
`index.html` points at `/src/main.tsx`, which only exists under `npm run dev`
(serving it live is exactly the stuck-"loading flyjs" boot you saw).

Automatic: push to `main` and `.github/workflows/deploy.yml` builds +
publishes `dist/` (one-time setup: repo Settings → Pages → Source: "GitHub
Actions"). Manual: `npm run build`, then upload `dist/` to any static host.

Note: first `dev` load compiles three.js on demand and can take a while —
the boot splash + "warming up the island…" fallback cover that gap, and the
production build has no such delay.

## Stuck on "loading flyjs…"?

The splash now carries a timestamped boot log — read it before anything else:

1. **Red `file://` line** — you double-clicked the HTML file. ES modules are
   blocked that way. Run `npm run dev` and open the `http://localhost:5173`
   URL it prints (or `npm run build && npm run preview`).
2. **Red chunk/resource line** — dev server died, port changed (check the
   terminal — Vite moves to `:5174` if `:5173` is taken), offline, or an
   adblocker ate a chunk. The 3D chunk retries 3×, then offers a Retry button.
3. **Red exception line** — copy it (F12 console has the full stack).
4. **No red, just slow** — first dev compile of three.js can take 30–60 s;
   the 20 s watchdog says so explicitly. `?quality=potato` lowers startup cost.
5. Still dead? Hard-refresh (Ctrl+Shift+R) to drop a stale service worker /
   cached chunk, then file an issue with the log lines + browser version.

## Controls

- **Take Off**: button or hold `F` (1.1 s charge) · **Land**: button or `Esc`
- In flight: `W/S` ascend/descend · `A/D` yaw · arrows fly/strafe ·
  `Shift` sport · `R` toggle reward rings · `T`/`B` or the 🍅 button drops a
  tomato · `G` or the 🏀 button releases the basketball · `Esc` land
- View: `V` (or 🥽) swaps chase / FPV goggles · `Q`/`E` (hold) tilt the
  camera up / down, or the 📷 button snaps forward → 45° → straight down
- Flying style: `M` (or 🎮) cycles Easy → Angle → Acro · `X` (or 🔄) does a
  flip trick in Easy/Angle (backflip; hold ↑ for a front flip, ←/→ to roll)
- Acro: `↑/↓` pitch rate · `←/→` roll rate · `A/D` yaw · `W` throttle up ·
  `S` throttle cut · nothing self-levels
- Idle: `WASD`/arrows nudge the hovering drone
- URL hooks: `?quality=potato|balanced|high|ultra` forces a tier,
  `?autofly=1` takes off automatically (demos, screenshots),
  `?tomatoes=0` starts with tomato mode off, `?race=0` starts with the
  basketball race off, `?room=CODE` auto-joins a squad

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
- **Basketball race** (`src/three/world/Basketball{,Hoops}.tsx`,
  `src/state/race.ts`, `src/config/race.ts`): carry a basketball around a
  6-hoop aerial loop (distinct from the reward-ring course) and release it
  (🏀 button or `G`) to arc it down through the rim — real gravity + air drag,
  a gold aim predictor (turns emerald when the arc would swish), ground
  bounce with basketball-like restitution. A make scores 300 pts, auto-
  recatches the ball, and advances to the next hoop; clearing the loop adds a
  500-pt lap bonus and records a best-lap time (persisted). A miss drops the
  ball to the ground — fly down and hover close to reclaim it, then retry the
  same hoop (the release button dims and the minimap marks the ball's resting
  spot while it's down, so "pressing G does nothing" reads as "go get it"
  rather than a dead button). Local-authoritative like tomato bombing (your
  run scores on your client); squadmates' hoop/lap progress shows on the
  roster.
- **FPV goggles** (`V` key or the 🥽 HUD button): swaps the chase camera for
  a rigid nose-mounted view — wide FOV, attitude directly from the drone
  (no look-at smoothing), so it reads like real FPV footage instead of a
  close-up chase cam. The drone's own body/arms/props render on a dedicated
  Three.js layer that this camera doesn't enable (`OWN_BODY_LAYER` in
  `Drone.tsx`), so there's nothing to clip into mid-maneuver — a nose-mounted
  camera is necessarily right at the fuselage/prop geometry, and any fixed
  offset "clearing" it in level flight ends up back inside it during a pitch
  or roll. A digital-goggle OSD overlays it: vignette + scanlines, a center
  reticle, a REC timer, signal bars that fade with distance from the pad, a
  battery gauge, and a hint of propeller blur at the bottom corners (flat 2D,
  not 3D — exact corner placement in 3D at this fov is unreasonably fiddly
  for a decorative touch). The flight battery is simulated (a fresh pack
  every takeoff, ~5 min to empty at a gentle hover, faster under
  throttle/sport) — it blinks amber under 20%, red under 10%, and forces a
  landing at 0%, mirroring a real FPV failsafe.

## Flight modes, wind, and the FPV OSD

The flight model lives in `src/lib/flightModel.ts` as pure functions (no
React, no stores), so it can be stepped headlessly.

| mode | what the sticks do | limits |
|---|---|---|
| **Easy** (default) | velocity follows the sticks directly; tilt is cosmetic | — |
| **Angle** | sticks set a tilt; the tilted thrust is what moves you (momentum, drift, wind), throttle holds altitude | tilt ≤ 26° (41° sport), self-levels |
| **Acro** | sticks set rotation *rates*; thrust always points out of the belly | **none** — pitch past vertical, loop, fly inverted |

Keys are on/off, so Angle and Acro run them through **virtual sticks**: a
held key travels the stick out over ~0.45 s and it springs back on release,
and Acro rates use an **expo** curve — a quick tap nudges the nose ~3° and
it stays there (that's how you fly forward in acro), holding ↓ ramps up to
the full 200°/s and loops you in ~2 s. Checked headlessly: Angle tops out at
~9 m/s at a steady 26° with altitude held, Acro hovers level with no drift.
`X` adds a canned 360° flip trick in Easy/Angle. Squadmates see your real
orientation, loops and flips included.

**Wind** (`src/state/wind.ts`, Settings: off / light / strong) veers, breathes
and gusts as a pure function of the clock, so everyone with the same setting
flies in the same weather. It pushes the drone (fully in Angle/Acro, partly
in Easy), carries the basketball (the aim arc accounts for it) and drifts the
clouds. Two airfield **windsocks** — at the helipad and on the beach — point
downwind and lift from limp to streaming with speed; the HUD shows speed,
where it's from, and an arrow for how it's pushing you relative to your nose;
the minimap has a north-up wind arrow.

**FPV OSD** (`src/ui/FpvOverlay.tsx`, `FpvInstruments.tsx`): an **artificial
horizon** split bar with a ±10°/±20° pitch ladder around the crosshair,
computed from the live camera (orientation, fov, gimbal tilt) so it sits on
the true horizon in any attitude — verified to 0 px against projected
horizon points — and pins dashed to the edge when the horizon's out of view;
a **compass tape** with heading readout; HP, wind, camera tilt and flight
mode; battery, signal, REC timer.

**Camera tilt**: in FPV the gimbal pitches from forward to straight down; in
chase view the camera rises to a near top-down view — handy for lining up
basketball and tomato drops.

**Battery packs**: the glowing green cells recharge the flight battery by
30% (only taken when you're below full; respawn after 40 s). The chase HUD
now shows a battery bar next to HP.

## Hull (HP)

`src/config/hull.ts`, `src/state/hull.ts`. Every takeoff starts with a fresh
100 HP airframe. Impact speed is the velocity component *into* what you hit
(terrain normal, collider normal, relative velocity for birds/pilots), and
damage grows super-linearly with it — so skimming low over flat ground is
free, but slamming into a hillside is not.

| hit | when it hurts | head-on at ~9 m/s | at sport ~16 m/s |
|---|---|---|---|
| tree | any real impact (>0.8 m/s) | ≈18 | ≈37 |
| rock (incl. mountain, waterfall cliff) | any real impact | ≈21 | ≈44 |
| bird | always (relative speed) | ≈10 | — |
| other pilot | any real impact | ≈14 | — |
| ground / water | only above 4 m/s into it | — | sport dive ≈17 |

Hits flash the screen edge red, shake the camera, throw a particle burst
(leaves, grit, feathers, splash, sparks) and knock birds tumbling. At 0 HP the
motors cut: the drone tumbles down, and you take off again with a fresh
airframe. Get HP back from floating **repair kits** (spinning wrench, +30 HP,
respawn after 30 s, marked as teal diamonds on the minimap — only consumed
when you're damaged) or by hovering low and slow over the **helipad**. The
drone now also rests on the water surface instead of sinking to the sea floor.

## Multiplayer

- **Quick join**: one button, no code — joins public lobby `PUB1`, hopping to
  `PUB2`…`PUB6` if the one it lands in already has more pilots than we render.
- **Smooth ghosts**: packets carry velocity, so squadmates are dead-reckoned
  between 10 Hz updates instead of trailing ~100 ms behind.
- **Shared hull**: HP bars over squadmates' nameplates and in the roster,
  sparks when they get hit, a toast when they go down. Drones bump off each
  other mid-air and both take damage — each client resolves its own side, no
  host needed.
- **Squadmates' basketballs** are visible (carried under their drone, or loose
  on the ground after a miss).
- **Toasts** for pilots joining, leaving, or losing signal.

## Multiplayer link health

`src/net/mp.ts` pins a curated set of 8 known-reliable public Nostr relays
(`redundancy: 4` — several are queried at once) instead of trystero's full
default list, which carries some relays that are slow or offline. The Squad
panel now shows link status: **degraded** (no relay response within ~7 s —
check network/firewall, WebRTC needs UDP) or **error** (relay unreachable),
each with a **Retry** button that drops and rejoins the room.

For strict NATs (symmetric NAT, locked-down corporate networks) where plain
STUN can't punch through, optional TURN relay config can be set via
`.env.local` (no credentials ship with this project):

```
VITE_TURN_URLS=turn:your-host:3478
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

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
