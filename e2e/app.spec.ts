import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const weather = (over: Record<string, number> = {}) => ({
  current: {
    temperature_2m: 21, apparent_temperature: 20, precipitation: 0, rain: 0, showers: 0,
    snowfall: 0, weather_code: 0, cloud_cover: 5, is_day: 1, ...over,
  },
});

async function open(context: BrowserContext, opts: { onboarded?: boolean; current?: Record<string, number> } = {}) {
  let online = true;
  let requests = 0;
  await context.route('**/api.open-meteo.com/**', (route) => {
    requests += 1;
    return online ? route.fulfill({ json: weather(opts.current) }) : route.abort();
  });
  await context.route('**/geocoding-api.open-meteo.com/**', (route) =>
    route.fulfill({
      json: { results: [{ name: 'Toronto', admin1: 'Ontario', country: 'Canada', latitude: 43.7, longitude: -79.4 }] },
    }),
  );
  if (opts.onboarded !== false) {
    await context.addInitScript(() => {
      if (!localStorage.getItem('pit-wall:settings')) {
        localStorage.setItem('pit-wall:settings', JSON.stringify({ onboarded: true }));
      }
    });
  }
  const pet = await context.newPage();
  await pet.goto('/index.html');
  await pet.waitForFunction(() => (window as any).__pitwall?.engine.ready);
  const panel = await context.newPage();
  await panel.goto('/panel.html');
  await panel.getByRole('tab', { name: 'Timer' }).waitFor();
  return { pet, panel, setOnline: (v: boolean) => (online = v), requests: () => requests };
}

const car = (pet: Page) => pet.locator('.pet');
const engineEval = <T>(pet: Page, fn: (e: any) => T) =>
  pet.evaluate((src) => new Function('e', `return (${src})(e)`)((window as any).__pitwall.engine), fn.toString()) as Promise<T>;

test('onboarding: choose a city and durations in a few clicks, then live weather shows', async ({ context }) => {
  const { pet, panel } = await open(context, { onboarded: false, current: { temperature_2m: 3, apparent_temperature: -1 } });
  await expect(panel.getByTestId('onboarding')).toBeVisible();
  await panel.getByLabel('City').fill('Toronto');
  await panel.getByRole('button', { name: 'Search' }).click();
  await panel.getByRole('button', { name: 'Toronto, Ontario, Canada' }).click();
  await panel.getByTestId('onboarding-next').click();
  await panel.getByRole('button', { name: /Long run/ }).click();
  await panel.getByTestId('onboarding-done').click();
  await expect(panel.getByTestId('onboarding')).toBeHidden();
  await expect(panel.getByTestId('clock')).toHaveText('50:00');
  await expect(panel.getByTestId('temperature')).toHaveText('3 °C');
  await expect(panel.getByTestId('compound')).toContainText('Hard');
  await expect(panel.getByTestId('reason')).toHaveText('Cold track temps');
  await expect(car(pet)).toHaveAttribute('data-compound', 'hard');
});

test('timer controls work and closing the panel does not stop the timer', async ({ context }) => {
  const { pet, panel } = await open(context);
  await expect(panel.getByTestId('clock')).toHaveText('25:00');
  await panel.getByTestId('primary').click();
  await expect(panel.getByTestId('phase')).toHaveText('Stint');
  await expect(car(pet)).toHaveAttribute('data-phase', 'stint');
  await expect(panel.getByTestId('clock')).toHaveText(/24:5\d/);

  await panel.close();
  await pet.waitForTimeout(2200);
  const state = await engineEval(pet, (e) => ({ running: e.timer.running, left: e.timer.endsAt - Date.now() }));
  expect(state.running).toBe(true);
  expect(state.left).toBeLessThan(25 * 60_000 - 2000);

  const again = await context.newPage();
  await again.goto('/panel.html');
  await expect(again.getByTestId('phase')).toHaveText('Stint');
  await again.getByTestId('primary').click();
  await expect(again.getByTestId('phase')).toHaveText('Stint (paused)');
  await expect(car(pet)).toHaveAttribute('data-paused', 'true');
  await expect(pet.locator('[data-flag="yellow"]')).toBeVisible();
  await again.getByRole('button', { name: 'Box box' }).click();
  await expect(again.getByTestId('phase')).toHaveText('Pit stop');
  await expect(again.getByTestId('clock')).toHaveText(/0(5:00|4:5\d)/);
  await again.getByRole('button', { name: 'Skip' }).click();
  await expect(again.getByTestId('lap')).toContainText('Stint 2/4');
  await again.getByRole('button', { name: 'Reset' }).click();
  await expect(again.getByTestId('phase')).toHaveText('On the grid');
  await again.getByRole('tab', { name: 'Stats' }).click();
  await expect(again.getByTestId('stints-today')).toHaveText('1');
});

test('each phase looks different on the pet', async ({ context }) => {
  const { pet } = await open(context);
  await engineEval(pet, (e) => e.dispatch({ type: 'start' }));
  await expect(pet.locator('.speed')).toBeVisible();
  await expect(pet.locator('.spin.rolling').first()).toBeAttached();
  await engineEval(pet, (e) => e.dispatch({ type: 'boxBox' }));
  await expect(pet.locator('.crew')).toBeVisible();
  await expect(pet.locator('.speed')).toHaveCount(0);
  await engineEval(pet, (e) => { for (let i = 0; i < 6; i += 1) e.dispatch({ type: 'skip' }); });
  await expect(pet.locator('.trophy')).toBeVisible();
  await expect(pet.locator('[data-flag="chequered"]')).toBeVisible();
});

