<script lang="ts">
  /** City search plus "detect my location". Used in settings and onboarding. */
  import { detectByDevice, detectByIp, searchCity, type Place } from '../core/location';
  import { fetchJson } from '../lib/platform';
  import { app, update } from './state.svelte';

  let query = $state('');
  let results = $state<Place[] | null>(null);
  let busy = $state(false);
  let message = $state('');

  const current = $derived(app.snap?.settings.location ?? null);

  async function search(event?: Event) {
    event?.preventDefault();
    if (query.trim().length < 2) return;
    busy = true;
    message = '';
    try {
      results = await searchCity(query, fetchJson);
      if (results.length === 0) message = 'No city found with that name.';
    } catch {
      results = null;
      message = 'City search is not reachable right now. Check your connection.';
    } finally {
      busy = false;
    }
  }

  function choose(place: Place) {
    update({ location: place });
    results = null;
    query = '';
    message = '';
  }

  async function detect() {
    busy = true;
    message = '';
    try {
      // The system location service first; if it is off or denied, fall back to the IP address.
      const place = await detectByDevice(4000).catch(() => detectByIp(fetchJson));
      choose(place);
    } catch {
      message = 'Could not detect your location. Search for your city instead.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="picker">
  {#if current}
    <div class="current">
      <span class="name" data-testid="location-name">{current.name}</span>
      {#if current.approximate}<span class="chip">approximate location</span>{/if}
      <button class="link" onclick={() => update({ location: null })}>Clear</button>
    </div>
  {/if}
  <form onsubmit={search}>
    <input
      type="search"
      placeholder={current ? 'Change city' : 'Search for your city'}
      aria-label="City"
      bind:value={query}
    />
    <button type="submit" disabled={busy || query.trim().length < 2}>Search</button>
  </form>
  {#if results && results.length > 0}
    <ul>
      {#each results as place (place.name + place.lat + place.lon)}
        <li><button class="ghost result" onclick={() => choose(place)}>{place.name}</button></li>
      {/each}
    </ul>
  {/if}
  <div class="row">
    <button class="link" onclick={detect} disabled={busy}>Detect my location</button>
    {#if busy}<span class="muted">Working…</span>{/if}
  </div>
  {#if message}<p class="muted msg" role="status">{message}</p>{/if}
</div>

<style>
  .picker {
    display: grid;
    gap: 8px;
  }
  .current {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .name {
    font-weight: 600;
  }
  form {
    display: flex;
    gap: 6px;
  }
  form input {
    flex: 1;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .result {
    width: 100%;
    text-align: left;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .msg {
    margin: 0;
  }
</style>
