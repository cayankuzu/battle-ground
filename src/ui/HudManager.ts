import {
  AIBehavior,
  ArenaBiome,
  Lang,
  QualityTier,
  RenderStyle,
  SpawnConfig,
  SpecialAbilityKind,
  Team,
  TeamSetting,
  TelemetryStats,
  ToolMode,
  UnitCategory,
  UnitTraits,
  VictoryReport,
} from '../types';
import { CATALOG_MAP, findModeEquivalent, getCatalogForMode } from '../data/catalog';
import { SPECIAL_ABILITY_META, formatEnergy, formatMass, getAbilityLabel } from '../data/science';
import { BATTLE_PRESETS } from '../data/presets';
import { BIOME_META, CATEGORY_META, QUALITY_META, RENDER_STYLE_META, t } from '../i18n';
import { BattleEngine, UnitEntity } from '../engine/BattleEngine';
import { ThumbnailRenderer } from '../engine/ThumbnailRenderer';
import { ICONS } from './icons';

export class HudManager {
  public lang: Lang = 'tr';
  public tool: ToolMode = 'brush';
  public activeCategory: UnitCategory = 'gods';
  public searchQuery = '';

  public spawnConfig: SpawnConfig = {
    catalogId: 'god_seraph',
    teamSetting: 'auto',
    ai: 'aggressive',
    scale: 1.0,
    hpMult: 1.0,
    dmgMult: 1.0,
    spdMult: 1.0,
    brushSize: 3,
  };

  private lastAbilityFeedAt = 0;

  private inspectedUnit: UnitEntity | null = null;
  private specCatalogId: string | null = null;
  private cinematicMode = false;
  private emptyBarDismissed = false;
  private emptyBarCollapsed = false;
  private lastTotalEntities = 0;

  // Cached DOM references
  private readonly elSimPill = document.getElementById('sim-state-pill')!;
  private readonly elSimLabel = document.getElementById('sim-state-label')!;
  private readonly elPlayBtn = document.getElementById('btn-play-pause')!;
  private readonly elPlayIcon = document.getElementById('play-pause-icon')!;
  private readonly elPlayText = document.getElementById('play-pause-text')!;
  private readonly elRedCount = document.getElementById('red-count')!;
  private readonly elBlueCount = document.getElementById('blue-count')!;
  private readonly elFfaStat = document.getElementById('ffa-stat')!;
  private readonly elFfaCount = document.getElementById('ffa-count')!;
  private readonly elBalRed = document.getElementById('balance-red')!;
  private readonly elBalBlue = document.getElementById('balance-blue')!;
  private readonly elKillCount = document.getElementById('kill-count')!;
  private readonly elFps = document.getElementById('fps-counter')!;
  private readonly elEmptyHint = document.getElementById('empty-hint-bar')!;
  private readonly elDockTabs = document.getElementById('dock-tabs')!;
  private readonly elUnitRail = document.getElementById('unit-cards-rail')!;
  private readonly elSearch = document.getElementById('unit-search') as HTMLInputElement;
  private readonly elInspector = document.getElementById('unit-inspector')!;
  private readonly elSpecDrawer = document.getElementById('char-spec-drawer')!;
  private readonly elVictory = document.getElementById('victory-banner')!;
  private readonly elToasts = document.getElementById('toast-container')!;

  constructor(
    private readonly engine: BattleEngine,
    private readonly thumbnails: ThumbnailRenderer
  ) {
    this.hydrateStaticIcons();
    this.bindControls();
    this.renderDockTabs();
    this.renderUnitCards();
    this.renderPresets();
    this.renderGraphicsModal();
    this.applyLanguage();
    this.updateSelectedPreview();
    this.syncSimStateUI();
    this.syncModeStatusStrip();

    this.engine.onSelectionChange = (unit) => {
      this.inspectedUnit = unit;
      if (unit) {
        this.closeSpecDrawer();
      }
      this.syncInspectorUI();
    };

    this.engine.onVictory = (report) => {
      this.showVictoryReport(report);
    };

    this.engine.onAbilityCast = (unit, ability) => {
      this.pushAbilityFeed(unit, ability);
    };
  }

