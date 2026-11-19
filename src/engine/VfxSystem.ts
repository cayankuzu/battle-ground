import * as THREE from 'three';
import { ProjectileKind, Team } from '../types';

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  spin: number;
}

interface RingWave {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
}

interface BeamEffect {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  life: number;
  maxLife: number;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  team: Team;
  ownerId: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  splashRadius: number;
  knockback: number;
  gravity: number;
  life: number;
  mesh: THREE.Mesh;
}

interface RallyBeacon {
  group: THREE.Group;
  life: number;
}

const SHARED_BOX = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const SHARED_RING = new THREE.RingGeometry(0.75, 1.0, 28);
const SHARED_ARROW = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6);
SHARED_ARROW.rotateX(Math.PI / 2);
const SHARED_SPHERE = new THREE.SphereGeometry(0.24, 10, 8);
const SHARED_BOLT = new THREE.BoxGeometry(0.09, 0.09, 0.85);

export class VfxSystem {
  public readonly projectiles: Projectile[] = [];
  private readonly particles: Particle[] = [];
  private readonly rings: RingWave[] = [];
  private readonly beams: BeamEffect[] = [];
  private readonly beacons: RallyBeacon[] = [];
  private nextProjId = 1;

  // Shared materials by color
  private readonly matCache = new Map<number, THREE.MeshBasicMaterial>();

  constructor(private readonly group: THREE.Group) {}

