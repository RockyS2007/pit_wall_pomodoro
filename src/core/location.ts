/**
 * Location lookup. In priority order the app uses:
 *   1. a city the user picked (Open-Meteo geocoding, free, no key)
 *   2. the system's own location service, if the user allows it
 *   3. an approximate location from the IP address
 * Only latitude, longitude and a display name are kept, and only on this computer.
 */
import type { FetchFn } from './weather';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** True when the place came from the IP address rather than a chosen city or GPS. */
  approximate: boolean;
}

interface GeocodeResult {
  name?: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
}

export function buildGeocodeUrl(query: string): string {
  return (
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(query.trim())}&count=6&language=en&format=json`
  );
}

export function parseGeocode(json: unknown): Place[] {
  const results = (json as { results?: GeocodeResult[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const places: Place[] = [];
  for (const r of results) {
    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number' || !r.name) continue;
    const parts = [r.name, r.admin1, r.country ?? r.country_code].filter(
      (p, i, all): p is string => !!p && all.indexOf(p) === i,
    );
    places.push({ name: parts.join(', '), lat: r.latitude, lon: r.longitude, approximate: false });
  }
  return places;
}

export async function searchCity(query: string, fetchFn: FetchFn): Promise<Place[]> {
  if (query.trim().length < 2) return [];
  const res = await fetchFn(buildGeocodeUrl(query));
  if (!res.ok) throw new Error(`City search answered ${res.status}`);
  return parseGeocode(await res.json());
}

/** Approximate location from the IP address. Tries two key-less services. */
export async function detectByIp(fetchFn: FetchFn): Promise<Place> {
  const sources: Array<{ url: string; read: (j: Record<string, unknown>) => Place | null }> = [
    {
      url: 'https://ipwho.is/',
      read: (j) =>
        typeof j.latitude === 'number' && typeof j.longitude === 'number'
          ? place([j.city, j.region, j.country], j.latitude, j.longitude)
          : null,
    },
    {
      url: 'https://ipapi.co/json/',
      read: (j) =>
        typeof j.latitude === 'number' && typeof j.longitude === 'number'
          ? place([j.city, j.region, j.country_name], j.latitude, j.longitude)
          : null,
    },
  ];
  let lastError = 'No location service answered';
  for (const source of sources) {
    try {
      const res = await fetchFn(source.url);
      if (!res.ok) throw new Error(`Location service answered ${res.status}`);
      const found = source.read((await res.json()) as Record<string, unknown>);
      if (found) return found;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

function place(parts: unknown[], lat: number, lon: number): Place {
  const name = parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(', ');
  return { name: name || 'Approximate location', lat, lon, approximate: true };
}

/** Ask the system location service. Rejects if unavailable, denied or slow. */
export function detectByDevice(timeoutMs = 8000): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location service is not available'));
      return;
    }
    const timer = setTimeout(() => reject(new Error('Location service timed out')), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          name: 'My location',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          approximate: false,
        });
      },
      (err) => {
        clearTimeout(timer);
        reject(new Error(err.message || 'Location permission was denied'));
      },
      { timeout: timeoutMs, maximumAge: 60 * 60 * 1000 },
    );
  });
}
