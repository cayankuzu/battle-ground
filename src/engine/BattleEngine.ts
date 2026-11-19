import * as THREE from 'three';
import {
  AIBehavior,
  CatalogItem,
  CharacterOverride,
  RenderStyle,
  SpawnConfig,
  SpecialAbilityKind,
  Team,
  TeamSetting,
  TelemetryStats,
  UnitSnapshot,
  UnitTraits,
  VictoryReport,
  WorldSettings,
} from '../types';
import { CATALOG_MAP, findModeEquivalent } from '../data/catalog';
import { ARENA_HALF_D, ARENA_HALF_W, ArenaScene } from './ArenaScene';
import { AnimKey, InstantiatedModel, ModelLibrary, applyStyleToMaterial } from './ModelLibrary';
import { SpatialGrid } from './SpatialGrid';
import { SoundSynth } from './SoundSynth';
import { VfxSystem } from './VfxSystem';

interface VenomZone {
  x: number;
  z: number;
  radius: number;
  team: Team;
  ownerId: number;
  damagePerSec: number;
  life: number;
  tickTimer: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

export interface UnitEntity {
  id: number;
  catalog: CatalogItem;
  team: Team;
  ai: AIBehavior;
  scale: number;
  hpMult: number;
  dmgMult: number;
  spdMult: number;
  maxHp: number;
  hp: number;
  damage: number;
  speed: number;
  attackRange: number;
  attackCooldown: number;
  armor: number;
  traits: UnitTraits;
  radius: number;
  mass: number;
  kills: number;

  // 3D Physics state
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  alive: boolean;
  dyingTimer: number;
  fallenOff: boolean;

  // Combat, AI & Autonomous Special Power timers
  attackTimer: number;
  auraTimer: number;
  slowTimer: number;
  specialTimer: number;
  shieldTimer: number;
  stunTimer: number;
  fearTimer: number;
  hasteTimer: number;
  stampedeTimer: number;
  stampedeTickTimer: number;
  polymorphTimer: number;
  polymorphOrigModel: InstantiatedModel | null;
  polymorphOrigDamage: number;
  polymorphOrigSpeed: number;
  hitFlashTimer: number;
  lungeTimer: number;
  spawnPop: number;
  phaseOffset: number;
  rallyTarget: { x: number; z: number } | null;
  targetId: number | null;
  retargetTimer: number;

  // Visual handles
  root: THREE.Group;
  model: InstantiatedModel | null;
  currentAnim: AnimKey | null;
  teamRing: THREE.Mesh;
  teamRingMat: THREE.MeshBasicMaterial;
  hpBarGroup: THREE.Group;
  hpFillMesh: THREE.Mesh;
  hpFillMat: THREE.MeshBasicMaterial;
  shieldMesh: THREE.Mesh | null;
  placeholder: THREE.Mesh | null;
}

const TEAM_HEX: Record<Team, number> = {
  red: 0xff2e1f,
  blue: 0x2563eb,
  ffa: 0xf59e0b,
  neutral: 0x94a3b8,
};

const SHARED_RING_GEO = new THREE.RingGeometry(0.72, 0.94, 24);
SHARED_RING_GEO.rotateX(-Math.PI / 2);
const SHARED_HP_BG = new THREE.PlaneGeometry(1.15, 0.14);
const SHARED_HP_FILL = new THREE.PlaneGeometry(1.1, 0.1);
const SHARED_HP_BG_MAT = new THREE.MeshBasicMaterial({ color: 0x080a0f, side: THREE.DoubleSide });
const SHARED_PLACEHOLDER_GEO = new THREE.CapsuleGeometry(0.35, 0.7, 6, 10);

export class BattleEngine {
  public readonly units: UnitEntity[] = [];
  private readonly unitMap = new Map<number, UnitEntity>();
  private readonly grid = new SpatialGrid<UnitEntity>(4.5);
  private readonly queryBuf: UnitEntity[] = [];
  private nextId = 1;

  public running = true;
  public timeScale = 1;
  public selectedUnitId: number | null = null;
  public followUnitId: number | null = null;

  public readonly worldSettings: WorldSettings = {
    renderStyle: 'ultra',
    quality: 'high',
    biome: 'obsidian',
    gravityScale: 1.0,
    enclosedWalls: false,
    friendlyFire: false,
    persistCorpses: false,
  };

  public readonly speciesOverrides = new Map<string, CharacterOverride>();
  public readonly lastTeamOrder: { red: AIBehavior; blue: AIBehavior } = {
    red: 'aggressive',
    blue: 'aggressive',
  };

  private savedSnapshot: UnitSnapshot[] = [];
  private snapshotLockedDuringFight = false;
  private readonly venomZones: VenomZone[] = [];

  private totalKills = 0;
  private battleElapsed = 0;
  private hadRedFighters = false;
  private hadBlueFighters = false;
  private hadFfaFighters = 0;
  private victoryReported = false;
  private fpsFrames = 0;
  private fpsAccum = 0;
  private currentFps = 60;

  public onVictory?: (report: VictoryReport) => void;
  public onSelectionChange?: (unit: UnitEntity | null) => void;
  public onAbilityCast?: (unit: UnitEntity, ability: SpecialAbilityKind) => void;

  constructor(
    public readonly arena: ArenaScene,
    public readonly models: ModelLibrary,
    public readonly vfx: VfxSystem,
    public readonly sound: SoundSynth
  ) {}

  public applyWorldSettings(patch: Partial<WorldSettings>): void {
    const prevStyle = this.worldSettings.renderStyle;
    Object.assign(this.worldSettings, patch);

    if (patch.renderStyle && patch.renderStyle !== prevStyle) {
      this.arena.setRenderStyle(patch.renderStyle);
      // Swap any non-native arena units into the new graphic mode's authentic 3D asset equivalent!
      this.convertArenaToMode(patch.renderStyle);
    }
    if (patch.quality) {
      this.arena.setQuality(patch.quality);
    }
    if (patch.biome) {
      this.arena.setBiome(patch.biome);
    }
    if (patch.enclosedWalls !== undefined) {
      this.arena.setEnclosedWalls(patch.enclosedWalls);
    }
  }

  public convertArenaToMode(targetMode: RenderStyle): void {
    // Convert saved snapshot too so Rewind stays true to the active mode!
    this.savedSnapshot = this.savedSnapshot.map((s) => {
      const eq = findModeEquivalent(s.catalogId, targetMode);
      return eq ? { ...s, catalogId: eq.id } : s;
    });

    for (const u of this.units) {
      if (!u.alive) continue;
      const eq = findModeEquivalent(u.catalog.id, targetMode);
      if (eq && eq.id !== u.catalog.id) {
        // Live hot-swap unit's 3D model & scientific catalog to the new mode's native asset!
        u.catalog = eq;
        const spec = this.getEffectiveSpec(eq.id);
        const hpRatio = u.hp / Math.max(1, u.maxHp);
        u.maxHp = Math.round(spec.hp * u.hpMult * Math.pow(u.scale, 1.35));
        u.hp = Math.max(1, Math.round(u.maxHp * hpRatio));
        u.damage = spec.damage * u.dmgMult * Math.pow(u.scale, 0.75);
        u.speed = spec.speed * u.spdMult * (1 / Math.pow(u.scale, 0.18));
        u.attackRange = spec.attackRange;
        u.attackCooldown = spec.attackCooldown;
        u.armor = spec.armor;
        u.radius = eq.radius * u.scale;
        u.mass = eq.mass * Math.pow(u.scale, 2);
        u.teamRing.scale.setScalar(Math.max(0.55, u.radius * 1.15));
        u.hpBarGroup.position.y = eq.targetHeight * u.scale + 0.55;

        if (u.polymorphOrigModel) {
          this.disposeInstantiatedModel(u.polymorphOrigModel);
          u.polymorphOrigModel = null;
          u.polymorphTimer = 0;
          u.fearTimer = 0;
        }
        if (u.model) {
          u.root.remove(u.model.root);
          this.disposeInstantiatedModel(u.model);
          u.model = null;
          u.currentAnim = null;
        }
        const capturedUnit = u;
        this.models
          .instantiate(eq, u.scale, targetMode)
          .then((inst) => {
            if (!this.unitMap.has(capturedUnit.id) || capturedUnit.catalog.id !== eq.id) {
              this.disposeInstantiatedModel(inst);
              return;
            }
            capturedUnit.model = inst;
            capturedUnit.root.add(inst.root);
            this.setUnitAnim(capturedUnit, capturedUnit.alive ? 'idle' : 'death');
          })
          .catch(() => {});
      } else if (u.model) {
        const isArmored =
          u.catalog.category === 'modern' ||
          u.catalog.category === 'vehicles' ||
          u.armor >= 0.3;
        for (const mat of u.model.flashMaterials) {
          applyStyleToMaterial(mat, targetMode, isArmored);
        }
      }
    }
  }

  public getEffectiveSpec(catalogId: string): {
    hp: number;
    damage: number;
    speed: number;
    attackRange: number;
    attackCooldown: number;
    armor: number;
    scale: number;
    defaultAi: AIBehavior;
    traits: UnitTraits;
  } {
    const item = CATALOG_MAP.get(catalogId)!;
    const ov = this.speciesOverrides.get(catalogId);
    return {
      hp: ov?.hp ?? item.hp,
      damage: ov?.damage ?? item.damage,
      speed: ov?.speed ?? item.speed,
      attackRange: ov?.attackRange ?? item.attackRange,
      attackCooldown: ov?.attackCooldown ?? item.attackCooldown,
      armor: ov?.armor ?? (item.armor ?? 0),
      scale: ov?.scale ?? 1.0,
      defaultAi: ov?.defaultAi ?? 'aggressive',
      traits: {
        explosive: ov?.traits?.explosive ?? false,
        vampire: ov?.traits?.vampire ?? false,
        frenzy: ov?.traits?.frenzy ?? false,
        invincible: ov?.traits?.invincible ?? false,
      },
    };
  }

  public setSpeciesOverride(catalogId: string, patch: CharacterOverride): void {
    const cur = this.speciesOverrides.get(catalogId) ?? {};
    const merged: CharacterOverride = {
      ...cur,
      ...patch,
      traits: { ...(cur.traits ?? {}), ...(patch.traits ?? {}) },
    };
    this.speciesOverrides.set(catalogId, merged);
  }

  public resetSpeciesOverride(catalogId: string): void {
    this.speciesOverrides.delete(catalogId);
  }

  public applySpeciesOverrideToField(catalogId: string): number {
    const spec = this.getEffectiveSpec(catalogId);
    let updated = 0;
    for (const u of this.units) {
      if (!u.alive || u.catalog.id !== catalogId) continue;
      this.setUnitScale(u.id, spec.scale);
      const hpRatio = u.hp / Math.max(1, u.maxHp);
      u.maxHp = Math.round(spec.hp * u.hpMult * Math.pow(u.scale, 1.35));
      u.hp = Math.max(1, Math.round(u.maxHp * hpRatio));
      u.damage = spec.damage * u.dmgMult * Math.pow(u.scale, 0.75);
      u.speed = spec.speed * u.spdMult * (1 / Math.pow(u.scale, 0.18));
      u.attackRange = spec.attackRange;
      u.attackCooldown = spec.attackCooldown;
      u.armor = spec.armor;
      u.traits = { ...spec.traits };
      if (!u.catalog.isStructure || u.catalog.combatStyle === 'turret' || u.catalog.combatStyle === 'tesla') {
        u.ai = spec.defaultAi;
      }
      updated++;
    }
    return updated;
  }

