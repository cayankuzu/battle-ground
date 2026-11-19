import { Lang, ScientificProfile, SpecialAbilityKind } from '../types';

export interface DerivedPhysicsStats {
  hp: number;
  damage: number;
  speed: number;
  mass: number;
  armor: number;
  knockback: number;
}

/**
 * Derives realistic, scientifically scaled simulation parameters from real-world
 * physical mass (kg), sprint/travel velocity (km/h), kinetic/bite energy (J),
 * and armor toughness — preserving true hierarchy (Rat < Knight < T-Rex < Tank < God)
 * while remaining readable and exciting in real-time 3D arena combat.
 */
export function computeScientificStats(
  sci: ScientificProfile,
  opts: { isStructure?: boolean; isZeroDamage?: boolean; infiniteHp?: boolean } = {}
): DerivedPhysicsStats {
  const hp = opts.infiniteHp
    ? 99999
    : Math.max(8, Math.round(42 * Math.pow(Math.max(0.3, sci.massKg) / 75, 0.42) * sci.durabilityFactor));

  const damage = opts.isZeroDamage
    ? 0
    : Math.max(4, Math.round(12 * Math.pow(Math.max(20, sci.energyJ) / 160, 0.34)));

  const speed = opts.isStructure
    ? 0
    : Number(Math.min(11.5, Math.max(2.1, (sci.speedKmh / 3.6) * 0.56)).toFixed(2));

  const mass = opts.isStructure
    ? 999
    : Number(Math.max(0.3, Math.pow(Math.max(0.4, sci.massKg) / 80, 0.52)).toFixed(2));

  const knockback = opts.isZeroDamage
    ? 0
    : Number(Math.min(18, Math.max(0.8, 1.4 * Math.pow(Math.max(30, sci.energyJ) / 150, 0.25))).toFixed(1));

  return {
    hp,
    damage,
    speed,
    mass,
    armor: Math.min(0.78, Math.max(0, sci.kineticArmor)),
    knockback,
  };
}

/**
 * Computes a deterministic overall tactical combat power score so unit lists
 * default-sort cleanly from strongest apex titans/gods/tanks down to weakest units.
 */
export function computeCombatPower(params: {
  category: string;
  hp: number;
  damage: number;
  armor: number;
  attackCooldown: number;
  attackRange: number;
  splashRadius?: number;
  chainCount?: number;
  swarmCount?: number;
  isStructure?: boolean;
  combatStyle: string;
  specialAbility: SpecialAbilityKind;
}): number {
  if (params.isStructure && params.category === 'structures') {
    switch (params.combatStyle) {
      case 'blackhole':
        return 10000;
      case 'spawner':
        return Math.round(6800 + params.hp * 0.45);
      case 'tesla':
        return Math.round(5800 + params.damage * 14);
      case 'turret':
        return Math.round(4800 + params.damage * 12 + params.hp * 0.25);
      case 'cryo':
        return 3600;
      case 'healtotem':
        return 3100;
      case 'structure':
        return Math.round(2100 + params.hp * 0.2);
      case 'explosive':
        return Math.round(1600 + params.damage * 4);
      case 'mine':
        return Math.round(1200 + params.damage * 3);
      case 'jumppad':
        return 850;
      default:
        return Math.round(1000 + params.hp * 0.2);
    }
  }

  const effHp = params.hp / Math.max(0.2, 1 - params.armor);
  const dps = params.damage / Math.max(0.22, params.attackCooldown);
  const aoeBonus =
    1 +
    (params.splashRadius ? params.splashRadius * 0.14 : 0) +
    (params.chainCount ? (params.chainCount - 1) * 0.22 : 0);
  const rangeBonus = 1 + Math.min(0.45, params.attackRange * 0.015);
  const abilityBonus =
    params.specialAbility === 'divine_smite' || params.specialAbility === 'fire_breath'
      ? 1.24
      : params.specialAbility === 'polymorph' || params.specialAbility === 'necromancy'
        ? 1.18
        : params.specialAbility !== 'none'
          ? 1.1
          : 1.0;
  const swarmBonus = params.swarmCount ? Math.pow(params.swarmCount, 0.72) : 1;

  return Math.round(Math.sqrt(effHp * Math.max(8, dps * aoeBonus * rangeBonus)) * abilityBonus * swarmBonus);
}

