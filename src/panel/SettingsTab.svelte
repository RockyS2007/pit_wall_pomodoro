<script lang="ts">
  import { formatDuration, fromDisplayTemp, toDisplayTemp } from '../core/format';
  import { LIMITS, LIVERIES, type PetSize, type Settings } from '../core/settings';
  import { COMPOUND_INFO, type Compound } from '../core/tires';
  import type { DebugWeather } from '../engine/engine';
  import { inTauri, setPetVisible } from '../lib/platform';
  import { playSound, unlockAudio } from '../lib/sound';
  import LocationPicker from './LocationPicker.svelte';
  import { app, dispatch, update } from './state.svelte';

  const s = $derived(app.snap!.settings);
  /** Wall time for one Grand Prix, including the pit stops between stints. */
  const gpLength = $derived(
    formatDuration((s.stintsPerGP * s.stintMin + (s.stintsPerGP - 1) * s.pitStopMin + s.redFlagMin) * 60_000),
  );
  const compounds: Compound[] = ['soft', 'medium', 'hard', 'wet'];
  const sizes: PetSize[] = ['S', 'M', 'L'];
  const presets: DebugWeather[] = ['clear', 'cloudy', 'fog', 'cold', 'snow', 'rain', 'offline'];

  // Hidden debug menu: click the version line five times.
  let versionClicks = $state(0);
  const debugOpen = $derived(versionClicks >= 5 || app.snap!.debugWeather !== null);

  function num(key: keyof Settings, event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) update({ [key]: value } as Partial<Settings>);
  }

  function setCold(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) update({ coldThresholdC: Math.round(fromDisplayTemp(value, s.units)) });
  }

  function testSound() {
    unlockAudio();
    // Give the audio system a moment to wake up on the first click.
    setTimeout(() => playSound('lightsOut', s.volume), 60);
  }
</script>

<section class="card">
  <h2>Timing</h2>
  <div class="grid">
    <label>
      Stint (focus)
      <span class="field"><input type="number" min={LIMITS.stintMin.min} max={LIMITS.stintMin.max} value={s.stintMin} onchange={(e) => num('stintMin', e)} data-testid="stint-min" /> min</span>
    </label>
    <label>
      Pit stop (short break)
      <span class="field"><input type="number" min={LIMITS.pitStopMin.min} max={LIMITS.pitStopMin.max} value={s.pitStopMin} onchange={(e) => num('pitStopMin', e)} data-testid="pit-min" /> min</span>
    </label>
    <label>
      Podium (long break)
      <span class="field"><input type="number" min={LIMITS.redFlagMin.min} max={LIMITS.redFlagMin.max} value={s.redFlagMin} onchange={(e) => num('redFlagMin', e)} data-testid="red-min" /> min</span>
    </label>
    <label>
      Stints per Grand Prix
      <span class="field"><input type="number" min={LIMITS.stintsPerGP.min} max={LIMITS.stintsPerGP.max} value={s.stintsPerGP} onchange={(e) => num('stintsPerGP', e)} data-testid="stints-per-gp" /> stints</span>
    </label>
  </div>
  <div class="presets">
    <button onclick={() => update({ stintMin: 25, pitStopMin: 5, redFlagMin: 20 })}>Classic 25 / 5</button>
    <button onclick={() => update({ stintMin: 50, pitStopMin: 10, redFlagMin: 30 })}>Long 50 / 10</button>
  </div>
  <label class="check">
    <input type="checkbox" checked={s.autoStartNext} onchange={(e) => update({ autoStartNext: e.currentTarget.checked })} />
    Start the next stint or break automatically
  </label>
  <div class="gp-total muted" data-testid="gp-total">
    One Grand Prix: {s.stintsPerGP} {s.stintsPerGP === 1 ? 'stint' : 'stints'} of {s.stintMin} min, then a {s.redFlagMin} min podium break. About {gpLength} in total.
  </div>
  <p class="muted hint">New lengths apply from the next stint or break. Lowering the stint count during a race ends it after the current stint.</p>
</section>

<section class="card" id="location">
  <h2>Location and weather</h2>
  <LocationPicker />
  <div class="grid two">
    <label>
      Temperature
      <span class="seg" role="group" aria-label="Temperature units">
        <button class:on={s.units === 'C'} onclick={() => update({ units: 'C' })}>°C</button>
        <button class:on={s.units === 'F'} onclick={() => update({ units: 'F' })}>°F</button>
      </span>
    </label>
    <label>
      Hard tires when it feels at or below
      <span class="field">
        <input type="number" value={Math.round(toDisplayTemp(s.coldThresholdC, s.units))} onchange={setCold} data-testid="cold-threshold" />
        °{s.units}
      </span>
    </label>
  </div>
  <button class="ghost" onclick={() => dispatch({ type: 'refreshWeather' })}>Check weather now</button>
  <p class="muted hint">Weather comes from Open-Meteo and is checked every 15 minutes. Your location never leaves this computer except for that lookup.</p>
</section>