  private pushAbilityFeed(unit: UnitEntity, ability: SpecialAbilityKind): void {
    const now = performance.now();
    if (now - this.lastAbilityFeedAt < 550) return;
    this.lastAbilityFeedAt = now;

    const feed = document.getElementById('ability-feed');
    if (!feed) return;
    const meta = SPECIAL_ABILITY_META[ability];
    const unitName = (this.lang === 'tr' ? unit.catalog.nameTr : unit.catalog.nameEn).toUpperCase();
    const abName = getAbilityLabel(ability, this.lang);

    const row = document.createElement('div');
    row.className = 'ability-event';
    row.style.setProperty('--ev-color', meta.color);
    row.innerHTML = `${unitName} &rarr; <span>${abName}</span>`;
    feed.appendChild(row);

    while (feed.children.length > 3) {
      feed.firstElementChild?.remove();
    }

    setTimeout(() => {
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 260);
    }, 2400);
  }

  private hydrateStaticIcons(): void {
    document.querySelectorAll<HTMLElement>('[data-svg]').forEach((el) => {
      const key = el.dataset.svg as keyof typeof ICONS;
      if (ICONS[key]) el.innerHTML = ICONS[key];
    });
    document.getElementById('audio-svg')!.innerHTML = ICONS.audioOn;
  }

  private bindControls(): void {
    this.elPlayBtn.addEventListener('click', () => this.togglePlayPause());
    document.getElementById('btn-rewind')!.addEventListener('click', () => this.triggerRewind());
    document.getElementById('btn-clear')!.addEventListener('click', () => this.triggerClear());

    document.querySelectorAll<HTMLButtonElement>('#speed-group .speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const spd = parseFloat(btn.dataset.speed || '1');
        this.engine.timeScale = spd;
        document.querySelectorAll('#speed-group .speed-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.engine.sound.playUiClick(540 + spd * 70);
      });
    });

    document.getElementById('btn-graphics')!.addEventListener('click', () => {
      this.renderGraphicsModal();
      this.openModal('graphics-modal');
    });

    document.getElementById('btn-presets')!.addEventListener('click', () => {
      this.openModal('presets-modal');
    });

    document.getElementById('btn-camera-reset')!.addEventListener('click', () => {
      this.engine.followUnitId = null;
      this.engine.arena.resetCamera();
      this.syncInspectorUI();
      this.engine.sound.playUiClick(620);
    });

    document.getElementById('btn-audio')!.addEventListener('click', () => this.toggleAudio());

    document.getElementById('btn-lang')!.addEventListener('click', () => {
      this.lang = this.lang === 'tr' ? 'en' : 'tr';
      this.applyLanguage();
      this.engine.sound.playUiClick(680);
    });

    document.getElementById('btn-help')!.addEventListener('click', () => this.openModal('help-modal'));
    document.getElementById('btn-hide-hud')!.addEventListener('click', () => this.toggleCinematic());
    document.getElementById('btn-show-hud')!.addEventListener('click', () => this.toggleCinematic());

    document.querySelectorAll<HTMLElement>('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => this.closeModal(btn.dataset.closeModal!));
    });
    document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) {
          bd.classList.add('hidden');
          this.syncModalOpenClass();
        }
      });
    });

    document.getElementById('btn-toggle-panel')!.addEventListener('click', () => {
      const collapsed = document.getElementById('command-panel')!.classList.toggle('collapsed');
      document.body.classList.toggle('panel-collapsed', collapsed);
      this.engine.sound.playUiClick(520);
    });
    document.getElementById('btn-toggle-dock')!.addEventListener('click', () => this.toggleDock());

    // Collapsible & closable Empty-Arena Quick-Start Bar
    document.getElementById('btn-empty-toggle')!.addEventListener('click', () => {
      this.emptyBarCollapsed = !this.emptyBarCollapsed;
      this.elEmptyHint.classList.toggle('collapsed', this.emptyBarCollapsed);
      this.engine.sound.playUiClick(560);
    });
    document.getElementById('btn-empty-close')!.addEventListener('click', () => {
      this.emptyBarDismissed = true;
      this.syncEmptyHintVisibility(this.lastTotalEntities);
      this.engine.sound.playUiClick(480);
    });
    document.getElementById('btn-empty-reopen')!.addEventListener('click', () => {
      this.emptyBarDismissed = false;
      this.emptyBarCollapsed = false;
      this.elEmptyHint.classList.remove('collapsed');
      this.syncEmptyHintVisibility(this.lastTotalEntities);
      this.engine.sound.playUiClick(620);
    });

    // Tool grid
    document.querySelectorAll<HTMLButtonElement>('#tool-grid .tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool as ToolMode));
    });

    // Team selector
    document.querySelectorAll<HTMLButtonElement>('#team-selector .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.spawnConfig.teamSetting = btn.dataset.team as TeamSetting;
        document.querySelectorAll('#team-selector .seg-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.syncModeStatusStrip();
        this.engine.sound.playUiClick(600);
      });
    });

    // Spawn AI behavior selector
    document.querySelectorAll<HTMLButtonElement>('#spawn-ai-selector .ai-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.spawnConfig.ai = btn.dataset.ai as AIBehavior;
        document.querySelectorAll('#spawn-ai-selector .ai-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.syncModeStatusStrip();
        this.engine.sound.playUiClick(610);
      });
    });

    // Left panel sliders
    this.bindSlider('slider-brush-size', 'val-brush-size', (v) => {
      this.spawnConfig.brushSize = v;
      this.syncModeStatusStrip();
      return String(v);
    });
    this.bindSlider('slider-scale', 'val-scale', (v) => {
      this.spawnConfig.scale = v;
      return `${v.toFixed(1)}×`;
    });
    this.bindSlider('slider-hp', 'val-hp', (v) => {
      this.spawnConfig.hpMult = v;
      return `${v.toFixed(2).replace(/\.00$/, '.0')}×`;
    });
    this.bindSlider('slider-dmg', 'val-dmg', (v) => {
      this.spawnConfig.dmgMult = v;
      return `${v.toFixed(2).replace(/\.00$/, '.0')}×`;
    });
    this.bindSlider('slider-spd', 'val-spd', (v) => {
      this.spawnConfig.spdMult = v;
      return `${v.toFixed(1)}×`;
    });

    document.getElementById('btn-reset-stats')!.addEventListener('click', () => {
      this.spawnConfig.brushSize = 3;
      this.spawnConfig.scale = 1.0;
      this.spawnConfig.hpMult = 1.0;
      this.spawnConfig.dmgMult = 1.0;
      this.spawnConfig.spdMult = 1.0;
      (document.getElementById('slider-brush-size') as HTMLInputElement).value = '3';
      (document.getElementById('slider-scale') as HTMLInputElement).value = '1.0';
      (document.getElementById('slider-hp') as HTMLInputElement).value = '1.0';
      (document.getElementById('slider-dmg') as HTMLInputElement).value = '1.0';
      (document.getElementById('slider-spd') as HTMLInputElement).value = '1.0';
      document.getElementById('val-brush-size')!.textContent = '3';
      document.getElementById('val-scale')!.textContent = '1.0×';
      document.getElementById('val-hp')!.textContent = '1.0×';
      document.getElementById('val-dmg')!.textContent = '1.0×';
      document.getElementById('val-spd')!.textContent = '1.0×';
      this.syncModeStatusStrip();
      this.engine.sound.playUiClick(500);
    });

    // Global Army Order buttons (persist active visual highlight!)
    document.querySelectorAll<HTMLButtonElement>('[data-order-team]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const team = btn.dataset.orderTeam as 'red' | 'blue';
        const ai = btn.dataset.orderAi as AIBehavior;
        this.engine.issueTeamOrder(team, ai);
        this.syncArmyOrderHighlights();
        this.showToast(t(this.lang, 'toastOrderApplied'));
      });
    });

    // Search filter + horizontal wheel scroll on bottom rail
    this.elSearch.addEventListener('input', () => {
      this.searchQuery = this.elSearch.value.trim().toLowerCase();
      this.renderUnitCards();
    });

    this.elUnitRail.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          this.elUnitRail.scrollLeft += e.deltaY * 1.4;
        }
      },
      { passive: false }
    );

    const railLeftBtn = document.getElementById('btn-rail-left') as HTMLButtonElement;
    const railRightBtn = document.getElementById('btn-rail-right') as HTMLButtonElement;
    railLeftBtn.addEventListener('click', () => {
      this.elUnitRail.scrollBy({ left: -330, behavior: 'smooth' });
    });
    railRightBtn.addEventListener('click', () => {
      this.elUnitRail.scrollBy({ left: 330, behavior: 'smooth' });
    });
    this.elUnitRail.addEventListener('scroll', () => this.updateRailNavButtons());
    window.addEventListener('resize', () => this.updateRailNavButtons());

    // Per-Character Spec Drawer bindings
    document.getElementById('btn-open-spec')!.addEventListener('click', () => {
      if (this.specCatalogId === this.spawnConfig.catalogId && !this.elSpecDrawer.classList.contains('hidden')) {
        this.closeSpecDrawer();
      } else {
        this.openSpecDrawer(this.spawnConfig.catalogId);
      }
    });
    document.getElementById('btn-close-spec')!.addEventListener('click', () => this.closeSpecDrawer());

    const bindSpecRange = (id: string, valId: string, fmt: (v: number) => string, apply: (v: number) => void) => {
      const inp = document.getElementById(id) as HTMLInputElement;
      const out = document.getElementById(valId)!;
      inp.addEventListener('input', () => {
        if (!this.specCatalogId) return;
        const v = parseFloat(inp.value);
        out.textContent = fmt(v);
        apply(v);
        this.renderUnitCards();
        this.updateSelectedPreview();
      });
    };

    bindSpecRange('spec-hp', 'spec-hp-val', (v) => String(Math.round(v)), (v) => {
      this.engine.setSpeciesOverride(this.specCatalogId!, { hp: v });
    });
    bindSpecRange('spec-dmg', 'spec-dmg-val', (v) => String(Math.round(v)), (v) => {
      this.engine.setSpeciesOverride(this.specCatalogId!, { damage: v });
    });
    bindSpecRange('spec-spd', 'spec-spd-val', (v) => v.toFixed(1), (v) => {
      this.engine.setSpeciesOverride(this.specCatalogId!, { speed: v });
    });
    bindSpecRange('spec-range', 'spec-range-val', (v) => v.toFixed(1), (v) => {
      this.engine.setSpeciesOverride(this.specCatalogId!, { attackRange: v });
    });
    bindSpecRange('spec-armor', 'spec-armor-val', (v) => `${Math.round(v)}%`, (v) => {
      this.engine.setSpeciesOverride(this.specCatalogId!, { armor: v / 100 });
    });
    bindSpecRange('spec-scale', 'spec-scale-val', (v) => `${v.toFixed(1)}×`, (v) => {
      this.engine.setSpeciesOverride(this.specCatalogId!, { scale: v });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-spec-trait]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.specCatalogId) return;
        const trait = btn.dataset.specTrait as keyof UnitTraits;
        const spec = this.engine.getEffectiveSpec(this.specCatalogId);
        const next = !spec.traits[trait];
        this.engine.setSpeciesOverride(this.specCatalogId, { traits: { [trait]: next } });
        btn.classList.toggle('active', next);
        this.renderUnitCards();
        this.engine.sound.playUiClick(640);
      });
    });

    document.getElementById('btn-spec-apply')!.addEventListener('click', () => {
      if (!this.specCatalogId) return;
      this.engine.applySpeciesOverrideToField(this.specCatalogId);
      this.showToast(t(this.lang, 'toastSpecApplied'));
      this.engine.sound.playUiClick(720);
    });

    document.getElementById('btn-spec-reset')!.addEventListener('click', () => {
      if (!this.specCatalogId) return;
      this.engine.resetSpeciesOverride(this.specCatalogId);
      this.openSpecDrawer(this.specCatalogId);
      this.renderUnitCards();
      this.updateSelectedPreview();
      this.engine.sound.playUiClick(500);
    });

    document.getElementById('btn-spec-purge')!.addEventListener('click', () => {
      if (!this.specCatalogId) return;
      const n = this.engine.purgeSpeciesFromField(this.specCatalogId);
      this.updateTelemetry(this.engine.getTelemetry());
      if (n > 0) this.showToast(`${t(this.lang, 'toastSpecPurged')} (${n})`);
    });

    // Live Placed Unit Inspector bindings
    document.getElementById('btn-close-inspector')!.addEventListener('click', () => {
      this.engine.selectedUnitId = null;
      this.inspectedUnit = null;
      this.syncInspectorUI();
    });

    document.querySelectorAll<HTMLButtonElement>('[data-insp-ai]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.inspectedUnit) return;
        this.engine.setUnitBehavior(this.inspectedUnit.id, btn.dataset.inspAi as AIBehavior);
        this.syncInspectorUI();
        this.engine.sound.playUiClick(620);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-insp-team]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.inspectedUnit) return;
        this.engine.setUnitTeam(this.inspectedUnit.id, btn.dataset.inspTeam as Team);
        this.syncInspectorUI();
        this.engine.sound.playUiClick(620);
      });
    });

    const inspScale = document.getElementById('insp-scale-slider') as HTMLInputElement;
    inspScale.addEventListener('input', () => {
      if (!this.inspectedUnit) return;
      const val = parseFloat(inspScale.value);
      this.engine.setUnitScale(this.inspectedUnit.id, val);
      document.getElementById('insp-scale-val')!.textContent = `${val.toFixed(1)}×`;
    });

    const inspDmg = document.getElementById('insp-dmg-slider') as HTMLInputElement;
    inspDmg.addEventListener('input', () => {
      if (!this.inspectedUnit) return;
      const val = parseFloat(inspDmg.value);
      this.engine.setUnitStat(this.inspectedUnit.id, 'damage', val);
      document.getElementById('insp-dmg-val')!.textContent = String(Math.round(val));
    });

    document.querySelectorAll<HTMLButtonElement>('[data-insp-trait]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.inspectedUnit) return;
        const trait = btn.dataset.inspTrait as keyof UnitTraits;
        const next = !this.inspectedUnit.traits[trait];
        this.engine.setUnitTrait(this.inspectedUnit.id, trait, next);
        btn.classList.toggle('active', next);
        this.engine.sound.playUiClick(640);
      });
    });

    document.getElementById('btn-insp-heal')!.addEventListener('click', () => {
      if (this.inspectedUnit) {
        this.engine.healUnit(this.inspectedUnit.id);
        this.syncInspectorUI();
      }
    });

    document.getElementById('btn-insp-clone')!.addEventListener('click', () => {
      if (this.inspectedUnit) {
        this.engine.cloneUnit(this.inspectedUnit.id);
        this.updateTelemetry(this.engine.getTelemetry());
      }
    });

    document.getElementById('btn-insp-follow')!.addEventListener('click', () => {
      if (!this.inspectedUnit) return;
      this.engine.toggleFollowUnit(this.inspectedUnit.id);
      this.syncInspectorUI();
      this.engine.sound.playUiClick(650);
    });

    document.getElementById('btn-insp-delete')!.addEventListener('click', () => {
      if (this.inspectedUnit) {
        this.engine.deleteUnit(this.inspectedUnit.id);
        this.updateTelemetry(this.engine.getTelemetry());
      }
    });

    document.getElementById('btn-insp-special')!.addEventListener('click', () => {
      if (!this.inspectedUnit) return;
      if (this.engine.triggerUnitSpecial(this.inspectedUnit.id)) {
        this.showToast(
          `${t(this.lang, 'toastSpecialUsed')}: ${getAbilityLabel(this.inspectedUnit.catalog.specialAbility, this.lang)}`
        );
      }
    });

    // World physics controls inside Graphics modal
    const gravInput = document.getElementById('slider-gravity') as HTMLInputElement;
    gravInput.addEventListener('input', () => {
      const g = parseFloat(gravInput.value);
      this.engine.applyWorldSettings({ gravityScale: g });
      document.getElementById('val-gravity')!.textContent = `${g.toFixed(1)}g`;
    });

    const wireWorldToggle = (id: string, key: 'enclosedWalls' | 'friendlyFire' | 'persistCorpses') => {
      const el = document.getElementById(id)!;
      el.addEventListener('click', () => {
        const next = !this.engine.worldSettings[key];
        this.engine.applyWorldSettings({ [key]: next });
        el.classList.toggle('active', next);
        this.engine.sound.playUiClick(620);
      });
    };
    wireWorldToggle('toggle-walls', 'enclosedWalls');
    wireWorldToggle('toggle-ff', 'friendlyFire');
    wireWorldToggle('toggle-corpses', 'persistCorpses');

    // Victory buttons (also dismiss when clicking dark backdrop)
    this.elVictory.addEventListener('click', (e) => {
      if (e.target === this.elVictory) this.elVictory.classList.add('hidden');
    });
    document.getElementById('btn-victory-close')!.addEventListener('click', () => {
      this.elVictory.classList.add('hidden');
    });
    document.getElementById('btn-victory-rematch')!.addEventListener('click', () => {
      this.elVictory.classList.add('hidden');
      this.triggerRewind();
      this.engine.running = true;
      this.syncSimStateUI();
    });
    document.getElementById('btn-victory-continue')!.addEventListener('click', () => {
      this.elVictory.classList.add('hidden');
    });
  }

  private bindSlider(id: string, valId: string, onChange: (val: number) => string): void {
    const input = document.getElementById(id) as HTMLInputElement;
    const valEl = document.getElementById(valId)!;
    input.addEventListener('input', () => {
      valEl.textContent = onChange(parseFloat(input.value));
    });
  }

  private syncStylePill(): void {
    const style = this.engine.worldSettings.renderStyle;
    const pill = document.getElementById('active-style-pill');
    if (!pill) return;
    if (style === 'hybrid') pill.textContent = this.lang === 'tr' ? 'KARMA' : 'HYBRID';
    else if (style === 'ultra') pill.textContent = 'ULTRA';
    else if (style === 'realistic') pill.textContent = this.lang === 'tr' ? 'STİLİZE' : 'CLASSIC';
    else if (style === 'manga') pill.textContent = 'MANGA';
    else if (style === 'pixel') pill.textContent = this.lang === 'tr' ? 'VOKSEL' : 'VOXEL';
    else pill.textContent = 'CAD';
  }

  private syncDrawerOpenClass(): void {
    const isOpen =
      !this.elSpecDrawer.classList.contains('hidden') || !this.elInspector.classList.contains('hidden');
    document.body.classList.toggle('drawer-open', isOpen);
  }

  public setRenderStyle(style: RenderStyle, silent = false): void {
    this.engine.applyWorldSettings({ renderStyle: style });
    document.body.dataset.renderStyle = style;
    const meta = RENDER_STYLE_META[style];
    this.syncStylePill();

    // Ensure selected unit & active category belong authentically to this mode's exclusive 3D roster!
    const modeItems = getCatalogForMode(style);
    const eq = findModeEquivalent(this.spawnConfig.catalogId, style) ?? modeItems[0];
    if (eq) {
      this.spawnConfig.catalogId = eq.id;
      this.activeCategory = eq.category;
    }

    this.renderGraphicsModal();
    this.syncModeStatusStrip();
    this.renderDockTabs();
    this.renderUnitCards();
    this.updateSelectedPreview();
    if (this.specCatalogId) {
      const specEq = findModeEquivalent(this.specCatalogId, style);
      if (specEq) this.openSpecDrawer(specEq.id);
      else this.closeSpecDrawer();
    }
    if (this.inspectedUnit) this.syncInspectorUI();
    if (!silent) {
      this.showToast(`${t(this.lang, 'toastStyleChanged')}: ${this.lang === 'tr' ? meta.tr : meta.en}`);
      this.engine.sound.playUiClick(660);
    }
  }

  public setBiome(biome: ArenaBiome, silent = false): void {
    this.engine.applyWorldSettings({ biome });
    this.renderGraphicsModal();
    if (!silent) {
      this.showToast(`${t(this.lang, 'toastBiomeChanged')}: ${this.lang === 'tr' ? BIOME_META[biome].tr : BIOME_META[biome].en}`);
      this.engine.sound.playUiClick(600);
    }
  }

  public setQuality(quality: QualityTier): void {
    this.engine.applyWorldSettings({ quality });
    this.renderGraphicsModal();
    this.engine.sound.playUiClick(620);
  }

  private renderGraphicsModal(): void {
    const ws = this.engine.worldSettings;

    // 6 Game & Render Style Cards (3x2 grid including Hybrid/Karma mode)
    const styleGrid = document.getElementById('render-style-grid')!;
    styleGrid.innerHTML = '';
    const styles: RenderStyle[] = ['hybrid', 'ultra', 'realistic', 'manga', 'pixel', 'blueprint'];
    for (const s of styles) {
      const m = RENDER_STYLE_META[s];
      const btn = document.createElement('button');
      btn.className = `style-card ${ws.renderStyle === s ? 'active' : ''}`;
      btn.innerHTML = `
        <span class="style-code">${m.code}</span>
        <span class="style-name">${this.lang === 'tr' ? m.tr : m.en}</span>
        <span class="style-desc">${this.lang === 'tr' ? m.descTr : m.descEn}</span>
      `;
      btn.addEventListener('click', () => this.setRenderStyle(s));
      styleGrid.appendChild(btn);
    }

    // 4 Quality Tiers
    const qGrid = document.getElementById('quality-grid')!;
    qGrid.innerHTML = '';
    const tiers: QualityTier[] = ['low', 'medium', 'high', 'ultra'];
    for (const q of tiers) {
      const btn = document.createElement('button');
      btn.className = `seg-btn ${ws.quality === q ? 'active' : ''}`;
      btn.textContent = this.lang === 'tr' ? QUALITY_META[q].tr : QUALITY_META[q].en;
      btn.addEventListener('click', () => this.setQuality(q));
      qGrid.appendChild(btn);
    }

    // 5 Arena Biomes
    const bGrid = document.getElementById('biome-grid')!;
    bGrid.innerHTML = '';
    const biomes: ArenaBiome[] = ['obsidian', 'desert', 'arctic', 'volcanic', 'orbital'];
    for (const b of biomes) {
      const btn = document.createElement('button');
      btn.className = `seg-btn ${ws.biome === b ? 'active' : ''}`;
      btn.textContent = this.lang === 'tr' ? BIOME_META[b].tr : BIOME_META[b].en;
      btn.addEventListener('click', () => this.setBiome(b));
      bGrid.appendChild(btn);
    }

    document.getElementById('toggle-walls')!.classList.toggle('active', ws.enclosedWalls);
    document.getElementById('toggle-ff')!.classList.toggle('active', ws.friendlyFire);
    document.getElementById('toggle-corpses')!.classList.toggle('active', ws.persistCorpses);
  }

  public openSpecDrawer(catalogId: string): void {
    const item = CATALOG_MAP.get(catalogId);
    if (!item) return;
    // Close live unit inspector to avoid stacked drawers
    this.engine.selectedUnitId = null;
    this.inspectedUnit = null;
    this.elInspector.classList.add('hidden');

    this.specCatalogId = catalogId;
    const spec = this.engine.getEffectiveSpec(catalogId);

    document.getElementById('spec-name')!.textContent = this.lang === 'tr' ? item.nameTr : item.nameEn;
    document.getElementById('spec-role')!.textContent = this.lang === 'tr' ? item.roleTr : item.roleEn;
    document.getElementById('spec-desc')!.textContent = this.lang === 'tr' ? item.descTr : item.descEn;

    // Populate Real-World Scientific Telemetry
    const sci = item.science;
    document.getElementById('sci-mass')!.textContent = formatMass(sci.massKg);
    document.getElementById('sci-speed')!.textContent = sci.speedKmh > 0 ? `${sci.speedKmh} km/h` : '0 km/h';
    document.getElementById('sci-energy')!.textContent = sci.forceN
      ? `${(sci.forceN / 1000).toFixed(0)} kN`
      : formatEnergy(sci.energyJ);
    document.getElementById('sci-armor')!.textContent = `${Math.round(sci.kineticArmor * 100)}%`;
    document.getElementById('sci-material')!.textContent = this.lang === 'tr' ? sci.armorMaterialTr : sci.armorMaterialEn;
    document.getElementById('sci-note')!.textContent = this.lang === 'tr' ? sci.scienceNoteTr : sci.scienceNoteEn;

    // Populate Signature Special Power
    const abMeta = SPECIAL_ABILITY_META[item.specialAbility];
    const specBox = document.getElementById('spec-special-box')!;
    specBox.style.borderLeftColor = abMeta.color;
    const abNameEl = document.getElementById('spec-ability-name')!;
    abNameEl.style.color = abMeta.color;
    abNameEl.textContent = this.lang === 'tr' ? abMeta.nameTr : abMeta.nameEn;
    document.getElementById('spec-ability-desc')!.textContent = this.lang === 'tr' ? abMeta.descTr : abMeta.descEn;

    const setRange = (id: string, valId: string, val: number, text: string, dynamicMax?: number) => {
      const inp = document.getElementById(id) as HTMLInputElement;
      if (dynamicMax !== undefined) inp.max = String(dynamicMax);
      inp.value = String(val);
      document.getElementById(valId)!.textContent = text;
    };

    const hpMax = Math.max(3500, Math.ceil((Math.max(item.hp, spec.hp) * 2.5) / 100) * 100);
    const dmgMax = Math.max(600, Math.ceil((Math.max(item.damage, spec.damage) * 2.5) / 10) * 10);

    setRange('spec-hp', 'spec-hp-val', Math.min(hpMax, spec.hp), String(Math.round(spec.hp)), hpMax);
    setRange('spec-dmg', 'spec-dmg-val', Math.min(dmgMax, spec.damage), String(Math.round(spec.damage)), dmgMax);
    setRange('spec-spd', 'spec-spd-val', Math.min(15, spec.speed), spec.speed.toFixed(1));
    setRange('spec-range', 'spec-range-val', Math.min(36, spec.attackRange), spec.attackRange.toFixed(1));
    setRange('spec-armor', 'spec-armor-val', Math.round(spec.armor * 100), `${Math.round(spec.armor * 100)}%`);
    setRange('spec-scale', 'spec-scale-val', spec.scale, `${spec.scale.toFixed(1)}×`);

    document.querySelectorAll<HTMLElement>('[data-spec-trait]').forEach((el) => {
      const tr = el.dataset.specTrait as keyof UnitTraits;
      el.classList.toggle('active', spec.traits[tr]);
    });

    this.refreshSpecPortrait();
    this.elSpecDrawer.classList.remove('hidden');
    document.getElementById('btn-open-spec')!.classList.add('active');
    this.syncDrawerOpenClass();
    this.engine.sound.playUiClick(640);
  }

  public closeSpecDrawer(): void {
    this.specCatalogId = null;
    this.elSpecDrawer.classList.add('hidden');
    document.getElementById('btn-open-spec')!.classList.remove('active');
    this.syncDrawerOpenClass();
  }

  private refreshSpecPortrait(): void {
    if (!this.specCatalogId) return;
    const item = CATALOG_MAP.get(this.specCatalogId);
    if (!item) return;
    const img = document.getElementById('spec-portrait') as HTMLImageElement;
    this.thumbnails.renderPortrait(item, this.engine.worldSettings.renderStyle).then((url) => {
      if (url && this.specCatalogId === item.id) img.src = url;
    });
  }

  private refreshInspPortrait(): void {
    if (!this.inspectedUnit) return;
    const item = this.inspectedUnit.catalog;
    const img = document.getElementById('insp-portrait') as HTMLImageElement;
    this.thumbnails.renderPortrait(item, this.engine.worldSettings.renderStyle).then((url) => {
      if (url && this.inspectedUnit?.catalog.id === item.id) img.src = url;
    });
  }

  public setTool(next: ToolMode): void {
    this.tool = next;
    document.querySelectorAll('#tool-grid .tool-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tool === next);
    });
    const container = document.getElementById('canvas-container')!;
    container.style.cursor = next === 'select' ? 'pointer' : next === 'erase' ? 'not-allowed' : 'crosshair';
    this.syncModeStatusStrip();
    this.engine.sound.playUiClick(580);
  }

  private syncModeStatusStrip(): void {
    const toolMap: Record<ToolMode, string> = {
      brush: t(this.lang, 'toolBrush'),
      single: t(this.lang, 'toolSingle'),
      squad: t(this.lang, 'toolSquad'),
      rally: t(this.lang, 'toolRally'),
      select: t(this.lang, 'toolSelect'),
      erase: t(this.lang, 'toolErase'),
    };
    const chipTool = document.getElementById('chip-tool')!;
    chipTool.textContent = `${toolMap[this.tool]}${this.tool === 'brush' || this.tool === 'squad' ? ` [${this.spawnConfig.brushSize}]` : ''}`;
    chipTool.className = `status-chip ${this.tool === 'erase' ? 'hl-red' : 'hl-white'}`;

    const teamMap: Record<TeamSetting, { label: string; cls: string }> = {
      auto: { label: t(this.lang, 'teamAuto'), cls: '' },
      red: { label: t(this.lang, 'teamRed'), cls: 'hl-red' },
      blue: { label: t(this.lang, 'teamBlue'), cls: 'hl-blue' },
      ffa: { label: t(this.lang, 'teamFfa'), cls: 'hl-amber' },
    };
    const tm = teamMap[this.spawnConfig.teamSetting];
    const chipTeam = document.getElementById('chip-team')!;
    chipTeam.textContent = tm.label;
    chipTeam.className = `status-chip ${tm.cls}`;

    const aiMap: Record<AIBehavior, { label: string; cls: string }> = {
      aggressive: { label: t(this.lang, 'aiAggressive'), cls: 'hl-red' },
      hold: { label: t(this.lang, 'aiHold'), cls: 'hl-blue' },
      passive: { label: t(this.lang, 'aiPassive'), cls: 'hl-white' },
      flee: { label: t(this.lang, 'aiFlee'), cls: 'hl-amber' },
    };
    const am = aiMap[this.spawnConfig.ai];
    const chipAi = document.getElementById('chip-ai')!;
    chipAi.textContent = am.label;
    chipAi.className = `status-chip ${am.cls}`;

    const stMeta = RENDER_STYLE_META[this.engine.worldSettings.renderStyle];
    const chipStyle = document.getElementById('chip-style')!;
    chipStyle.textContent = this.lang === 'tr' ? stMeta.tr : stMeta.en;
  }

  private syncArmyOrderHighlights(): void {
    document.querySelectorAll<HTMLElement>('#order-row-red .order-mini').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.orderAi === this.engine.lastTeamOrder.red);
    });
    document.querySelectorAll<HTMLElement>('#order-row-blue .order-mini').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.orderAi === this.engine.lastTeamOrder.blue);
    });
  }

  public adjustBrushSize(delta: number): void {
    const next = Math.max(1, Math.min(10, this.spawnConfig.brushSize + delta));
    this.spawnConfig.brushSize = next;
    (document.getElementById('slider-brush-size') as HTMLInputElement).value = String(next);
    document.getElementById('val-brush-size')!.textContent = String(next);
    this.syncModeStatusStrip();
  }

  public togglePlayPause(): void {
    this.engine.running = !this.engine.running;
    if (this.engine.running && !this.engine.hasSnapshot()) this.engine.captureSnapshot();
    this.syncSimStateUI();
    this.engine.sound.playUiClick(this.engine.running ? 700 : 460);
  }

  public triggerRewind(): void {
    this.elVictory.classList.add('hidden');
    if (this.engine.rewindToSnapshot()) {
      this.updateTelemetry(this.engine.getTelemetry());
      this.showToast(t(this.lang, 'toastRewind'));
    } else {
      this.showToast(t(this.lang, 'toastNoSnapshot'));
    }
  }

  public triggerClear(): void {
    this.elVictory.classList.add('hidden');
    this.engine.clearArena(true);
    this.syncArmyOrderHighlights();
    this.updateTelemetry(this.engine.getTelemetry());
    this.showToast(t(this.lang, 'toastClear'));
    this.engine.sound.playErase();
  }

  public toggleAudio(): void {
    this.engine.sound.enabled = !this.engine.sound.enabled;
    const btn = document.getElementById('btn-audio')!;
    document.getElementById('audio-svg')!.innerHTML = this.engine.sound.enabled ? ICONS.audioOn : ICONS.audioOff;
    btn.classList.toggle('active', this.engine.sound.enabled);
    this.showToast(t(this.lang, this.engine.sound.enabled ? 'toastUnmuted' : 'toastMuted'));
  }

  public toggleDock(): void {
    const collapsed = document.getElementById('unit-dock')!.classList.toggle('collapsed');
    document.body.classList.toggle('dock-collapsed', collapsed);
    this.engine.sound.playUiClick(520);
  }

  private syncEmptyHintVisibility(totalEntities: number): void {
    this.lastTotalEntities = totalEntities;
    const isEmpty = totalEntities === 0;
    this.elEmptyHint.classList.toggle('hidden', !isEmpty || this.emptyBarDismissed);
    document.getElementById('btn-empty-reopen')?.classList.toggle('hidden', !isEmpty || !this.emptyBarDismissed);
  }

  public toggleCinematic(): void {
    this.cinematicMode = !this.cinematicMode;
    document.body.classList.toggle('cinematic', this.cinematicMode);
    document.getElementById('btn-show-hud')!.classList.toggle('hidden', !this.cinematicMode);
  }

  private syncModalOpenClass(): void {
    const anyModal = Array.from(document.querySelectorAll('.modal-backdrop')).some(
      (m) => !m.classList.contains('hidden')
    );
    document.body.classList.toggle('modal-open', anyModal);
  }

  public openModal(id: string): void {
    document.getElementById(id)?.classList.remove('hidden');
    this.syncModalOpenClass();
    this.engine.sound.playUiClick(620);
  }

  public closeModal(id: string): void {
    document.getElementById(id)?.classList.add('hidden');
    this.syncModalOpenClass();
  }

  public closeAllModals(): void {
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
    this.syncModalOpenClass();
    this.elVictory.classList.add('hidden');
    this.closeSpecDrawer();
    if (this.inspectedUnit) {
      this.engine.selectedUnitId = null;
      this.inspectedUnit = null;
      this.syncInspectorUI();
    }
  }

  public syncSimStateUI(): void {
    const running = this.engine.running;
    this.elSimPill.classList.toggle('paused', !running);
    this.elSimLabel.textContent = t(this.lang, running ? 'live' : 'paused');
    this.elPlayBtn.classList.toggle('is-paused', !running);
    this.elPlayIcon.innerHTML = running ? ICONS.pause : ICONS.play;
    this.elPlayText.textContent = t(this.lang, running ? 'pause' : 'play');
  }

  public renderDockTabs(): void {
    this.elDockTabs.innerHTML = '';
    const modeItems = getCatalogForMode(this.engine.worldSettings.renderStyle);
    const categories: UnitCategory[] = ['gods', 'heroes', 'undead', 'modern', 'vehicles', 'beasts', 'structures'];
    const availableCats = categories.filter((cat) => modeItems.some((item) => item.category === cat));
    if (!availableCats.includes(this.activeCategory) && availableCats.length > 0) {
      this.activeCategory = availableCats[0];
    }

    for (const cat of availableCats) {
      const count = modeItems.filter((item) => item.category === cat).length;
      const meta = CATEGORY_META[cat];
      const svg = ICONS[meta.iconKey as keyof typeof ICONS] || '';
      const btn = document.createElement('button');
      btn.className = `dock-tab ${this.activeCategory === cat ? 'active' : ''}`;
      btn.innerHTML = `<span class="svg-ico sm">${svg}</span><span>${this.lang === 'tr' ? meta.tr : meta.en}</span><span class="tab-count">${count}</span>`;
      btn.addEventListener('click', () => {
        this.activeCategory = cat;
        this.searchQuery = '';
        this.elSearch.value = '';
        this.renderDockTabs();
        this.renderUnitCards();
        this.engine.sound.playUiClick(580);
      });
      this.elDockTabs.appendChild(btn);
    }
  }

  public renderUnitCards(): void {
    this.elUnitRail.innerHTML = '';
    const style = this.engine.worldSettings.renderStyle;
    const modeItems = getCatalogForMode(style);
    const items = modeItems.filter((item) => {
      if (this.searchQuery) {
        const hay = `${item.nameTr} ${item.nameEn} ${item.roleTr} ${item.roleEn} ${item.id} ${item.specialAbility}`.toLowerCase();
        return hay.includes(this.searchQuery);
      }
      return item.category === this.activeCategory;
    });

    for (const item of items) {
      const spec = this.engine.getEffectiveSpec(item.id);
      const hasOverride = this.engine.speciesOverrides.has(item.id);
      const card = document.createElement('div');
      card.className = `unit-card ${this.spawnConfig.catalogId === item.id ? 'active' : ''} ${hasOverride ? 'has-override' : ''}`;
      card.style.setProperty('--card-accent', item.accentColor);
      card.title = this.lang === 'tr' ? item.descTr : item.descEn;

      const name = this.lang === 'tr' ? item.nameTr : item.nameEn;
      const role = this.lang === 'tr' ? item.roleTr : item.roleEn;
      const statLeft = spec.hp >= 9000 ? 'INF' : `HP ${Math.round(spec.hp)}`;
      const statRight = spec.damage > 0 ? `ATK ${Math.round(spec.damage)}` : '—';
      const cachedUrl = this.thumbnails.getCached(item.id, style) ?? '';

      card.innerHTML = `
        <span class="unit-accent-bar"></span>
        <button class="unit-card-gear" title="${t(this.lang, 'charConfigBtn')}"><span class="svg-ico xs">${ICONS.sliders}</span></button>
        <div class="unit-thumb-wrap">
          <img class="unit-portrait" src="${cachedUrl}" alt="${name}" />
          <span class="unit-role-pill">${role}</span>
        </div>
        <div class="unit-name">${name}</div>
        <div class="unit-mini-stats">
          <span>${statLeft}</span>
          <span>${statRight}</span>
        </div>
      `;

      const imgEl = card.querySelector('.unit-portrait') as HTMLImageElement;
      if (!cachedUrl) {
        this.thumbnails.renderPortrait(item, style).then((url) => {
          if (url) imgEl.src = url;
        });
      }

      const gearBtn = card.querySelector('.unit-card-gear') as HTMLButtonElement;
      gearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.spawnConfig.catalogId = item.id;
        this.openSpecDrawer(item.id);
        this.renderUnitCards();
        this.updateSelectedPreview();
      });

      card.addEventListener('mouseenter', () => {
        if (item.modelFile && !this.engine.models.isLoaded(item.modelFile)) {
          this.engine.models.preloadFiles([item.modelFile]).catch(() => {});
        }
      });

      card.addEventListener('click', () => {
        this.spawnConfig.catalogId = item.id;
        if (item.modelFile && !this.engine.models.isLoaded(item.modelFile)) {
          this.engine.models.preloadFiles([item.modelFile]).catch(() => {});
        }
        if (this.tool === 'erase' || this.tool === 'select' || this.tool === 'rally') {
          this.setTool('brush');
        }
        this.renderUnitCards();
        this.updateSelectedPreview();
        if (this.specCatalogId) this.openSpecDrawer(item.id);
        this.engine.sound.playUiClick(650);
      });

      this.elUnitRail.appendChild(card);
    }
    requestAnimationFrame(() => this.updateRailNavButtons());
  }

  private updateRailNavButtons(): void {
    const leftBtn = document.getElementById('btn-rail-left') as HTMLButtonElement | null;
    const rightBtn = document.getElementById('btn-rail-right') as HTMLButtonElement | null;
    if (!leftBtn || !rightBtn) return;
    const maxScroll = Math.max(0, this.elUnitRail.scrollWidth - this.elUnitRail.clientWidth - 2);
    leftBtn.disabled = this.elUnitRail.scrollLeft <= 2;
    rightBtn.disabled = this.elUnitRail.scrollLeft >= maxScroll;
  }

  private updateSelectedPreview(): void {
    const item = CATALOG_MAP.get(this.spawnConfig.catalogId);
    if (!item) return;
    const spec = this.engine.getEffectiveSpec(item.id);
    document.getElementById('sel-name')!.textContent = this.lang === 'tr' ? item.nameTr : item.nameEn;
    document.getElementById('sel-stats')!.textContent =
      spec.hp >= 9000
        ? this.lang === 'tr'
          ? item.roleTr
          : item.roleEn
        : `HP ${Math.round(spec.hp)} · ATK ${Math.round(spec.damage)}`;

    const img = document.getElementById('sel-portrait') as HTMLImageElement;
    this.thumbnails.renderPortrait(item, this.engine.worldSettings.renderStyle).then((url) => {
      if (url && this.spawnConfig.catalogId === item.id) img.src = url;
    });
  }

  private renderPresets(): void {
    const grid = document.getElementById('presets-grid')!;
    const quickRow = document.getElementById('quick-presets-row')!;
    grid.innerHTML = '';
    quickRow.innerHTML = '';

    const quickIds = new Set(['gods_war', 'science_tank_vs_trex', 'voxel_kingdom_war', 'hybrid_multiverse_clash']);

    BATTLE_PRESETS.forEach((preset) => {
      const card = document.createElement('button');
      card.className = 'preset-card';
      card.innerHTML = `
        <span class="preset-tag">${this.lang === 'tr' ? preset.tagTr : preset.tagEn}</span>
        <span class="preset-title">${this.lang === 'tr' ? preset.nameTr : preset.nameEn}</span>
        <span class="preset-desc">${this.lang === 'tr' ? preset.descTr : preset.descEn}</span>
      `;
      card.addEventListener('click', () => this.launchPreset(preset.id));
      grid.appendChild(card);

      if (quickIds.has(preset.id)) {
        const pill = document.createElement('button');
        pill.className = 'quick-preset-pill';
        pill.textContent = this.lang === 'tr' ? preset.nameTr : preset.nameEn;
        pill.addEventListener('click', () => this.launchPreset(preset.id));
        quickRow.appendChild(pill);
      }
    });
  }

  public launchPreset(presetId: string): void {
    const preset = BATTLE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.closeModal('presets-modal');
    this.elVictory.classList.add('hidden');
    if (preset.recommendedBiome) this.setBiome(preset.recommendedBiome, true);
    if (preset.recommendedStyle) this.setRenderStyle(preset.recommendedStyle, true);
    this.engine.loadSnapshotUnits(preset.units, preset.autoStart);
    this.syncSimStateUI();
    this.syncArmyOrderHighlights();
    this.updateTelemetry(this.engine.getTelemetry());
    this.showToast(`${t(this.lang, 'toastPresetLoaded')}: ${this.lang === 'tr' ? preset.nameTr : preset.nameEn}`);
  }

  public updateTelemetry(stats: TelemetryStats): void {
    this.elRedCount.textContent = String(stats.redCount);
    this.elBlueCount.textContent = String(stats.blueCount);
    this.elFfaCount.textContent = String(stats.ffaCount);
    this.elFfaStat.classList.toggle('hidden', stats.ffaCount === 0);
    this.elKillCount.textContent = String(stats.kills);
    this.elFps.textContent = String(stats.fps);

    const totalPower = stats.redPower + stats.bluePower;
    if (totalPower > 0) {
      const redPct = (stats.redPower / totalPower) * 100;
      this.elBalRed.style.width = `${redPct.toFixed(1)}%`;
      this.elBalBlue.style.width = `${(100 - redPct).toFixed(1)}%`;
    } else {
      this.elBalRed.style.width = '50%';
      this.elBalBlue.style.width = '50%';
    }

    this.syncEmptyHintVisibility(stats.totalEntities);

    if (this.inspectedUnit) {
      if (!this.inspectedUnit.alive) {
        this.inspectedUnit = null;
        this.syncInspectorUI();
      } else {
        const pct = Math.max(0, (this.inspectedUnit.hp / this.inspectedUnit.maxHp) * 100);
        document.getElementById('insp-hp-fill')!.style.width = `${pct.toFixed(1)}%`;
        document.getElementById('insp-hp-text')!.textContent = `${Math.ceil(this.inspectedUnit.hp)}/${this.inspectedUnit.maxHp}`;
        document.getElementById('insp-kills')!.textContent = `${this.inspectedUnit.kills} ${t(this.lang, 'killsSuffix')}`;
      }
    }
  }

  private syncInspectorUI(): void {
    const u = this.inspectedUnit;
    if (!u || !u.alive) {
      this.elInspector.classList.add('hidden');
      this.syncDrawerOpenClass();
      return;
    }
    this.elInspector.classList.remove('hidden');
    this.syncDrawerOpenClass();
    document.getElementById('insp-name')!.textContent =
      `02 // ${(this.lang === 'tr' ? u.catalog.nameTr : u.catalog.nameEn).toUpperCase()}`;

    const badge = document.getElementById('insp-team-badge')!;
    badge.className = `team-pill ${u.team}`;
    badge.textContent =
      u.team === 'red'
        ? t(this.lang, 'teamRed')
        : u.team === 'blue'
          ? t(this.lang, 'teamBlue')
          : u.team === 'ffa'
            ? t(this.lang, 'teamFfa')
            : t(this.lang, 'teamNeutral');

    document.querySelectorAll<HTMLElement>('[data-insp-ai]').forEach((el) => {
      el.classList.toggle('active', el.dataset.inspAi === u.ai);
    });
    document.querySelectorAll<HTMLElement>('[data-insp-team]').forEach((el) => {
      el.classList.toggle('active', el.dataset.inspTeam === u.team);
    });
    document.querySelectorAll<HTMLElement>('[data-insp-trait]').forEach((el) => {
      const tr = el.dataset.inspTrait as keyof UnitTraits;
      el.classList.toggle('active', u.traits[tr]);
    });

    (document.getElementById('insp-scale-slider') as HTMLInputElement).value = u.scale.toFixed(1);
    document.getElementById('insp-scale-val')!.textContent = `${u.scale.toFixed(1)}×`;
    const inspDmgEl = document.getElementById('insp-dmg-slider') as HTMLInputElement;
    const inspDmgMax = Math.max(600, Math.ceil((Math.max(u.damage, u.catalog.damage) * 2.5) / 10) * 10);
    inspDmgEl.max = String(inspDmgMax);
    inspDmgEl.value = String(Math.round(Math.min(inspDmgMax, u.damage)));
    document.getElementById('insp-dmg-val')!.textContent = String(Math.round(u.damage));

    const isFollowing = this.engine.followUnitId === u.id;
    document.getElementById('btn-insp-follow')!.classList.toggle('active-follow', isFollowing);
    document.getElementById('insp-follow-text')!.textContent = t(this.lang, isFollowing ? 'inspUnfollow' : 'inspFollow');

    const spBtn = document.getElementById('btn-insp-special') as HTMLButtonElement;
    const hasSpecial = u.catalog.specialAbility !== 'none';
    spBtn.classList.toggle('hidden', !hasSpecial);
    if (hasSpecial) {
      document.getElementById('insp-special-label')!.textContent = `${t(this.lang, 'triggerSpecial')}: ${getAbilityLabel(u.catalog.specialAbility, this.lang)}`;
    }

    this.refreshInspPortrait();
  }

  private showVictoryReport(report: VictoryReport): void {
    const titleEl = document.getElementById('victory-title')!;
    titleEl.className = `victory-title ${report.winner}`;
    titleEl.textContent =
      report.winner === 'red'
        ? t(this.lang, 'redWins')
        : report.winner === 'blue'
          ? t(this.lang, 'blueWins')
          : report.winner === 'ffa'
            ? t(this.lang, 'ffaWins')
            : t(this.lang, 'drawWins');

    const mins = Math.floor(report.duration / 60);
    const secs = Math.floor(report.duration % 60);
    document.getElementById('v-duration')!.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('v-casualties')!.textContent = String(report.casualties);
    document.getElementById('v-survivors')!.textContent = String(report.survivors);

    const mvpName = this.lang === 'tr' ? report.mvpNameTr : report.mvpNameEn;
    document.getElementById('v-mvp')!.textContent =
      report.mvpKills > 0 ? `${mvpName} (${report.mvpKills} ${t(this.lang, 'killsSuffix')})` : t(this.lang, 'noMvp');

    this.elVictory.classList.remove('hidden');
  }

  public showToast(msg: string): void {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    this.elToasts.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 2000);
  }

  private applyLanguage(): void {
    document.documentElement.lang = this.lang;
    document.getElementById('btn-lang')!.textContent = this.lang.toUpperCase();
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n!;
      el.textContent = t(this.lang, key);
    });
    this.elSearch.placeholder = t(this.lang, 'searchPlaceholder');
    document.getElementById('help-content')!.innerHTML = t(this.lang, 'helpHtml');

    // Fully localize all tooltips & aria-labels
    const setTip = (id: string, key: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      const val = t(this.lang, key);
      el.title = val;
      el.setAttribute('aria-label', val);
    };
    setTip('btn-camera-reset', 'tipCamera');
    setTip('btn-audio', 'tipAudio');
    setTip('btn-help', 'tipHelp');
    setTip('btn-hide-hud', 'tipCinematic');
    setTip('btn-toggle-panel', 'tipTogglePanel');
    setTip('btn-toggle-dock', 'tipToggleDock');
    setTip('btn-graphics', 'tipGraphics');
    setTip('btn-presets', 'tipPresets');
    setTip('btn-close-spec', 'tipClose');
    setTip('btn-close-inspector', 'tipClose');
    setTip('btn-victory-close', 'tipClose');
    setTip('btn-play-pause', 'tipPlay');
    setTip('btn-rewind', 'tipRewind');
    setTip('btn-clear', 'tipClear');
    setTip('btn-open-spec', 'tipOpenSpec');
    setTip('ffa-stat', 'tipFfaCount');
    setTip('btn-empty-toggle', 'tipEmptyToggle');
    setTip('btn-empty-close', 'tipEmptyClose');
    setTip('btn-empty-reopen', 'tipEmptyReopen');
    setTip('btn-victory-rematch', 'rematch');

    const toolTipMap: Record<ToolMode, string> = {
      brush: 'tipToolBrush',
      single: 'tipToolSingle',
      squad: 'tipToolSquad',
      rally: 'tipToolRally',
      select: 'tipToolSelect',
      erase: 'tipToolErase',
    };
    document.querySelectorAll<HTMLElement>('#tool-grid [data-tool]').forEach((el) => {
      const k = toolTipMap[el.dataset.tool as ToolMode];
      if (!k) return;
      const val = t(this.lang, k);
      el.title = val;
      el.setAttribute('aria-label', val);
    });
    document.querySelectorAll<HTMLElement>('.modal-close').forEach((el) => {
      el.title = t(this.lang, 'tipClose');
      el.setAttribute('aria-label', t(this.lang, 'tipClose'));
    });

    const aiNames: Record<AIBehavior, string> = {
      aggressive: t(this.lang, 'aiAggressive'),
      hold: t(this.lang, 'aiHold'),
      passive: t(this.lang, 'aiPassive'),
      flee: t(this.lang, 'aiFlee'),
    };
    document.querySelectorAll<HTMLElement>('[data-order-team]').forEach((el) => {
      const prefix = el.dataset.orderTeam === 'red' ? t(this.lang, 'tipOrderRed') : t(this.lang, 'tipOrderBlue');
      const ai = el.dataset.orderAi as AIBehavior;
      const label = `${prefix}: ${aiNames[ai]}`;
      el.title = label;
      el.setAttribute('aria-label', label);
    });

    this.renderDockTabs();
    this.renderUnitCards();
    this.renderPresets();
    this.renderGraphicsModal();
    this.updateSelectedPreview();
    this.syncStylePill();
    this.syncSimStateUI();
    this.syncModeStatusStrip();
    this.syncArmyOrderHighlights();
    this.syncInspectorUI();
    if (this.specCatalogId && !this.elSpecDrawer.classList.contains('hidden')) {
      this.openSpecDrawer(this.specCatalogId);
    }
  }
}
