/**
 * The engine owns all live state: timer, weather, tires, settings and stats.
 * It runs in the pet window (which is always alive) and publishes snapshots
 * that the Pit Wall panel renders. Closing the panel never touches it.
 *
 * Everything outside this file that it needs (clock, network, disk, sounds,
 * notifications) comes in through the `Host` interface, so the engine can be
 * driven by tests with a fake clock.
 */
import {
  sanitizeSettings,
  defaultSettings,
  timerConfig,
  LIMITS,
  type Settings,
} from '../core/settings';
import * as timer from '../core/timer';
import type { TimerEvent, TimerState } from '../core/timer';
import {
  displayedTire,
  initialTireState,
  nextTireState,
  OFFLINE_FALLBACK_MS,
  type Compound,
  type Conditions,
  type DisplayedTire,
  type TireState,
} from '../core/tires';
import { WeatherService, emptyWeatherCache, type FetchFn, type WeatherCache } from '../core/weather';
import {
  emptyStats,
  prune,
  recordFocus,
  recordGrandPrix,
  recordStint,
  type StatsData,
} from '../core/stats';
import type { Place } from '../core/location';

export type SoundName = 'lightsOut' | 'pitRadio' | 'redFlag' | 'wheelGun' | 'click';

export type DebugWeather = 'rain' | 'snow' | 'cold' | 'cloudy' | 'clear' | 'fog' | 'offline';

export interface Host {
  now(): number;
  fetch: FetchFn;
  load(key: string): Promise<unknown>;
  save(key: string, value: unknown): Promise<void>;
  notify(title: string, body: string): void;
  playSound(name: SoundName, volume: number): void;
  setAutostart(on: boolean): Promise<void>;
  setHotkey(accelerator: string | null): Promise<void>;
  log(message: string): void;
}

export interface Snapshot {
  timer: TimerState;
  settings: Settings;
  tire: DisplayedTire;
  conditions: Conditions | null;
  weatherError: string | null;
  stats: StatsData;
  /** Goes up by one each time the fitted compound changes (drives the tire swap animation). */
  swapSeq: number;
  debugWeather: DebugWeather | null;
  /** Times of the most recent weather requests, for the debug menu. */
  requestLog: number[];
  ready: boolean;
}

/** The three settings that hold a phase length, in minutes. */
export type PhaseLengthKey = 'stintMin' | 'pitStopMin' | 'redFlagMin';

const PHASE_KEY: Record<Exclude<TimerState['phase'], 'idle'>, PhaseLengthKey> = {
  stint: 'stintMin',
  pitStop: 'pitStopMin',
  redFlag: 'redFlagMin',
};

export type Command =
  | { type: 'toggle' }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'skip' }
  | { type: 'boxBox' }
  | { type: 'reset' }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  /** Set a phase length from the timer face; also resizes that phase if it is the one running. */
  | { type: 'setPhaseMinutes'; key: PhaseLengthKey; minutes: number }
  | { type: 'refreshWeather' }
  | { type: 'debugWeather'; preset: DebugWeather | null }
  | { type: 'resetStats' }
  | { type: 'requestSnapshot' };

const KEYS = {
  settings: 'settings',
  timer: 'timer',
  tire: 'tire',
  weather: 'weather',
  stats: 'stats',
} as const;

/** A gap this long between ticks means the computer was asleep. */
const WAKE_GAP_MS = 60_000;

function debugConditions(preset: Exclude<DebugWeather, 'offline'>, now: number): Conditions {
  const base: Conditions = {
    temperatureC: 21,
    apparentC: 21,
    precipitationMm: 0,
    rainMm: 0,
    showersMm: 0,
    snowfallCm: 0,
    weatherCode: 0,
    cloudCover: 5,
    isDay: true,
    fetchedAt: now,
  };
  switch (preset) {
    case 'rain':
      return { ...base, temperatureC: 12, apparentC: 10, weatherCode: 63, rainMm: 1.4, precipitationMm: 1.4, cloudCover: 100 };
    case 'snow':
      return { ...base, temperatureC: -3, apparentC: -8, weatherCode: 73, snowfallCm: 0.6, cloudCover: 100 };
    case 'cold':
      return { ...base, temperatureC: 2, apparentC: -1 };
    case 'cloudy':
      return { ...base, temperatureC: 16, apparentC: 15, weatherCode: 3, cloudCover: 92 };
    case 'fog':
      return { ...base, temperatureC: 11, apparentC: 10, weatherCode: 45, cloudCover: 100 };
    case 'clear':
      return base;
  }
}

