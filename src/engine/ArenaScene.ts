import * as THREE from 'three';
import { ArenaBiome, QualityTier, RenderStyle, Team, ToolMode } from '../types';
import { RenderStyleEngine } from './RenderStyleEngine';

export const ARENA_HALF_W = 36;
export const ARENA_HALF_D = 24;

interface BiomePalette {
  skyHex: number;
  fogHex: number;
  leftBg: string;
  midBg: string;
  rightBg: string;
  gridColor: string;
  sideColor: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  roughness: number;
  metalness: number;
}

const BIOME_PALETTES: Record<ArenaBiome, BiomePalette> = {
  obsidian: {
    skyHex: 0x090b10,
    fogHex: 0x090b10,
    leftBg: '#1c1518',
    midBg: '#13161e',
    rightBg: '#121a26',
    gridColor: 'rgba(255,255,255,0.06)',
    sideColor: 0x0d1018,
    sunColor: 0xfff5e6,
    sunIntensity: 2.3,
    hemiSky: 0xd0e2ff,
    hemiGround: 0x1c202c,
    roughness: 0.82,
    metalness: 0.14,
  },
  desert: {
    skyHex: 0x1d1712,
    fogHex: 0x1d1712,
    leftBg: '#57402c',
    midBg: '#664d36',
    rightBg: '#534334',
    gridColor: 'rgba(255,235,205,0.08)',
    sideColor: 0x2e2116,
    sunColor: 0xffe0b2,
    sunIntensity: 2.6,
    hemiSky: 0xffebd2,
    hemiGround: 0x4b3523,
    roughness: 0.92,
    metalness: 0.04,
  },
  arctic: {
    skyHex: 0x101824,
    fogHex: 0x101824,
    leftBg: '#4c5c6e',
    midBg: '#586c82',
    rightBg: '#48607a',
    gridColor: 'rgba(255,255,255,0.14)',
    sideColor: 0x243140,
    sunColor: 0xe6f4ff,
    sunIntensity: 2.4,
    hemiSky: 0xdcf0ff,
    hemiGround: 0x33475c,
    roughness: 0.42,
    metalness: 0.18,
  },
  volcanic: {
    skyHex: 0x120a0a,
    fogHex: 0x120a0a,
    leftBg: '#2b1614',
    midBg: '#1d1414',
    rightBg: '#1a151b',
    gridColor: 'rgba(255,95,46,0.12)',
    sideColor: 0x140b0b,
    sunColor: 0xffb38a,
    sunIntensity: 2.4,
    hemiSky: 0xffbca0,
    hemiGround: 0x2b1210,
    roughness: 0.85,
    metalness: 0.15,
  },
  orbital: {
    skyHex: 0x050811,
    fogHex: 0x050811,
    leftBg: '#181c28',
    midBg: '#121824',
    rightBg: '#122030',
    gridColor: 'rgba(56,189,248,0.13)',
    sideColor: 0x0a0f1c,
    sunColor: 0xdbeafe,
    sunIntensity: 2.5,
    hemiSky: 0x93c5fd,
    hemiGround: 0x0f172a,
    roughness: 0.48,
    metalness: 0.45,
  },
};

export class ArenaScene {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly renderEngine: RenderStyleEngine;
  public readonly groundPlane: THREE.Mesh;
  public readonly unitsGroup = new THREE.Group();
  public readonly vfxGroup = new THREE.Group();

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly tableTopMat: THREE.MeshStandardMaterial;
  private readonly tableSideMat: THREE.MeshStandardMaterial;
  private readonly cageGroup: THREE.Group;
  private currentBiome: ArenaBiome = 'obsidian';
  private currentStyle: RenderStyle = 'ultra';
  private currentTopTex: THREE.CanvasTexture | null = null;

  // Camera orbit state
  private target = new THREE.Vector3(0, 0, 0);
  private theta = 0;
  private phi = 0.88;
  private radius = 44;
  private desiredTarget = new THREE.Vector3(0, 0, 0);
  private desiredTheta = 0;
  private desiredPhi = 0.88;
  private desiredRadius = 44;
  private shakeIntensity = 0;
  private followPos: THREE.Vector3 | null = null;

