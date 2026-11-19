import './style.css';
import * as THREE from 'three';
import { CATALOG, CATALOG_MAP, STARTER_PRELOAD_IDS } from './data/catalog';
import { ArenaScene } from './engine/ArenaScene';
import { BattleEngine } from './engine/BattleEngine';
import { ModelLibrary } from './engine/ModelLibrary';
import { SoundSynth } from './engine/SoundSynth';
import { ThumbnailRenderer } from './engine/ThumbnailRenderer';
import { VfxSystem } from './engine/VfxSystem';
import { HudManager } from './ui/HudManager';
import { t } from './i18n';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('canvas-container')!;
  const arena = new ArenaScene(container);
  const models = new ModelLibrary();
  const thumbnails = new ThumbnailRenderer(models);
  const vfx = new VfxSystem(arena.vfxGroup);
  const sound = new SoundSynth();
  const engine = new BattleEngine(arena, models, vfx, sound);
  const hud = new HudManager(engine, thumbnails);

  // Pointer & Camera interaction state
  let isLeftDown = false;
  let isRightDown = false;
  let isMiddleDown = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let lastPaintPos: THREE.Vector3 | null = null;
  let lastPaintTime = 0;
  let hoverGroundPos: THREE.Vector3 | null = null;

  const canvas = arena.renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const applyPrimaryTool = (pos: THREE.Vector3, isClickStart: boolean, altKey: boolean): void => {
    // Alt + Left Click from ANY tool immediately selects/inspects a placed unit!
    if (altKey && isClickStart) {
      engine.selectUnitAt(pos.x, pos.z);
      return;
    }

    const cfg = hud.spawnConfig;
    const brushRadius = 0.9 + cfg.brushSize * 0.72;

    if (hud.tool === 'erase') {
      if (engine.eraseAt(pos.x, pos.z, brushRadius) > 0) {
        hud.updateTelemetry(engine.getTelemetry());
      }
      return;
    }

    if (hud.tool === 'select') {
      if (isClickStart) {
        engine.selectUnitAt(pos.x, pos.z);
      }
      return;
    }

    if (hud.tool === 'rally') {
      if (isClickStart) {
        const target = engine.issueRallyPoint(pos.x, pos.z, cfg.teamSetting);
        const key = target === 'red' ? 'toastRallyRed' : target === 'blue' ? 'toastRallyBlue' : 'toastRallyAll';
        hud.showToast(t(hud.lang, key));
      }
      return;
    }

    if (hud.tool === 'single' || hud.tool === 'squad') {
      if (isClickStart) {
        if (engine.spawnWithConfig(pos.x, pos.z, cfg, hud.tool) > 0) {
          hud.updateTelemetry(engine.getTelemetry());
        }
      }
      return;
    }

    const now = performance.now();
    const item = CATALOG_MAP.get(cfg.catalogId);
    const stepDist = item?.isStructure ? Math.max(1.8, (item.radius ?? 1) * cfg.scale * 1.9) : Math.max(1.1, brushRadius * 0.55);

    if (
      isClickStart ||
      !lastPaintPos ||
      pos.distanceTo(lastPaintPos) >= stepDist ||
      (!item?.isStructure && now - lastPaintTime > 170)
    ) {
      const count = engine.spawnWithConfig(pos.x, pos.z, cfg, 'brush');
      if (count > 0) hud.updateTelemetry(engine.getTelemetry());
      if (count > 0 || isClickStart) {
        lastPaintPos = pos.clone();
        lastPaintTime = now;
      }
    }
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    if (e.button === 0) {
      isLeftDown = true;
      lastPaintPos = null;
      const hit = arena.raycastGround(e.clientX, e.clientY);
      if (hit) applyPrimaryTool(hit, true, e.altKey);
    } else if (e.button === 2) {
      isRightDown = true;
    } else if (e.button === 1) {
      e.preventDefault();
      isMiddleDown = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    if (isMiddleDown || (isRightDown && e.shiftKey)) {
      arena.pan(dx, dy);
      return;
    }
    if (isRightDown) {
      arena.orbit(dx, dy);
      return;
    }

    hoverGroundPos = arena.raycastGround(e.clientX, e.clientY);
    if (isLeftDown && hoverGroundPos && !e.altKey) {
      applyPrimaryTool(hoverGroundPos, false, false);
    }
  });

  const endPointer = (e: PointerEvent): void => {
    if (e.button === 0) {
      isLeftDown = false;
      lastPaintPos = null;
    } else if (e.button === 2) {
      isRightDown = false;
    } else if (e.button === 1) {
      isMiddleDown = false;
    }
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    hoverGroundPos = null;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.shiftKey) hud.adjustBrushSize(e.deltaY > 0 ? -1 : 1);
      else arena.zoom(e.deltaY);
    },
    { passive: false }
  );

  // Global keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') {
      if (e.code === 'Escape') (e.target as HTMLElement).blur();
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        hud.togglePlayPause();
        break;
      case 'KeyR':
        hud.triggerRewind();
        break;
      case 'KeyC':
        hud.triggerClear();
        break;
      case 'KeyB':
        hud.setTool('brush');
        break;
      case 'Digit1':
        hud.setTool('single');
        break;
      case 'Digit2':
        hud.setTool('squad');
        break;
      case 'KeyG':
        hud.setTool('rally');
        break;
      case 'KeyV':
        hud.setTool('select');
        break;
      case 'KeyX':
      case 'KeyE':
        hud.setTool('erase');
        break;
      case 'BracketLeft':
        hud.adjustBrushSize(-1);
        break;
      case 'BracketRight':
        hud.adjustBrushSize(1);
        break;
      case 'Tab':
        e.preventDefault();
        hud.toggleDock();
        break;
      case 'KeyH':
        hud.toggleCinematic();
        break;
      case 'KeyF':
        engine.followUnitId = null;
        arena.resetCamera();
        break;
      case 'KeyM':
        hud.toggleAudio();
        break;
      case 'Escape':
        hud.closeAllModals();
        break;
      case 'Slash':
        if (e.shiftKey) hud.openModal('help-modal');
        break;
      default:
        break;
    }
  });

  // Preload core starter 3D GLB models + first tab studio portraits
  const loadingOverlay = document.getElementById('loading-overlay')!;
  const loadingStatus = document.getElementById('loading-status')!;
  const loadingFill = document.getElementById('loading-bar-fill')!;

  const starterFiles = [
    'cyber_runner.glb',
    ...STARTER_PRELOAD_IDS.map((id) => CATALOG_MAP.get(id)?.modelFile ?? '').filter(Boolean),
  ];

  loadingStatus.textContent = t(hud.lang, 'loadingModels');
  await models.preloadFiles(starterFiles, (done, total) => {
    const pct = Math.round((done / Math.max(1, total)) * 100);
    loadingFill.style.width = `${Math.max(12, pct)}%`;
    loadingStatus.textContent = `${t(hud.lang, 'loadingModels')} (${done}/${total})`;
  });

  // Refresh initial tab cards so portraits show right away
  hud.renderDockTabs();
  hud.renderUnitCards();

  loadingOverlay.classList.add('fade-out');
  setTimeout(() => loadingOverlay.remove(), 400);

  // Quietly warm remaining 3D GLB models in background batches
  const remainingFiles = [
    ...new Set(CATALOG.map((c) => c.modelFile).filter((f): f is string => f !== null && !starterFiles.includes(f))),
  ];
  (async () => {
    for (let i = 0; i < remainingFiles.length; i += 2) {
      await models.preloadFiles(remainingFiles.slice(i, i + 2));
      await new Promise((r) => setTimeout(r, 90));
    }
  })();

  let lastFrame = performance.now();
  let telemetryAccum = 0;

  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    const curItem = CATALOG_MAP.get(hud.spawnConfig.catalogId)!;
    const resolvedTeam = hoverGroundPos
      ? engine.resolveTeam(hud.spawnConfig.teamSetting, hoverGroundPos.x, curItem)
      : 'red';
    const brushRadius = 0.9 + hud.spawnConfig.brushSize * 0.72;
    const squadInfo =
      hud.tool === 'squad'
        ? {
            cols: Math.max(2, Math.min(7, Math.ceil(hud.spawnConfig.brushSize * 0.85))),
            rows: Math.max(2, Math.min(6, Math.ceil(hud.spawnConfig.brushSize * 0.65))),
            spacing: Math.max(1.35, curItem.radius * hud.spawnConfig.scale * 2.45),
          }
        : undefined;
    arena.updateBrushCursor(hoverGroundPos, hud.tool, brushRadius, resolvedTeam, squadInfo);

    engine.update(dt);
    arena.update(dt);
    arena.render();

    telemetryAccum += dt;
    if (telemetryAccum >= 0.12) {
      telemetryAccum = 0;
      hud.updateTelemetry(engine.getTelemetry());
    }
  };

  requestAnimationFrame(tick);
}

bootstrap();