  public purgeSpeciesFromField(catalogId: string): number {
    let removed = 0;
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].catalog.id === catalogId) {
        this.removeUnitAt(i);
        removed++;
      }
    }
    if (removed > 0) {
      this.syncFactionFlagsAfterRemoval();
      this.sound.playErase();
    }
    return removed;
  }

  private syncFactionFlagsAfterRemoval(): void {
    if (this.units.length === 0 || this.battleElapsed < 0.6) {
      this.hadRedFighters = false;
      this.hadBlueFighters = false;
      this.hadFfaFighters = 0;
      for (const u of this.units) {
        if (!u.alive) continue;
        if (
          u.catalog.isStructure &&
          u.catalog.combatStyle !== 'turret' &&
          u.catalog.combatStyle !== 'tesla' &&
          u.catalog.combatStyle !== 'spawner'
        ) {
          continue;
        }
        if (u.team === 'red') this.hadRedFighters = true;
        if (u.team === 'blue') this.hadBlueFighters = true;
        if (u.team === 'ffa') this.hadFfaFighters++;
      }
      this.victoryReported = false;
    }
  }

  public resolveTeam(setting: TeamSetting, x: number, item: CatalogItem): Team {
    if (
      item.combatStyle === 'explosive' ||
      item.combatStyle === 'jumppad' ||
      item.combatStyle === 'blackhole' ||
      item.id === 'rock' ||
      item.id === 'tree' ||
      item.id === 'viking_ship'
    ) {
      return 'neutral';
    }
    if (setting === 'auto') {
      return x < 0 ? 'red' : 'blue';
    }
    return setting;
  }

  public spawnUnit(
    catalogId: string,
    x: number,
    z: number,
    opts: {
      team: Team;
      ai: AIBehavior;
      scale: number;
      hpMult: number;
      dmgMult: number;
      spdMult: number;
      traits?: Partial<UnitTraits>;
      silent?: boolean;
      recordSnapshot?: boolean;
    }
  ): UnitEntity | null {
    const item = CATALOG_MAP.get(catalogId);
    if (!item) return null;

    const maxCap = this.arena.renderEngine.getMaxUnitCap();
    if (this.units.length >= maxCap) return null;

    const spec = this.getEffectiveSpec(catalogId);
    const clampedX = THREE.MathUtils.clamp(x, -ARENA_HALF_W + 1.1, ARENA_HALF_W - 1.1);
    const clampedZ = THREE.MathUtils.clamp(z, -ARENA_HALF_D + 1.1, ARENA_HALF_D - 1.1);
    const scale = THREE.MathUtils.clamp(opts.scale * spec.scale, 0.4, 3.8);
    const hpMult = THREE.MathUtils.clamp(opts.hpMult, 0.2, 6);
    const dmgMult = THREE.MathUtils.clamp(opts.dmgMult, 0.2, 6);
    const spdMult = THREE.MathUtils.clamp(opts.spdMult, 0.3, 3);

    const root = new THREE.Group();
    const flyY = item.flyHeight ?? 0;
    root.position.set(clampedX, flyY, clampedZ);
    const initialYaw =
      opts.team === 'red' ? Math.PI / 2 : opts.team === 'blue' ? -Math.PI / 2 : Math.random() * Math.PI * 2;
    root.rotation.y = initialYaw;

    const teamRingMat = new THREE.MeshBasicMaterial({
      color: TEAM_HEX[opts.team],
      transparent: true,
      opacity: opts.team === 'neutral' ? 0.32 : 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const teamRing = new THREE.Mesh(SHARED_RING_GEO, teamRingMat);
    teamRing.position.y = 0.04 - flyY;
    teamRing.scale.setScalar(Math.max(0.55, item.radius * scale * 1.15));
    root.add(teamRing);

    const hpBarGroup = new THREE.Group();
    hpBarGroup.position.y = item.targetHeight * scale + 0.55;
    hpBarGroup.visible = false;

    const hpBg = new THREE.Mesh(SHARED_HP_BG, SHARED_HP_BG_MAT);
    const hpFillMat = new THREE.MeshBasicMaterial({
      color: opts.team === 'red' ? 0xff2e1f : opts.team === 'blue' ? 0x2563eb : 0x10b981,
      side: THREE.DoubleSide,
    });
    const hpFillMesh = new THREE.Mesh(SHARED_HP_FILL, hpFillMat);
    hpFillMesh.position.z = 0.01;
    hpBarGroup.add(hpBg, hpFillMesh);
    root.add(hpBarGroup);

    let placeholder: THREE.Mesh | null = null;
    if (!this.models.isLoaded(item.modelFile)) {
      const pMat = new THREE.MeshStandardMaterial({ color: TEAM_HEX[opts.team], roughness: 0.5 });
      placeholder = new THREE.Mesh(SHARED_PLACEHOLDER_GEO, pMat);
      placeholder.position.y = item.targetHeight * scale * 0.5;
      placeholder.scale.setScalar(scale * (item.targetHeight / 1.8));
      root.add(placeholder);
    }

    this.arena.unitsGroup.add(root);

    const traits: UnitTraits = {
      explosive: opts.traits?.explosive ?? spec.traits.explosive,
      vampire: opts.traits?.vampire ?? spec.traits.vampire,
      frenzy: opts.traits?.frenzy ?? spec.traits.frenzy,
      invincible: opts.traits?.invincible ?? spec.traits.invincible,
    };

    const maxHp = Math.round(spec.hp * hpMult * Math.pow(scale, 1.35));
    const unit: UnitEntity = {
      id: this.nextId++,
      catalog: item,
      team: opts.team,
      ai:
        item.isStructure &&
        item.combatStyle !== 'turret' &&
        item.combatStyle !== 'tesla' &&
        item.combatStyle !== 'spawner'
          ? 'passive'
          : opts.ai,
      scale,
      hpMult,
      dmgMult,
      spdMult,
      maxHp,
      hp: maxHp,
      damage: spec.damage * dmgMult * Math.pow(scale, 0.75),
      speed: spec.speed * spdMult * (1 / Math.pow(scale, 0.18)),
      attackRange: spec.attackRange,
      attackCooldown: spec.attackCooldown,
      armor: spec.armor,
      traits,
      radius: item.radius * scale,
      mass: item.mass * Math.pow(scale, 2),
      kills: 0,
      x: clampedX,
      y: flyY,
      z: clampedZ,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: initialYaw,
      alive: true,
      dyingTimer: 0,
      fallenOff: false,
      attackTimer: item.combatStyle === 'spawner' ? 1.5 : Math.random() * 0.35,
      auraTimer: 0.4,
      slowTimer: 0,
      specialTimer: item.specialCooldown * (0.4 + Math.random() * 0.7),
      shieldTimer: 0,
      stunTimer: 0,
      fearTimer: 0,
      hasteTimer: 0,
      stampedeTimer: 0,
      stampedeTickTimer: 0,
      polymorphTimer: 0,
      polymorphOrigModel: null,
      polymorphOrigDamage: 0,
      polymorphOrigSpeed: 0,
      hitFlashTimer: 0,
      lungeTimer: 0,
      spawnPop: 0.15,
      phaseOffset: Math.random() * Math.PI * 2,
      rallyTarget: null,
      targetId: null,
      retargetTimer: 0,
      root,
      model: null,
      currentAnim: null,
      teamRing,
      teamRingMat,
      hpBarGroup,
      hpFillMesh,
      hpFillMat,
      shieldMesh: null,
      placeholder,
    };

    this.units.push(unit);
    this.unitMap.set(unit.id, unit);

    if (
      !item.isStructure ||
      item.combatStyle === 'turret' ||
      item.combatStyle === 'tesla' ||
      item.combatStyle === 'spawner'
    ) {
      if (unit.team === 'red') this.hadRedFighters = true;
      if (unit.team === 'blue') this.hadBlueFighters = true;
      if (unit.team === 'ffa') this.hadFfaFighters++;
      this.victoryReported = false;
    }

    if (!opts.silent) {
      this.sound.playSpawnPop(item.mass > 4 || scale > 1.5);
      this.vfx.spawnRing(clampedX, 0.08, clampedZ, TEAM_HEX[opts.team], 0.25, unit.radius * 1.9, 0.3);
    }

    this.models
      .instantiate(item, scale, this.worldSettings.renderStyle)
      .then((inst) => {
        if (!this.unitMap.has(unit.id)) {
          this.disposeInstantiatedModel(inst);
          return;
        }
        if (unit.placeholder) {
          unit.root.remove(unit.placeholder);
          (unit.placeholder.material as THREE.Material).dispose();
          unit.placeholder = null;
        }
        unit.model = inst;
        unit.root.add(inst.root);
        if (!unit.alive) this.setUnitAnim(unit, 'death');
        else this.setUnitAnim(unit, 'idle');
      })
      .catch((err) => {
        console.warn('[BattleEngine] Model instantiate failed:', item.id, err);
      });

    if (opts.recordSnapshot !== false && !this.snapshotLockedDuringFight) {
      this.captureSnapshot();
    }

    return unit;
  }

  public spawnWithConfig(x: number, z: number, cfg: SpawnConfig, mode: 'single' | 'brush' | 'squad'): number {
    const item = CATALOG_MAP.get(cfg.catalogId);
    if (!item) return 0;

    let spawned = 0;

    if (mode === 'single') {
      const team = this.resolveTeam(cfg.teamSetting, x, item);
      const count = item.swarmCount ?? 1;
      for (let i = 0; i < count; i++) {
        const ox = count === 1 ? 0 : (Math.random() - 0.5) * 1.2;
        const oz = count === 1 ? 0 : (Math.random() - 0.5) * 1.2;
        if (
          this.spawnUnit(cfg.catalogId, x + ox, z + oz, {
            team,
            ai: cfg.ai,
            scale: cfg.scale,
            hpMult: cfg.hpMult,
            dmgMult: cfg.dmgMult,
            spdMult: cfg.spdMult,
            silent: i > 0,
          })
        ) {
          spawned++;
        }
      }
      return spawned;
    }

    if (mode === 'squad') {
      const cols = Math.max(2, Math.min(7, Math.ceil(cfg.brushSize * 0.85)));
      const rows = Math.max(2, Math.min(6, Math.ceil(cfg.brushSize * 0.65)));
      const spacing = Math.max(1.35, item.radius * cfg.scale * 2.45);
      const team = this.resolveTeam(cfg.teamSetting, x, item);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ux = x + (c - (cols - 1) / 2) * spacing;
          const uz = z + (r - (rows - 1) / 2) * spacing;
          if (
            this.spawnUnit(cfg.catalogId, ux, uz, {
              team,
              ai: cfg.ai,
              scale: cfg.scale,
              hpMult: cfg.hpMult,
              dmgMult: cfg.dmgMult,
              spdMult: cfg.spdMult,
              silent: spawned > 0,
              recordSnapshot: false,
            })
          ) {
            spawned++;
          }
        }
      }
      if (spawned > 0 && !this.snapshotLockedDuringFight) this.captureSnapshot();
      return spawned;
    }

    const brushRadius = 0.9 + cfg.brushSize * 0.72;
    const baseCount = item.isStructure ? 1 : Math.max(1, Math.round(cfg.brushSize * 0.55 * (item.swarmCount ?? 1)));
    const minDist = Math.max(0.85, item.radius * cfg.scale * 1.6);

    for (let i = 0; i < baseCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = baseCount === 1 ? 0 : Math.sqrt(Math.random()) * brushRadius;
      const ux = x + Math.cos(angle) * r;
      const uz = z + Math.sin(angle) * r;

      let crowded = false;
      for (let j = 0; j < this.units.length; j++) {
        const other = this.units[j];
        if (!other.alive) continue;
        const d2 = (other.x - ux) ** 2 + (other.z - uz) ** 2;
        if (d2 < minDist * minDist * 0.65) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;

      const team = this.resolveTeam(cfg.teamSetting, ux, item);
      if (
        this.spawnUnit(cfg.catalogId, ux, uz, {
          team,
          ai: cfg.ai,
          scale: cfg.scale,
          hpMult: cfg.hpMult,
          dmgMult: cfg.dmgMult,
          spdMult: cfg.spdMult,
          silent: spawned > 0,
          recordSnapshot: false,
        })
      ) {
        spawned++;
      }
    }
    if (spawned > 0 && !this.snapshotLockedDuringFight) this.captureSnapshot();
    return spawned;
  }

  public eraseAt(x: number, z: number, radius: number): number {
    let removed = 0;
    const r2 = radius * radius;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const dx = u.x - x;
      const dz = u.z - z;
      if (dx * dx + dz * dz <= r2 + u.radius * u.radius) {
        this.removeUnitAt(i);
        removed++;
      }
    }
    if (removed > 0) {
      this.syncFactionFlagsAfterRemoval();
      this.sound.playErase();
      if (!this.snapshotLockedDuringFight) this.captureSnapshot();
    }
    return removed;
  }

  public selectUnitAt(x: number, z: number): UnitEntity | null {
    let best: UnitEntity | null = null;
    let bestD2 = 10;
    for (const u of this.units) {
      if (!u.alive) continue;
      const d2 = (u.x - x) ** 2 + (u.z - z) ** 2;
      const hitR = Math.max(1.4, u.radius * 1.45);
      if (d2 <= hitR * hitR && d2 < bestD2) {
        bestD2 = d2;
        best = u;
      }
    }
    this.selectedUnitId = best ? best.id : null;
    this.onSelectionChange?.(best);
    if (best) this.sound.playUiClick(740);
    return best;
  }

  public getSelectedUnit(): UnitEntity | null {
    if (this.selectedUnitId === null) return null;
    const u = this.unitMap.get(this.selectedUnitId) ?? null;
    if (!u || !u.alive) {
      this.selectedUnitId = null;
      return null;
    }
    return u;
  }

  public toggleFollowUnit(unitId: number): boolean {
    if (this.followUnitId === unitId) {
      this.followUnitId = null;
      this.arena.setFollowPoint(null);
      return false;
    }
    this.followUnitId = unitId;
    return true;
  }

  public setUnitBehavior(unitId: number, ai: AIBehavior): void {
    const u = this.unitMap.get(unitId);
    if (!u) return;
    u.ai = ai;
    if (ai === 'passive') u.targetId = null;
  }

  public setUnitTeam(unitId: number, team: Team): void {
    const u = this.unitMap.get(unitId);
    if (!u) return;
    u.team = team;
    u.targetId = null;
    u.teamRingMat.color.setHex(TEAM_HEX[team]);
    u.hpFillMat.color.setHex(TEAM_HEX[team]);
    if (team === 'red') this.hadRedFighters = true;
    else if (team === 'blue') this.hadBlueFighters = true;
    else if (team === 'ffa') this.hadFfaFighters++;
    this.victoryReported = false;
  }

  public setUnitScale(unitId: number, newScale: number): void {
    const u = this.unitMap.get(unitId);
    if (!u) return;
    const clamped = THREE.MathUtils.clamp(newScale, 0.4, 3.8);
    const ratio = clamped / u.scale;
    const spec = this.getEffectiveSpec(u.catalog.id);
    u.scale = clamped;
    u.radius = u.catalog.radius * clamped;
    u.mass = u.catalog.mass * Math.pow(clamped, 2);
    u.maxHp = Math.round(spec.hp * u.hpMult * Math.pow(clamped, 1.35));
    u.hp = Math.min(u.maxHp, Math.max(1, Math.round(u.hp * Math.pow(ratio, 1.35))));
    u.damage = spec.damage * u.dmgMult * Math.pow(clamped, 0.75);
    u.speed = spec.speed * u.spdMult * (1 / Math.pow(clamped, 0.18));
    u.teamRing.scale.setScalar(Math.max(0.55, u.radius * 1.15));
    u.hpBarGroup.position.y = u.catalog.targetHeight * clamped + 0.55;
    if (u.shieldMesh) {
      u.shieldMesh.scale.multiplyScalar(ratio);
      u.shieldMesh.position.y = u.catalog.targetHeight * clamped * 0.5;
    }
    if (u.placeholder) {
      u.placeholder.scale.multiplyScalar(ratio);
      u.placeholder.position.y = u.catalog.targetHeight * clamped * 0.5;
    }
    if (u.model) {
      u.model.visual.scale.multiplyScalar(ratio);
      u.model.visual.position.y *= ratio;
    }
  }

  public setUnitTrait(unitId: number, trait: keyof UnitTraits, val: boolean): void {
    const u = this.unitMap.get(unitId);
    if (!u) return;
    u.traits[trait] = val;
  }

  public setUnitStat(unitId: number, stat: 'hp' | 'damage' | 'speed', value: number): void {
    const u = this.unitMap.get(unitId);
    if (!u) return;
    if (stat === 'hp') {
      u.maxHp = Math.max(10, Math.round(value));
      u.hp = Math.min(u.maxHp, u.hp > 0 ? u.maxHp : u.hp);
      this.updateHpBar(u);
    } else if (stat === 'damage') {
      u.damage = Math.max(0, value);
    } else if (stat === 'speed') {
      u.speed = Math.max(0, value);
    }
  }

  public healUnit(unitId: number): void {
    const u = this.unitMap.get(unitId);
    if (!u || !u.alive) return;
    u.hp = u.maxHp;
    u.hpBarGroup.visible = false;
    this.vfx.spawnRing(u.x, 0.12, u.z, 0x10b981, 0.3, u.radius * 2.2, 0.38);
    this.sound.playShoot('heal');
  }

  public cloneUnit(unitId: number): UnitEntity | null {
    const u = this.unitMap.get(unitId);
    if (!u || !u.alive) return null;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.max(1.5, u.radius * 2.2);
    return this.spawnUnit(u.catalog.id, u.x + Math.cos(angle) * dist, u.z + Math.sin(angle) * dist, {
      team: u.team,
      ai: u.ai,
      scale: u.scale / this.getEffectiveSpec(u.catalog.id).scale,
      hpMult: u.hpMult,
      dmgMult: u.dmgMult,
      spdMult: u.spdMult,
      traits: { ...u.traits },
    });
  }

  public deleteUnit(unitId: number): void {
    const idx = this.units.findIndex((u) => u.id === unitId);
    if (idx !== -1) {
      this.removeUnitAt(idx);
      this.syncFactionFlagsAfterRemoval();
      this.sound.playErase();
    }
  }

  public issueTeamOrder(team: 'red' | 'blue', ai: AIBehavior): void {
    this.lastTeamOrder[team] = ai;
    for (const u of this.units) {
      if (!u.alive || u.team !== team) continue;
      if (
        u.catalog.isStructure &&
        u.catalog.combatStyle !== 'turret' &&
        u.catalog.combatStyle !== 'tesla' &&
        u.catalog.combatStyle !== 'spawner'
      ) {
        continue;
      }
      u.ai = ai;
      if (ai === 'passive') {
        u.targetId = null;
        u.rallyTarget = null;
      }
    }
    this.sound.playUiClick(520);
  }

  public issueRallyPoint(x: number, z: number, teamSetting: TeamSetting): 'red' | 'blue' | 'all' {
    const targetTeam = teamSetting === 'red' ? 'red' : teamSetting === 'blue' ? 'blue' : 'all';
    const color = targetTeam === 'red' ? 0xff2e1f : targetTeam === 'blue' ? 0x2563eb : 0x10b981;
    this.vfx.spawnRallyBeacon(x, z, color);
    this.sound.playUiClick(680);

    for (const u of this.units) {
      if (!u.alive || u.catalog.isStructure) continue;
      if (targetTeam !== 'all' && u.team !== targetTeam) continue;
      if (u.ai === 'passive') continue;
      u.rallyTarget = {
        x: x + (Math.random() - 0.5) * 3.5,
        z: z + (Math.random() - 0.5) * 3.5,
      };
    }
    return targetTeam;
  }

  public captureSnapshot(): void {
    const snap: UnitSnapshot[] = [];
    for (const u of this.units) {
      if (!u.alive) continue;
      snap.push({
        catalogId: u.catalog.id,
        team: u.team,
        ai: u.ai,
        x: u.x,
        z: u.z,
        scale: u.scale / this.getEffectiveSpec(u.catalog.id).scale,
        hpMult: u.hpMult,
        dmgMult: u.dmgMult,
        spdMult: u.spdMult,
        traits: { ...u.traits },
      });
    }
    if (snap.length > 0) this.savedSnapshot = snap;
  }

  public hasSnapshot(): boolean {
    return this.savedSnapshot.length > 0;
  }

  public rewindToSnapshot(): boolean {
    if (this.savedSnapshot.length === 0) return false;
    const copy = this.savedSnapshot.map((s) => ({ ...s, traits: s.traits ? { ...s.traits } : undefined }));
    this.clearArena(false);
    for (const s of copy) {
      this.spawnUnit(s.catalogId, s.x, s.z, {
        team: s.team,
        ai: s.ai,
        scale: s.scale,
        hpMult: s.hpMult,
        dmgMult: s.dmgMult,
        spdMult: s.spdMult,
        traits: s.traits,
        silent: true,
        recordSnapshot: false,
      });
    }
    this.savedSnapshot = copy;
    this.snapshotLockedDuringFight = false;
    this.sound.playUiClick(580);
    return true;
  }

  public loadSnapshotUnits(units: UnitSnapshot[], autoStart: boolean): void {
    this.clearArena(true);
    for (const s of units) {
      this.spawnUnit(s.catalogId, s.x, s.z, {
        team: s.team,
        ai: s.ai,
        scale: s.scale,
        hpMult: s.hpMult,
        dmgMult: s.dmgMult,
        spdMult: s.spdMult,
        traits: s.traits,
        silent: true,
        recordSnapshot: false,
      });
    }
    this.savedSnapshot = units.map((s) => ({ ...s }));
    this.snapshotLockedDuringFight = false;
    this.lastTeamOrder.red = 'aggressive';
    this.lastTeamOrder.blue = 'aggressive';
    this.running = autoStart;
    this.sound.playUiClick(640);
  }

  public clearArena(wipeSnapshot = true): void {
    for (let i = this.units.length - 1; i >= 0; i--) {
      this.removeUnitAt(i);
    }
    for (const vz of this.venomZones) {
      this.arena.vfxGroup.remove(vz.mesh);
      vz.mat.dispose();
    }
    this.venomZones.length = 0;
    this.vfx.clearAll();
    this.totalKills = 0;
    this.battleElapsed = 0;
    this.hadRedFighters = false;
    this.hadBlueFighters = false;
    this.hadFfaFighters = 0;
    this.victoryReported = false;
    this.snapshotLockedDuringFight = false;
    this.lastTeamOrder.red = 'aggressive';
    this.lastTeamOrder.blue = 'aggressive';
    this.selectedUnitId = null;
    this.followUnitId = null;
    this.arena.setFollowPoint(null);
    this.onSelectionChange?.(null);
    if (wipeSnapshot) this.savedSnapshot = [];
  }

  private removeUnitAt(index: number): void {
    const u = this.units[index];
    if (this.selectedUnitId === u.id) {
      this.selectedUnitId = null;
      this.onSelectionChange?.(null);
    }
    if (this.followUnitId === u.id) {
      this.followUnitId = null;
      this.arena.setFollowPoint(null);
    }
    this.arena.unitsGroup.remove(u.root);
    u.teamRingMat.dispose();
    u.hpFillMat.dispose();
    if (u.placeholder) (u.placeholder.material as THREE.Material).dispose();
    if (u.shieldMesh) {
      u.root.remove(u.shieldMesh);
      (u.shieldMesh.material as THREE.Material).dispose();
    }
    if (u.model) this.disposeInstantiatedModel(u.model);
    if (u.polymorphOrigModel) this.disposeInstantiatedModel(u.polymorphOrigModel);
    this.unitMap.delete(u.id);
    this.units.splice(index, 1);
  }

  private disposeInstantiatedModel(inst: InstantiatedModel): void {
    inst.mixer?.stopAllAction();
    for (const m of inst.disposeMaterials) m.dispose();
  }

  private isHostile(a: UnitEntity, b: UnitEntity): boolean {
    if (a.id === b.id || !b.alive) return false;
    if (a.team === 'neutral' || b.team === 'neutral') return false;
    if (a.team === 'ffa' || b.team === 'ffa') {
      return true;
    }
    return a.team !== b.team;
  }

  private setUnitAnim(u: UnitEntity, next: AnimKey): void {
    if (!u.model || !u.model.hasSkeletalAnims) return;
    if (u.currentAnim === next && next !== 'attack') return;

    const action = u.model.actions[next] ?? (next === 'move' ? u.model.actions.idle : undefined);
    if (!action) return;

    if (next === 'attack') {
      action.reset();
      action.setEffectiveTimeScale(u.traits.frenzy ? 2.1 : 1.25);
      action.fadeIn(0.08).play();
      u.currentAnim = 'attack';
      return;
    }

    const prev = u.currentAnim ? u.model.actions[u.currentAnim] : undefined;
    if (prev && prev !== action) prev.fadeOut(0.16);
    action.reset().fadeIn(0.16).play();
    u.currentAnim = next;
  }

  public update(rawDt: number): void {
    this.fpsFrames++;
    this.fpsAccum += rawDt;
    if (this.fpsAccum >= 0.4) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsFrames = 0;
      this.fpsAccum = 0;
    }

    const clampedRaw = Math.min(rawDt, 0.05);
    const simDt = this.running ? clampedRaw * this.timeScale : 0;

    const sel = this.getSelectedUnit();
    this.arena.updateSelectionRing(sel ? new THREE.Vector3(sel.x, 0, sel.z) : null, sel?.radius ?? 1);

    if (this.followUnitId !== null) {
      const fUnit = this.unitMap.get(this.followUnitId);
      if (fUnit && fUnit.alive) {
        this.arena.setFollowPoint(new THREE.Vector3(fUnit.x, fUnit.y + 1, fUnit.z));
      } else {
        this.followUnitId = null;
        this.arena.setFollowPoint(null);
      }
    }

    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.spawnPop < 1) {
        u.spawnPop = Math.min(1, u.spawnPop + clampedRaw * 5.8);
        const overshoot = 1 + Math.sin(u.spawnPop * Math.PI) * 0.14;
        u.root.scale.setScalar(u.spawnPop < 1 ? u.spawnPop * overshoot : 1);
      } else {
        u.root.scale.setScalar(1);
      }

      if (u.model && !u.catalog.modelFile) {
        u.model.visual.traverse((child) => {
          if (child.name === 'spin_ring') child.rotation.y += clampedRaw * 2.4;
          if (child.name === 'spin_ring_2') child.rotation.z -= clampedRaw * 1.8;
          if (child.name === 'pulse_led') {
            const p = 0.75 + Math.sin(performance.now() * 0.008 + u.phaseOffset) * 0.3;
            child.scale.setScalar(p);
          }
        });
      }

      if (u.hitFlashTimer > 0) {
        u.hitFlashTimer = Math.max(0, u.hitFlashTimer - clampedRaw);
        this.applyHitFlash(u, u.hitFlashTimer > 0 ? u.hitFlashTimer / 0.12 : 0);
      }

      if (u.hpBarGroup.visible) {
        u.hpBarGroup.lookAt(this.arena.camera.position);
      }

      if (!this.running && u.alive && u.model?.mixer) {
        u.model.mixer.update(clampedRaw * 0.35);
      }
    }

    if (!this.running || simDt <= 0) {
      this.vfx.updateEffects(clampedRaw * 0.35);
      return;
    }

    this.battleElapsed += simDt;

    this.grid.clear();
    for (let i = 0; i < this.units.length; i++) {
      if (this.units[i].alive) this.grid.insert(this.units[i]);
    }

    this.updatePhysicsToys(simDt);
    this.updateVenomZones(simDt);
    this.updateUnits(simDt);
    this.updateProjectiles(simDt);
    this.vfx.updateEffects(simDt);
    this.checkVictory();
  }

  private updateVenomZones(dt: number): void {
    for (let i = this.venomZones.length - 1; i >= 0; i--) {
      const vz = this.venomZones[i];
      vz.life -= dt;
      vz.tickTimer -= dt;
      vz.mesh.rotation.z += dt * 0.7;
      vz.mat.opacity = Math.min(0.45, vz.life * 0.25);

      if (vz.tickTimer <= 0) {
        vz.tickTimer = 0.45;
        const owner = this.unitMap.get(vz.ownerId) ?? null;
        this.grid.queryRadius(vz.x, vz.z, vz.radius, this.queryBuf);
        const venomVictims = this.queryBuf.slice();
        for (let j = 0; j < venomVictims.length; j++) {
          const vic = venomVictims[j];
          if (!vic.alive || vic.catalog.isStructure) continue;
          if (!this.worldSettings.friendlyFire && vic.team === vz.team && vz.team !== 'ffa') continue;
          vic.slowTimer = Math.max(vic.slowTimer, 0.55);
          this.applyDamage(vic, vz.damagePerSec * 0.45, owner, 0, 0, 0);
        }
      }

      if (vz.life <= 0) {
        this.arena.vfxGroup.remove(vz.mesh);
        vz.mat.dispose();
        this.venomZones.splice(i, 1);
      }
    }
  }

  public triggerUnitSpecial(unitId: number): boolean {
    const u = this.unitMap.get(unitId);
    if (!u || !u.alive || u.polymorphTimer > 0) return false;
    if (u.catalog.specialAbility === 'none') return false;
    const target = this.findNearestHostile(u, Math.max(u.attackRange * 1.4, 22));
    return this.executeSpecialAbility(u, target);
  }

  private executeSpecialAbility(caster: UnitEntity, target: UnitEntity | null): boolean {
    const ab = caster.catalog.specialAbility;
    if (ab === 'none' || caster.polymorphTimer > 0) return false;

    const muzzle = new THREE.Vector3(
      caster.x,
      caster.y + caster.catalog.targetHeight * caster.scale * 0.65,
      caster.z
    );

    switch (ab) {
      case 'polymorph': {
        if (!target || target.catalog.isStructure || target.polymorphTimer > 0 || target.catalog.mass > 18) return false;
        this.polymorphTarget(caster, target);
        break;
      }
      case 'divine_smite': {
        if (!target) return false;
        this.grid.queryRadius(target.x, target.z, 9.5, this.queryBuf);
        const victims = this.queryBuf.filter((c) => this.isHostile(caster, c)).slice(0, 3);
        if (victims.length === 0) victims.push(target);
        for (const vic of victims) {
          const sky = new THREE.Vector3(vic.x, 28, vic.z);
          const ground = new THREE.Vector3(vic.x, 0.3, vic.z);
          this.vfx.spawnLightning([sky, ground], 0xfbbf24);
          this.vfx.spawnExplosion(vic.x, 0.4, vic.z, 4.5);
          this.grid.queryRadius(vic.x, vic.z, 4.5, this.queryBuf);
          const splashTargets = this.queryBuf.slice();
          for (const splash of splashTargets) {
            if (!this.isHostile(caster, splash)) continue;
            const dx = splash.x - vic.x;
            const dz = splash.z - vic.z;
            const d = Math.max(0.2, Math.hypot(dx, dz));
            this.applyDamage(splash, caster.damage * 1.35, caster, (dx / d) * 12, 9, (dz / d) * 12);
          }
        }
        this.arena.addShake(0.65);
        this.sound.playExplosion(true);
        break;
      }
      case 'necromancy': {
        const rs = this.worldSettings.renderStyle;
        const summonId =
          rs === 'pixel' ? 'voxel_zombie' : rs === 'ultra' || rs === 'manga' ? 'myth_revenant' : 'skeleton_minion';
        for (let k = 0; k < 2; k++) {
          const ang = Math.random() * Math.PI * 2;
          const sx = caster.x + Math.cos(ang) * (caster.radius + 1.8);
          const sz = caster.z + Math.sin(ang) * (caster.radius + 1.8);
          const summoned = this.spawnUnit(summonId, sx, sz, {
            team: caster.team,
            ai: 'aggressive',
            scale: 0.95,
            hpMult: 1,
            dmgMult: 1,
            spdMult: 1,
            silent: true,
            recordSnapshot: false,
          });
          if (summoned) {
            this.vfx.spawnRing(sx, 0.14, sz, 0xa855f7, 0.3, 2.4, 0.5);
          }
        }
        this.sound.playShoot('lightning');
        break;
      }
      case 'fire_breath': {
        if (!target) return false;
        const baseYaw = Math.atan2(target.x - caster.x, target.z - caster.z);
        const kind = caster.catalog.projectileKind === 'plasma' ? 'plasma' : 'fireball';
        for (let s = -2; s <= 2; s++) {
          const ang = baseYaw + s * 0.16;
          const aim = new THREE.Vector3(caster.x + Math.sin(ang) * 14, 0.6, caster.z + Math.cos(ang) * 14);
          this.vfx.spawnProjectile({
            kind,
            team: caster.team,
            ownerId: caster.id,
            from: muzzle,
            to: aim,
            damage: caster.damage * 0.65,
            splashRadius: 2.8,
            knockback: 6.5,
          });
        }
        this.sound.playExplosion(false);
        this.setUnitAnim(caster, 'attack');
        break;
      }
      case 'apex_roar': {
        const roarR = 11.5 * Math.pow(caster.scale, 0.4);
        this.vfx.spawnRing(caster.x, 0.25, caster.z, 0xf97316, 0.6, roarR, 0.55);
        this.arena.addShake(0.45);
        this.sound.playExplosion(false);
        this.grid.queryRadius(caster.x, caster.z, roarR, this.queryBuf);
        for (const vic of this.queryBuf) {
          if (!this.isHostile(caster, vic) || vic.catalog.isStructure) continue;
          if (vic.mass < caster.mass * 0.7) {
            vic.fearTimer = 2.8;
            const dx = vic.x - caster.x;
            const dz = vic.z - caster.z;
            const d = Math.max(0.2, Math.hypot(dx, dz));
            vic.vx += (dx / d) * 6;
            vic.vz += (dz / d) * 6;
          }
        }
        break;
      }
      case 'shield_wall': {
        caster.shieldTimer = 3.5;
        if (!caster.shieldMesh) {
          const smat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.28,
            wireframe: true,
          });
          caster.shieldMesh = new THREE.Mesh(
            new THREE.IcosahedronGeometry(Math.max(1.0, caster.radius * 1.45), 1),
            smat
          );
          caster.shieldMesh.position.y = caster.catalog.targetHeight * caster.scale * 0.5;
          caster.root.add(caster.shieldMesh);
        }
        caster.shieldMesh.visible = true;
        this.vfx.spawnRing(caster.x, 0.16, caster.z, 0x38bdf8, 0.4, caster.radius * 2.5, 0.4);
        this.sound.playUiClick(780);
        break;
      }
      case 'berserk_leap': {
        if (!target) return false;
        const dx = target.x - caster.x;
        const dz = target.z - caster.z;
        const dist = Math.max(1, Math.hypot(dx, dz));
        const jumpDist = Math.min(11, dist);
        caster.vx = (dx / dist) * jumpDist * 1.5;
        caster.vz = (dz / dist) * jumpDist * 1.5;
        caster.vy = 11.5;
        this.vfx.spawnRing(caster.x, 0.14, caster.z, 0xff453a, 0.4, 3.2, 0.35);
        this.sound.playJumpPad();
        break;
      }
      case 'shadow_blink': {
        if (!target) return false;
        this.vfx.spawnBurst(caster.x, 1.0, caster.z, 0xec4899, 8, 5);
        const behindAngle = target.yaw + Math.PI;
        caster.x = THREE.MathUtils.clamp(target.x + Math.sin(behindAngle) * (target.radius + 1.1), -ARENA_HALF_W + 1.5, ARENA_HALF_W - 1.5);
        caster.z = THREE.MathUtils.clamp(target.z + Math.cos(behindAngle) * (target.radius + 1.1), -ARENA_HALF_D + 1.5, ARENA_HALF_D - 1.5);
        this.vfx.spawnRing(caster.x, 0.15, caster.z, 0xec4899, 0.3, 2.2, 0.32);
        this.applyDamage(target, caster.damage * 2.2, caster, 0, 3, 0);
        this.sound.playShoot('laser');
        break;
      }
      case 'stampede': {
        caster.stampedeTimer = 2.2;
        this.vfx.spawnRing(caster.x, 0.14, caster.z, 0xeab308, 0.5, caster.radius * 2.8, 0.35);
        this.sound.playJumpPad();
        break;
      }
      case 'barrage': {
        if (!target) return false;
        const pKind = caster.catalog.projectileKind ?? 'shell';
        for (let b = 0; b < 3; b++) {
          const aim = new THREE.Vector3(
            target.x + (Math.random() - 0.5) * 3.8,
            0.5,
            target.z + (Math.random() - 0.5) * 3.8
          );
          this.vfx.spawnProjectile({
            kind: pKind,
            team: caster.team,
            ownerId: caster.id,
            from: muzzle,
            to: aim,
            damage: caster.damage * 0.78,
            splashRadius: Math.max(2.2, (caster.catalog.splashRadius ?? 0) * 0.85),
            knockback: (caster.catalog.knockback ?? 4) * 0.8,
          });
        }
        this.sound.playShoot(pKind);
        break;
      }
      case 'emp_pulse': {
        const empR = 10.0;
        this.vfx.spawnRing(caster.x, 0.3, caster.z, 0x38bdf8, 0.5, empR, 0.45);
        this.sound.playShoot('lightning');
        this.grid.queryRadius(caster.x, caster.z, empR, this.queryBuf);
        const empTargets = this.queryBuf.slice();
        for (const vic of empTargets) {
          if (!this.isHostile(caster, vic) || vic.catalog.isStructure) continue;
          vic.stunTimer = 2.2;
          this.applyDamage(vic, caster.damage * 0.5, caster, 0, 0, 0);
        }
        break;
      }
      case 'venom_cloud': {
        const cx = target ? (caster.x + target.x) * 0.5 : caster.x;
        const cz = target ? (caster.z + target.z) * 0.5 : caster.z;
        const vRad = 4.2;
        const mat = new THREE.MeshBasicMaterial({
          color: 0x22c55e,
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(vRad, 24), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(cx, 0.08, cz);
        this.arena.vfxGroup.add(mesh);
        this.venomZones.push({
          x: cx,
          z: cz,
          radius: vRad,
          team: caster.team,
          ownerId: caster.id,
          damagePerSec: Math.max(12, caster.damage * 0.6),
          life: 4.2,
          tickTimer: 0.1,
          mesh,
          mat,
        });
        this.sound.playShoot('darkbolt');
        break;
      }
      case 'pack_howl': {
        const r = 9.5;
        this.vfx.spawnRing(caster.x, 0.2, caster.z, 0xfbbf24, 0.4, r, 0.48);
        this.grid.queryRadius(caster.x, caster.z, r, this.queryBuf);
        for (const ally of this.queryBuf) {
          if (ally.alive && ally.team === caster.team && !ally.catalog.isStructure) {
            ally.hasteTimer = 4.2;
          }
        }
        this.sound.playUiClick(820);
        break;
      }
      case 'heal_nova': {
        const r = 9.0;
        this.vfx.spawnRing(caster.x, 0.2, caster.z, 0x10b981, 0.5, r, 0.5);
        this.grid.queryRadius(caster.x, caster.z, r, this.queryBuf);
        for (const ally of this.queryBuf) {
          if (ally.alive && ally.team === caster.team && !ally.catalog.isStructure) {
            ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * 0.35);
            this.updateHpBar(ally);
          }
        }
        this.sound.playShoot('heal');
        break;
      }
    }

    caster.specialTimer = caster.catalog.specialCooldown * (0.85 + Math.random() * 0.45);
    this.onAbilityCast?.(caster, ab);
    return true;
  }

  private polymorphTarget(caster: UnitEntity, target: UnitEntity): void {
    const frogCatalog = CATALOG_MAP.get('frog');
    if (!frogCatalog) return;

    const from = new THREE.Vector3(caster.x, caster.y + 1.4, caster.z);
    const to = new THREE.Vector3(target.x, target.y + 1.0, target.z);
    this.vfx.spawnLightning([from, to], 0xc084fc);
    this.vfx.spawnRing(target.x, 0.2, target.z, 0xc084fc, 0.3, 2.5, 0.45);
    this.vfx.spawnBurst(target.x, 1.0, target.z, 0xc084fc, 10, 6);
    this.sound.playShoot('lightning');

    target.polymorphTimer = 5.5;
    target.polymorphOrigDamage = target.damage;
    target.polymorphOrigSpeed = target.speed;
    target.damage = 3;
    target.speed = 3.2;
    target.fearTimer = 5.5;

    // Live 3D body swap into the animated Frog model (or 100% blocky Voxel Frog in Voxel 3D mode)!
    if (target.model && !target.polymorphOrigModel) {
      target.polymorphOrigModel = target.model;
      target.model.root.visible = false;
      const morphCatalog: CatalogItem =
        this.worldSettings.renderStyle === 'pixel'
          ? { ...frogCatalog, modelFile: null, proceduralKind: 'voxel_frog' }
          : frogCatalog;
      this.models
        .instantiate(morphCatalog, 1.0, this.worldSettings.renderStyle)
        .then((frogInst) => {
          if (!this.unitMap.has(target.id) || target.polymorphTimer <= 0) {
            this.disposeInstantiatedModel(frogInst);
            return;
          }
          target.model = frogInst;
          target.root.add(frogInst.root);
          this.setUnitAnim(target, 'move');
        })
        .catch(() => {});
    }
  }

  private revertPolymorph(u: UnitEntity): void {
    u.polymorphTimer = 0;
    u.damage = u.polymorphOrigDamage || u.damage;
    u.speed = u.polymorphOrigSpeed || u.speed;
    u.fearTimer = 0;
    if (u.polymorphOrigModel) {
      if (u.model && u.model !== u.polymorphOrigModel) {
        u.root.remove(u.model.root);
        this.disposeInstantiatedModel(u.model);
      }
      u.model = u.polymorphOrigModel;
      u.model.root.visible = true;
      u.polymorphOrigModel = null;
      this.vfx.spawnRing(u.x, 0.16, u.z, 0xc084fc, 0.3, 2.2, 0.35);
    }
  }

  private updatePhysicsToys(dt: number): void {
    for (let i = 0; i < this.units.length; i++) {
      const toy = this.units[i];
      if (!toy.alive) continue;
      const style = toy.catalog.combatStyle;

      if (style === 'blackhole') {
        const pullRadius = toy.attackRange * toy.scale;
        this.grid.queryRadius(toy.x, toy.z, pullRadius, this.queryBuf);
        for (let j = 0; j < this.queryBuf.length; j++) {
          const u = this.queryBuf[j];
          if (u.id === toy.id || !u.alive || u.catalog.isStructure) continue;
          const dx = toy.x - u.x;
          const dz = toy.z - u.z;
          const dist = Math.max(0.6, Math.hypot(dx, dz));
          const strength = (38 * toy.scale) / (dist + 1.4);
          const nx = dx / dist;
          const nz = dz / dist;
          u.vx += (nx * strength - nz * strength * 0.45) * dt;
          u.vz += (nz * strength + nx * strength * 0.45) * dt;
          if (dist < 2.2 * toy.scale) {
            u.vy += 9 * dt;
            if (toy.auraTimer <= 0) this.applyDamage(u, toy.damage, toy, 0, 0, 0);
          }
        }
        for (let pIdx = 0; pIdx < this.vfx.projectiles.length; pIdx++) {
          const p = this.vfx.projectiles[pIdx];
          const dx = toy.x - p.x;
          const dz = toy.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist < pullRadius && dist > 0.5) {
            const f = 55 / (dist + 1);
            p.vx += (dx / dist) * f * dt;
            p.vz += (dz / dist) * f * dt;
          }
        }
        toy.auraTimer -= dt;
        if (toy.auraTimer <= 0) {
          toy.auraTimer = 0.28;
          this.vfx.spawnRing(toy.x, 0.25, toy.z, 0xa855f7, pullRadius * 0.45, 0.4, 0.45);
        }
      } else if (style === 'jumppad') {
        const triggerR = toy.attackRange * toy.scale;
        this.grid.queryRadius(toy.x, toy.z, triggerR, this.queryBuf);
        for (let j = 0; j < this.queryBuf.length; j++) {
          const u = this.queryBuf[j];
          if (u.id === toy.id || !u.alive || u.catalog.isStructure) continue;
          if (u.y <= (u.catalog.flyHeight ?? 0) + 0.35 && u.vy < 4) {
            const dirX = u.team === 'red' ? 1 : u.team === 'blue' ? -1 : u.x < 0 ? 1 : -1;
            u.vx += dirX * (13 + Math.random() * 4);
            u.vz += (Math.random() - 0.5) * 6;
            u.vy = 15.5 * Math.min(1.4, toy.scale);
            this.vfx.spawnRing(toy.x, 0.25, toy.z, 0x06b6d4, 0.5, 2.8, 0.35);
            this.sound.playJumpPad();
          }
        }
      } else if (style === 'mine') {
        const triggerR = toy.attackRange * toy.scale;
        this.grid.queryRadius(toy.x, toy.z, triggerR, this.queryBuf);
        let triggered = false;
        for (let j = 0; j < this.queryBuf.length; j++) {
          const u = this.queryBuf[j];
          if (u.id === toy.id || !u.alive || u.catalog.isStructure) continue;
          if (toy.team !== 'neutral' && u.team === toy.team) continue;
          triggered = true;
          break;
        }
        if (triggered) this.detonateUnit(toy);
      } else if (style === 'cryo') {
        toy.auraTimer -= dt;
        const r = toy.attackRange * toy.scale;
        this.grid.queryRadius(toy.x, toy.z, r, this.queryBuf);
        for (let j = 0; j < this.queryBuf.length; j++) {
          const u = this.queryBuf[j];
          if (!u.alive || u.id === toy.id || u.catalog.isStructure) continue;
          if (toy.team !== 'neutral' && u.team === toy.team) continue;
          u.slowTimer = 0.7;
          if (toy.auraTimer <= 0) {
            this.applyDamage(u, toy.damage, toy, 0, 0, 0);
          }
        }
        if (toy.auraTimer <= 0) {
          toy.auraTimer = 0.65;
          this.vfx.spawnRing(toy.x, 0.14, toy.z, 0x38bdf8, 0.5, r * 0.9, 0.55);
        }
      } else if (style === 'healtotem') {
        toy.auraTimer -= dt;
        if (toy.auraTimer <= 0) {
          toy.auraTimer = toy.attackCooldown;
          const r = toy.attackRange * toy.scale;
          this.grid.queryRadius(toy.x, toy.z, r, this.queryBuf);
          let healedAny = false;
          for (let j = 0; j < this.queryBuf.length; j++) {
            const ally = this.queryBuf[j];
            if (!ally.alive || ally.id === toy.id || ally.catalog.isStructure) continue;
            if (toy.team !== 'neutral' && ally.team !== toy.team) continue;
            if (ally.hp < ally.maxHp) {
              ally.hp = Math.min(ally.maxHp, ally.hp + toy.damage);
              this.updateHpBar(ally);
              healedAny = true;
            }
          }
          if (healedAny) this.vfx.spawnRing(toy.x, 0.14, toy.z, 0x10b981, 0.6, r * 0.85, 0.55);
        }
      }
    }
  }

  private updateUnits(dt: number): void {
    const tNow = this.battleElapsed;
    const grav = 26 * this.worldSettings.gravityScale;

    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];

      if (!u.alive) {
        u.dyingTimer += dt;
        if (u.model?.mixer) u.model.mixer.update(dt);
        u.vy -= grav * 1.1 * dt;
        u.vx *= Math.exp(-4.2 * dt);
        u.vz *= Math.exp(-4.2 * dt);
        u.x += THREE.MathUtils.clamp(u.vx, -16, 16) * dt;
        u.y = Math.min(12, u.y + u.vy * dt);
        u.z += THREE.MathUtils.clamp(u.vz, -16, 16) * dt;

        if (!u.fallenOff && u.y < 0) {
          u.y = 0;
          u.vy *= -0.22;
          u.vx *= 0.5;
          u.vz *= 0.5;
        }
        if (this.worldSettings.enclosedWalls) {
          u.x = THREE.MathUtils.clamp(u.x, -ARENA_HALF_W + 1, ARENA_HALF_W - 1);
          u.z = THREE.MathUtils.clamp(u.z, -ARENA_HALF_D + 1, ARENA_HALF_D - 1);
        } else if (Math.abs(u.x) > ARENA_HALF_W + 0.5 || Math.abs(u.z) > ARENA_HALF_D + 0.5) {
          u.fallenOff = true;
        }
        if (!u.model?.actions.death) {
          u.root.rotation.x = THREE.MathUtils.lerp(u.root.rotation.x, -Math.PI / 2, Math.min(1, dt * 8));
        }

        u.root.position.set(u.x, u.y, u.z);
        u.teamRing.visible = false;
        u.hpBarGroup.visible = false;

        const shouldRemove =
          u.y < -12 ||
          Math.abs(u.x) > ARENA_HALF_W + 10 ||
          Math.abs(u.z) > ARENA_HALF_D + 10 ||
          (!this.worldSettings.persistCorpses && u.dyingTimer > 2.8);

        if (shouldRemove) this.removeUnitAt(i);
        continue;
      }

      if (u.model?.mixer) u.model.mixer.update(dt * (u.slowTimer > 0 ? 0.45 : u.traits.frenzy ? 1.5 : 1));

      if (u.catalog.buffAuraRadius) {
        u.auraTimer -= dt;
        if (u.auraTimer <= 0) {
          u.auraTimer = 1.3;
          this.grid.queryRadius(u.x, u.z, u.catalog.buffAuraRadius * u.scale, this.queryBuf);
          for (let j = 0; j < this.queryBuf.length; j++) {
            const ally = this.queryBuf[j];
            if (ally.alive && ally.team === u.team && ally.hp < ally.maxHp) {
              ally.hp = Math.min(ally.maxHp, ally.hp + 12);
              this.updateHpBar(ally);
            }
          }
          this.vfx.spawnRing(u.x, 0.1, u.z, 0xeab308, 0.6, u.catalog.buffAuraRadius * 0.75, 0.5);
        }
      }

      u.attackTimer = Math.max(0, u.attackTimer - dt);
      u.retargetTimer = Math.max(0, u.retargetTimer - dt);
      u.lungeTimer = Math.max(0, u.lungeTimer - dt);
      u.slowTimer = Math.max(0, u.slowTimer - dt);
      u.specialTimer = Math.max(0, u.specialTimer - dt);
      u.stunTimer = Math.max(0, u.stunTimer - dt);
      u.fearTimer = Math.max(0, u.fearTimer - dt);
      u.hasteTimer = Math.max(0, u.hasteTimer - dt);
      u.stampedeTimer = Math.max(0, u.stampedeTimer - dt);

      if (u.shieldTimer > 0) {
        u.shieldTimer = Math.max(0, u.shieldTimer - dt);
        if (u.shieldMesh) {
          u.shieldMesh.visible = u.shieldTimer > 0;
          u.shieldMesh.rotation.y += dt * 1.8;
        }
      }

      if (u.polymorphTimer > 0) {
        u.polymorphTimer -= dt;
        if (u.polymorphTimer <= 0) {
          this.revertPolymorph(u);
        }
      }

      // Stunned units briefly freeze in place
      if (u.stunTimer > 0) {
        u.vx *= Math.exp(-8 * dt);
        u.vz *= Math.exp(-8 * dt);
        continue;
      }

      if (u.catalog.isStructure) {
        if ((u.catalog.combatStyle === 'turret' || u.catalog.combatStyle === 'tesla') && u.ai !== 'passive') {
          const target = this.findNearestHostile(u, u.attackRange * u.scale);
          if (target && u.attackTimer <= 0) {
            u.attackTimer = u.attackCooldown * (u.traits.frenzy ? 0.5 : 1);
            this.performAttack(u, target);
          }
        } else if (u.catalog.combatStyle === 'spawner' && u.catalog.spawnsUnitId && u.ai !== 'passive') {
          if (u.attackTimer <= 0) {
            u.attackTimer = (u.catalog.spawnInterval ?? 4.5) * (u.traits.frenzy ? 0.55 : 1);
            const dirX = u.team === 'red' ? 1 : u.team === 'blue' ? -1 : 0;
            const spawnX = u.x + dirX * (u.radius + 1.4) + (Math.random() - 0.5) * 1.4;
            const spawnZ = u.z + (Math.random() - 0.5) * 2.2;
            const modeUnit = findModeEquivalent(u.catalog.spawnsUnitId, this.worldSettings.renderStyle);
            const targetSpawnId = modeUnit ? modeUnit.id : u.catalog.spawnsUnitId;
            const spawned = this.spawnUnit(targetSpawnId, spawnX, spawnZ, {
              team: u.team === 'neutral' ? 'red' : u.team,
              ai: 'aggressive',
              scale: 1,
              hpMult: 1,
              dmgMult: 1,
              spdMult: 1,
              silent: true,
              recordSnapshot: false,
            });
            if (spawned) {
              this.vfx.spawnRing(spawnX, 0.14, spawnZ, TEAM_HEX[spawned.team], 0.3, 2.2, 0.4);
            }
          }
        }
        continue;
      }

      let moveDirX = 0;
      let moveDirZ = 0;
      let wantsMove = false;
      let activeTarget: UnitEntity | null = null;

      if (u.ai !== 'passive') {
        if (u.rallyTarget) {
          const rdx = u.rallyTarget.x - u.x;
          const rdz = u.rallyTarget.z - u.z;
          const rDist = Math.hypot(rdx, rdz);
          if (rDist < 2.2) {
            u.rallyTarget = null;
          } else {
            moveDirX = rdx / rDist;
            moveDirZ = rdz / rDist;
            wantsMove = true;
          }
        }

        if (!u.rallyTarget) {
          if (u.catalog.combatStyle === 'healer' && u.ai !== 'flee' && u.fearTimer <= 0) {
            activeTarget = this.findInjuredAlly(u);
          } else if (u.ai === 'flee' || u.fearTimer > 0) {
            const threat = this.findNearestHostile(u, 18);
            if (threat) {
              const dx = u.x - threat.x;
              const dz = u.z - threat.z;
              const d = Math.max(0.1, Math.hypot(dx, dz));
              moveDirX = dx / d;
              moveDirZ = dz / d;
              wantsMove = true;
            }
          } else {
            const cur = u.targetId !== null ? this.unitMap.get(u.targetId) ?? null : null;
            if (cur && cur.alive && this.isHostile(u, cur) && u.retargetTimer > 0) {
              activeTarget = cur;
            } else {
              const searchMax = u.ai === 'hold' ? Math.max(u.attackRange * 1.15, 4.5) : 95;
              activeTarget = this.findNearestHostile(u, searchMax);
              u.targetId = activeTarget ? activeTarget.id : null;
              u.retargetTimer = 0.45 + Math.random() * 0.35;
            }
          }
        }

        // Autonomous stochastic Special Ability trigger during active combat!
        if (
          activeTarget &&
          u.polymorphTimer <= 0 &&
          u.catalog.specialAbility !== 'none' &&
          u.specialTimer <= 0
        ) {
          const distToTarget = Math.hypot(activeTarget.x - u.x, activeTarget.z - u.z);
          const triggerDist = Math.max(u.attackRange * 1.3, 13.5);
          if (distToTarget <= triggerDist) {
            // Stochastic moment check so armies don't fire every power in robotic sync
            if (Math.random() < 0.45) {
              const fired = this.executeSpecialAbility(u, activeTarget);
              if (!fired) u.specialTimer = 1.6;
            } else {
              u.specialTimer = 0.9 + Math.random() * 1.4;
            }
          }
        }

        if (activeTarget) {
          const dx = activeTarget.x - u.x;
          const dz = activeTarget.z - u.z;
          const dist = Math.max(0.01, Math.hypot(dx, dz));
          const effRange = u.attackRange * Math.pow(u.scale, 0.35) + activeTarget.radius + u.radius * 0.5;
          const desiredYaw = Math.atan2(dx, dz);
          u.yaw = this.lerpAngle(u.yaw, desiredYaw, Math.min(1, dt * 11));

          if (dist <= effRange) {
            if (
              u.ai === 'aggressive' &&
              (u.catalog.combatStyle === 'ranged' || u.catalog.combatStyle === 'magic') &&
              dist < effRange * 0.32 &&
              dist < 5.0
            ) {
              moveDirX = -dx / dist;
              moveDirZ = -dz / dist;
              wantsMove = true;
            }
            if (u.attackTimer <= 0) {
              const cd =
                u.attackCooldown *
                (u.traits.frenzy ? 0.5 : 1) *
                (u.hasteTimer > 0 ? 0.68 : 1) *
                (u.slowTimer > 0 ? 1.5 : 1);
              u.attackTimer = cd * (0.9 + Math.random() * 0.2);
              this.performAttack(u, activeTarget);
            }
          } else if (u.ai === 'aggressive') {
            moveDirX = dx / dist;
            moveDirZ = dz / dist;
            wantsMove = true;
          }
        }
      }

      let sepX = 0;
      let sepZ = 0;
      const queryR = Math.max(2.6, u.radius * 3.1);
      this.grid.queryRadius(u.x, u.z, queryR, this.queryBuf);
      const isFlying = (u.catalog.flyHeight ?? 0) > 0.5;

      for (let j = 0; j < this.queryBuf.length; j++) {
        const other = this.queryBuf[j];
        if (other.id === u.id || !other.alive) continue;
        if (
          other.catalog.combatStyle === 'mine' ||
          other.catalog.combatStyle === 'jumppad' ||
          other.catalog.combatStyle === 'blackhole' ||
          other.catalog.combatStyle === 'cryo'
        ) {
          continue;
        }
        const otherFlying = (other.catalog.flyHeight ?? 0) > 0.5;
        if (isFlying !== otherFlying && !other.catalog.isStructure) continue;
        if (isFlying && other.catalog.isStructure && other.catalog.id !== 'tower') continue;

        const dx = u.x - other.x;
        const dz = u.z - other.z;
        const minSep = u.radius + other.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < minSep * minSep && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const overlap = minSep - d;
          const push = other.catalog.isStructure ? 18 : 6.5;
          sepX += (dx / d) * overlap * push;
          sepZ += (dz / d) * overlap * push;

          if (
            other.catalog.isStructure &&
            other.team !== u.team &&
            other.team !== 'neutral' &&
            u.ai === 'aggressive' &&
            u.attackTimer <= 0
          ) {
            u.attackTimer = u.attackCooldown * (u.traits.frenzy ? 0.5 : 1);
            this.performAttack(u, other);
          }
        }
      }

      const effSpeed =
        u.speed *
        (u.slowTimer > 0 ? 0.32 : 1) *
        (u.hasteTimer > 0 ? 1.45 : 1) *
        (u.stampedeTimer > 0 ? 2.1 : 1) *
        (u.traits.frenzy ? 1.28 : 1);

      // Stampede active trample: plow through & launch hostile units along path!
      if (u.stampedeTimer > 0 && wantsMove) {
        u.stampedeTickTimer = Math.max(0, u.stampedeTickTimer - dt);
        if (u.stampedeTickTimer <= 0) {
          u.stampedeTickTimer = 0.24;
          this.grid.queryRadius(u.x, u.z, u.radius + 1.25, this.queryBuf);
          const trampled = this.queryBuf.slice();
          for (const vic of trampled) {
            if (!this.isHostile(u, vic) || vic.catalog.isStructure) continue;
            const tdx = vic.x - u.x;
            const tdz = vic.z - u.z;
            const td = Math.max(0.15, Math.hypot(tdx, tdz));
            this.applyDamage(vic, Math.max(12, u.damage * 0.55), u, (tdx / td) * 11, 7.5, (tdz / td) * 11);
          }
          this.vfx.spawnRing(u.x, 0.12, u.z, 0xeab308, 0.25, u.radius * 1.9, 0.25);
        }
      }
      const targetVx = wantsMove ? moveDirX * effSpeed : 0;
      const targetVz = wantsMove ? moveDirZ * effSpeed : 0;
      const accel = u.y > (u.catalog.flyHeight ?? 0) + 0.35 ? 1.8 : 9.5;
      u.vx += (targetVx - u.vx) * Math.min(1, accel * dt) + sepX * dt;
      u.vz += (targetVz - u.vz) * Math.min(1, accel * dt) + sepZ * dt;

      if (wantsMove && !activeTarget) {
        u.yaw = this.lerpAngle(u.yaw, Math.atan2(moveDirX, moveDirZ), Math.min(1, dt * 10));
      }

      const baseAlt = u.catalog.flyHeight ?? 0;
      const outOfBounds = Math.abs(u.x) > ARENA_HALF_W + 0.4 || Math.abs(u.z) > ARENA_HALF_D + 0.4;

      if (outOfBounds && !isFlying && !this.worldSettings.enclosedWalls) {
        u.vy -= grav * 1.1 * dt;
        u.y += u.vy * dt;
        if (u.y < -9) {
          this.killUnit(u, null);
          continue;
        }
      } else if (isFlying) {
        const targetAlt = baseAlt + Math.sin(tNow * 3.8 + u.phaseOffset) * 0.25;
        u.y += (targetAlt - u.y) * Math.min(1, dt * 5);
        u.vy = 0;
      } else {
        if (u.y > 0.01 || u.vy > 0) {
          u.vy -= grav * dt;
          u.y += u.vy * dt;
          if (u.y <= 0) {
            u.y = 0;
            if (Math.abs(u.vy) > 6) {
              this.vfx.spawnRing(u.x, 0.08, u.z, 0x94a3b8, 0.2, u.radius * 1.4, 0.22);
              // Seismic slam impact when Berserk Leap lands!
              if (u.catalog.specialAbility === 'berserk_leap' && Math.abs(u.vy) > 8.5) {
                this.vfx.spawnExplosion(u.x, 0.25, u.z, 4.2);
                this.arena.addShake(0.38);
                this.sound.playExplosion(false);
                this.grid.queryRadius(u.x, u.z, 4.2, this.queryBuf);
                const slamTargets = this.queryBuf.slice();
                for (const vic of slamTargets) {
                  if (!this.isHostile(u, vic)) continue;
                  const dx = vic.x - u.x;
                  const dz = vic.z - u.z;
                  const d = Math.max(0.2, Math.hypot(dx, dz));
                  this.applyDamage(vic, u.damage * 1.4, u, (dx / d) * 10, 7, (dz / d) * 10);
                }
              }
            }
            u.vy = 0;
          }
        }
      }

      u.x += u.vx * dt;
      u.z += u.vz * dt;

      if (this.worldSettings.enclosedWalls) {
        if (u.x > ARENA_HALF_W - 1.1) {
          u.x = ARENA_HALF_W - 1.1;
          u.vx = -Math.abs(u.vx) * 0.65;
        } else if (u.x < -ARENA_HALF_W + 1.1) {
          u.x = -ARENA_HALF_W + 1.1;
          u.vx = Math.abs(u.vx) * 0.65;
        }
        if (u.z > ARENA_HALF_D - 1.1) {
          u.z = ARENA_HALF_D - 1.1;
          u.vz = -Math.abs(u.vz) * 0.65;
        } else if (u.z < -ARENA_HALF_D + 1.1) {
          u.z = -ARENA_HALF_D + 1.1;
          u.vz = Math.abs(u.vz) * 0.65;
        }
      } else if (!outOfBounds && Math.hypot(u.vx, u.vz) < effSpeed * 1.35) {
        if (u.x > ARENA_HALF_W - 1.2) u.x = ARENA_HALF_W - 1.2;
        if (u.x < -ARENA_HALF_W + 1.2) u.x = -ARENA_HALF_W + 1.2;
        if (u.z > ARENA_HALF_D - 1.2) u.z = ARENA_HALF_D - 1.2;
        if (u.z < -ARENA_HALF_D + 1.2) u.z = -ARENA_HALF_D + 1.2;
      }

      const horizSpeed = Math.hypot(u.vx, u.vz);
      const isMoving = wantsMove && horizSpeed > 0.55;
      if (u.lungeTimer <= 0) this.setUnitAnim(u, isMoving ? 'move' : 'idle');

      let extraBob = 0;
      let tiltZ = 0;
      let tiltX = 0;
      if (isMoving && !u.model?.hasSkeletalAnims) {
        const freq = 9.5;
        extraBob = Math.abs(Math.sin(tNow * freq + u.phaseOffset)) * 0.18 * u.scale;
        tiltZ = Math.sin(tNow * freq + u.phaseOffset) * 0.1;
      }
      if (u.lungeTimer > 0) {
        tiltX = Math.sin((u.lungeTimer / 0.22) * Math.PI) * 0.28;
      }

      u.root.position.set(u.x, u.y + extraBob, u.z);
      u.root.rotation.set(tiltX, u.yaw, tiltZ);
      u.teamRing.position.y = 0.04 - (u.y + extraBob);
    }
  }

  private performAttack(attacker: UnitEntity, target: UnitEntity): void {
    this.snapshotLockedDuringFight = true;
    attacker.lungeTimer = 0.22;
    this.setUnitAnim(attacker, 'attack');

    const style = attacker.catalog.combatStyle;
    const muzzle = new THREE.Vector3(
      attacker.x + Math.sin(attacker.yaw) * attacker.radius * 0.8,
      attacker.y + attacker.catalog.targetHeight * attacker.scale * 0.65,
      attacker.z + Math.cos(attacker.yaw) * attacker.radius * 0.8
    );
    const aimPos = new THREE.Vector3(
      target.x,
      target.y + target.catalog.targetHeight * target.scale * 0.45,
      target.z
    );

    if (style === 'healer') {
      target.hp = Math.min(target.maxHp, target.hp + attacker.damage);
      this.updateHpBar(target);
      this.vfx.spawnLightning([muzzle, aimPos], 0x10b981);
      this.vfx.spawnRing(target.x, 0.14, target.z, 0x10b981, 0.3, target.radius * 1.8, 0.32);
      this.sound.playShoot('heal');
      return;
    }

    if (attacker.catalog.projectileKind === 'lightning') {
      const chainPoints = [muzzle];
      const hitIds = new Set<number>();
      let curTarget: UnitEntity | null = target;
      const maxChains = attacker.catalog.chainCount ?? 3;

      for (let c = 0; c < maxChains && curTarget; c++) {
        hitIds.add(curTarget.id);
        chainPoints.push(
          new THREE.Vector3(curTarget.x, curTarget.y + curTarget.catalog.targetHeight * curTarget.scale * 0.5, curTarget.z)
        );
        const dmg = attacker.damage * Math.pow(0.82, c);
        this.applyDamage(curTarget, dmg, attacker, 0, 2.5, 0);

        this.grid.queryRadius(curTarget.x, curTarget.z, 7.2, this.queryBuf);
        let nextT: UnitEntity | null = null;
        let bestD2 = 999;
        for (let j = 0; j < this.queryBuf.length; j++) {
          const cand = this.queryBuf[j];
          if (hitIds.has(cand.id) || !this.isHostile(attacker, cand)) continue;
          const d2 = (cand.x - curTarget.x) ** 2 + (cand.z - curTarget.z) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            nextT = cand;
          }
        }
        curTarget = nextT;
      }
      this.vfx.spawnLightning(chainPoints, attacker.catalog.combatStyle === 'tesla' ? 0x38bdf8 : 0xc084fc);
      this.sound.playShoot('lightning');
      return;
    }

    const extraSplash = attacker.traits.explosive ? 3.8 : 0;

    if (attacker.catalog.projectileKind) {
      this.vfx.spawnProjectile({
        kind: attacker.catalog.projectileKind,
        team: attacker.team,
        ownerId: attacker.id,
        from: muzzle,
        to: aimPos,
        damage: attacker.damage,
        splashRadius: Math.max((attacker.catalog.splashRadius ?? 0) * Math.pow(attacker.scale, 0.5), extraSplash),
        knockback: ((attacker.catalog.knockback ?? 2.5) + (attacker.traits.explosive ? 6 : 0)) * Math.pow(attacker.scale, 0.4),
      });
      this.sound.playShoot(attacker.catalog.projectileKind);
      if (attacker.catalog.projectileKind === 'shell') this.arena.addShake(0.28);
      return;
    }

    const kb = ((attacker.catalog.knockback ?? 2.5) + (attacker.traits.explosive ? 7 : 0)) * Math.pow(attacker.scale, 0.5);
    const splash = Math.max((attacker.catalog.splashRadius ?? 0) * Math.pow(attacker.scale, 0.5), extraSplash);

    if (splash > 0.5) {
      this.grid.queryRadius(target.x, target.z, splash, this.queryBuf);
      const meleeSplashTargets = this.queryBuf.slice();
      for (let j = 0; j < meleeSplashTargets.length; j++) {
        const vic = meleeSplashTargets[j];
        if (!this.worldSettings.friendlyFire && !this.isHostile(attacker, vic) && vic.catalog.combatStyle !== 'explosive') {
          continue;
        }
        if (vic.id === attacker.id) continue;
        const dx = vic.x - attacker.x;
        const dz = vic.z - attacker.z;
        const d = Math.max(0.1, Math.hypot(dx, dz));
        this.applyDamage(vic, attacker.damage, attacker, (dx / d) * kb, kb * 0.55, (dz / d) * kb);
      }
      if (attacker.catalog.shockwave || attacker.traits.explosive) {
        this.vfx.spawnExplosion(target.x, 0.2, target.z, splash);
        this.arena.addShake(0.32 * Math.min(2, attacker.scale));
        this.sound.playExplosion(false);
      } else {
        this.vfx.spawnRing(target.x, 0.16, target.z, 0xffffff, 0.3, splash, 0.22);
        this.sound.playMeleeHit();
      }
    } else {
      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const d = Math.max(0.1, Math.hypot(dx, dz));
      this.applyDamage(target, attacker.damage, attacker, (dx / d) * kb, kb * 0.35, (dz / d) * kb);
      this.vfx.spawnBurst(aimPos.x, aimPos.y, aimPos.z, 0xfef08a, 3, 4);
      this.sound.playMeleeHit();
    }
  }

  private updateProjectiles(dt: number): void {
    const gravScale = this.worldSettings.gravityScale;
    for (let i = this.vfx.projectiles.length - 1; i >= 0; i--) {
      const p = this.vfx.projectiles[i];
      p.life -= dt;
      p.vy -= p.gravity * gravScale * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);

      let hitTarget: UnitEntity | null = null;
      const hitGround = p.y <= 0.12;

      this.grid.queryRadius(p.x, p.z, 2.2, this.queryBuf);
      for (let j = 0; j < this.queryBuf.length; j++) {
        const cand = this.queryBuf[j];
        if (!cand.alive || cand.id === p.ownerId) continue;
        if (cand.team === 'neutral' && cand.catalog.combatStyle !== 'explosive' && cand.catalog.combatStyle !== 'mine') {
          continue;
        }
        if (!this.worldSettings.friendlyFire && cand.team === p.team && p.team !== 'ffa') continue;
        const dx = cand.x - p.x;
        const dz = cand.z - p.z;
        const h = cand.catalog.targetHeight * cand.scale;
        if (dx * dx + dz * dz <= (cand.radius + 0.35) ** 2 && p.y >= cand.y - 0.3 && p.y <= cand.y + h + 0.45) {
          hitTarget = cand;
          break;
        }
      }

      if (hitTarget || hitGround || p.life <= 0) {
        const owner = this.unitMap.get(p.ownerId) ?? null;

        if (p.splashRadius > 0.5) {
          this.vfx.spawnExplosion(p.x, Math.max(0.2, p.y), p.z, p.splashRadius);
          this.sound.playExplosion(p.splashRadius >= 4);
          if (p.splashRadius >= 3.5) this.arena.addShake(0.42);

          this.grid.queryRadius(p.x, p.z, p.splashRadius, this.queryBuf);
          const projSplashTargets = this.queryBuf.slice();
          for (let j = 0; j < projSplashTargets.length; j++) {
            const vic = projSplashTargets[j];
            if (!vic.alive || vic.id === p.ownerId) continue;
            if (
              !this.worldSettings.friendlyFire &&
              vic.team === p.team &&
              p.team !== 'ffa' &&
              vic.catalog.combatStyle !== 'explosive'
            ) {
              continue;
            }
            const dx = vic.x - p.x;
            const dz = vic.z - p.z;
            const d = Math.max(0.2, Math.hypot(dx, dz));
            const falloff = 1 - (d / (p.splashRadius * 1.15)) * 0.5;
            this.applyDamage(
              vic,
              p.damage * Math.max(0.35, falloff),
              owner,
              (dx / d) * p.knockback,
              p.knockback * 0.72,
              (dz / d) * p.knockback
            );
          }
        } else if (hitTarget) {
          const speedLen = Math.max(0.1, Math.hypot(p.vx, p.vz));
          this.applyDamage(
            hitTarget,
            p.damage,
            owner,
            (p.vx / speedLen) * p.knockback,
            p.knockback * 0.32,
            (p.vz / speedLen) * p.knockback
          );
          this.vfx.spawnBurst(p.x, p.y, p.z, 0xfef08a, 4, 4.5);
        }

        this.vfx.removeProjectileAt(i);
      }
    }
  }

  private applyDamage(
    target: UnitEntity,
    rawDmg: number,
    attacker: UnitEntity | null,
    kbX: number,
    kbY: number,
    kbZ: number
  ): void {
    if (!target.alive) return;

    const effArmor = target.shieldTimer > 0 ? Math.max(0.82, target.armor) : target.armor;
    const dmg = target.traits.invincible ? 0 : Math.max(1, rawDmg * (1 - effArmor));
    target.hp -= dmg;
    target.hitFlashTimer = 0.12;

    // Vampire lifesteal trait
    if (attacker && attacker.alive && attacker.traits.vampire && dmg > 0) {
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + dmg * 0.35);
      this.updateHpBar(attacker);
    }

    if (!target.catalog.isStructure && target.shieldTimer <= 0) {
      const invMass = 1 / Math.max(0.75, target.mass);
      const addVx = THREE.MathUtils.clamp(kbX * invMass * 1.45, -14, 14);
      const addVy = THREE.MathUtils.clamp(kbY * invMass * 1.05, 0, 11);
      const addVz = THREE.MathUtils.clamp(kbZ * invMass * 1.45, -14, 14);
      target.vx = THREE.MathUtils.clamp(target.vx + addVx, -16, 16);
      target.vy = THREE.MathUtils.clamp(target.vy + addVy, -18, 12);
      target.vz = THREE.MathUtils.clamp(target.vz + addVz, -16, 16);
    }

    this.updateHpBar(target);

    if (target.hp <= 0) {
      if (target.catalog.combatStyle === 'explosive' || target.catalog.combatStyle === 'mine') {
        this.detonateUnit(target, attacker);
      } else {
        this.killUnit(target, attacker);
      }
    }
  }

  private detonateUnit(explosive: UnitEntity, triggerer: UnitEntity | null = null): void {
    if (!explosive.alive) return;
    const r = (explosive.catalog.splashRadius ?? 5.5) * Math.pow(explosive.scale, 0.5);
    const dmg = explosive.damage || 135;
    const kb = (explosive.catalog.knockback ?? 16) * Math.pow(explosive.scale, 0.4);

    this.killUnit(explosive, triggerer);
    this.vfx.spawnExplosion(explosive.x, 0.3, explosive.z, r);
    this.sound.playExplosion(true);
    this.arena.addShake(0.75);

    this.grid.queryRadius(explosive.x, explosive.z, r, this.queryBuf);
    const victims = [...this.queryBuf];
    for (let j = 0; j < victims.length; j++) {
      const vic = victims[j];
      if (!vic.alive || vic.id === explosive.id) continue;
      const dx = vic.x - explosive.x;
      const dz = vic.z - explosive.z;
      const d = Math.max(0.2, Math.hypot(dx, dz));
      const falloff = 1 - (d / (r * 1.15)) * 0.5;
      this.applyDamage(
        vic,
        dmg * Math.max(0.35, falloff),
        triggerer,
        (dx / d) * kb,
        kb * 0.78,
        (dz / d) * kb
      );
    }
  }

  private killUnit(target: UnitEntity, killer: UnitEntity | null): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.dyingTimer = 0;
    this.totalKills++;

    if (killer && killer.id !== target.id) killer.kills++;

    this.setUnitAnim(target, 'death');
    this.vfx.spawnBurst(
      target.x,
      target.y + target.catalog.targetHeight * target.scale * 0.45,
      target.z,
      TEAM_HEX[target.team],
      8,
      6.5
    );

    if (this.selectedUnitId === target.id) {
      this.selectedUnitId = null;
      this.onSelectionChange?.(null);
    }
  }

  private applyHitFlash(u: UnitEntity, intensity: number): void {
    if (!u.model) return;
    const mats = u.model.flashMaterials;
    for (let i = 0; i < mats.length; i++) {
      if (intensity > 0.01) {
        mats[i].emissive.setRGB(intensity * 0.85, intensity * 0.85, intensity * 0.85);
      } else {
        mats[i].emissive.setRGB(0, 0, 0);
      }
    }
  }

  private updateHpBar(u: UnitEntity): void {
    if (u.hp >= u.maxHp || !u.alive) {
      u.hpBarGroup.visible = false;
      return;
    }
    u.hpBarGroup.visible = true;
    const ratio = Math.max(0.01, u.hp / u.maxHp);
    u.hpFillMesh.scale.x = ratio;
    u.hpFillMesh.position.x = -(1 - ratio) * 0.55;
  }

  private findNearestHostile(u: UnitEntity, maxRange: number): UnitEntity | null {
    this.grid.queryRadius(u.x, u.z, Math.min(maxRange, 16), this.queryBuf);
    let best: UnitEntity | null = null;
    let bestD2 = maxRange * maxRange;

    for (let i = 0; i < this.queryBuf.length; i++) {
      const c = this.queryBuf[i];
      if (!this.isHostile(u, c)) continue;
      const isLowPri =
        c.catalog.isStructure &&
        c.catalog.combatStyle !== 'turret' &&
        c.catalog.combatStyle !== 'tesla' &&
        c.catalog.combatStyle !== 'spawner';
      const penalty = isLowPri ? 144 : 0;
      const d2 = (c.x - u.x) ** 2 + (c.z - u.z) ** 2 + penalty;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }
    if (best || maxRange <= 16) return best;

    for (let i = 0; i < this.units.length; i++) {
      const c = this.units[i];
      if (!this.isHostile(u, c)) continue;
      const isLowPri =
        c.catalog.isStructure &&
        c.catalog.combatStyle !== 'turret' &&
        c.catalog.combatStyle !== 'tesla' &&
        c.catalog.combatStyle !== 'spawner';
      const penalty = isLowPri ? 225 : 0;
      const d2 = (c.x - u.x) ** 2 + (c.z - u.z) ** 2 + penalty;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }
    return best;
  }

  private findInjuredAlly(healer: UnitEntity): UnitEntity | null {
    let best: UnitEntity | null = null;
    let lowestRatio = 0.99;
    const canRepairStructures = healer.catalog.id === 'engineer';
    for (let i = 0; i < this.units.length; i++) {
      const c = this.units[i];
      if (!c.alive || c.id === healer.id) continue;
      if (!canRepairStructures && c.catalog.isStructure) continue;
      if (c.team !== healer.team) continue;
      const ratio = c.hp / c.maxHp;
      if (ratio < lowestRatio) {
        lowestRatio = ratio;
        best = c;
      }
    }
    return best;
  }

  private checkVictory(): void {
    if (this.victoryReported) return;

    let redAlive = 0;
    let blueAlive = 0;
    let ffaAlive = 0;
    let lastFfa: UnitEntity | null = null;
    let mvp: UnitEntity | null = null;

    for (const u of this.units) {
      if (!u.alive) continue;
      if (
        u.catalog.isStructure &&
        u.catalog.combatStyle !== 'turret' &&
        u.catalog.combatStyle !== 'tesla' &&
        u.catalog.combatStyle !== 'spawner'
      ) {
        continue;
      }
      if (u.team === 'red') redAlive++;
      if (u.team === 'blue') blueAlive++;
      if (u.team === 'ffa') {
        ffaAlive++;
        lastFfa = u;
      }
      if (!mvp || u.kills > mvp.kills) mvp = u;
    }

    // Standard Red vs Blue Victory
    if (this.hadRedFighters && this.hadBlueFighters) {
      if (redAlive === 0 || blueAlive === 0) {
        this.victoryReported = true;
        const winner: 'red' | 'blue' | 'draw' = redAlive > 0 ? 'red' : blueAlive > 0 ? 'blue' : 'draw';
        this.sound.playVictory();
        this.onVictory?.({
          winner,
          duration: this.battleElapsed,
          casualties: this.totalKills,
          survivors: Math.max(redAlive, blueAlive),
          mvpNameTr: mvp && mvp.kills > 0 ? mvp.catalog.nameTr : '',
          mvpNameEn: mvp && mvp.kills > 0 ? mvp.catalog.nameEn : '',
          mvpKills: mvp?.kills ?? 0,
        });
      }
      return;
    }

    // Pure Chaos (FFA) Battle Royale Victory (Last Survivor Standing!)
    if (this.hadFfaFighters >= 2 && redAlive === 0 && blueAlive === 0 && ffaAlive <= 1) {
      this.victoryReported = true;
      const champ = lastFfa ?? mvp;
      this.sound.playVictory();
      this.onVictory?.({
        winner: ffaAlive === 1 ? 'ffa' : 'draw',
        duration: this.battleElapsed,
        casualties: this.totalKills,
        survivors: ffaAlive,
        mvpNameTr: champ ? champ.catalog.nameTr : '',
        mvpNameEn: champ ? champ.catalog.nameEn : '',
        mvpKills: champ?.kills ?? 0,
      });
    }
  }

  public getTelemetry(): TelemetryStats {
    let redCount = 0;
    let blueCount = 0;
    let ffaCount = 0;
    let redPower = 0;
    let bluePower = 0;

    for (const u of this.units) {
      if (!u.alive) continue;
      if (
        u.catalog.isStructure &&
        u.catalog.combatStyle !== 'turret' &&
        u.catalog.combatStyle !== 'tesla' &&
        u.catalog.combatStyle !== 'spawner'
      ) {
        continue;
      }
      if (u.team === 'red') {
        redCount++;
        redPower += u.hp;
      } else if (u.team === 'blue') {
        blueCount++;
        bluePower += u.hp;
      } else if (u.team === 'ffa') {
        ffaCount++;
      }
    }

    return {
      redCount,
      blueCount,
      ffaCount,
      redPower,
      bluePower,
      kills: this.totalKills,
      fps: this.currentFps,
      totalEntities: this.units.length,
      running: this.running,
      elapsedTime: this.battleElapsed,
    };
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return a + diff * t;
  }
}
