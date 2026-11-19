import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { QualityTier, RenderStyle } from '../types';

const MangaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float luma(vec3 c) {
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 texel = 1.0 / uResolution;
      vec4 base = texture2D(tDiffuse, vUv);

      // Sobel edge detection for bold India-ink outlines
      float tl = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  1.0)).rgb);
      float t  = luma(texture2D(tDiffuse, vUv + texel * vec2( 0.0,  1.0)).rgb);
      float tr = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  1.0)).rgb);
      float l  = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  0.0)).rgb);
      float r  = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  0.0)).rgb);
      float bl = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb);
      float b  = luma(texture2D(tDiffuse, vUv + texel * vec2( 0.0, -1.0)).rgb);
      float br = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0, -1.0)).rgb);

      float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
      float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
      float edge = sqrt(gx * gx + gy * gy);

      float lum = luma(base.rgb);

      // Preserve selective vibrant faction colors (red, blue, bright magic/explosions)
      float maxC = max(base.r, max(base.g, base.b));
      float minC = min(base.r, min(base.g, base.b));
      float sat = (maxC > 0.001) ? (maxC - minC) / maxC : 0.0;

      // Diagonal Ben-Day halftone screentone dots
      vec2 px = gl_FragCoord.xy;
      float angle = 0.785398; // 45 deg
      vec2 rot = vec2(
        px.x * cos(angle) - px.y * sin(angle),
        px.x * sin(angle) + px.y * cos(angle)
      );
      vec2 cell = fract(rot / 4.8) - 0.5;
      float dotDist = length(cell);

      vec3 paper = vec3(0.93, 0.915, 0.885);
      vec3 ink = vec3(0.06, 0.06, 0.075);

      // 4-tone cel + screentone manga quantization
      vec3 mangaTone;
      if (lum > 0.66) {
        mangaTone = paper;
      } else if (lum > 0.42) {
        mangaTone = (dotDist < 0.24) ? vec3(0.22, 0.22, 0.25) : paper;
      } else if (lum > 0.22) {
        mangaTone = (dotDist < 0.38) ? ink : vec3(0.76, 0.745, 0.71);
      } else {
        mangaTone = ink;
      }

      // Selective Seinen color pop for red/blue/explosions/energy
      float colorPop = smoothstep(0.42, 0.72, sat) * smoothstep(0.18, 0.45, maxC);
      vec3 celColor = floor(base.rgb * 4.5 + 0.5) / 4.5;
      vec3 col = mix(mangaTone, celColor * 1.08, colorPop * 0.78);

      // Crisp black ink edges
      float inkMask = smoothstep(0.14, 0.26, edge);
      col = mix(col, ink, inkMask);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

const PixelShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uPixelSize: { value: 4.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uPixelSize;
    varying vec2 vUv;

    float bayer4(vec2 p) {
      int x = int(mod(p.x, 4.0));
      int y = int(mod(p.y, 4.0));
      int idx = x + y * 4;
      if (idx == 0)  return  0.0 / 16.0;
      if (idx == 1)  return  8.0 / 16.0;
      if (idx == 2)  return  2.0 / 16.0;
      if (idx == 3)  return 10.0 / 16.0;
      if (idx == 4)  return 12.0 / 16.0;
      if (idx == 5)  return  4.0 / 16.0;
      if (idx == 6)  return 14.0 / 16.0;
      if (idx == 7)  return  6.0 / 16.0;
      if (idx == 8)  return  3.0 / 16.0;
      if (idx == 9)  return 11.0 / 16.0;
      if (idx == 10) return  1.0 / 16.0;
      if (idx == 11) return  9.0 / 16.0;
      if (idx == 12) return 15.0 / 16.0;
      if (idx == 13) return  7.0 / 16.0;
      if (idx == 14) return 13.0 / 16.0;
      return 5.0 / 16.0;
    }

    void main() {
      vec2 grid = uResolution / uPixelSize;
      vec2 pixCoord = floor(vUv * grid);
      vec2 snappedUv = (pixCoord + 0.5) / grid;

      vec3 col = texture2D(tDiffuse, snappedUv).rgb;

      // Gentle shadow lift so dark arenas (Obsidian/Orbital) keep crisp pixel grid readability
      col = pow(max(col, vec3(0.0)), vec3(0.84));
      col = (col - 0.5) * 1.1 + 0.52;
      col = clamp(col, 0.0, 1.0);

      // 4x4 Bayer ordered dithering + 12-step retro palette quantization
      float d = (bayer4(pixCoord) - 0.5) * 0.085;
      float levels = 12.0;
      col = floor((col + d) * levels + 0.5) / levels;

      // Subtle dark crisp pixel edge definition
      vec2 sub = fract(vUv * grid);
      float scan = 1.0 - step(0.92, sub.y) * 0.06;

      gl_FragColor = vec4(clamp(col * scan, 0.0, 1.0), 1.0);
    }
  `,
};

const BlueprintShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float luma(vec3 c) {
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 texel = 1.0 / uResolution;
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      float tl = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  1.0)).rgb);
      float t  = luma(texture2D(tDiffuse, vUv + texel * vec2( 0.0,  1.0)).rgb);
      float tr = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  1.0)).rgb);
      float l  = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  0.0)).rgb);
      float r  = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  0.0)).rgb);
      float bl = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb);
      float b  = luma(texture2D(tDiffuse, vUv + texel * vec2( 0.0, -1.0)).rgb);
      float br = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0, -1.0)).rgb);

      float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
      float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
      float edge = smoothstep(0.08, 0.24, sqrt(gx * gx + gy * gy));

      vec3 cadBg = vec3(0.03, 0.045, 0.075);
      // Keep red/blue faction signal glow in CAD telemetry
      float redSig = max(0.0, c.r - max(c.g, c.b) * 1.15);
      float blueSig = max(0.0, c.b - max(c.r, c.g) * 1.15);
      vec3 lineCol = vec3(0.84, 0.90, 0.96);
      lineCol = mix(lineCol, vec3(1.0, 0.22, 0.18), clamp(redSig * 2.4, 0.0, 1.0));
      lineCol = mix(lineCol, vec3(0.24, 0.58, 1.0), clamp(blueSig * 2.4, 0.0, 1.0));

      vec3 fill = cadBg + c * 0.28;
      vec3 outCol = mix(fill, lineCol * 1.15, edge);

      // Subtle architectural scanline
      float scan = 0.97 + 0.03 * sin(gl_FragCoord.y * 1.5);
      gl_FragColor = vec4(outCol * scan, 1.0);
    }
  `,
};

