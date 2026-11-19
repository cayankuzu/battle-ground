# BATTLE GROUND — 3D Tactical Battle Simulator

A real-time 3D tactical battle sandbox built with **TypeScript**, **Three.js**, and **Vite**, designed as part of the [fikkis.](https://fikkis.vercel.app/) experimental web lab.

## Features

- **117 Playable 3D Units & Structures** — 101 verified self-contained CC0 `.glb` models plus 16 bespoke 3D procedural constructs, automatically ranked from strongest to weakest by real combat power score.
- **6 Distinct Visual & Game Modes** (with live cross-mode 3D model conversion):
  - **HYBRID / KARMA (`ALL-IN-ONE`)** — All 117 units from every visual universe clash in a single arena.
  - **ULTRA REALISTIC (`REAL+MYTH`)** — High-detail soldiers, plate knights, T-Rex, cruisers, M1A2 tanks & 18 Mythological Gods, Dragons & Golems with HDR PBR & Bloom.
  - **STYLIZED / CLASSIC (`LOW-POLY`)** — Cohesive KayKit & Quaternius heroes, undead legion, dinosaurs, beasts & live troop-spawning barracks.
  - **MANGA / FEUDAL (`SAMURAI+INK`)** — Exclusive Feudal Japan Samurai, Shogun, Shinobi, Ballista & Pagoda in a Sobel ink & halftone screentone shader.
  - **VOXEL / PIXEL 3D (`VOXEL-8BIT`)** — 100% authentic blocky/voxel 3D characters, Voxel Zeus, Voxel Dragon, Voxel T-Rex, Voxel Tank & Bayer 4×4 dithering.
  - **BLUEPRINT / CAD (`TACTICAL-CAD`)** — Autonomous robotics, starfleet, heavy armor & physics toys in CAD vector telemetry.
- **14 Autonomous Signature Special Powers** — Including live 3D **Polymorph** (turning charging enemies into helpless live 3D frogs for 5.5s), **Divine Smite**, **Dragon Fire Breath**, **Raise Undead**, **Apex Roar**, **Iron Aegis**, **Seismic Leap**, **Shadow Blink**, **Stampede Trample**, **Salvo Barrage**, **EMP Overload**, **Venom Cloud**, **Warcry Haste**, and **Healing Nova** (both stochastically triggered and manually castable via the Live Unit Inspector).
- **Scientifically Grounded Defaults** — Unit HP, Damage, Speed, Armor, Mass, and Knockback are computed from real-world physical mass (`kg`), velocity (`km/h`), kinetic/bite energy (`J`/`N`), and armor materials, inspectable in the Per-Character Scientific Telemetry Drawer.
- **Full Sandbox Command Suite** — Brush, Single, Squad formation, Rally move orders, Live Unit Inspector, Erase, Factions (`Auto`, `Red`, `Blue`, `Chaos FFA`), AI Protocols (`Fight`, `Hold`, `Passive`, `Flee`), Global Army Orders, World Physics (`Gravity`, `Energy Cage`, `Friendly Fire`, `Corpse Persistence`), 5 Arena Biomes, 13 Preset Scenarios, Rewind, and full `TR | EN` bilingual UI.

## Development

```bash
npm install
npm run dev
npm run build
```

## 3D Assets & Credits

All bundled `.glb` models are CC0 / public domain assets sourced from KayKit, Quaternius, Polyfork, Vuena, and Three.js official examples.