<section class="card">
  <h2>Tires</h2>
  <div class="seg wide" role="group" aria-label="Tire compound">
    <button class:on={s.compoundOverride === null} onclick={() => update({ compoundOverride: null })}>Auto (weather)</button>
    {#each compounds as c (c)}
      <button class:on={s.compoundOverride === c} onclick={() => update({ compoundOverride: c })} data-testid="override-{c}">
        <i style="background: {COMPOUND_INFO[c].color}"></i>{COMPOUND_INFO[c].label}
      </button>
    {/each}
  </div>
  <p class="muted hint">Rain fits wets, cold or snow fits hards, cloud fits mediums, sunshine fits softs. Pick one to pin it ("Driver's choice").</p>
</section>

<section class="card">
  <h2>Car</h2>
  <div class="liveries" role="group" aria-label="Livery">
    {#each LIVERIES as l (l.id)}
      <button class="livery" class:on={s.livery === l.id} onclick={() => update({ livery: l.id })} title={l.name}>
        <span class="swatch" style="background: linear-gradient(135deg, {l.body} 0 55%, {l.accent} 55% 72%, {l.bodyDark} 72%)"></span>
        {l.name}
      </button>
    {/each}
  </div>
  <div class="grid two">
    <label>
      Car number
      <span class="field"><input type="number" min="0" max="99" value={s.carNumber} onchange={(e) => num('carNumber', e)} /></span>
    </label>
    <label>
      Size
      <span class="seg" role="group" aria-label="Car size">
        {#each sizes as size (size)}
          <button class:on={s.petSize === size} onclick={() => update({ petSize: size })}>{size}</button>
        {/each}
      </span>
    </label>
  </div>
  <label class="check">
    <input type="checkbox" checked={s.nightDim} onchange={(e) => update({ nightDim: e.currentTarget.checked })} />
    Dim the car a little at night
  </label>
  <div class="presets">
    <button onclick={() => setPetVisible(true)} disabled={!inTauri}>Show car</button>
    <button onclick={() => setPetVisible(false)} disabled={!inTauri}>Hide car</button>
  </div>
</section>

<section class="card">
  <h2>Sound and alerts</h2>
  <label class="check">
    <input type="checkbox" checked={s.soundOn} onchange={(e) => update({ soundOn: e.currentTarget.checked })} data-testid="sound-on" />
    Sounds
  </label>
  <label class="volume">
    Volume
    <input type="range" min="0" max="1" step="0.05" value={s.volume} disabled={!s.soundOn} onchange={(e) => num('volume', e)} />
    <button onclick={testSound} disabled={!s.soundOn}>Test</button>
  </label>
  <label class="check">
    <input type="checkbox" checked={s.notifications} onchange={(e) => update({ notifications: e.currentTarget.checked })} />
    Notification at each stint and break
  </label>
</section>

<section class="card">
  <h2>App</h2>
  <label class="check">
    <input type="checkbox" checked={s.autostart} onchange={(e) => update({ autostart: e.currentTarget.checked })} />
    Open when I log in
  </label>
  <label class="check">
    <input type="checkbox" checked={s.hotkeyEnabled} onchange={(e) => update({ hotkeyEnabled: e.currentTarget.checked })} />
    Start / pause shortcut from anywhere
  </label>
  <label>
    Shortcut
    <input type="text" value={s.hotkey} disabled={!s.hotkeyEnabled} onchange={(e) => update({ hotkey: e.currentTarget.value })} />
  </label>
  <button class="version" onclick={() => (versionClicks += 1)} data-testid="version">Pit Wall Pomodoro 0.1.1</button>
</section>

{#if debugOpen}
  <section class="card debug" data-testid="debug-menu">
    <h2>Debug: force weather</h2>
    <div class="presets">
      {#each presets as preset (preset)}
        <button class:on={app.snap!.debugWeather === preset} onclick={() => dispatch({ type: 'debugWeather', preset })} data-testid="debug-{preset}">{preset}</button>
      {/each}
      <button onclick={() => dispatch({ type: 'debugWeather', preset: null })} data-testid="debug-off">real weather</button>
    </div>
    <p class="muted hint">
      Weather requests this session:
      {#if app.snap!.requestLog.length === 0}none{:else}{app.snap!.requestLog.map((t) => new Date(t).toLocaleTimeString()).join(', ')}{/if}
    </p>
  </section>
{/if}

<style>
  section {
    display: grid;
    gap: 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .grid.two {
    grid-template-columns: 1fr 1fr;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 13px;
    align-content: start;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .field input {
    width: 64px;
  }
  label.check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .volume {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .volume input {
    flex: 1;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .gp-total {
    font-size: 13px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 9px;
    overflow: hidden;
    width: fit-content;
  }
  .seg.wide {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
  }
  .seg button {
    border: 0;
    border-radius: 0;
    background: transparent;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 1;
    justify-content: center;
    white-space: nowrap;
  }
  .seg button.on,
  button.on {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
  }
  .seg i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1px solid #0006;
  }
  .liveries {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 6px;
  }
  .livery {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
  }
  .livery.on {
    background: var(--card-2);
    color: var(--text);
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    flex: none;
  }
  .version {
    border: 0;
    background: none;
    padding: 0;
    color: var(--muted);
    font-size: 12px;
    text-align: left;
    cursor: default;
  }
  .version:hover {
    background: none !important;
  }
  .debug {
    border-style: dashed;
  }
</style>
