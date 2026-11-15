/**
 * All sounds are synthesized here with the Web Audio API. Nothing is recorded
 * or sampled, so there is no borrowed audio anywhere in the app.
 */
import type { SoundName } from '../engine/engine';

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  return ctx;
}

/** Call from a click or key press so the browser lets this window make sound. */
export function unlockAudio(): void {
  const c = context();
  if (c && c.state === 'suspended') void c.resume();
}

interface Tone {
  at: number;
  dur: number;
  freq: number;
  /** Glide to this frequency over the note. */
  to?: number;
  type?: OscillatorType;
  gain?: number;
}

function playTones(c: AudioContext, tones: Tone[], volume: number): void {
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.5;
  master.connect(c.destination);
  const t0 = c.currentTime + 0.03;
  for (const tone of tones) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = tone.type ?? 'sine';
    osc.frequency.setValueAtTime(tone.freq, t0 + tone.at);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, t0 + tone.at + tone.dur);
    const peak = tone.gain ?? 0.6;
    env.gain.setValueAtTime(0.0001, t0 + tone.at);
    env.gain.exponentialRampToValueAtTime(peak, t0 + tone.at + 0.012);
    env.gain.setValueAtTime(peak, t0 + tone.at + Math.max(0.012, tone.dur - 0.05));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.at + tone.dur);
    osc.connect(env).connect(master);
    osc.start(t0 + tone.at);
    osc.stop(t0 + tone.at + tone.dur + 0.02);
  }
}

/** A short burst of filtered noise, like a radio keying up. */
function playStatic(c: AudioContext, at: number, dur: number, volume: number): void {
  const length = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  const gain = c.createGain();
  gain.gain.value = Math.max(0, Math.min(1, volume)) * 0.18;
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(c.currentTime + 0.03 + at);
}

const SCORES: Record<SoundName, Tone[]> = {
  // Five start beeps, then a higher "go" tone.
  lightsOut: [
    ...[0, 1, 2, 3, 4].map((i) => ({ at: i * 0.24, dur: 0.13, freq: 520, type: 'square' as const, gain: 0.3 })),
    { at: 1.3, dur: 0.5, freq: 1040, type: 'square', gain: 0.32 },
  ],
  // Radio-style two-note chime.
  pitRadio: [
    { at: 0.08, dur: 0.16, freq: 660, type: 'triangle' },
    { at: 0.26, dur: 0.3, freq: 990, type: 'triangle' },
  ],
  // End of a Grand Prix: a short rising fanfare.
  redFlag: [
    { at: 0.08, dur: 0.16, freq: 523, type: 'triangle' },
    { at: 0.26, dur: 0.16, freq: 659, type: 'triangle' },
    { at: 0.44, dur: 0.16, freq: 784, type: 'triangle' },
    { at: 0.62, dur: 0.55, freq: 1047, type: 'triangle' },
  ],
  // Two quick whirrs.
  wheelGun: [
    { at: 0, dur: 0.22, freq: 160, to: 420, type: 'sawtooth', gain: 0.22 },
    { at: 0.34, dur: 0.22, freq: 160, to: 420, type: 'sawtooth', gain: 0.22 },
  ],
  click: [{ at: 0, dur: 0.06, freq: 880, type: 'triangle', gain: 0.3 }],
};

/**
 * Play a sound. Returns false if this window is not allowed to make sound yet
 * (no click has happened in it), so the caller can ask the other window.
 */
export function playSound(name: SoundName, volume: number): boolean {
  const c = context();
  if (!c || volume <= 0) return false;
  if (c.state !== 'running') {
    void c.resume();
    return false;
  }
  if (name === 'pitRadio') playStatic(c, 0, 0.09, volume);
  playTones(c, SCORES[name], volume);
  return true;
}
