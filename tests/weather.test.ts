import { describe, expect, it } from 'vitest';
import {
  buildForecastUrl,
  describeWeather,
  parseForecast,
  WeatherService,
  WEATHER_INTERVAL_MS,
  WEATHER_RETRY_MS,
  type FetchFn,
} from '../src/core/weather';
import { buildGeocodeUrl, detectByIp, parseGeocode, searchCity } from '../src/core/location';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const sample = {
  current: {
    temperature_2m: 18.4,
    apparent_temperature: 17.1,
    precipitation: 0,
    rain: 0,
    showers: 0,
    snowfall: 0,
    weather_code: 2,
    cloud_cover: 61,
    is_day: 1,
  },
};

function fakeFetch(responses: Array<unknown | Error>): { fetchFn: FetchFn; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fetchFn: FetchFn = async (url) => {
    urls.push(url);
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return { ok: true, status: 200, json: async () => next };
  };
  return { fetchFn, urls };
}

describe('Open-Meteo request and parsing', () => {
  it('asks for exactly the fields the tire rules need', () => {
    const url = buildForecastUrl(43.6532, -79.3832);
    expect(url).toContain('https://api.open-meteo.com/v1/forecast?latitude=43.6532&longitude=-79.3832');
    for (const field of ['temperature_2m', 'apparent_temperature', 'precipitation', 'rain', 'showers', 'snowfall', 'weather_code', 'cloud_cover', 'is_day']) {
      expect(url).toContain(field);
    }
    expect(url).toContain('timezone=auto');
  });

  it('parses a forecast response', () => {
    expect(parseForecast(sample, T0)).toEqual({
      temperatureC: 18.4,
      apparentC: 17.1,
      precipitationMm: 0,
      rainMm: 0,
      showersMm: 0,
      snowfallCm: 0,
      weatherCode: 2,
      cloudCover: 61,
      isDay: true,
      fetchedAt: T0,
    });
  });

  it('rejects a response without the essentials', () => {
    expect(() => parseForecast({}, T0)).toThrow();
    expect(() => parseForecast({ current: { temperature_2m: 3 } }, T0)).toThrow(/weather_code/);
    expect(() => parseForecast(null, T0)).toThrow();
  });

  it('describes weather codes in words', () => {
    expect(describeWeather(0)).toBe('Clear sky');
    expect(describeWeather(3)).toBe('Overcast');
    expect(describeWeather(45)).toBe('Fog');
    expect(describeWeather(63)).toBe('Rain');
    expect(describeWeather(73)).toBe('Snow');
    expect(describeWeather(96)).toBe('Thunderstorm');
  });
});

