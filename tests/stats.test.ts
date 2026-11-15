import { describe, expect, it } from 'vitest';
import {
  dayKey,
  emptyStats,
  prune,
  recordFocus,
  recordGrandPrix,
  recordStint,
  streak,
  today,
  totalFocusMs,
  weekly,
} from '../src/core/stats';

const MIN = 60_000;
/** Local time on a given day, so the tests do not depend on the machine's time zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('stats across days (mocked dates)', () => {
  it('uses the local calendar day', () => {
    expect(dayKey(at(2026, 3, 9, 0, 1))).toBe('2026-03-09');
    expect(dayKey(at(2026, 3, 9, 23, 59))).toBe('2026-03-09');
    expect(dayKey(at(2026, 12, 31, 23, 59))).toBe('2026-12-31');
  });

  it('counts stints and focus time on the day they finished', () => {
    let s = emptyStats();
    s = recordStint(recordFocus(s, 25 * MIN, at(2026, 3, 9, 10)), at(2026, 3, 9, 10));
    s = recordStint(recordFocus(s, 25 * MIN, at(2026, 3, 9, 11)), at(2026, 3, 9, 11));
    // A stint that runs past midnight lands on the new day.
    s = recordStint(recordFocus(s, 25 * MIN, at(2026, 3, 10, 0, 5)), at(2026, 3, 10, 0, 5));
    expect(today(s, at(2026, 3, 9, 20))).toEqual({ stints: 2, focusMs: 50 * MIN, grandPrix: 0 });
    expect(today(s, at(2026, 3, 10, 9))).toEqual({ stints: 1, focusMs: 25 * MIN, grandPrix: 0 });
    expect(today(s, at(2026, 3, 11, 9))).toEqual({ stints: 0, focusMs: 0, grandPrix: 0 });
    expect(totalFocusMs(s)).toBe(75 * MIN);
  });

  it('fastest lap is the longest unbroken focus stretch', () => {
    let s = emptyStats();
    s = recordFocus(s, 10 * MIN, at(2026, 3, 9));
    s = recordFocus(s, 25 * MIN, at(2026, 3, 9));
    s = recordFocus(s, 15 * MIN, at(2026, 3, 10));
    expect(s.fastestLapMs).toBe(25 * MIN);
    expect(recordFocus(s, 0, at(2026, 3, 10))).toBe(s);
  });

  it('streak counts consecutive days with at least one Grand Prix', () => {
    let s = emptyStats();
    expect(streak(s, at(2026, 3, 9))).toBe(0);
    s = recordGrandPrix(s, at(2026, 3, 7));
    s = recordGrandPrix(s, at(2026, 3, 8));
    s = recordGrandPrix(s, at(2026, 3, 8));
    // Nothing yet today: the streak up to yesterday is still alive.
    expect(streak(s, at(2026, 3, 9, 8))).toBe(2);
    s = recordGrandPrix(s, at(2026, 3, 9, 18));
    expect(streak(s, at(2026, 3, 9, 19))).toBe(3);
    // Miss a whole day and it is gone.
    expect(streak(s, at(2026, 3, 11))).toBe(0);
  });

  it('a day with stints but no full Grand Prix does not extend the streak', () => {
    let s = recordGrandPrix(emptyStats(), at(2026, 3, 7));
    s = recordStint(s, at(2026, 3, 8));
    expect(streak(s, at(2026, 3, 8, 22))).toBe(1);
    expect(streak(s, at(2026, 3, 9))).toBe(0);
  });

  it('streak crosses month, year and daylight-saving boundaries', () => {
    let s = emptyStats();
    for (const [y, m, d] of [[2025, 12, 30], [2025, 12, 31], [2026, 1, 1], [2026, 1, 2]] as const) {
      s = recordGrandPrix(s, at(y, m, d));
    }
    expect(streak(s, at(2026, 1, 2))).toBe(4);
    let dst = emptyStats();
    for (let d = 5; d <= 12; d += 1) dst = recordGrandPrix(dst, at(2026, 3, d, 23, 30));
    expect(streak(dst, at(2026, 3, 12, 23, 45))).toBe(8);
  });

  it('weekly chart covers the last 7 days ending today', () => {
    let s = emptyStats();
    s = recordFocus(s, 50 * MIN, at(2026, 3, 9));
    s = recordStint(s, at(2026, 3, 9));
    s = recordFocus(s, 25 * MIN, at(2026, 3, 4));
    s = recordFocus(s, 99 * MIN, at(2026, 3, 2)); // older than a week
    const bars = weekly(s, at(2026, 3, 10));
    expect(bars.map((b) => b.key)).toEqual([
      '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
    ]);
    expect(bars.map((b) => b.label)).toEqual(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
    expect(bars.map((b) => b.focusMs / MIN)).toEqual([25, 0, 0, 0, 0, 50, 0]);
    expect(bars[5].stints).toBe(1);
    expect(bars.filter((b) => b.isToday).map((b) => b.key)).toEqual(['2026-03-10']);
  });

  it('prunes very old days', () => {
    let s = recordFocus(emptyStats(), 25 * MIN, at(2024, 1, 1));
    s = recordFocus(s, 25 * MIN, at(2026, 3, 1));
    expect(Object.keys(prune(s, at(2026, 3, 10)).days)).toEqual(['2026-03-01']);
  });
});
