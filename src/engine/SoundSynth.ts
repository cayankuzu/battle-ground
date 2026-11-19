export class SoundSynth {
  private ctx: AudioContext | null = null;
  public enabled = true;
  private lastSoundTime = new Map<string, number>();
  private paintStreak = 0;
  private lastPaintAt = 0;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private throttle(key: string, minIntervalMs: number): boolean {
    const now = performance.now();
    const prev = this.lastSoundTime.get(key) ?? 0;
    if (now - prev < minIntervalMs) return false;
    this.lastSoundTime.set(key, now);
    return true;
  }

  public playUiClick(pitch = 620): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.throttle('ui', 30)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, now + 0.045);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  public playSpawnPop(isHeavy = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.throttle('spawn', 42)) return;
    const tNow = performance.now();
    if (tNow - this.lastPaintAt < 260) {
      this.paintStreak = Math.min(this.paintStreak + 1, 14);
    } else {
      this.paintStreak = 0;
    }
    this.lastPaintAt = tNow;

    const now = ctx.currentTime;
    const baseFreq = (isHeavy ? 170 : 280) * Math.pow(1.04, this.paintStreak);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isHeavy ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 0.72, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.38, now + 0.07);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  public playErase(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.throttle('erase', 55)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.07);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playMeleeHit(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.throttle('melee', 65)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    const f = 140 + Math.random() * 90;
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.07);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playShoot(kind: string): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.throttle('shoot_' + kind, 70)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (kind === 'laser' || kind === 'plasma') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(kind === 'laser' ? 980 : 620, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.11);
      gain.gain.setValueAtTime(0.038, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    } else if (kind === 'bullet') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(240 + Math.random() * 80, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.055);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    } else if (kind === 'lightning') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1250, now);
      osc.frequency.linearRampToValueAtTime(320, now + 0.09);
      gain.gain.setValueAtTime(0.042, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    } else if (kind === 'heal') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(840, now + 0.12);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    } else {
      // Arrow / fireball / darkbolt
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.08);
      gain.gain.setValueAtTime(0.032, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    }

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playExplosion(heavy = true): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.throttle('boom', 90)) return;
    const now = ctx.currentTime;
    const duration = heavy ? 0.36 : 0.2;

    // Noise burst
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.8);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(heavy ? 520 : 880, now);
    filter.frequency.exponentialRampToValueAtTime(80, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.16 : 0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);

    // Sub punch
    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 110 : 150, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + duration * 0.8);
    oGain.gain.setValueAtTime(heavy ? 0.15 : 0.08, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.85);
    osc.connect(oGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  public playJumpPad(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.throttle('jump', 80)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.16);
    gain.gain.setValueAtTime(0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playVictory(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const notes = [392.0, 523.25, 659.25, 783.99];
    const now = ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + idx * 0.095;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.08, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.44);
    });
  }
}