describe('WeatherService rate limiting and caching', () => {
  it('makes at most one request per 15 minutes however often it is asked', async () => {
    let now = T0;
    const { fetchFn, urls } = fakeFetch([sample]);
    const svc = new WeatherService({ fetchFn, now: () => now });
    // Simulate 2 hours of once-a-second ticks.
    for (let s = 0; s < 2 * 60 * 60; s += 1) {
      now = T0 + s * 1000;
      await svc.refresh(43.65, -79.38);
    }
    expect(urls).toHaveLength(8);
    for (let i = 1; i < svc.requestLog.length; i += 1) {
      expect(svc.requestLog[i] - svc.requestLog[i - 1]).toBeGreaterThanOrEqual(WEATHER_INTERVAL_MS);
    }
  });

  it('returns cached conditions between requests', async () => {
    let now = T0;
    const { fetchFn } = fakeFetch([sample]);
    const svc = new WeatherService({ fetchFn, now: () => now });
    const first = await svc.refresh(1, 2);
    expect(first.status).toBe('fresh');
    now += 5 * MIN;
    const second = await svc.refresh(1, 2);
    expect(second).toEqual({ status: 'cached', conditions: (first as { conditions: unknown }).conditions });
  });

  it('shares one request between simultaneous callers', async () => {
    const { fetchFn, urls } = fakeFetch([sample]);
    const svc = new WeatherService({ fetchFn, now: () => T0 });
    await Promise.all([svc.refresh(1, 2), svc.refresh(1, 2), svc.refresh(1, 2)]);
    expect(urls).toHaveLength(1);
  });

  it('fetches straight away when the location changes', async () => {
    let now = T0;
    const { fetchFn, urls } = fakeFetch([sample]);
    const svc = new WeatherService({ fetchFn, now: () => now });
    await svc.refresh(1, 2);
    now += MIN;
    await svc.refresh(50, 8);
    expect(urls).toHaveLength(2);
    expect(svc.cache.key).toBe('50.0000,8.0000');
  });

  it('keeps the last conditions on error and retries sooner', async () => {
    let now = T0;
    const { fetchFn, urls } = fakeFetch([sample, new Error('offline'), new Error('offline'), sample]);
    const svc = new WeatherService({ fetchFn, now: () => now });
    await svc.refresh(1, 2);
    now += WEATHER_INTERVAL_MS;
    const failed = await svc.refresh(1, 2);
    expect(failed).toEqual({ status: 'error', error: 'offline' });
    expect(svc.cache.conditions).not.toBeNull();
    expect(svc.cache.lastError).toBe('offline');
    now += WEATHER_RETRY_MS - 1;
    expect((await svc.refresh(1, 2)).status).toBe('cached');
    now += 1;
    expect((await svc.refresh(1, 2)).status).toBe('error');
    now += WEATHER_RETRY_MS;
    expect((await svc.refresh(1, 2)).status).toBe('fresh');
    expect(svc.cache.lastError).toBeNull();
    expect(urls).toHaveLength(4);
  });

  it('treats an HTTP error as a failure', async () => {
    const fetchFn: FetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const svc = new WeatherService({ fetchFn, now: () => T0 });
    expect(await svc.refresh(1, 2)).toEqual({ status: 'error', error: 'Weather service answered 503' });
  });

  it('starts from a saved cache without refetching inside the interval', async () => {
    const { fetchFn, urls } = fakeFetch([sample]);
    const conditions = parseForecast(sample, T0);
    const svc = new WeatherService({
      fetchFn,
      now: () => T0 + 5 * MIN,
      cache: { conditions, key: '1.0000,2.0000', lastAttemptAt: T0, lastSuccessAt: T0, lastError: null },
    });
    expect(await svc.refresh(1, 2)).toEqual({ status: 'cached', conditions });
    expect(urls).toHaveLength(0);
  });
});

describe('location', () => {
  it('builds and parses a city search', async () => {
    expect(buildGeocodeUrl(' São Paulo ')).toBe(
      'https://geocoding-api.open-meteo.com/v1/search?name=S%C3%A3o%20Paulo&count=6&language=en&format=json',
    );
    const json = {
      results: [
        { name: 'Toronto', admin1: 'Ontario', country: 'Canada', latitude: 43.70011, longitude: -79.4163 },
        { name: 'Singapore', admin1: 'Singapore', country: 'Singapore', latitude: 1.28967, longitude: 103.85007 },
        { name: 'Broken' },
      ],
    };
    expect(parseGeocode(json)).toEqual([
      { name: 'Toronto, Ontario, Canada', lat: 43.70011, lon: -79.4163, approximate: false },
      { name: 'Singapore', lat: 1.28967, lon: 103.85007, approximate: false },
    ]);
    expect(parseGeocode({})).toEqual([]);
    const { fetchFn, urls } = fakeFetch([json]);
    expect(await searchCity('toronto', fetchFn)).toHaveLength(2);
    expect(await searchCity('t', fetchFn)).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it('falls back to the second IP service and marks the place approximate', async () => {
    const { fetchFn, urls } = fakeFetch([
      new Error('blocked'),
      { city: 'Lyon', region: 'Auvergne-Rhone-Alpes', country_name: 'France', latitude: 45.75, longitude: 4.85 },
    ]);
    expect(await detectByIp(fetchFn)).toEqual({
      name: 'Lyon, Auvergne-Rhone-Alpes, France',
      lat: 45.75,
      lon: 4.85,
      approximate: true,
    });
    expect(urls).toHaveLength(2);
  });

  it('fails cleanly when no IP service answers', async () => {
    const { fetchFn } = fakeFetch([new Error('blocked')]);
    await expect(detectByIp(fetchFn)).rejects.toThrow('blocked');
  });
});
