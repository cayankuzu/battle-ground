export type Lang = 'tr' | 'en';

export type Team = 'red' | 'blue' | 'ffa' | 'neutral';
export type TeamSetting = 'auto' | 'red' | 'blue' | 'ffa';

export type AIBehavior = 'aggressive' | 'hold' | 'passive' | 'flee';

export type ToolMode = 'brush' | 'single' | 'squad' | 'rally' | 'select' | 'erase';

export type UnitCategory = 'gods' | 'heroes' | 'undead' | 'modern' | 'vehicles' | 'beasts' | 'structures';

export type RenderStyle = 'hybrid' | 'ultra' | 'realistic' | 'manga' | 'pixel' | 'blueprint';

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

export type ArenaBiome = 'obsidian' | 'desert' | 'arctic' | 'volcanic' | 'orbital';

export type SpecialAbilityKind =
  | 'none'
  | 'polymorph'
  | 'divine_smite'
  | 'necromancy'
  | 'fire_breath'
  | 'apex_roar'
  | 'shield_wall'
  | 'berserk_leap'
  | 'shadow_blink'
  | 'stampede'
  | 'barrage'
  | 'emp_pulse'
  | 'venom_cloud'
  | 'pack_howl'
  | 'heal_nova';

export type CombatStyle =
  | 'melee'
  | 'ranged'
  | 'magic'
  | 'healer'
  | 'siege'
  | 'turret'
  | 'spawner'
  | 'structure'
  | 'explosive'
  | 'mine'
  | 'jumppad'
  | 'blackhole'
  | 'healtotem'
  | 'tesla'
  | 'cryo';

export type ProjectileKind =
  | 'arrow'
  | 'bullet'
  | 'laser'
  | 'plasma'
  | 'fireball'
  | 'darkbolt'
  | 'lightning'
  | 'shell'
  | 'heal';

export interface ScientificProfile {
  massKg: number;
  speedKmh: number;
  energyJ: number;
  forceN?: number;
  armorMaterialTr: string;
  armorMaterialEn: string;
  durabilityFactor: number;
  kineticArmor: number;
  scienceNoteTr: string;
  scienceNoteEn: string;
}

export interface UnitTraits {
  explosive: boolean;
  vampire: boolean;
  frenzy: boolean;
  invincible: boolean;
}

export interface CharacterOverride {
  scale?: number;
  hp?: number;
  damage?: number;
  speed?: number;
  attackRange?: number;
  attackCooldown?: number;
  armor?: number;
  defaultAi?: AIBehavior;
  traits?: Partial<UnitTraits>;
}

export interface WorldSettings {
  renderStyle: RenderStyle;
  quality: QualityTier;
  biome: ArenaBiome;
  gravityScale: number;
  enclosedWalls: boolean;
  friendlyFire: boolean;
  persistCorpses: boolean;
}

export type ProceduralVisualKind =
  | 'mine'
  | 'jumppad'
  | 'blackhole'
  | 'healtotem'
  | 'tesla'
  | 'cryo'
  | 'voxel_trex'
  | 'voxel_dragon'
  | 'voxel_tank'
  | 'voxel_mech'
  | 'voxel_zeus'
  | 'voxel_wall'
  | 'voxel_tower'
  | 'voxel_tnt'
  | 'voxel_barracks'
  | 'voxel_frog';

export interface CatalogItem {
  id: string;
  category: UnitCategory;
  /** Which render modes natively include this authentic 3D asset */
  modes: RenderStyle[];
  /** Shared archetype key so switching graphic modes automatically swaps units to that mode's native 3D model! */
  archetype?: string;
  nameTr: string;
  nameEn: string;
  roleTr: string;
  roleEn: string;
  descTr: string;
  descEn: string;
  accentColor: string;
  modelFile: string | null;
  proceduralKind?: ProceduralVisualKind;
  hideNodes?: string[];
  borrowAnimsFrom?: string;
  targetHeight: number;
  facingOffsetY?: number;
  radius: number;
  mass: number;
  flyHeight?: number;
  combatStyle: CombatStyle;
  projectileKind?: ProjectileKind;
  spawnsUnitId?: string;
  spawnInterval?: number;
  hp: number;
  damage: number;
  powerScore: number;
  speed: number;
  attackRange: number;
  attackCooldown: number;
  splashRadius?: number;
  knockback?: number;
  chainCount?: number;
  swarmCount?: number;
  isStructure?: boolean;
  buffAuraRadius?: number;
  shockwave?: boolean;
  armor?: number;
  /** Autonomous signature special ability */
  specialAbility: SpecialAbilityKind;
  specialCooldown: number;
  /** Real-world biomechanical / ballistic / mythological scientific profile */
  science: ScientificProfile;
}

export interface SpawnConfig {
  catalogId: string;
  teamSetting: TeamSetting;
  ai: AIBehavior;
  scale: number;
  hpMult: number;
  dmgMult: number;
  spdMult: number;
  brushSize: number;
}

export interface UnitSnapshot {
  catalogId: string;
  team: Team;
  ai: AIBehavior;
  x: number;
  z: number;
  scale: number;
  hpMult: number;
  dmgMult: number;
  spdMult: number;
  traits?: Partial<UnitTraits>;
}

export interface BattlePreset {
  id: string;
  nameTr: string;
  nameEn: string;
  descTr: string;
  descEn: string;
  tagTr: string;
  tagEn: string;
  recommendedBiome: ArenaBiome;
  recommendedStyle: RenderStyle;
  autoStart: boolean;
  units: UnitSnapshot[];
}

export interface TelemetryStats {
  redCount: number;
  blueCount: number;
  ffaCount: number;
  redPower: number;
  bluePower: number;
  kills: number;
  fps: number;
  totalEntities: number;
  running: boolean;
  elapsedTime: number;
}

export interface VictoryReport {
  winner: 'red' | 'blue' | 'ffa' | 'draw';
  duration: number;
  casualties: number;
  survivors: number;
  mvpNameTr: string;
  mvpNameEn: string;
  mvpKills: number;
}
