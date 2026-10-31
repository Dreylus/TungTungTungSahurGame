# PIXEL WARS: Algorithm Battlegrounds — Design Document

A sandbox game where autonomous expansion algorithms fight for territory
on a pixel grid. Pick your fighters, shape the arena, toggle the rules,
save your setup, and watch it play out.

Target: an Android APK meant to be played on a Google Pixel — custom images,
haptics, and "super cool" visuals.

---

## 1. Core Concept

- A grid of pixels is the battleground.
- 2 to 16 algorithms spawn and expand using their own unique logic.
- Winner = most territory (pixels owned) when the match ends.
- Everything is customizable and saveable.

## 2. Game Modes (Rule Toggles)

| Toggle | Options | Effect |
|---|---|---|
| Attack | On / Off | Can an algorithm overwrite enemy pixels? |
| Consume | On / Off | Can it absorb surrounded enemy regions? |
| Territory Decay | On / Off | Unconnected pixels slowly die |
| Fog of War | On / Off | Algorithms only "see" nearby pixels |
| Win Condition | Most area / Last alive / Timer | How the match ends |
| Match Length | 30s to unlimited | Timer for the match |
| Expansion Speed | 0.25x to 10x | Global sim speed |
| Obstacles | None / Random / Custom | Walls and holes in the arena |

### Preset Modes
1. **Pure Race** (no attack, no consume): who fills the most space first?
2. **Classic War** (attack on, consume off): fronts push against each other.
3. **Total Domination** (attack + consume): encirclement wins.
4. **Survival** (decay on, last alive wins): only stable growth lasts.
5. **Chaos** (random toggles each match).
6. **Sandbox** (everything manual).

## 3. Arenas

Square, Circle, Hexagon, Ring / Donut, Cross, Spiral corridor, Islands
(joined by bridges), Maze, Custom (paint your own), Random generator (seeded).

Arena options: size (64x64 up to 1024x1024), wrap-around edges on/off,
spawn layout (symmetric, random, corners, center, manual placement).

## 4. The Algorithms (16 Fighters)

| # | Name | Method | Strength | Weakness |
|---|---|---|---|---|
| 1 | **Flood** | Breadth-first fill, uniform in all directions | Fast, steady | Predictable, no tactics |
| 2 | **Mycelium** | Branching threads with random tips that fork | Reaches far places | Thin, easy to cut |
| 3 | **Encircler** | Rushes to the arena edge, builds a wall, then fills inward | Traps enemies | Slow start |
| 4 | **Spiral** | Winds outward from its spawn point | Dense, no gaps | Slow reach |
| 5 | **Crystal** | Grows in straight lines at fixed angles | Strong straight fronts | Leaves gaps |
| 6 | **Slime Mold** | Seeks nearest empty space and builds efficient paths | Adaptive | Wastes time exploring |
| 7 | **Virus** | Random-walk spread with high infection chance on contact | Great at attacking | Unstable core |
| 8 | **Wave** | Pulses outward in rings, each ring thicker | Strong frontline | Pulse gaps |
| 9 | **Hive** | Builds a dense cluster, then launches scouts | Balanced | Complex |
| 10 | **Lightning** | Fast jagged branches (diffusion-limited aggregation) | Very fast reach | Fragile |
| 11 | **Glacier** | Slow growth that cannot be overwritten | Hard to attack | Slowest speed |
| 12 | **Swarm** | Many tiny agents wander and claim pixels | Hard to predict | Chaotic, inefficient |
| 13 | **Parasite** | Targets enemy borders and grows along them | Strong in attack mode | Useless in Pure Race |
| 14 | **Fractal** | Recursive branching (tree/Koch-style) | Scales well | Needs room |
| 15 | **Tide** | Expands and retreats in cycles, claiming net gains | Resilient | Slow net progress |
| 16 | **Mind** | Scores options each tick (greedy plus lookahead) | Smartest | Costly to compute |

### Custom Algorithm Builder (stretch goal)
Combine parameters: spread pattern, speed, aggression, branching chance,
retreat chance, randomness. Save as a new fighter.

## 5. Simulation Engine

- Grid stored as a typed array (owner ID per pixel).
- Each tick: every algorithm runs `step()` in a randomized order (fair turn order).
- Conflict rules when two algorithms want the same pixel: random, speed-based,
  or strength-based (toggle).
- Run in a Web Worker for big grids.
- Seeded RNG so any match can be replayed exactly.

## 6. Controls and UI

- Main Menu: Quick Play, Custom Match, Saved Setups, Settings
- Match Screen: Start / Pause / Restart / Step one tick, speed slider, live
  scoreboard, territory graph, zoom and pan, click-to-spawn and
  paint-obstacles tools while paused
- Setup Screen: pick algorithms (2 to 16, duplicates allowed), arena, spawn
  layout, rule toggles, randomize button

## 7. Save System

- 10 save slots (expandable): arena, algorithms, spawn positions, rule toggles,
  speed, seed, name and thumbnail.
- Save, Load, Overwrite, Rename, Duplicate, Delete.
- Restart with same settings (same seed) or re-roll (new seed).
- Templates: built-in presets that cannot be deleted.
- Export / Import a setup as a string to share with friends.

## 8. Sound

Per-algorithm instrument and pitch, generative tones on territory gains,
sharper hits for attacks and captures, jingles and a victory sting, ambient
loop, master / music / SFX volume and per-algorithm mute. Web Audio only.

## 9. Visuals

Standard flat colours with subtle borders; Visual Masterpiece Mode with
glowing frontiers and bloom, particle sparks, pulsing shading, growth trails,
heat map, age gradients, shader styles (CRT, neon, watercolor, ink), slow
motion on big captures, cinematic camera, timelapse replay and
screenshot / GIF export. Accessibility: colour-blind palettes, reduced
motion, pattern overlays.

## 10–13

Tech stack (Canvas / WebGL, TypeScript, Web Workers, Web Audio, Vite, no
backend), roadmap phases 1–6, balance notes (no fighter above ~15% of wins,
every fighter shines somewhere; the Encircler should win small circles
without attack and lose huge arenas), and open questions (learning between
matches, team mode, chaos events, mobile layout).