export class Engine {
  settings: Settings = defaultSettings();
  timer: TimerState = timer.createTimer(timerConfig(this.settings));
  tire: TireState = initialTireState();
  stats: StatsData = emptyStats();
  conditions: Conditions | null = null;
  weatherError: string | null = null;
  debugWeather: DebugWeather | null = null;
  swapSeq = 0;
  ready = false;

  private weather: WeatherService;
  private lastTickAt: number | null = null;
  private lastShownCompound: Compound | null = null;
  private listeners = new Set<(s: Snapshot) => void>();

  constructor(private host: Host) {
    this.weather = this.makeWeatherService(emptyWeatherCache());
  }

  private makeWeatherService(cache: WeatherCache): WeatherService {
    return new WeatherService({
      fetchFn: this.host.fetch,
      now: () => this.host.now(),
      cache,
      onRequest: (url, at) =>
        this.host.log(`[weather] request at ${new Date(at).toISOString()} ${url}`),
    });
  }

  /** Load everything saved on disk. Call once before the first tick. */
  async init(): Promise<void> {
    const [settings, savedTimer, tire, weather, stats] = await Promise.all([
      this.host.load(KEYS.settings),
      this.host.load(KEYS.timer),
      this.host.load(KEYS.tire),
      this.host.load(KEYS.weather),
      this.host.load(KEYS.stats),
    ]);
    this.settings = sanitizeSettings(settings);
    const config = timerConfig(this.settings);
    this.timer = isTimerState(savedTimer) ? savedTimer : timer.createTimer(config);
    this.timer = timer.applyConfig(this.timer, config);
    if (isTireState(tire)) this.tire = tire;
    if (isStats(stats)) this.stats = prune(stats, this.host.now());
    if (isWeatherCache(weather)) {
      this.weather = this.makeWeatherService(weather);
      this.conditions = weather.conditions;
    }
    if (!this.settings.location) this.tire = initialTireState();
    this.lastShownCompound = this.shownTire().compound;
    this.ready = true;
    await this.host.setHotkey(this.settings.hotkeyEnabled ? this.settings.hotkey : null).catch(() => {});
    this.publish();
    void this.refreshWeather();
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): Snapshot {
    return {
      timer: this.timer,
      settings: this.settings,
      tire: this.shownTire(),
      conditions: this.conditions,
      weatherError: this.weatherError,
      stats: this.stats,
      swapSeq: this.swapSeq,
      debugWeather: this.debugWeather,
      requestLog: this.weather.requestLog.slice(-8),
      ready: this.ready,
    };
  }

  private shownTire(): DisplayedTire {
    return displayedTire(this.tire, this.settings.compoundOverride);
  }

