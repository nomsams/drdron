// Synthesized drone audio (no samples): a sawtooth+triangle motor hum through
// a bandpass filter whose pitch follows throttle, plus collect/crash SFX.
// Initialise from a user gesture (takeoff click/key qualifies).
// Adapted from rishabhrathod01.github.io (MIT). Entire module is optional —
// the experience runs muted if Web Audio is unavailable.

class EngineAudio {
  private ctx: AudioContext | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private fallGain: GainNode | null = null;
  private targetGain = 0;
  private masterVolume = 1;
  enabled = true;

  init() {
    if (this.ctx) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      this.ctx = ctx;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc1.type = "sawtooth";
      osc1.frequency.value = 65;
      osc2.type = "triangle";
      osc2.frequency.value = 130;

      filter.type = "bandpass";
      filter.frequency.value = 180;
      filter.Q.value = 1.8;

      gain.gain.value = 0;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(0);
      osc2.start(0);

      this.osc1 = osc1;
      this.osc2 = osc2;
      this.gain = gain;
      this.filter = filter;

      // Waterfall bed: looped noise through a lowpass = distant rushing.
      // Gain driven by proximity (see setFallLevel), silent by default.
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      const fallGain = ctx.createGain();
      fallGain.gain.value = 0;
      noise.connect(lp);
      lp.connect(fallGain);
      fallGain.connect(ctx.destination);
      noise.start(0);
      this.fallGain = fallGain;
    } catch (e) {
      console.warn("Web Audio API not supported", e);
    }
  }

  private now() {
    return this.ctx?.currentTime ?? 0;
  }

  setHum(volume: number) {
    if (!this.gain) return;
    this.targetGain = this.enabled ? 0.05 * volume * this.masterVolume : 0;
    this.gain.gain.setTargetAtTime(this.targetGain, this.now(), 0.08);
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.min(1, Math.max(0, v));
  }

  setThrottle(totalThrottle: number) {
    if (!this.osc1 || !this.osc2 || !this.filter) return;
    const pitch = 1.0 + totalThrottle * 0.45;
    const t = this.now();
    this.osc1.frequency.setTargetAtTime(65 * pitch, t, 0.05);
    this.osc2.frequency.setTargetAtTime(130 * pitch, t, 0.05);
    this.filter.frequency.setTargetAtTime(180 + totalThrottle * 90, t, 0.05);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.gain) {
      this.gain.gain.setTargetAtTime(enabled ? this.targetGain : 0, this.now(), 0.05);
    }
    if (!enabled && this.fallGain) {
      this.fallGain.gain.setTargetAtTime(0, this.now(), 0.05);
    }
  }

  /** Waterfall proximity 0..1 — rushing gets louder as you approach. */
  setFallLevel(level: number) {
    if (!this.fallGain) return;
    const v = this.enabled ? Math.min(1, Math.max(0, level)) * 0.12 * this.masterVolume : 0;
    this.fallGain.gain.setTargetAtTime(v, this.now(), 0.2);
  }

  playCollect() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.35);
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.1 * this.masterVolume, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  playCrash() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);
    gain.gain.setValueAtTime(0.1 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  /** Tomato release: short downward whoosh. */
  playDrop() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.08 * this.masterVolume, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /** Tomato splat: filtered noise burst + low thump. */
  playSplat() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Noise burst.
    const len = Math.floor(ctx.sampleRate * 0.18);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12 * this.masterVolume, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.connect(lp);
    lp.connect(ng);
    ng.connect(ctx.destination);
    noise.start(now);
    // Thump.
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.connect(og);
    og.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    og.gain.setValueAtTime(0.1 * this.masterVolume, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  /** Bullseye: bright two-note chirp. */
  playBullseye() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = [659.25, 987.77];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      const t0 = now + i * 0.09;
      osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0.0, t0);
      gain.gain.linearRampToValueAtTime(0.12 * this.masterVolume, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
      osc.start(t0);
      osc.stop(t0 + 0.26);
    });
  }

  /** Hull hit: a crunch (noise) + thump, both scaled by severity 0..1.
   *  Water hits get a brighter, longer hiss instead of the low crunch. */
  playHit(intensity: number, water = false) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const k = Math.min(1, Math.max(0.15, intensity));
    const dur = water ? 0.35 : 0.14 + k * 0.12;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = water ? "highpass" : "lowpass";
    filt.frequency.value = water ? 900 : 700 + k * 1600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * k * this.masterVolume, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filt);
    filt.connect(ng);
    ng.connect(ctx.destination);
    noise.start(now);
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.connect(og);
    og.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(140 - k * 50, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);
    og.gain.setValueAtTime(0.14 * k * this.masterVolume, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  /** Bird strike: a short, indignant squawk. */
  playSquawk() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(650, now + 0.13);
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.05 * this.masterVolume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  /** Repair kit: a quick rising three-note arpeggio. */
  playRepair() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [392, 523.25, 783.99].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      const t0 = now + i * 0.07;
      osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0.0, t0);
      gain.gain.linearRampToValueAtTime(0.1 * this.masterVolume, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      osc.start(t0);
      osc.stop(t0 + 0.23);
    });
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    this.ctx?.resume();
  }

  dispose() {
    this.osc1?.stop();
    this.osc2?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.osc1 = this.osc2 = null;
    this.gain = null;
    this.filter = null;
    this.fallGain = null;
  }
}

export const engineAudio = new EngineAudio();
