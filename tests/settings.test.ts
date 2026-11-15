import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultUnits, sanitizeSettings, timerConfig } from '../src/core/settings';
import { formatClock, formatDuration, formatTemp, fromDisplayTemp, toDisplayTemp } from '../src/core/format';

describe('settings', () => {
  it('has the classic defaults', () => {
    const s = defaultSettings('en-CA');
    expect(s).toMatchObject({ stintMin: 25, pitStopMin: 5, redFlagMin: 20, stintsPerGP: 4, coldThresholdC: 7, units: 'C', location: null });
    expect(timerConfig(s)).toEqual({
      stintMs: 1_500_000,
      pitStopMs: 300_000,
      redFlagMs: 1_200_000,
      stintsPerGrandPrix: 4,
      autoStartNext: true,
    });
  });

  it('picks Fahrenheit only for US-style locales', () => {
    expect(defaultUnits('en-US')).toBe('F');
    expect(defaultUnits('en-GB')).toBe('C');
    expect(defaultUnits('fr')).toBe('C');
  });

  it('clamps durations to the allowed ranges', () => {
    const s = sanitizeSettings({ stintMin: 500, pitStopMin: 0, redFlagMin: 46, carNumber: 123, volume: 7 });
    expect(s).toMatchObject({ stintMin: 90, pitStopMin: 2, redFlagMin: 45, carNumber: 99, volume: 1 });
    expect(sanitizeSettings({ stintMin: 50, pitStopMin: 10 })).toMatchObject({ stintMin: 50, pitStopMin: 10 });
  });

  it('keeps stints per Grand Prix between 1 and 8 and feeds it to the timer', () => {
    expect(sanitizeSettings({ stintsPerGP: 0 }).stintsPerGP).toBe(1);
    expect(sanitizeSettings({ stintsPerGP: 20 }).stintsPerGP).toBe(8);
    expect(sanitizeSettings({ stintsPerGP: 2.6 }).stintsPerGP).toBe(3);
    expect(sanitizeSettings({ stintsPerGP: 'six' }).stintsPerGP).toBe(4);
    expect(timerConfig(sanitizeSettings({ stintsPerGP: 6 })).stintsPerGrandPrix).toBe(6);
  });

  it('ignores rubbish and falls back to what was there', () => {
    const base = { ...defaultSettings('en-GB'), stintMin: 40, livery: 'sorbet' as const };
    const s = sanitizeSettings({ stintMin: 'abc', units: 'K', livery: 'real-team', petSize: 'XXL', compoundOverride: 'slick' }, base);
    expect(s.stintMin).toBe(40);
    expect(s.units).toBe('C');
    expect(s.livery).toBe('sorbet');
    expect(s.petSize).toBe('M');
    expect(s.compoundOverride).toBe('medium');
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
  });

  it('keeps a valid location and drops a broken one', () => {
    const loc = { name: 'Toronto, Ontario, Canada', lat: 43.7, lon: -79.4, approximate: false };
    expect(sanitizeSettings({ location: loc }).location).toEqual(loc);
    expect(sanitizeSettings({ location: { name: 'x', lat: 999, lon: 0 } }).location).toBeNull();
    expect(sanitizeSettings({ location: null }, { ...defaultSettings(), location: loc }).location).toBeNull();
    expect(sanitizeSettings({}, { ...defaultSettings(), location: loc }).location).toEqual(loc);
  });

  it('round-trips through JSON (survives a restart)', () => {
    const s = sanitizeSettings({
      stintMin: 50, pitStopMin: 10, redFlagMin: 30, stintsPerGP: 3, units: 'F', coldThresholdC: 4, soundOn: false, volume: 0.25,
      notifications: false, compoundOverride: 'wet', petSize: 'L', autostart: true, livery: 'graphite', carNumber: 44,
      hotkeyEnabled: true, hotkey: 'Alt+Shift+S', nightDim: false, objective: 'Linear algebra ch. 4', onboarded: true,
      autoStartNext: false, location: { name: 'Lyon', lat: 45.75, lon: 4.85, approximate: true },
    });
    expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('formatting', () => {
  it('formats the countdown, rounding up', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(999)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(90 * 60_000)).toBe('90:00');
  });

  it('formats durations', () => {
    expect(formatDuration(30_000)).toBe('30s');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(60 * 60_000)).toBe('1h');
    expect(formatDuration(80 * 60_000)).toBe('1h 20m');
  });

  it('converts temperatures both ways', () => {
    expect(formatTemp(21.4, 'C')).toBe('21 °C');
    expect(formatTemp(7, 'F')).toBe('45 °F');
    expect(toDisplayTemp(0, 'F')).toBe(32);
    expect(fromDisplayTemp(45, 'F')).toBeCloseTo(7.2, 1);
    expect(fromDisplayTemp(7, 'C')).toBe(7);
  });
});