  // Projected 3D Brush Cursor
  private readonly brushGroup = new THREE.Group();
  private readonly brushRing: THREE.Mesh;
  private readonly brushFill: THREE.Mesh;
  private readonly brushRingMat: THREE.MeshBasicMaterial;
  private readonly brushFillMat: THREE.MeshBasicMaterial;
  private readonly squadDots: THREE.Mesh[] = [];

  // Selection highlight ring
  private readonly selectRing: THREE.Mesh;

  // Raycaster
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly groundMathPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly keysPressed = new Set<string>();

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090b10);
    this.scene.fog = new THREE.FogExp2(0x090b10, 0.0065);

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(44, w / h, 0.5, 280);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    // Lighting
    this.hemiLight = new THREE.HemisphereLight(0xd0e2ff, 0x1c202c, 1.05);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 2.3);
    this.sunLight.position.set(28, 48, 26);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 130;
    const d = 44;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    const rimLight = new THREE.DirectionalLight(0x528bff, 0.75);
    rimLight.position.set(-34, 24, -26);
    this.scene.add(rimLight);

    // Arena Tabletop
    this.tableSideMat = new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: 0.85, metalness: 0.2 });
    this.tableTopMat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.14 });
    this.groundPlane = this.buildArenaTable();
    this.cageGroup = this.buildEnergyCage();
    this.cageGroup.visible = false;
    this.scene.add(this.cageGroup);

    this.scene.add(this.unitsGroup);
    this.scene.add(this.vfxGroup);

    // Post-processing & Render Style Engine
    this.renderEngine = new RenderStyleEngine(this.renderer, this.scene, this.camera);
    this.applyBiomeAndStyle();

    // 3D Brush Ring Cursor
    this.brushRingMat = new THREE.MeshBasicMaterial({
      color: 0xff2e1f,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.brushFillMat = new THREE.MeshBasicMaterial({
      color: 0xff2e1f,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.brushRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 48), this.brushRingMat);
    this.brushRing.rotation.x = -Math.PI / 2;
    this.brushRing.position.y = 0.06;

    this.brushFill = new THREE.Mesh(new THREE.CircleGeometry(0.92, 48), this.brushFillMat);
    this.brushFill.rotation.x = -Math.PI / 2;
    this.brushFill.position.y = 0.05;

    this.brushGroup.add(this.brushRing, this.brushFill);
    this.brushGroup.visible = false;
    this.scene.add(this.brushGroup);

    // Selection highlight ring
    const selMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.selectRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 36), selMat);
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.position.y = 0.09;
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);

    this.updateCameraTransform(1);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('focusin', this.handleFocusIn);
  }

  private buildArenaTable(): THREE.Mesh {
    const W = ARENA_HALF_W * 2;
    const D = ARENA_HALF_D * 2;
    const slabGeo = new THREE.BoxGeometry(W, 2.2, D);
    const table = new THREE.Mesh(slabGeo, [
      this.tableSideMat,
      this.tableSideMat,
      this.tableTopMat,
      this.tableSideMat,
      this.tableSideMat,
      this.tableSideMat,
    ]);
    table.position.y = -1.1;
    table.receiveShadow = true;
    this.scene.add(table);

    const rimGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(W + 0.1, 0.16, D + 0.1));
    const rim = new THREE.LineSegments(
      rimGeo,
      new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.65 })
    );
    rim.position.y = 0.02;
    this.scene.add(rim);

    const outerGrid = new THREE.GridHelper(220, 44, 0x1e293b, 0x111726);
    outerGrid.position.y = -6.5;
    this.scene.add(outerGrid);

    return table;
  }

  private buildEnergyCage(): THREE.Group {
    const g = new THREE.Group();
    const W = ARENA_HALF_W * 2;
    const D = ARENA_HALF_D * 2;
    const h = 3.2;
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65 });

    const makeWall = (w: number, x: number, z: number, ry: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
      mesh.position.set(x, h / 2, z);
      mesh.rotation.y = ry;
      const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), edgeMat);
      border.position.copy(mesh.position);
      border.rotation.y = ry;
      g.add(mesh, border);
    };

    makeWall(W, 0, -ARENA_HALF_D, 0);
    makeWall(W, 0, ARENA_HALF_D, 0);
    makeWall(D, -ARENA_HALF_W, 0, Math.PI / 2);
    makeWall(D, ARENA_HALF_W, 0, Math.PI / 2);
    return g;
  }

  private generateBiomeTexture(biome: ArenaBiome, isManga: boolean): THREE.CanvasTexture {
    const pal = BIOME_PALETTES[biome];
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const ctx = canvas.getContext('2d')!;

    if (isManga) {
      ctx.fillStyle = '#e5e2da';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
      grad.addColorStop(0, pal.leftBg);
      grad.addColorStop(0.45, pal.midBg);
      grad.addColorStop(0.55, pal.midBg);
      grad.addColorStop(1, pal.rightBg);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (let i = 0; i < 4200; i++) {
      const gx = Math.random() * canvas.width;
      const gy = Math.random() * canvas.height;
      ctx.fillStyle = isManga
        ? 'rgba(0,0,0,0.035)'
        : Math.random() > 0.5
          ? 'rgba(255,255,255,0.025)'
          : 'rgba(0,0,0,0.045)';
      ctx.fillRect(gx, gy, 2, 2);
    }

    // Crisp tactical grid
    const cols = 36;
    const rows = 24;
    ctx.strokeStyle = isManga ? 'rgba(0,0,0,0.14)' : pal.gridColor;
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      const x = (c / cols) * canvas.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      const y = (r / rows) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Center divider line
    ctx.strokeStyle = isManga ? 'rgba(0,0,0,0.45)' : 'rgba(255, 255, 255, 0.24)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 18);
    ctx.lineTo(canvas.width / 2, canvas.height - 18);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center circle
    ctx.strokeStyle = isManga ? 'rgba(0,0,0,0.28)' : 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 82, 0, Math.PI * 2);
    ctx.stroke();

    // Red & Blue outer perimeter U-brackets (zero centerline bleed)
    ctx.strokeStyle = 'rgba(255, 46, 31, 0.65)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 20, 8);
    ctx.lineTo(8, 8);
    ctx.lineTo(8, canvas.height - 8);
    ctx.lineTo(canvas.width / 2 - 20, canvas.height - 8);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(37, 99, 235, 0.65)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 + 20, 8);
    ctx.lineTo(canvas.width - 8, 8);
    ctx.lineTo(canvas.width - 8, canvas.height - 8);
    ctx.lineTo(canvas.width / 2 + 20, canvas.height - 8);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public setBiome(biome: ArenaBiome): void {
    this.currentBiome = biome;
    this.applyBiomeAndStyle();
  }

  public setRenderStyle(style: RenderStyle): void {
    this.currentStyle = style;
    this.renderEngine.setStyle(style);
    this.applyBiomeAndStyle();
  }

  public setQuality(quality: QualityTier): void {
    this.renderEngine.setQuality(quality);
  }

  public setEnclosedWalls(enabled: boolean): void {
    this.cageGroup.visible = enabled;
  }

  private applyBiomeAndStyle(): void {
    const pal = BIOME_PALETTES[this.currentBiome];
    const isManga = this.currentStyle === 'manga';
    const isBlueprint = this.currentStyle === 'blueprint';

    const sky = isManga ? 0xebe8e0 : isBlueprint ? 0x050810 : pal.skyHex;
    (this.scene.background as THREE.Color).setHex(sky);
    (this.scene.fog as THREE.FogExp2).color.setHex(sky);
    (this.scene.fog as THREE.FogExp2).density = isManga ? 0.0025 : 0.0062;

    this.sunLight.color.setHex(isManga ? 0xffffff : pal.sunColor);
    this.sunLight.intensity = isManga ? 2.6 : pal.sunIntensity;
    this.hemiLight.color.setHex(isManga ? 0xffffff : pal.hemiSky);
    this.hemiLight.groundColor.setHex(isManga ? 0x555555 : pal.hemiGround);

    this.tableSideMat.color.setHex(isManga ? 0x1a1a1d : pal.sideColor);
    this.tableTopMat.roughness = isManga
      ? 0.96
      : this.currentStyle === 'ultra' || this.currentStyle === 'hybrid'
        ? pal.roughness * 0.85
        : pal.roughness;
    this.tableTopMat.metalness = isManga
      ? 0.0
      : this.currentStyle === 'ultra' || this.currentStyle === 'hybrid'
        ? pal.metalness + 0.1
        : pal.metalness;

    const newTex = this.generateBiomeTexture(this.currentBiome, isManga);
    if (this.currentTopTex) this.currentTopTex.dispose();
    this.currentTopTex = newTex;
    this.tableTopMat.map = newTex;
    this.tableTopMat.needsUpdate = true;
  }

  public setFollowPoint(pos: THREE.Vector3 | null): void {
    this.followPos = pos;
  }

  public addShake(amount: number): void {
    this.shakeIntensity = Math.min(1.6, this.shakeIntensity + amount);
  }

  public orbit(deltaX: number, deltaY: number): void {
    this.desiredTheta -= deltaX * 0.0065;
    this.desiredPhi = THREE.MathUtils.clamp(this.desiredPhi - deltaY * 0.0055, 0.22, 1.38);
  }

  public pan(deltaX: number, deltaY: number): void {
    this.followPos = null;
    const panSpeed = this.desiredRadius * 0.0014;
    const forward = new THREE.Vector3(-Math.sin(this.theta), 0, -Math.cos(this.theta));
    const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    this.desiredTarget.addScaledVector(right, -deltaX * panSpeed);
    this.desiredTarget.addScaledVector(forward, deltaY * panSpeed);
    this.clampTarget();
  }

  public zoom(deltaY: number): void {
    const factor = deltaY > 0 ? 1.09 : 0.91;
    this.desiredRadius = THREE.MathUtils.clamp(this.desiredRadius * factor, 10, 88);
  }

  public resetCamera(): void {
    this.followPos = null;
    this.desiredTarget.set(0, 0, 0);
    this.desiredTheta = 0;
    this.desiredPhi = 0.88;
    this.desiredRadius = 44;
  }

  private clampTarget(): void {
    this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -ARENA_HALF_W, ARENA_HALF_W);
    this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -ARENA_HALF_D, ARENA_HALF_D);
  }

  public raycastGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundMathPlane, hit)) return null;
    if (Math.abs(hit.x) > ARENA_HALF_W - 0.6 || Math.abs(hit.z) > ARENA_HALF_D - 0.6) {
      return null;
    }
    return hit;
  }

  public updateBrushCursor(
    pos: THREE.Vector3 | null,
    tool: ToolMode,
    radius: number,
    resolvedTeam: Team,
    squadInfo?: { cols: number; rows: number; spacing: number }
  ): void {
    if (!pos || tool === 'select') {
      this.brushGroup.visible = false;
      this.squadDots.forEach((d) => (d.visible = false));
      return;
    }
    this.brushGroup.visible = true;
    this.brushGroup.position.set(pos.x, 0, pos.z);

    let color = 0xffffff;
    if (tool === 'erase') color = 0xff2e1f;
    else if (tool === 'rally') color = 0x10b981;
    else if (resolvedTeam === 'red') color = 0xff2e1f;
    else if (resolvedTeam === 'blue') color = 0x2563eb;
    else if (resolvedTeam === 'ffa') color = 0xf59e0b;
    else color = 0x94a3b8;

    this.brushRingMat.color.setHex(color);
    this.brushFillMat.color.setHex(color);

    if (tool === 'squad' && squadInfo) {
      this.brushRing.visible = false;
      this.brushFill.visible = false;
      const needed = squadInfo.cols * squadInfo.rows;
      while (this.squadDots.length < needed) {
        const dot = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.48, 16), this.brushRingMat);
        dot.rotation.x = -Math.PI / 2;
        dot.position.y = 0.08;
        this.brushGroup.add(dot);
        this.squadDots.push(dot);
      }
      let idx = 0;
      for (let r = 0; r < squadInfo.rows; r++) {
        for (let c = 0; c < squadInfo.cols; c++) {
          const d = this.squadDots[idx++];
          d.visible = true;
          d.position.set(
            (c - (squadInfo.cols - 1) / 2) * squadInfo.spacing,
            0.08,
            (r - (squadInfo.rows - 1) / 2) * squadInfo.spacing
          );
        }
      }
      for (let i = idx; i < this.squadDots.length; i++) {
        this.squadDots[i].visible = false;
      }
    } else {
      this.brushRing.visible = true;
      this.brushFill.visible = true;
      const displayRadius = tool === 'single' ? 1.05 : tool === 'rally' ? 1.6 : radius;
      this.brushRing.scale.setScalar(displayRadius);
      this.brushFill.scale.setScalar(displayRadius);
      this.squadDots.forEach((d) => (d.visible = false));
    }
  }

  public updateSelectionRing(pos: THREE.Vector3 | null, radius = 1): void {
    if (!pos) {
      this.selectRing.visible = false;
      return;
    }
    this.selectRing.visible = true;
    this.selectRing.position.set(pos.x, 0.09, pos.z);
    this.selectRing.scale.setScalar(Math.max(0.85, radius * 1.45));
  }

  public update(dt: number): void {
    const moveSpeed = this.radius * 0.68 * dt;
    const forward = new THREE.Vector3(-Math.sin(this.theta), 0, -Math.cos(this.theta));
    const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    let moved = false;

    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) {
      this.desiredTarget.addScaledVector(forward, moveSpeed);
      moved = true;
    }
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) {
      this.desiredTarget.addScaledVector(forward, -moveSpeed);
      moved = true;
    }
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) {
      this.desiredTarget.addScaledVector(right, -moveSpeed);
      moved = true;
    }
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) {
      this.desiredTarget.addScaledVector(right, moveSpeed);
      moved = true;
    }
    if (moved) {
      this.followPos = null;
      this.clampTarget();
    } else if (this.followPos) {
      this.desiredTarget.copy(this.followPos);
    }

    const damp = 1 - Math.exp(-11 * dt);
    this.target.lerp(this.desiredTarget, damp);
    this.theta += (this.desiredTheta - this.theta) * damp;
    this.phi += (this.desiredPhi - this.phi) * damp;
    this.radius += (this.desiredRadius - this.radius) * damp;

    if (this.shakeIntensity > 0.001) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 3.8);
    } else {
      this.shakeIntensity = 0;
    }

    if (this.selectRing.visible) {
      this.selectRing.rotation.z += dt * 1.8;
    }

    this.updateCameraTransform(dt);
  }

  private updateCameraTransform(_dt: number): void {
    const sinPhi = Math.sin(this.phi);
    const x = this.target.x + this.radius * sinPhi * Math.sin(this.theta);
    const y = this.target.y + this.radius * Math.cos(this.phi);
    const z = this.target.z + this.radius * sinPhi * Math.cos(this.theta);

    const sx = (Math.random() - 0.5) * this.shakeIntensity;
    const sy = (Math.random() - 0.5) * this.shakeIntensity * 0.7;
    const sz = (Math.random() - 0.5) * this.shakeIntensity;

    this.camera.position.set(x + sx, y + sy, z + sz);
    this.camera.lookAt(this.target);
  }

  public render(): void {
    this.renderEngine.render();
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderEngine.resize(w, h);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keysPressed.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keysPressed.delete(e.code);
  };

  private handleWindowBlur = (): void => {
    this.keysPressed.clear();
  };

  private handleFocusIn = (e: FocusEvent): void => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') {
      this.keysPressed.clear();
    }
  };
}
