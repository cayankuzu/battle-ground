import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CatalogItem, RenderStyle } from '../types';

export type AnimKey = 'idle' | 'move' | 'attack' | 'death';

interface CachedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  normScale: number;
  yOffset: number;
}

export interface InstantiatedModel {
  root: THREE.Group;
  visual: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Partial<Record<AnimKey, THREE.AnimationAction>>;
  flashMaterials: THREE.MeshStandardMaterial[];
  disposeMaterials: THREE.Material[];
  hasSkeletalAnims: boolean;
}

const ANIM_PATTERNS: Record<AnimKey, RegExp[]> = {
  idle: [/^idle$/i, /idle_neutral/i, /idle_gun/i, /idle_sword/i, /\|idle$/i, /idle/i, /flying/i],
  move: [
    /^running_a$/i,
    /^running$/i,
    /^run$/i,
    /\|run$/i,
    /gallop$/i,
    /crawl$/i,
    /horse_a/i,
    /tank_forward/i,
    /flying/i,
    /walking_a/i,
    /walk$/i,
    /run/i,
    /walk/i,
  ],
  attack: [
    /firebreath/i,
    /1h_melee_attack_chop/i,
    /2h_melee_attack_chop/i,
    /1h_ranged_shoot$/i,
    /2h_ranged_shoot$/i,
    /spellcast_shoot/i,
    /gun_shoot/i,
    /run_swordattack/i,
    /attack_headbutt/i,
    /bite_front/i,
    /\|shoot$/i,
    /\|attack$/i,
    /^punch$/i,
    /^shoot$/i,
    /attack/i,
    /punch/i,
    /kick/i,
  ],
  death: [/^death_a$/i, /^death$/i, /\|death$/i, /\|dead$/i, /death/i, /dead/i],
};

function pickClip(
  clips: THREE.AnimationClip[],
  patterns: RegExp[],
  preferRanged = false,
  preferMagic = false
): THREE.AnimationClip | undefined {
  if (clips.length === 0) return undefined;
  if (preferMagic) {
    const magicClip = clips.find((c) => /spellcast_shoot|spellcast/i.test(c.name));
    if (magicClip) return magicClip;
  }
  if (preferRanged) {
    const rangedClip = clips.find((c) => /2h_ranged_shoot|1h_ranged_shoot|gun_shoot|\|shoot$/i.test(c.name));
    if (rangedClip) return rangedClip;
  }
  for (const rx of patterns) {
    const match = clips.find((c) => rx.test(c.name));
    if (match) return match;
  }
  return undefined;
}

function makeQuaternionOnlyClips(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  return clips.map((clip) => {
    const rotTracks = clip.tracks.filter((tr) => tr.name.endsWith('.quaternion'));
    return new THREE.AnimationClip(clip.name + '_q', clip.duration, rotTracks);
  });
}

export function applyStyleToMaterial(mat: THREE.MeshStandardMaterial, style: RenderStyle, isArmored = false): void {
  if (mat.userData.origRoughness === undefined) {
    mat.userData.origRoughness = mat.roughness;
    mat.userData.origMetalness = mat.metalness;
    mat.userData.origFlat = mat.flatShading;
    mat.userData.origWireframe = mat.wireframe;
  }

  const baseRough = mat.userData.origRoughness as number;
  const baseMetal = mat.userData.origMetalness as number;

  if (style === 'ultra' || style === 'hybrid') {
    mat.roughness = isArmored ? Math.min(0.36, baseRough * 0.65) : Math.min(0.72, Math.max(0.28, baseRough));
    mat.metalness = isArmored ? Math.max(0.55, baseMetal) : Math.min(0.35, Math.max(0.1, baseMetal));
    mat.envMapIntensity = isArmored ? 1.45 : 1.05;
    mat.flatShading = style === 'hybrid' ? Boolean(mat.userData.origFlat) : false;
    mat.wireframe = false;
  } else if (style === 'realistic') {
    mat.roughness = Math.min(0.84, Math.max(0.4, baseRough));
    mat.metalness = Math.min(0.35, baseMetal);
    mat.envMapIntensity = 0.8;
    mat.flatShading = false;
    mat.wireframe = false;
  } else if (style === 'manga') {
    mat.roughness = 0.96;
    mat.metalness = 0.0;
    mat.envMapIntensity = 0.0;
    mat.flatShading = false;
    mat.wireframe = false;
  } else if (style === 'pixel') {
    mat.roughness = 0.88;
    mat.metalness = 0.05;
    mat.envMapIntensity = 0.2;
    mat.flatShading = true;
    mat.wireframe = false;
  } else if (style === 'blueprint') {
    mat.roughness = 0.7;
    mat.metalness = 0.25;
    mat.envMapIntensity = 0.0;
    mat.flatShading = true;
    mat.wireframe = false;
  }
  mat.needsUpdate = true;
}