test('hidden debug menu forces every compound and the tires recolour', async ({ context }) => {
  const { pet, panel } = await open(context);
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await expect(panel.getByTestId('debug-menu')).toHaveCount(0);
  for (let i = 0; i < 5; i += 1) await panel.getByTestId('version').click();
  const expected = { rain: ['wet', 'rgb(47, 128, 255)'], snow: ['hard', 'rgb(245, 245, 247)'], cloudy: ['medium', 'rgb(255, 214, 10)'], clear: ['soft', 'rgb(255, 59, 48)'] };
  for (const [preset, [compound, colour]] of Object.entries(expected)) {
    await panel.getByTestId(`debug-${preset}`).click();
    await expect(car(pet)).toHaveAttribute('data-compound', compound, { timeout: 4000 });
    await expect(pet.locator('.stripe').first()).toHaveCSS('stroke', colour);
  }
  await panel.getByTestId('debug-offline').click();
  await expect(pet.locator('[data-badge="no-telemetry"]')).toBeVisible();
});

test('manual override shows the lock; going offline shows "No telemetry" and keeps the data', async ({ context }) => {
  const { pet, panel, setOnline } = await open(context);
  await engineEval(pet, (e) => e.dispatch({ type: 'updateSettings', patch: { location: { name: 'Toronto', lat: 43.7, lon: -79.4, approximate: false } } }));
  await expect(panel.getByTestId('temperature')).toHaveText('21 °C');
  await expect(panel.getByTestId('compound')).toContainText('Soft');

  setOnline(false);
  // Pretend 16 minutes pass so the next check is due.
  await engineEval(pet, (e) => { e.weather.cache.lastAttemptAt -= 16 * 60_000; e.tick(); });
  await expect(panel.getByTestId('no-telemetry')).toBeVisible();
  await expect(panel.getByTestId('temperature')).toHaveText('21 °C');
  await expect(panel.getByTestId('compound')).toContainText('Soft');

  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.getByTestId('override-wet').click();
  await expect(pet.locator('[data-badge="lock"]')).toBeVisible();
  await expect(car(pet)).toHaveAttribute('data-compound', 'wet', { timeout: 4000 });
});

test('weather is requested once, not on every tick', async ({ context }) => {
  const { pet, requests } = await open(context);
  await engineEval(pet, (e) => e.dispatch({ type: 'updateSettings', patch: { location: { name: 'Toronto', lat: 43.7, lon: -79.4, approximate: false } } }));
  await pet.waitForTimeout(3000);
  expect(requests()).toBe(1);
});

test('settings survive a restart', async ({ context }) => {
  const { pet, panel } = await open(context);
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.getByTestId('stint-min').fill('40');
  await panel.getByTestId('stint-min').blur();
  await panel.getByRole('button', { name: '°F' }).click();
  await panel.getByRole('button', { name: 'Ultraviolet' }).click();
  await panel.getByTestId('sound-on').uncheck();
  await panel.getByRole('button', { name: 'L', exact: true }).click();
  await expect.poll(() => engineEval(pet, (e) => e.settings.petSize)).toBe('L');

  await pet.reload();
  await pet.waitForFunction(() => (window as any).__pitwall?.engine.ready);
  await panel.reload();
  await expect(panel.getByTestId('clock')).toHaveText('40:00');
  const s = await engineEval(pet, (e) => e.settings);
  expect(s).toMatchObject({ stintMin: 40, units: 'F', livery: 'ultraviolet', soundOn: false, petSize: 'L', onboarded: true });
});

test('stints per Grand Prix changes the lap count on the panel and the car', async ({ context }) => {
  const { pet, panel } = await open(context);
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.getByTestId('stints-per-gp').fill('2');
  await panel.getByTestId('stints-per-gp').blur();
  await expect(panel.getByTestId('gp-total')).toContainText('2 stints of 25 min');
  await panel.getByRole('button', { name: 'Long 50 / 10' }).click();
  await expect(panel.getByTestId('gp-total')).toContainText('About 2h 20m');
  await panel.getByRole('tab', { name: 'Timer' }).click();
  await panel.getByTestId('primary').click();
  await expect(panel.getByTestId('lap')).toContainText('Stint 1/2');
  await expect(pet.locator('.lap')).toHaveText('1/2');
  await engineEval(pet, (e) => e.dispatch({ type: 'skip' }));
  await engineEval(pet, (e) => e.dispatch({ type: 'skip' }));
  await expect(panel.getByTestId('lap')).toContainText('Stint 2/2');
  await engineEval(pet, (e) => e.dispatch({ type: 'boxBox' }));
  await expect(panel.getByTestId('phase')).toHaveText('Podium');
});

test('panel is usable at its minimum size', async ({ context }) => {
  const { panel } = await open(context);
  await panel.setViewportSize({ width: 320, height: 440 });
  for (const tab of ['Timer', 'Stats', 'Settings']) {
    await panel.getByRole('tab', { name: tab }).click();
    const overflow = await panel.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${tab} tab scrolls sideways`).toBeLessThanOrEqual(0);
  }
  await panel.getByRole('tab', { name: 'Timer' }).click();
  await expect(panel.getByTestId('primary')).toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Reset' })).toBeInViewport();
});

test('reduced motion turns off speed lines, wheel spin and the swap animation', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', baseURL: 'http://localhost:1420' });
  const { pet } = await open(context);
  await engineEval(pet, (e) => e.dispatch({ type: 'start' }));
  await expect(car(pet)).toHaveAttribute('data-phase', 'stint');
  await expect(pet.locator('.speed')).toBeHidden();
  await expect(pet.locator('.spin.rolling').first()).toHaveCSS('animation-name', 'none');
  await engineEval(pet, (e) => e.dispatch({ type: 'updateSettings', patch: { compoundOverride: 'wet' } }));
  await expect(car(pet)).toHaveAttribute('data-compound', 'wet', { timeout: 500 });
  await context.close();
});
