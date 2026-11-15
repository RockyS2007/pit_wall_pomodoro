/**
 * Weather service: fetches current conditions from Open-Meteo (free, no key),
 * caches them and makes sure we never ask more than once per 15 minutes in
 * normal use.
 */
import type { Conditions } from './tires';

export const WEATHER_INTERVAL_MS = 15 * 60 * 1000;
/** After a failed request we may try again sooner than the normal interval. */
export const WEATHER_RETRY_MS = 2 * 60 * 1000;

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function buildForecastUrl(lat: number, lon: number): string {
  const current = [
    'temperature_2m',
    'apparent_temperature',
    'precipitation',
    'rain',
    'showers',
    'snowfall',
    'weather_code',
    'cloud_cover',
    'is_day',
  ].join(',');
  return (
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=${current}&timezone=auto`
  );
}

function num(v: unknown, name: string, fallback?: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Weather response is missing "${name}"`);
}

/** Turn an Open-Meteo forecast response into our Conditions shape. */
export function parseForecast(json: unknown, now: number): Conditions {
  const cur = (json as { current?: Record<string, unknown> } | null)?.current;
  if (!cur || typeof cur !== 'object') throw new Error('Weather response has no current conditions');
  return {
    temperatureC: num(cur.temperature_2m, 'temperature_2m'),
    apparentC: num(cur.apparent_temperature, 'apparent_temperature', num(cur.temperature_2m, 'temperature_2m')),
    precipitationMm: num(cur.precipitation, 'precipitation', 0),
    rainMm: num(cur.rain, 'rain', 0),
    showersMm: num(cur.showers, 'showers', 0),
    snowfallCm: num(cur.snowfall, 'snowfall', 0),
    weatherCode: num(cur.weather_code, 'weather_code'),
    cloudCover: num(cur.cloud_cover, 'cloud_cover', 0),
    isDay: num(cur.is_day, 'is_day', 1) === 1,
    fetchedAt: now,
  };
}

/** Short human description of a WMO weather code. */
export function describeWeather(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code >= 71 && code <= 75) return 'Snow';
  if (code === 77) return 'Snow grains';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Mixed conditions';
}

export interface WeatherCache {
  conditions: Conditions | null;
  /** Coordinates the cached conditions belong to, as "lat,lon". */
  key: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export function emptyWeatherCache(): WeatherCache {
  return { conditions: null, key: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null };
}

export type RefreshOutcome =
  | { status: 'fresh'; conditions: Conditions }
  | { status: 'cached'; conditions: Conditions | null }
  | { status: 'error'; error: string };

export interface WeatherServiceOptions {
  fetchFn: FetchFn;
  now: () => number;
  cache?: WeatherCache;
  /** Called for every real network request (used for the request log). */
  onRequest?: (url: string, at: number) => void;
}

export class WeatherService {
  cache: WeatherCache;
  /** Timestamps of every real request, newest last. */
  readonly requestLog: number[] = [];
  private inFlight: Promise<RefreshOutcome> | null = null;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly onRequest?: (url: string, at: number) => void;

  constructor(opts: WeatherServiceOptions) {
    this.fetchFn = opts.fetchFn;
    this.now = opts.now;
    this.cache = opts.cache ?? emptyWeatherCache();
    this.onRequest = opts.onRequest;
  }

  /** True when a call to refresh() would actually hit the network. */
  isDue(lat: number, lon: number): boolean {
    const key = locationKey(lat, lon);
    if (this.cache.key !== key || this.cache.lastAttemptAt === null) return true;
    const failedLast = this.cache.lastError !== null;
    const wait = failedLast ? WEATHER_RETRY_MS : WEATHER_INTERVAL_MS;
    return this.now() - this.cache.lastAttemptAt >= wait;
  }

  /**
   * Get current conditions. Uses the cache unless the 15 minute interval has
   * passed (or the location changed). Safe to call as often as you like.
   */
  async refresh(lat: number, lon: number): Promise<RefreshOutcome> {
    if (!this.isDue(lat, lon)) return { status: 'cached', conditions: this.cache.conditions };
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.request(lat, lon).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async request(lat: number, lon: number): Promise<RefreshOutcome> {
    const key = locationKey(lat, lon);
    const at = this.now();
    const url = buildForecastUrl(lat, lon);
    if (this.cache.key !== key) {
      // New place: old conditions no longer apply.
      this.cache = { ...emptyWeatherCache(), key };
    }
    this.cache = { ...this.cache, lastAttemptAt: at };
    this.requestLog.push(at);
    if (this.requestLog.length > 200) this.requestLog.shift();
    this.onRequest?.(url, at);
    try {
      const res = await this.fetchFn(url);
      if (!res.ok) throw new Error(`Weather service answered ${res.status}`);
      const conditions = parseForecast(await res.json(), this.now());
      this.cache = { ...this.cache, conditions, lastSuccessAt: conditions.fetchedAt, lastError: null };
      return { status: 'fresh', conditions };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.cache = { ...this.cache, lastError: error };
      return { status: 'error', error };
    }
  }
}

export function locationKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}
