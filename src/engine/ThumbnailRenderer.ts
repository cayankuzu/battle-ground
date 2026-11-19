import * as THREE from 'three';
import { CatalogItem, RenderStyle } from '../types';
import { ModelLibrary } from './ModelLibrary';

export class ThumbnailRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cache = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly models: ModelLibrary) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(144, 144);
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;

    this.scene = new THREE.Scene();

    // High-contrast 3-point editorial studio lighting (makes dark silhouettes pop!)
    const hemi = new THREE.HemisphereLight(0xf0f6ff, 0x333c52, 1.55);
    const key = new THREE.DirectionalLight(0xfff6e8, 2.7);
    key.position.set(4, 6, 5.5);
    const rim = new THREE.DirectionalLight(0xa5d8ff, 2.2);
    rim.position.set(-5, 4, -5);
    const fill = new THREE.DirectionalLight(0xffd2b8, 0.9);
    fill.position.set(-4, 1.5, 4);
    this.scene.add(hemi, key, rim, fill);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  }

  public getCached(itemId: string, style: RenderStyle): string | undefined {
    return this.cache.get(`${itemId}:${style}`);
  }

  public renderPortrait(item: CatalogItem, style: RenderStyle): Promise<string> {
    const key = `${item.id}:${style}`;
    const existing = this.cache.get(key);
    if (existing) return Promise.resolve(existing);

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const inst = await this.models.instantiate(item, 1.0, style === 'manga' ? 'realistic' : style);
        const obj = inst.root;
        this.scene.add(obj);

        // Advance Idle animation slightly so rigged characters leave static frame-0 T-pose!
        if (inst.mixer) {
          if (inst.actions.idle) {
            inst.actions.idle.reset().play();
          } else if (inst.actions.move) {
            inst.actions.move.reset().play();
          }
          inst.mixer.update(0.32);
        }
        obj.updateMatrixWorld(true);

        // Compute tight bounding box after idle pose settles
        const box = new THREE.Box3().setFromObject(obj);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);

        // Avoid T-pose arm-span zooming out humanoids: weight vertical height + capped horizontal span
        const isHumanoid =
          !item.isStructure &&
          (item.category === 'heroes' ||
            item.category === 'undead' ||
            (item.category === 'modern' && item.flyHeight === undefined && item.mass < 6));
        const isLongCreature =
          !item.isStructure &&
          (item.category === 'beasts' ||
            item.id.includes('dragon') ||
            item.id.includes('trex') ||
            size.z > size.y * 1.15);

        const effectiveSpan = isHumanoid
          ? Math.max(size.y * 0.94, Math.min(size.x, size.y * 0.98))
          : isLongCreature
            ? Math.max(size.y * 0.96, size.z * 0.66, size.x * 0.78, 0.55)
            : Math.max(size.y, size.x * 0.88, size.z * 0.88, 0.55);

        const dist = (effectiveSpan * (isLongCreature ? 0.78 : 0.88)) / Math.tan(THREE.MathUtils.degToRad(15));

        const yaw = item.isStructure
          ? 0.58
          : item.category === 'vehicles'
            ? 0.68
            : isLongCreature
              ? 0.82
              : 0.42;
        const pitch = item.isStructure ? 0.36 : item.category === 'vehicles' ? 0.32 : isLongCreature ? 0.22 : 0.18;
        const focusY = center.y + (isHumanoid ? size.y * 0.08 : size.y * 0.02);

        this.camera.position.set(
          center.x + Math.sin(yaw) * Math.cos(pitch) * dist,
          focusY + Math.sin(pitch) * dist,
          center.z + Math.cos(yaw) * Math.cos(pitch) * dist
        );
        this.camera.lookAt(center.x, focusY, center.z);

        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);

        // Composite onto style-matched 144x144 canvas
        const out = document.createElement('canvas');
        out.width = 144;
        out.height = 144;
        const ctx = out.getContext('2d')!;

        if (style === 'manga') {
          // Authentic Seinen Manga off-white inked paper backdrop + stark contrast!
          ctx.fillStyle = '#ece9e1';
          ctx.fillRect(0, 0, 144, 144);
          // Subtle diagonal halftone corner accent
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          for (let y = 0; y < 144; y += 6) {
            for (let x = 0; x < 144; x += 6) {
              if (x + y > 165) ctx.fillRect(x, y, 2, 2);
            }
          }
          ctx.filter = 'grayscale(100%) contrast(235%) brightness(108%)';
          ctx.drawImage(this.renderer.domElement, 0, 0, 144, 144);
          ctx.filter = 'none';
        } else if (style === 'pixel') {
          ctx.imageSmoothingEnabled = false;
          const small = document.createElement('canvas');
          small.width = 32;
          small.height = 32;
          const sctx = small.getContext('2d')!;
          sctx.imageSmoothingEnabled = false;
          sctx.drawImage(this.renderer.domElement, 0, 0, 32, 32);
          ctx.drawImage(small, 0, 0, 144, 144);
        } else if (style === 'blueprint') {
          ctx.fillStyle = '#07111f';
          ctx.fillRect(0, 0, 144, 144);
          ctx.strokeStyle = 'rgba(148, 197, 255, 0.14)';
          ctx.lineWidth = 1;
          for (let p = 18; p < 144; p += 24) {
            ctx.beginPath();
            ctx.moveTo(p, 0);
            ctx.lineTo(p, 144);
            ctx.moveTo(0, p);
            ctx.lineTo(144, p);
            ctx.stroke();
          }
          ctx.filter = 'contrast(165%) saturate(35%) hue-rotate(175deg) brightness(122%)';
          ctx.drawImage(this.renderer.domElement, 0, 0, 144, 144);
          ctx.filter = 'none';
        } else {
          // Ultra Realistic / Realistic: subtle studio vignette spotlight so dark units always pop
          const grad = ctx.createRadialGradient(72, 68, 10, 72, 72, 76);
          grad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
          grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.04)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 144, 144);
          ctx.drawImage(this.renderer.domElement, 0, 0, 144, 144);
        }

        const dataUrl = out.toDataURL('image/png');

        this.scene.remove(obj);
        inst.mixer?.stopAllAction();
        for (const m of inst.disposeMaterials) m.dispose();

        this.cache.set(key, dataUrl);
        return dataUrl;
      } catch {
        return '';
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, promise);
    return promise;
  }
}