  private getBasicMat(hex: number): THREE.MeshBasicMaterial {
    let m = this.matCache.get(hex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: hex });
      this.matCache.set(hex, m);
    }
    return m;
  }

  public spawnProjectile(opts: {
    kind: ProjectileKind;
    team: Team;
    ownerId: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    damage: number;
    splashRadius?: number;
    knockback?: number;
  }): void {
    const dx = opts.to.x - opts.from.x;
    const dy = opts.to.y - opts.from.y;
    const dz = opts.to.z - opts.from.z;
    const horizDist = Math.max(0.5, Math.hypot(dx, dz));

    let speed = 26;
    let gravity = 14;
    let geo: THREE.BufferGeometry = SHARED_ARROW;
    let color = 0xfef08a;
    let scale = 1;

    switch (opts.kind) {
      case 'arrow':
        speed = 24;
        gravity = 16;
        geo = SHARED_ARROW;
        color = 0xfde68a;
        break;
      case 'bullet':
        speed = 46;
        gravity = 0.5;
        geo = SHARED_BOLT;
        color = 0xfbbf24;
        scale = 0.7;
        break;
      case 'laser':
        speed = 50;
        gravity = 0;
        geo = SHARED_BOLT;
        color = opts.team === 'blue' ? 0x38bdf8 : 0xff3b30;
        scale = 1.2;
        break;
      case 'plasma':
        speed = 38;
        gravity = 0;
        geo = SHARED_BOLT;
        color = 0x22d3ee;
        scale = 1.35;
        break;
      case 'fireball':
        speed = 19;
        gravity = 6;
        geo = SHARED_SPHERE;
        color = 0xff6b2b;
        scale = 1.45;
        break;
      case 'darkbolt':
        speed = 22;
        gravity = 3;
        geo = SHARED_SPHERE;
        color = 0xa855f7;
        scale = 1.15;
        break;
      case 'shell':
        speed = 23;
        gravity = 18;
        geo = SHARED_SPHERE;
        color = 0xfacc15;
        scale = 1.65;
        break;
      case 'heal':
        speed = 26;
        gravity = 0;
        geo = SHARED_SPHERE;
        color = 0x10b981;
        scale = 1.0;
        break;
      default:
        break;
    }

    const flightTime = horizDist / speed;
    const vx = dx / flightTime;
    const vz = dz / flightTime;
    const vy = (dy + 0.5 * gravity * flightTime * flightTime) / flightTime;

    const mesh = new THREE.Mesh(geo, this.getBasicMat(color));
    mesh.scale.setScalar(scale);
    mesh.position.copy(opts.from);
    mesh.lookAt(opts.from.x + vx, opts.from.y + vy, opts.from.z + vz);
    this.group.add(mesh);

    this.projectiles.push({
      id: this.nextProjId++,
      kind: opts.kind,
      team: opts.team,
      ownerId: opts.ownerId,
      x: opts.from.x,
      y: opts.from.y,
      z: opts.from.z,
      vx,
      vy,
      vz,
      damage: opts.damage,
      splashRadius: opts.splashRadius ?? 0,
      knockback: opts.knockback ?? 2.5,
      gravity,
      life: Math.min(3.5, flightTime + 0.8),
      mesh,
    });
  }

  public spawnRing(x: number, y: number, z: number, color: number, startScale: number, endScale: number, maxLife = 0.42): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(SHARED_RING, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(startScale);
    this.group.add(mesh);
    this.rings.push({ mesh, mat, life: maxLife, maxLife, startScale, endScale });
  }

  public spawnBurst(x: number, y: number, z: number, color: number, count = 10, power = 7): void {
    if (this.particles.length > 260) return;
    const mat = this.getBasicMat(color);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(SHARED_BOX, mat);
      const s = 0.55 + Math.random() * 0.95;
      mesh.scale.setScalar(s);
      mesh.position.set(x, y, z);
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.85) * power;
      this.group.add(mesh);
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd,
        vy: (0.4 + Math.random() * 0.9) * power,
        vz: Math.sin(angle) * spd,
        life: 0.35 + Math.random() * 0.45,
        maxLife: 0.8,
        gravity: 22,
        spin: (Math.random() - 0.5) * 12,
      });
    }
  }

  public spawnExplosion(x: number, y: number, z: number, radius: number): void {
    this.spawnRing(x, 0.14, z, 0xff6b2b, 0.5, radius * 1.1, 0.45);
    this.spawnRing(x, 0.18, z, 0xfef08a, 0.3, radius * 0.75, 0.28);
    this.spawnBurst(x, y + 0.6, z, 0xff5722, 14, Math.min(14, 5 + radius * 1.4));
    this.spawnBurst(x, y + 0.6, z, 0xfacc15, 8, Math.min(12, 4 + radius));
  }

  public spawnLightning(points: THREE.Vector3[], color = 0xc084fc): void {
    const jagged: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      jagged.push(a.clone());
      for (let s = 1; s <= 3; s++) {
        const p = new THREE.Vector3().lerpVectors(a, b, s / 4);
        p.x += (Math.random() - 0.5) * 0.6;
        p.y += (Math.random() - 0.5) * 0.5 + 0.3;
        p.z += (Math.random() - 0.5) * 0.6;
        jagged.push(p);
      }
    }
    jagged.push(points[points.length - 1].clone());

    const geo = new THREE.BufferGeometry().setFromPoints(jagged);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    this.group.add(line);
    this.beams.push({ line, mat, life: 0.24, maxLife: 0.24 });
  }

  public spawnRallyBeacon(x: number, z: number, color: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const poleMat = this.getBasicMat(0xe2e8f0);
    const flagMat = this.getBasicMat(color);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), poleMat);
    pole.position.y = 1.6;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.65, 0.08), flagMat);
    flag.position.set(0.55, 2.75, 0);

    g.add(pole, flag);
    this.group.add(g);
    this.beacons.push({ group: g, life: 3.5 });
    this.spawnRing(x, 0.12, z, color, 0.4, 2.8, 0.5);
  }

  public removeProjectileAt(idx: number): void {
    const p = this.projectiles[idx];
    this.group.remove(p.mesh);
    this.projectiles.splice(idx, 1);
  }

  public clearAll(): void {
    for (const p of this.projectiles) this.group.remove(p.mesh);
    this.projectiles.length = 0;

    for (const pt of this.particles) this.group.remove(pt.mesh);
    this.particles.length = 0;

    for (const r of this.rings) {
      this.group.remove(r.mesh);
      r.mat.dispose();
    }
    this.rings.length = 0;

    for (const b of this.beams) {
      this.group.remove(b.line);
      b.line.geometry.dispose();
      b.mat.dispose();
    }
    this.beams.length = 0;

    for (const bc of this.beacons) {
      this.group.remove(bc.group);
    }
    this.beacons.length = 0;
  }

  public updateEffects(dt: number): void {
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.group.remove(pt.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy -= pt.gravity * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y += pt.vy * dt;
      pt.mesh.position.z += pt.vz * dt;
      if (pt.mesh.position.y < 0.08) {
        pt.mesh.position.y = 0.08;
        pt.vy *= -0.35;
        pt.vx *= 0.6;
        pt.vz *= 0.6;
      }
      pt.mesh.rotation.x += pt.spin * dt;
      pt.mesh.rotation.y += pt.spin * dt;
      const ratio = pt.life / pt.maxLife;
      pt.mesh.scale.setScalar(Math.max(0.05, ratio));
    }

    // Ring shockwaves
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        r.mat.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const p = 1 - r.life / r.maxLife;
      const s = r.startScale + (r.endScale - r.startScale) * (1 - Math.pow(1 - p, 2));
      r.mesh.scale.setScalar(s);
      r.mat.opacity = 0.85 * (1 - p);
    }

    // Lightning beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.group.remove(b.line);
        b.line.geometry.dispose();
        b.mat.dispose();
        this.beams.splice(i, 1);
        continue;
      }
      b.mat.opacity = b.life / b.maxLife;
    }

    // Rally beacons
    for (let i = this.beacons.length - 1; i >= 0; i--) {
      const bc = this.beacons[i];
      bc.life -= dt;
      bc.group.rotation.y += dt * 1.6;
      if (bc.life <= 0) {
        this.group.remove(bc.group);
        this.beacons.splice(i, 1);
      }
    }
  }
}
