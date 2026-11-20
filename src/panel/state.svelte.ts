/**
 * The Pit Wall's view of the app. The panel owns no state of its own: it
 * renders snapshots published by the engine (which lives in the pet window)
 * and sends commands back.
 */
import type { Command, PhaseLengthKey, Snapshot, SoundName } from '../engine/engine';
import type { Settings } from '../core/settings';
import { on, send } from '../lib/platform';
import { playSound } from '../lib/sound';

export const app = $state<{ snap: Snapshot | null; now: number }>({ snap: null, now: Date.now() });

export function dispatch(cmd: Command): void {
  void send('command', cmd);
}

export function update(patch: Partial<Settings>): void {
  // Show the change at once; the engine's snapshot confirms it a moment later.
  if (app.snap) app.snap = { ...app.snap, settings: { ...app.snap.settings, ...patch } };
  dispatch({ type: 'updateSettings', patch });
}

/** Set a phase length from the timer face (same setting as in Settings). */
export function setPhaseMinutes(key: PhaseLengthKey, minutes: number): void {
  if (app.snap) app.snap = { ...app.snap, settings: { ...app.snap.settings, [key]: minutes } };
  dispatch({ type: 'setPhaseMinutes', key, minutes });
}

export async function connect(): Promise<() => void> {
  const offSnap = await on<Snapshot>('snapshot', (snap) => {
    app.snap = snap;
    app.now = Date.now();
  });
  const offSound = await on<{ name: SoundName; volume: number }>('play-sound', ({ name, volume }) => {
    playSound(name, volume);
  });
  // Ask until the engine answers (it may still be starting up).
  dispatch({ type: 'requestSnapshot' });
  const retry = setInterval(() => {
    if (app.snap) clearInterval(retry);
    else dispatch({ type: 'requestSnapshot' });
  }, 400);
  const clock = setInterval(() => (app.now = Date.now()), 250);
  return () => {
    offSnap();
    offSound();
    clearInterval(retry);
    clearInterval(clock);
  };
}