export class ModelLibrary {
  private readonly loader = new GLTFLoader();
  private readonly rawCache = new Map<string, Promise<CachedModel>>();
  private readonly loadedFiles = new Set<string>();

  public isLoaded(modelFile: string | null): boolean {
    return modelFile === null || this.loadedFiles.has(modelFile);
  }

  public async preloadFiles(files: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const unique = [...new Set(files.filter(Boolean))];
    let done = 0;
    const total = unique.length;
    await Promise.all(
      unique.map(async (file) => {
        try {
          await this.loadRaw(file);
        } catch (err) {
          console.warn('[ModelLibrary] Failed to preload', file, err);
        } finally {
          done++;
          onProgress?.(done, total);
        }
      })
    );
  }

  private loadRaw(filename: string): Promise<CachedModel> {
    const existing = this.rawCache.get(filename);
    if (existing) return existing;

    const promise = new Promise<CachedModel>((resolve, reject) => {
      this.loader.load(
        `/models/${filename}`,
        (gltf) => {
          const scene = gltf.scene;
          scene.updateMatrixWorld(true);

          scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              mesh.frustumCulled = false;
            }
          });

          const box = new THREE.Box3().setFromObject(scene);
          const size = new THREE.Vector3();
          box.getSize(size);
          const height = Math.max(size.y, 0.2);
          const normScale = 1 / height;
          const yOffset = -box.min.y * normScale;

          this.loadedFiles.add(filename);
          resolve({
            scene,
            animations: gltf.animations,
            normScale,
            yOffset,
          });
        },
        undefined,
        (err) => reject(err)
      );
    });

    this.rawCache.set(filename, promise);
    return promise;
  }

  public async instantiate(item: CatalogItem, scaleMult: number, style: RenderStyle = 'ultra'): Promise<InstantiatedModel> {
    if (!item.modelFile) {
      return this.createProceduralToy(item, scaleMult, style);
    }

    const cached = await this.loadRaw(item.modelFile);
    let animSourceClips = cached.animations;

    if (animSourceClips.length === 0 && item.borrowAnimsFrom) {
      try {
        const donor = await this.loadRaw(item.borrowAnimsFrom);
        animSourceClips = makeQuaternionOnlyClips(donor.animations);
      } catch {
        // fallback to procedural wobble
      }
    }

    const cloned = SkeletonUtils.clone(cached.scene);

    if (item.hideNodes && item.hideNodes.length > 0) {
      const hideSet = new Set(item.hideNodes);
      cloned.traverse((obj) => {
        if (hideSet.has(obj.name)) {
          obj.visible = false;
        }
      });
    }

    const isArmored =
      item.category === 'modern' ||
      item.category === 'vehicles' ||
      (item.armor ?? 0) >= 0.3;

    const flashMaterials: THREE.MeshStandardMaterial[] = [];
    const disposeMaterials: THREE.Material[] = [];

    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        const cloneMat = (m: THREE.Material): THREE.Material => {
          const cm = m.clone();
          disposeMaterials.push(cm);
          if ((cm as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const std = cm as THREE.MeshStandardMaterial;
            applyStyleToMaterial(std, style, isArmored);
            flashMaterials.push(std);
          }
          return cm;
        };

        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map(cloneMat);
        } else if (mesh.material) {
          mesh.material = cloneMat(mesh.material);
        }
      }
    });

    const finalScale = cached.normScale * item.targetHeight * scaleMult;
    cloned.scale.setScalar(finalScale);
    cloned.position.y = cached.yOffset * item.targetHeight * scaleMult;
    if (item.facingOffsetY) {
      cloned.rotation.y = item.facingOffsetY;
    }

    const root = new THREE.Group();
    root.add(cloned);

    let mixer: THREE.AnimationMixer | null = null;
    const actions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
    let hasSkeletalAnims = false;

    if (animSourceClips.length > 0) {
      mixer = new THREE.AnimationMixer(cloned);
      const preferRanged = item.combatStyle === 'ranged' || item.combatStyle === 'siege';
      const preferMagic = item.combatStyle === 'magic' || item.combatStyle === 'healer';

      const resolved: Partial<Record<AnimKey, THREE.AnimationClip>> = {
        idle: pickClip(animSourceClips, ANIM_PATTERNS.idle),
        move: pickClip(animSourceClips, ANIM_PATTERNS.move),
        attack: pickClip(animSourceClips, ANIM_PATTERNS.attack, preferRanged, preferMagic),
        death: pickClip(animSourceClips, ANIM_PATTERNS.death),
      };

      (Object.keys(resolved) as AnimKey[]).forEach((k) => {
        const clip = resolved[k];
        if (clip && mixer) {
          const action = mixer.clipAction(clip);
          if (k === 'death') {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          } else if (k === 'attack') {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = false;
          }
          actions[k] = action;
          hasSkeletalAnims = true;
        }
      });

      if (actions.idle) actions.idle.play();
      else if (actions.move) actions.move.play();
    }

    return {
      root,
      visual: cloned,
      mixer,
      actions,
      flashMaterials,
      disposeMaterials,
      hasSkeletalAnims,
    };
  }

  private createProceduralToy(item: CatalogItem, scaleMult: number, style: RenderStyle): InstantiatedModel {
    const root = new THREE.Group();
    const visual = new THREE.Group();
    const disposeMaterials: THREE.Material[] = [];
    const flashMaterials: THREE.MeshStandardMaterial[] = [];

    const addMat = (params: THREE.MeshStandardMaterialParameters, armored = true): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial(params);
      applyStyleToMaterial(m, style, armored);
      disposeMaterials.push(m);
      flashMaterials.push(m);
      return m;
    };

    const addVox = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
      emissive = 0
    ): THREE.Mesh => {
      const m = addMat(
        {
          color,
          emissive,
          emissiveIntensity: emissive ? 1.5 : 0,
          roughness: 0.78,
          metalness: 0.12,
          flatShading: true,
        },
        false
      );
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      visual.add(mesh);
      return mesh;
    };

    const pKind = item.proceduralKind ?? item.combatStyle;

    if (pKind === 'voxel_trex') {
      // Authentic blocky voxel T-Rex built from stacked 3D cubes
      addVox(-0.55, 0.7, -0.2, 0.5, 1.4, 0.6, 0x2f6b36);
      addVox(0.55, 0.7, -0.2, 0.5, 1.4, 0.6, 0x2f6b36);
      addVox(0, 1.8, 0, 1.5, 1.3, 2.2, 0x3f8a48);
      addVox(0, 1.85, -1.65, 0.9, 0.85, 1.5, 0x35753d);
      addVox(0, 1.9, -2.7, 0.55, 0.55, 1.0, 0x2f6b36);
      addVox(0, 2.95, 1.15, 1.25, 1.15, 1.65, 0x4ca657);
      addVox(0, 2.38, 1.45, 1.1, 0.35, 1.15, 0xd4d0b8);
      addVox(-0.52, 3.2, 1.65, 0.22, 0.22, 0.22, 0xfacc15, 0xfacc15);
      addVox(0.52, 3.2, 1.65, 0.22, 0.22, 0.22, 0xfacc15, 0xfacc15);
      addVox(-0.78, 1.75, 0.9, 0.25, 0.25, 0.55, 0x2f6b36);
      addVox(0.78, 1.75, 0.9, 0.25, 0.25, 0.55, 0x2f6b36);
    } else if (pKind === 'voxel_dragon') {
      // Blocky Voxel Fire Dragon with outstretched voxel wings
      addVox(0, 1.4, 0, 1.4, 1.2, 2.4, 0x991b1b);
      addVox(-0.6, 0.55, 0.7, 0.45, 1.1, 0.45, 0x7f1d1d);
      addVox(0.6, 0.55, 0.7, 0.45, 1.1, 0.45, 0x7f1d1d);
      addVox(-0.6, 0.55, -0.7, 0.45, 1.1, 0.45, 0x7f1d1d);
      addVox(0.6, 0.55, -0.7, 0.45, 1.1, 0.45, 0x7f1d1d);
      addVox(0, 2.55, 1.3, 1.1, 1.0, 1.5, 0xdc2626);
      addVox(-0.4, 3.2, 1.0, 0.25, 0.65, 0.25, 0xfbbf24);
      addVox(0.4, 3.2, 1.0, 0.25, 0.65, 0.25, 0xfbbf24);
      addVox(-0.4, 2.7, 1.95, 0.24, 0.24, 0.24, 0xfef08a, 0xf97316);
      addVox(0.4, 2.7, 1.95, 0.24, 0.24, 0.24, 0xfef08a, 0xf97316);
      addVox(-2.1, 2.1, -0.1, 2.8, 0.22, 1.5, 0xb91c1c);
      addVox(2.1, 2.1, -0.1, 2.8, 0.22, 1.5, 0xb91c1c);
      addVox(0, 1.45, -1.9, 0.65, 0.6, 1.7, 0x7f1d1d);
    } else if (pKind === 'voxel_tank') {
      // Authentic Voxel Main Battle Tank
      addVox(-1.05, 0.4, 0, 0.55, 0.78, 2.7, 0x1e242b);
      addVox(1.05, 0.4, 0, 0.55, 0.78, 2.7, 0x1e242b);
      addVox(0, 0.78, 0, 1.85, 0.85, 2.5, 0x4d6b3b);
      addVox(0, 1.45, -0.1, 1.35, 0.65, 1.4, 0x3b542d);
      addVox(0, 1.5, 1.35, 0.28, 0.28, 1.85, 0x2c3b23);
    } else if (pKind === 'voxel_mech') {
      // Voxel Titan Mech
      addVox(-0.65, 0.9, 0, 0.65, 1.8, 0.75, 0x334155);
      addVox(0.65, 0.9, 0, 0.65, 1.8, 0.75, 0x334155);
      addVox(0, 2.4, 0, 2.1, 1.6, 1.3, 0x475569);
      addVox(0, 2.55, 0.72, 1.1, 0.42, 0.2, 0x38bdf8, 0x38bdf8);
      addVox(-1.45, 2.35, 0.2, 0.65, 1.4, 1.1, 0xf97316);
      addVox(1.45, 2.35, 0.2, 0.65, 1.4, 1.1, 0xf97316);
      addVox(0, 3.55, 0, 0.95, 0.75, 0.95, 0x64748b);
    } else if (pKind === 'voxel_zeus') {
      // Voxel Sky God Zeus with golden crown & glowing lightning bolt
      addVox(-0.38, 0.7, 0, 0.48, 1.4, 0.48, 0xe2e8f0);
      addVox(0.38, 0.7, 0, 0.48, 1.4, 0.48, 0xe2e8f0);
      addVox(0, 2.0, 0, 1.35, 1.45, 0.85, 0xf8fafc);
      addVox(0, 2.0, 0.46, 0.35, 1.4, 0.15, 0xfbbf24, 0xf59e0b);
      addVox(0, 3.15, 0, 0.95, 0.95, 0.95, 0xf5d0b5);
      addVox(0, 2.8, 0.48, 0.85, 0.42, 0.25, 0xf1f5f9);
      addVox(0, 3.72, 0, 1.05, 0.25, 1.05, 0xfbbf24, 0xf59e0b);
      addVox(-0.98, 2.0, 0, 0.45, 1.25, 0.45, 0xf8fafc);
      addVox(0.98, 2.15, 0.35, 0.45, 1.25, 0.45, 0xf8fafc);
      const bolt = addVox(1.1, 2.6, 0.95, 0.22, 1.7, 0.22, 0xfef08a, 0xfacc15);
      bolt.rotation.x = 0.25;
      bolt.name = 'spin_ring';
    } else if (pKind === 'voxel_wall') {
      addVox(0, 1.2, 0, 2.6, 2.4, 1.1, 0x64748b);
      addVox(-0.95, 2.65, 0, 0.65, 0.55, 1.15, 0x94a3b8);
      addVox(0, 2.65, 0, 0.65, 0.55, 1.15, 0x94a3b8);
      addVox(0.95, 2.65, 0, 0.65, 0.55, 1.15, 0x94a3b8);
    } else if (pKind === 'voxel_tower') {
      addVox(0, 1.8, 0, 1.8, 3.6, 1.8, 0x64748b);
      addVox(0, 3.9, 0, 2.2, 0.6, 2.2, 0x475569);
      addVox(0, 4.45, 0, 0.7, 0.7, 0.7, 0x38bdf8, 0x38bdf8).name = 'spin_ring';
    } else if (pKind === 'voxel_tnt') {
      addVox(0, 0.6, 0, 1.2, 1.2, 1.2, 0xdc2626);
      addVox(0, 0.6, 0, 1.24, 0.34, 1.24, 0xf8fafc);
      addVox(0, 1.28, 0, 0.16, 0.28, 0.16, 0xfacc15, 0xf97316);
    } else if (pKind === 'voxel_barracks') {
      addVox(0, 1.25, 0, 3.0, 2.5, 2.4, 0x475569);
      addVox(0, 2.85, 0, 3.3, 0.7, 2.7, 0x991b1b);
      addVox(0, 0.9, 1.22, 1.0, 1.7, 0.14, 0x0f172a);
      addVox(0, 3.6, 0, 0.55, 0.55, 0.55, 0xfbbf24, 0xf59e0b).name = 'spin_ring';
    } else if (pKind === 'voxel_frog') {
      // 100% blocky green voxel frog for Voxel 3D Polymorph hex!
      addVox(0, 0.32, 0, 0.72, 0.42, 0.85, 0x22c55e);
      addVox(-0.24, 0.62, 0.28, 0.22, 0.22, 0.22, 0xfef08a);
      addVox(0.24, 0.62, 0.28, 0.22, 0.22, 0.22, 0xfef08a);
      addVox(-0.24, 0.64, 0.39, 0.1, 0.1, 0.05, 0x0f172a);
      addVox(0.24, 0.64, 0.39, 0.1, 0.1, 0.05, 0x0f172a);
      addVox(-0.42, 0.16, -0.22, 0.22, 0.28, 0.36, 0x16a34a);
      addVox(0.42, 0.16, -0.22, 0.22, 0.28, 0.36, 0x16a34a);
      addVox(-0.36, 0.14, 0.3, 0.18, 0.24, 0.22, 0x16a34a);
      addVox(0.36, 0.14, 0.3, 0.18, 0.24, 0.22, 0x16a34a);
    } else if (item.combatStyle === 'mine') {
      const baseMat = addMat({ color: 0x262b36, roughness: 0.4, metalness: 0.65 });
      const ledMat = addMat({ color: 0xff2e1f, emissive: 0xff2e1f, emissiveIntensity: 2.2, roughness: 0.2 }, false);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 0.22, 16), baseMat);
      disc.position.y = 0.11;
      disc.castShadow = true;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), ledMat);
      led.position.y = 0.25;
      led.name = 'pulse_led';
      visual.add(disc, led);
    } else if (item.combatStyle === 'jumppad') {
      const frameMat = addMat({ color: 0x1b2230, roughness: 0.35, metalness: 0.75 });
      const glowMat = addMat({ color: 0x06b6d4, emissive: 0x06b6d4, emissiveIntensity: 1.7, roughness: 0.2 }, false);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.28, 0.22, 24), frameMat);
      pad.position.y = 0.11;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.09, 10, 28), glowMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.25;
      ring.name = 'spin_ring';
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.38, 16), glowMat);
      cone.position.y = 0.4;
      visual.add(pad, ring, cone);
    } else if (item.combatStyle === 'blackhole') {
      const coreMat = addMat({ color: 0x030206, roughness: 0.05, metalness: 0.95 });
      const diskMat = addMat({ color: 0xa855f7, emissive: 0x9333ea, emissiveIntensity: 2.2, side: THREE.DoubleSide }, false);
      const outerMat = addMat(
        { color: 0xec4899, emissive: 0xdb2777, emissiveIntensity: 1.5, transparent: true, opacity: 0.58, side: THREE.DoubleSide },
        false
      );
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 24), coreMat);
      core.position.y = 1.45;
      const disk = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.14, 12, 36), diskMat);
      disk.position.y = 1.45;
      disk.rotation.x = Math.PI / 2.3;
      disk.name = 'spin_ring';
      const outer = new THREE.Mesh(new THREE.RingGeometry(1.75, 2.35, 32), outerMat);
      outer.position.y = 1.45;
      outer.rotation.x = -Math.PI / 2.3;
      outer.name = 'spin_ring_2';
      visual.add(core, disk, outer);
    } else if (item.combatStyle === 'tesla') {
      const steelMat = addMat({ color: 0x1e2430, roughness: 0.35, metalness: 0.8 });
      const copperMat = addMat({ color: 0xd97706, roughness: 0.3, metalness: 0.85 });
      const arcMat = addMat({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 2.2, roughness: 0.15 }, false);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.88, 0.65, 8), steelMat);
      base.position.y = 0.32;
      base.castShadow = true;
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 2.1, 10), steelMat);
      spire.position.y = 1.6;
      spire.castShadow = true;
      const coil1 = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 8, 20), copperMat);
      coil1.rotation.x = Math.PI / 2;
      coil1.position.y = 1.45;
      const coil2 = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.07, 8, 20), copperMat);
      coil2.rotation.x = Math.PI / 2;
      coil2.position.y = 2.05;
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 1), arcMat);
      orb.position.y = 2.85;
      orb.name = 'spin_ring';
      visual.add(base, spire, coil1, coil2, orb);
    } else if (item.combatStyle === 'cryo') {
      const baseMat = addMat({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 });
      const iceMat = addMat({ color: 0x7dd3fc, emissive: 0x0284c7, emissiveIntensity: 1.5, roughness: 0.12 }, false);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.25, 6), baseMat);
      base.position.y = 0.12;
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.45, 6), iceMat);
      shard.position.y = 1.05;
      shard.name = 'spin_ring';
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.06, 8, 24), iceMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.45;
      ring.name = 'spin_ring_2';
      visual.add(base, shard, ring);
    } else {
      const pillarMat = addMat({ color: 0x1e2430, roughness: 0.55, metalness: 0.35 });
      const crystalMat = addMat({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.8, roughness: 0.18 }, false);
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.72, 0.9, 8), pillarMat);
      pedestal.position.y = 0.45;
      pedestal.castShadow = true;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crystalMat);
      crystal.position.y = 1.65;
      crystal.name = 'spin_ring';
      visual.add(pedestal, crystal);
    }

    visual.scale.setScalar(scaleMult);
    root.add(visual);

    return {
      root,
      visual,
      mixer: null,
      actions: {},
      flashMaterials,
      disposeMaterials,
      hasSkeletalAnims: false,
    };
  }
}