export function formatMass(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(kg >= 10000 ? 0 : 1)} t`;
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  return `${Math.round(kg)} kg`;
}

export function formatEnergy(j: number): string {
  if (j <= 0) return '—';
  if (j >= 1_000_000) return `${(j / 1_000_000).toFixed(1)} MJ`;
  if (j >= 1_000) return `${(j / 1_000).toFixed(1)} kJ`;
  return `${Math.round(j)} J`;
}

export const SPECIAL_ABILITY_META: Record<
  SpecialAbilityKind,
  { nameTr: string; nameEn: string; descTr: string; descEn: string; color: string }
> = {
  none: {
    nameTr: 'YOK',
    nameEn: 'NONE',
    descTr: 'Pasif veya sabit yapı.',
    descEn: 'Passive or stationary structure.',
    color: '#64748b',
  },
  polymorph: {
    nameTr: 'DÖNÜŞTÜRME (POLYMORPH)',
    nameEn: 'POLYMORPH HEX',
    descTr: 'Bir düşman savaşçıyı 5.5 saniyeliğine çaresiz bir kurbağaya dönüştürür!',
    descEn: 'Transforms a hostile fighter into a helpless frog for 5.5 seconds!',
    color: '#c084fc',
  },
  divine_smite: {
    nameTr: 'GÖK YARGISI (YILDIRIM)',
    nameEn: 'DIVINE SMITE',
    descTr: 'Gökyüzünden düşman saflarına 3 devasa ilahi yıldırım sütunu indirir.',
    descEn: 'Calls down 3 colossal sky-to-ground divine lightning pillars on foes.',
    color: '#fbbf24',
  },
  necromancy: {
    nameTr: 'ÖLÜLERİ DİRİLT',
    nameEn: 'RAISE UNDEAD',
    descTr: 'Savaş alanının toprağından kendi saflarında yeni ölümsüz savaşçılar diriltir.',
    descEn: 'Summons fresh undead warriors directly out of the battlefield ground.',
    color: '#a855f7',
  },
  fire_breath: {
    nameTr: 'EJDERHA NEFESİ',
    nameEn: 'DRAGON BREATH',
    descTr: 'Önündeki geniş koni alanına 5 alev/enerji topu püskürtür.',
    descEn: 'Exhales a sweeping 5-bolt cone of elemental breath across enemies.',
    color: '#ff453a',
  },
  apex_roar: {
    nameTr: 'KORKU KÜKREMESİ',
    nameEn: 'APEX ROAR',
    descTr: 'Akustik şok dalgasıyla yakındaki küçük düşmanları 2.8 sn panikle kaçırır.',
    descEn: 'Acoustic shockwave inflicts fear, forcing smaller enemies to flee for 2.8s.',
    color: '#f97316',
  },
  shield_wall: {
    nameTr: 'DEMİR KALKAN (AEGİS)',
    nameEn: 'IRON AEGIS',
    descTr: '3.5 saniyeliğine %80 hasar direnci ve savrulma bağışıklığı kazanır.',
    descEn: 'Activates an armored stance granting 80% damage reduction & knockback immunity.',
    color: '#3b82f6',
  },
  berserk_leap: {
    nameTr: 'ÖFKE SIÇRAYIŞI',
    nameEn: 'SEISMIC LEAP',
    descTr: 'Havaya sıçrayıp düşman grubunun ortasına şok dalgalı darbe indirir.',
    descEn: 'Leaps skyward and crashes into enemy clusters with a seismic slam.',
    color: '#ef4444',
  },
  shadow_blink: {
    nameTr: 'GÖLGE IŞINLANMASI',
    nameEn: 'SHADOW BLINK',
    descTr: 'Duman bulutu içinde düşman arka hattına ışınlanıp 2.2× kritik vurur.',
    descEn: 'Teleports behind enemy backlines in smoke for a 2.2× critical strike.',
    color: '#ec4899',
  },
  stampede: {
    nameTr: 'KOÇBAŞI HÜCUMU',
    nameEn: 'STAMPEDE CHARGE',
    descTr: '2.1× hız patlamasıyla önündeki tüm birimleri ezip havaya fırlatır.',
    descEn: 'Bursts forward at 2.1× speed plowing and launching everyone in its path.',
    color: '#eab308',
  },
  barrage: {
    nameTr: 'SALVO YAYLIM ATEŞİ',
    nameEn: 'SALVO BARRAGE',
    descTr: 'Hedef bölgeye art arda 3 yüksek yıkımlı salvo atışı indirir.',
    descEn: 'Unleashes a rapid 3-round high-impact salvo onto the target zone.',
    color: '#f59e0b',
  },
  emp_pulse: {
    nameTr: 'EMP ŞOK DALGASI',
    nameEn: 'EMP OVERLOAD',
    descTr: 'Yakındaki tüm düşmanları ve makineleri 2.2 saniye felç edip durdurur.',
    descEn: 'Emits an electric pulse stunning nearby enemies and machines for 2.2s.',
    color: '#38bdf8',
  },
  venom_cloud: {
    nameTr: 'ZEHİR BULUTU',
    nameEn: 'VENOM CLOUD',
    descTr: 'Zeminde 4 saniye kalan toksik bulut bırakarak hasar verir ve yavaşlatır.',
    descEn: 'Releases a lingering 4s toxic cloud dealing continuous damage & slow.',
    color: '#22c55e',
  },
  pack_howl: {
    nameTr: 'SÜRÜ ÇAĞRISI (HIZ)',
    nameEn: 'WARCRY HASTE',
    descTr: '9m içindeki tüm dost birimlere 4 sn boyunca +%45 hız ve saldırı hızı verir.',
    descEn: 'Rallies allies within 9m with +45% movement and attack speed for 4s.',
    color: '#fbbf24',
  },
  heal_nova: {
    nameTr: 'ŞİFA DALGASI',
    nameEn: 'HEALING NOVA',
    descTr: '8.5m içindeki tüm dost birimlerin canını anında +%35 yeniler.',
    descEn: 'Emits an emerald wave restoring +35% HP to all allies within 8.5m.',
    color: '#10b981',
  },
};

export function getAbilityLabel(kind: SpecialAbilityKind, lang: Lang): string {
  return lang === 'tr' ? SPECIAL_ABILITY_META[kind].nameTr : SPECIAL_ABILITY_META[kind].nameEn;
}