export class RenderStyleEngine {
  public style: RenderStyle = 'ultra';
  public quality: QualityTier = 'high';

  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly mangaPass: ShaderPass;
  private readonly pixelPass: ShaderPass;
  private readonly blueprintPass: ShaderPass;
  private readonly outputPass: OutputPass;
  private readonly pmremEnv: THREE.Texture;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera
  ) {
    // Generate real procedural HDR Studio Environment Map for Ultra Realistic PBR reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.pmremEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const size = new THREE.Vector2();
    renderer.getSize(size);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Half-resolution bloom target gives identical cinema glow at 2.5x higher frame rate
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.max(1, size.x * 0.5), Math.max(1, size.y * 0.5)), 0.34, 0.42, 0.85);
    this.composer.addPass(this.bloomPass);

    this.mangaPass = new ShaderPass(MangaShader);
    this.mangaPass.enabled = false;
    this.composer.addPass(this.mangaPass);

    this.pixelPass = new ShaderPass(PixelShader);
    this.pixelPass.enabled = false;
    this.composer.addPass(this.pixelPass);

    this.blueprintPass = new ShaderPass(BlueprintShader);
    this.blueprintPass.enabled = false;
    this.composer.addPass(this.blueprintPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.applySettings();
  }

  public setStyle(style: RenderStyle): void {
    this.style = style;
    this.applySettings();
  }

  public setQuality(quality: QualityTier): void {
    this.quality = quality;
    this.applySettings();
  }

  public getMaxUnitCap(): number {
    switch (this.quality) {
      case 'low':
        return 140;
      case 'medium':
        return 220;
      case 'high':
        return 300;
      case 'ultra':
        return 380;
    }
  }

  public resize(width: number, height: number): void {
    const dpr = this.getTargetPixelRatio();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);

    const rw = Math.max(1, width * dpr);
    const rh = Math.max(1, height * dpr);
    this.mangaPass.uniforms.uResolution.value.set(rw, rh);
    this.pixelPass.uniforms.uResolution.value.set(rw, rh);
    this.blueprintPass.uniforms.uResolution.value.set(rw, rh);
    this.pixelPass.uniforms.uPixelSize.value = Math.max(3, Math.round(3.8 * dpr));
  }

  private getTargetPixelRatio(): number {
    const sys = window.devicePixelRatio || 1;
    switch (this.quality) {
      case 'low':
        return 1;
      case 'medium':
        return Math.min(sys, 1.15);
      case 'high':
        return Math.min(sys, 1.45);
      case 'ultra':
        return Math.min(sys, 2.0);
    }
  }

  private applySettings(): void {
    // Shadows by quality tier
    this.renderer.shadowMap.enabled = this.quality !== 'low';

    // Reset passes
    this.bloomPass.enabled = false;
    this.mangaPass.enabled = false;
    this.pixelPass.enabled = false;
    this.blueprintPass.enabled = false;

    if (this.style === 'ultra' || this.style === 'hybrid') {
      this.scene.environment = this.pmremEnv;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = this.style === 'hybrid' ? 1.14 : 1.18;
      this.bloomPass.enabled = this.quality !== 'low';
      this.bloomPass.strength = this.quality === 'ultra' ? 0.4 : 0.28;
    } else if (this.style === 'realistic') {
      this.scene.environment = null;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.06;
    } else if (this.style === 'manga') {
      this.scene.environment = null;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.mangaPass.enabled = true;
    } else if (this.style === 'pixel') {
      this.scene.environment = null;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1.12;
      this.pixelPass.enabled = true;
    } else if (this.style === 'blueprint') {
      this.scene.environment = null;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1.1;
      this.blueprintPass.enabled = true;
    }

    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.resize(size.x || window.innerWidth, size.y || window.innerHeight);
  }

  public render(): void {
    // Use direct fast render for Realistic mode (no post-process passes enabled), composer for all stylized/ultra modes
    if (this.style === 'realistic') {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }
  }
}
