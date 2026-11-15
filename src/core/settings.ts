/**
 * User settings: defaults, limits and validation.
 * Every choice the plan left open (durations, units, cold cutoff, location)
 * lives here as a setting so it is easy to change from the Pit Wall.
 */
import type { Place } from './location';
import type { Compound } from './tires';
import type { TimerConfig } from './timer';

export type Units = 'C' | 'F';
export type PetSize = 'S' | 'M' | 'L';
export type LiveryId = 'lagoon' | 'ultraviolet' | 'sorbet' | 'graphite';

export interface Settings {
  stintMin: number;
  pitStopMin: number;
  redFlagMin: number;
  /** Stints in one Grand Prix; the long podium break comes after the last one. */
  stintsPerGP: number;
  /** Start the next stint or break automatically when one ends. */
  autoStartNext: boolean;
  location: Place | null;
  units: Units;
  /** "Feels like" temperature (always stored in Celsius) at or below which hard tires go on. */
  coldThresholdC: number;
  soundOn: boolean;
  /** 0..1 */
  volume: number;
  notifications: boolean;
  /** "Driver's choice": pin a compound regardless of the weather. */
  compoundOverride: Compound | null;
  petSize: PetSize;
  autostart: boolean;
  livery: LiveryId;
  carNumber: number;
  hotkeyEnabled: boolean;
  /** Global start/pause shortcut, in Tauri accelerator syntax. */
  hotkey: string;
  /** Dim the car a little at night. */
  nightDim: boolean;
  /** What you are studying this session. */
  objective: string;
  onboarded: boolean;
}

export const LIMITS = {
  stintMin: { min: 10, max: 90 },
  pitStopMin: { min: 2, max: 20 },
  redFlagMin: { min: 10, max: 45 },
  stintsPerGP: { min: 1, max: 8 },
  coldThresholdC: { min: -10, max: 20 },
  carNumber: { min: 0, max: 99 },
} as const;


export const PET_SCALE: Record<PetSize, number> = { S: 0.8, M: 1, L: 1.35 };
/** Pet window size at scale 1, in logical pixels. */
export const PET_BASE = { width: 150, height: 104 };

export interface Livery {
  id: LiveryId;
  name: string;
  body: string;
  bodyDark: string;
  accent: string;
  wing: string;
  helmet: string;
  number: string;
}

/** Original colour schemes. None of them copies a real team. */
export const LIVERIES: Livery[] = [
  { id: 'lagoon', name: 'Lagoon', body: '#12a5a0', bodyDark: '#2b3340', accent: '#ff8a3d', wing: '#2b3340', helmet: '#ffd166', number: '#ffffff' },
  { id: 'ultraviolet', name: 'Ultraviolet', body: '#7b4dff', bodyDark: '#231942', accent: '#c6f432', wing: '#231942', helmet: '#f4f1ff', number: '#ffffff' },
  { id: 'sorbet', name: 'Sorbet', body: '#ff7a8a', bodyDark: '#22335c', accent: '#fff1c9', wing: '#22335c', helmet: '#7ad7f0', number: '#22335c' },
  { id: 'graphite', name: 'Graphite', body: '#555d6b', bodyDark: '#1c1f26', accent: '#3fe0d0', wing: '#1c1f26', helmet: '#ff6b9a', number: '#3fe0d0' },
];

export function liveryFor(id: LiveryId): Livery {
  return LIVERIES.find((l) => l.id === id) ?? LIVERIES[0];
}

/** Fahrenheit only for the few places that use it day to day. */
export function defaultUnits(locale?: string): Units {
  const tag = locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  const region = tag.split('-')[1]?.toUpperCase();
  return region && ['US', 'BS', 'KY', 'LR', 'PW', 'FM', 'MH'].includes(region) ? 'F' : 'C';
}