  private publish(): void {
    const shown = this.shownTire().compound;
    if (this.lastShownCompound !== null && shown !== this.lastShownCompound) {
      this.swapSeq += 1;
      if (this.settings.soundOn) this.host.playSound('wheelGun', this.settings.volume);
    }
    this.lastShownCompound = shown;
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  /** Drive the engine. Call about once a second; any cadence is safe. */
  tick(): void {
    if (!this.ready) return;
    const now = this.host.now();
    const woke = this.lastTickAt !== null && now - this.lastTickAt > WAKE_GAP_MS;
    this.lastTickAt = now;
    this.apply(timer.tick(this.timer, timerConfig(this.settings), now));
    const loc = this.settings.location;
    if (loc && !this.debugWeather && (woke || this.weather.isDue(loc.lat, loc.lon))) {
      void this.refreshWeather();
    }
  }

  dispatch(cmd: Command): void {
    if (!this.ready) return;
    const now = this.host.now();
    const config = timerConfig(this.settings);
    switch (cmd.type) {
      case 'toggle':
        this.apply(timer.toggle(this.timer, config, now));
        break;
      case 'start':
        this.apply(timer.start(this.timer, config, now));
        break;
      case 'pause':
        this.apply(timer.pause(this.timer, now));
        break;
      case 'skip':
        this.apply(timer.skip(this.timer, config, now));
        break;
      case 'boxBox':
        this.apply(timer.boxBox(this.timer, config, now));
        break;
      case 'reset':
        this.apply(timer.reset(this.timer, config, now));
        break;
      case 'updateSettings':
        this.updateSettings(cmd.patch);
        break;
      case 'setPhaseMinutes':
        this.setPhaseMinutes(cmd.key, cmd.minutes);
        break;
      case 'refreshWeather':
        void this.refreshWeather();
        break;
      case 'debugWeather':
        this.setDebugWeather(cmd.preset);
        break;
      case 'resetStats':
        this.stats = emptyStats();
        void this.host.save(KEYS.stats, this.stats);
        this.publish();
        break;
      case 'requestSnapshot':
        this.publish();
        break;
    }
  }

  private apply(result: timer.TimerResult): void {
    if (result.state === this.timer && result.events.length === 0) return;
    this.timer = result.state;
    let statsChanged = false;
    for (const event of result.events) {
      if (event.type === 'focus') {
        this.stats = recordFocus(this.stats, event.ms, event.endedAt);
        statsChanged = true;
      } else if (event.type === 'stintComplete') {
        this.stats = recordStint(this.stats, event.endedAt);
        statsChanged = true;
      } else if (event.type === 'grandPrixComplete') {
        this.stats = recordGrandPrix(this.stats, event.endedAt);
        statsChanged = true;
      } else {
        this.announce(event);
      }
    }
    void this.host.save(KEYS.timer, this.timer);
    if (statsChanged) void this.host.save(KEYS.stats, this.stats);
    this.publish();
  }

  /** Notification and sound for a phase change. */
  private announce(event: Extract<TimerEvent, { type: 'phaseChanged' }>): void {
    const s = this.settings;
    const waiting = !this.timer.running;
    let title = '';
    let body = '';
    let sound: SoundName | null = null;
    if (event.to === 'stint') {
      title = waiting ? `Stint ${event.lap} is ready` : `Lights out, stint ${event.lap} begins`;
      body = waiting
        ? 'Press start when you are back in the car.'
        : `Focus for ${s.stintMin} minutes.${s.objective ? ` Objective: ${s.objective}` : ''}`;
      sound = 'lightsOut';
    } else if (event.to === 'pitStop') {
      title = `Box box! Pit stop for ${s.pitStopMin} minutes`;
      body = 'Stretch, drink some water, fresh tires going on.';
      sound = 'pitRadio';
    } else if (event.to === 'redFlag') {
      title = 'Chequered flag! Grand Prix complete';
      body = `Podium time: take a ${s.redFlagMin} minute break away from the desk.`;
      sound = 'redFlag';
    } else {
      return;
    }
    if (s.notifications && event.cause !== 'start') this.host.notify(title, body);
    if (s.soundOn && sound) this.host.playSound(sound, s.volume);
  }

  private setPhaseMinutes(key: PhaseLengthKey, minutes: number): void {
    if (!(key in LIMITS) || !Number.isFinite(minutes)) return;
    const { min, max } = LIMITS[key];
    const value = Math.min(max, Math.max(min, Math.round(minutes)));
    const phase = this.timer.phase;
    // Resize the running (or paused) phase only if it is the kind being edited.
    if (phase !== 'idle' && PHASE_KEY[phase] === key) {
      this.timer = timer.resizePhase(this.timer, value * 60_000, this.host.now());
      void this.host.save(KEYS.timer, this.timer);
    }
    // updateSettings saves, re-fits an idle timer to the new length and publishes.
    this.updateSettings({ [key]: value });
  }

  private updateSettings(patch: Partial<Settings>): void {
    const before = this.settings;
    this.settings = sanitizeSettings({ ...before, ...patch }, before);
    void this.host.save(KEYS.settings, this.settings);
    this.timer = timer.applyConfig(this.timer, timerConfig(this.settings));

    if (before.autostart !== this.settings.autostart) {
      void this.host.setAutostart(this.settings.autostart).catch((err) => this.host.log(`[autostart] ${err}`));
    }
    if (before.hotkeyEnabled !== this.settings.hotkeyEnabled || before.hotkey !== this.settings.hotkey) {
      void this.host
        .setHotkey(this.settings.hotkeyEnabled ? this.settings.hotkey : null)
        .catch((err) => this.host.log(`[hotkey] ${err}`));
    }

    const moved = !samePlace(before.location, this.settings.location);
    if (moved) {
      // New place: forget the old weather and fit whatever the new place calls for.
      this.tire = initialTireState();
      this.conditions = null;
      this.weatherError = null;
      this.debugWeather = null;
      this.publish();
      void this.refreshWeather();
      return;
    }
    if (before.coldThresholdC !== this.settings.coldThresholdC && this.conditions && !this.debugWeather) {
      // Re-run the rules with the new cutoff straight away.
      this.tire = nextTireState(
        initialTireState(),
        { kind: 'conditions', conditions: this.conditions },
        this.tire.lastGoodAt ?? this.host.now(),
        { coldThresholdC: this.settings.coldThresholdC },
      );
      void this.host.save(KEYS.tire, this.tire);
    }
    this.publish();
  }

  /** Fetch weather if it is due and update the tires. */
  async refreshWeather(): Promise<void> {
    if (!this.ready || this.debugWeather) return;
    const loc = this.settings.location;
    const opts = { coldThresholdC: this.settings.coldThresholdC };
    if (!loc) {
      this.tire = initialTireState();
      this.conditions = null;
      this.publish();
      return;
    }
    const outcome = await this.weather.refresh(loc.lat, loc.lon);
    if (this.debugWeather || !samePlace(loc, this.settings.location)) return;
    const now = this.host.now();
    if (outcome.status === 'fresh') {
      this.conditions = outcome.conditions;
      this.weatherError = null;
      this.tire = nextTireState(this.tire, { kind: 'conditions', conditions: outcome.conditions }, now, opts);
    } else if (outcome.status === 'error') {
      this.weatherError = outcome.error;
      this.tire = nextTireState(this.tire, { kind: 'error' }, now, opts);
    } else {
      if (outcome.conditions && this.tire.basis === 'fallback' && !this.tire.stale) {
        // Cached conditions from a recent run are still fresh enough to use.
        this.conditions = outcome.conditions;
        this.tire = nextTireState(this.tire, { kind: 'conditions', conditions: outcome.conditions }, outcome.conditions.fetchedAt, opts);
      } else if (this.tire.stale && this.tire.lastGoodAt !== null && now - this.tire.lastGoodAt > OFFLINE_FALLBACK_MS) {
        this.tire = nextTireState(this.tire, { kind: 'error' }, now, opts);
      } else {
        return;
      }
    }
    void this.host.save(KEYS.weather, this.weather.cache);
    void this.host.save(KEYS.tire, this.tire);
    this.publish();
  }

  /** Debug menu: force a weather situation to check every compound by eye. */
  private setDebugWeather(preset: DebugWeather | null): void {
    const now = this.host.now();
    const opts = { coldThresholdC: this.settings.coldThresholdC };
    this.debugWeather = preset;
    if (preset === null) {
      this.tire = initialTireState();
      this.conditions = this.weather.cache.conditions;
      this.weatherError = this.weather.cache.lastError;
      if (this.conditions && this.settings.location) {
        this.tire = nextTireState(this.tire, { kind: 'conditions', conditions: this.conditions }, this.conditions.fetchedAt, opts);
      }
      this.publish();
      void this.refreshWeather();
      return;
    }
    if (preset === 'offline') {
      // As if the last good data arrived more than 3 hours ago.
      this.tire = nextTireState(
        { ...this.tire, basis: 'weather', lastGoodAt: now - OFFLINE_FALLBACK_MS - 1 },
        { kind: 'error' },
        now,
        opts,
      );
      this.weatherError = 'Debug: offline';
    } else {
      this.conditions = debugConditions(preset, now);
      this.weatherError = null;
      this.tire = nextTireState(initialTireState(), { kind: 'conditions', conditions: this.conditions }, now, opts);
    }
    this.publish();
  }
}

function samePlace(a: Place | null, b: Place | null): boolean {
  if (a === null || b === null) return a === b;
  return a.lat === b.lat && a.lon === b.lon;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isTimerState(v: unknown): v is TimerState {
  return (
    isObject(v) &&
    typeof v.phase === 'string' &&
    ['idle', 'stint', 'pitStop', 'redFlag'].includes(v.phase) &&
    typeof v.running === 'boolean' &&
    typeof v.remainingMs === 'number' &&
    typeof v.durationMs === 'number' &&
    typeof v.lap === 'number' &&
    typeof v.creditedInSet === 'number' &&
    (!v.running || typeof v.endsAt === 'number')
  );
}

function isTireState(v: unknown): v is TireState {
  return (
    isObject(v) &&
    typeof v.compound === 'string' &&
    ['soft', 'medium', 'hard', 'wet'].includes(v.compound) &&
    typeof v.reason === 'string' &&
    (v.basis === 'weather' || v.basis === 'fallback') &&
    typeof v.stale === 'boolean'
  );
}

function isStats(v: unknown): v is StatsData {
  return isObject(v) && isObject(v.days) && typeof v.fastestLapMs === 'number';
}

function isWeatherCache(v: unknown): v is WeatherCache {
  return isObject(v) && 'conditions' in v && 'lastAttemptAt' in v && 'key' in v;
}
