# PIXEL WARS: Algorithm Battlegrounds

_Repository: TungTungTungSahurGame — triple t's deadly game._

A sandbox game where 16 autonomous expansion algorithms fight for territory on
a pixel grid. Pick your fighters, shape the arena, flip the rules, save your
setup and watch it play out. Built as an **Android APK for Google Pixel**
(haptics, 120 Hz, edge-to-edge), and it also runs in any modern browser.

The full design document is in [`docs/DESIGN.md`](docs/DESIGN.md).

## Install on your Pixel

Every push builds a signed APK with GitHub Actions
(`.github/workflows/android.yml`):

1. On your phone, open this repository's **Releases** page.
   - `latest` is built from the default branch.
   - `preview-<branch>` is built from other branches.
2. Download **`PixelWars.apk`** and open it. If Android asks, allow your browser
   to install unknown apps.
3. Each new build installs over the previous one; your saves are kept.

The APK is also attached to every workflow run as an artifact.

## What's in the game

**Fighters (all 16):** Flood, Mycelium, Encircler, Spiral, Crystal, Slime Mold,
Virus, Wave, Hive, Lightning, Glacier, Swarm, Parasite, Fractal, Tide and Mind,
each with its own expansion logic, strengths and weaknesses. The **Fighter Lab**
lets you build your own fighter from a spread pattern, speed, aggression,
branching, retreat and randomness, with a live preview.

**Rules:** attack, consume (encirclement), territory decay, fog of war, three
win conditions, match length (30 s to unlimited), speed (0.25× to 10×), conflict
rule (random / speed / strength) and chaos events (meteors, growth surges).
Six presets: Pure Race, Classic War, Total Domination, Survival, Chaos, Sandbox.

**Arenas:** square, circle, hexagon, ring, cross, spiral corridor, islands with
bridges, maze, seeded random, custom paint (walls / holes / floor with mirror
and rotation symmetry) and **photo arenas** (turn any picture into a map; the
photo shows through the battlefield). Sizes from 64 to 1024, square / 4:5 /
phone-shaped 9:16 boards, wrap-around edges, five spawn layouts including
manual placement.

**Custom images:** give any fighter your own picture. It is used as the
fighter's avatar on the scoreboard, as a badge that follows its territory on
the board, and on the victory screen, and the fighter's colour is taken from
the image.

**Match screen:** play / pause / step / restart, speed slider, live share bar
and scoreboard, territory graph, pinch-zoom and pan, double-tap zoom,
cinematic camera, and while paused: click-to-spawn, paint walls or holes, and
erase.

**Visual Masterpiece mode:** glowing frontiers with bloom, particle sparks at
conflict lines, growth trails, pulsing shading, age gradients, heat map, slow
motion and a camera punch-in on big encirclements, plus CRT, neon, watercolor
and ink shader styles. Timelapse replay, screenshot sharing and **GIF export**.
Accessibility: colour-blind-safe and high-contrast palettes, pattern overlays
and reduced motion.

**Sound:** generative Web Audio, with no audio files. Each fighter has its own
instrument; territory gains play notes in A-minor pentatonic; clashes,
encirclements, meteors and eliminations have their own hits; there is an
ambient pad and a victory sting. Master, music and effects volume, plus a mute
for each fighter.

**Haptics (Pixel):** the Android shell builds every effect from
`VibrationEffect` composition primitives (click, tick, low tick, thud, spin,
quick and slow rise, quick fall), so you feel the countdown, clashes, wave
pulses, lightning strikes, encirclements, meteors, eliminations and the
victory. Older phones fall back to predefined effects or amplitude waveforms.
Haptic strength and battle haptics can be adjusted in Settings.

**Saves:** 10 slots (add more), each with a thumbnail and the arena, fighters,
spawns, rules, speed, seed and images. Load, overwrite, rename, duplicate,
delete and export. Built-in templates cannot be deleted. Setups export as a
compressed `PW1:` share code (or JSON) and import from the clipboard or a
file. Matches are seeded: **Rematch** replays the exact same battle, and
**New seed** rolls a new one.

## Balance

`npm run balance -- [matchesPerMode] [size] [fighters] [modes]` plays headless
seeded matches and prints win rates per fighter and mode. With
`80 128 4 race,war,domination,survival`, no fighter takes more than ~12% of all
wins (the target in the design doc is ~15%). Every fighter has a mode where it
does well: Flood, Mycelium, Lightning, Hive and Slime Mold in Pure Race; Virus,
Crystal, Tide and Mind in Classic War; Parasite in Total Domination; Glacier,
Spiral and Wave in Survival. The Encircler wins small circles with attack off,
and its wall gets more expensive on huge arenas.

## Develop

```bash
npm install
npm run dev            # web version at http://localhost:5173
npm run typecheck
npm run balance        # headless balance report
```

### Build the APK yourself

You need Node 22+, JDK 17 and the Android SDK (or Android Studio).

```bash
npm run build:android            # bundles the game into android/app/src/main/assets/www
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```

Or open the `android/` folder in Android Studio after running
`npm run build:android`.

### Signing

Release builds are signed with `android/app/pixelwars-sideload.jks`, a
**public** key (password `pixelwars`) that is only meant for sideloading, so
every build can update the previous install. Before publishing to the Play
Store, create your own keystore and pass it with the `PW_KEYSTORE`,
`PW_KEYSTORE_PASSWORD`, `PW_KEY_ALIAS` and `PW_KEY_PASSWORD` environment
variables (or the matching repository secrets in CI).

## Project layout

```
src/
  engine/       grid, tick loop, rules, consume/decay, seeded RNG, presets
  algorithms/   the 16 fighters + custom builder (basic, walkers, strategic)
  arenas/       shapes, obstacles, spawn layouts, mask encoding
  sim/          Web Worker runner + main-thread host (diffs, history, timelapse)
  visuals/      WebGL2 renderer + post-processing, effects, GIF encoder
  audio/        generative Web Audio engine
  native/       Android bridge + semantic haptics
  saves/        settings, slots, custom fighters, export/import
  ui/           screens: menu, setup, match, saves, fighters, lab, editor, settings
android/        WebView shell (MainActivity, NativeBridge, Haptics)
scripts/        balance runner
```