export function defaultSettings(locale?: string): Settings {
  return {
    stintMin: 25,
    pitStopMin: 5,
    redFlagMin: 20,
    stintsPerGP: 4,
    autoStartNext: true,
    location: null,
    units: defaultUnits(locale),
    coldThresholdC: 7,
    soundOn: true,
    volume: 0.6,
    notifications: true,
    compoundOverride: null,
    petSize: 'M',
    autostart: false,
    livery: 'lagoon',
    carNumber: 7,
    hotkeyEnabled: false,
    hotkey: 'CommandOrControl+Shift+P',
    nightDim: true,
    objective: '',
    onboarded: false,
  };
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

function cleanPlace(v: unknown): Place | null {
  const p = v as Partial<Place> | null;
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  return {
    name: typeof p.name === 'string' && p.name ? p.name.slice(0, 80) : 'My location',
    lat: p.lat,
    lon: p.lon,
    approximate: p.approximate === true,
  };
}

/** Merge anything loaded from disk (or sent from the panel) onto safe defaults. */
export function sanitizeSettings(raw: unknown, base: Settings = defaultSettings()): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const has = (k: keyof Settings) => k in r;
  return {
    stintMin: clampInt(r.stintMin, LIMITS.stintMin.min, LIMITS.stintMin.max, base.stintMin),
    pitStopMin: clampInt(r.pitStopMin, LIMITS.pitStopMin.min, LIMITS.pitStopMin.max, base.pitStopMin),
    redFlagMin: clampInt(r.redFlagMin, LIMITS.redFlagMin.min, LIMITS.redFlagMin.max, base.redFlagMin),
    stintsPerGP: clampInt(r.stintsPerGP, LIMITS.stintsPerGP.min, LIMITS.stintsPerGP.max, base.stintsPerGP),
    autoStartNext: bool(r.autoStartNext, base.autoStartNext),
    location: has('location') ? cleanPlace(r.location) : base.location,
    units: oneOf(r.units, ['C', 'F'] as const, base.units),
    coldThresholdC: clampInt(
      r.coldThresholdC,
      LIMITS.coldThresholdC.min,
      LIMITS.coldThresholdC.max,
      base.coldThresholdC,
    ),
    soundOn: bool(r.soundOn, base.soundOn),
    volume:
      typeof r.volume === 'number' && Number.isFinite(r.volume)
        ? Math.min(1, Math.max(0, r.volume))
        : base.volume,
    notifications: bool(r.notifications, base.notifications),
    compoundOverride: has('compoundOverride')
      ? r.compoundOverride === null
        ? null
        : oneOf(r.compoundOverride, ['soft', 'medium', 'hard', 'wet'] as const, 'medium')
      : base.compoundOverride,
    petSize: oneOf(r.petSize, ['S', 'M', 'L'] as const, base.petSize),
    autostart: bool(r.autostart, base.autostart),
    livery: oneOf(r.livery, ['lagoon', 'ultraviolet', 'sorbet', 'graphite'] as const, base.livery),
    carNumber: clampInt(r.carNumber, LIMITS.carNumber.min, LIMITS.carNumber.max, base.carNumber),
    hotkeyEnabled: bool(r.hotkeyEnabled, base.hotkeyEnabled),
    hotkey: typeof r.hotkey === 'string' && r.hotkey.trim() ? r.hotkey.trim().slice(0, 60) : base.hotkey,
    nightDim: bool(r.nightDim, base.nightDim),
    objective: typeof r.objective === 'string' ? r.objective.slice(0, 200) : base.objective,
    onboarded: bool(r.onboarded, base.onboarded),
  };
}

export function timerConfig(s: Settings): TimerConfig {
  return {
    stintMs: s.stintMin * 60_000,
    pitStopMs: s.pitStopMin * 60_000,
    redFlagMs: s.redFlagMin * 60_000,
    stintsPerGrandPrix: s.stintsPerGP,
    autoStartNext: s.autoStartNext,
  };
}
