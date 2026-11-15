/**
 * Thin layer over the things that differ between the real desktop app (Tauri)
 * and a plain browser tab. In a browser the two "windows" are two tabs that
 * talk over a BroadcastChannel and save to localStorage, which is what the UI
 * tests and `npm run dev` use.
 */
export const inTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as object);

type Handler<T> = (payload: T) => void;

const CHANNEL = 'pit-wall-pomodoro';
let channel: BroadcastChannel | null = null;
function bus(): BroadcastChannel {
  channel ??= new BroadcastChannel(CHANNEL);
  return channel;
}

/** Send a message to the other window. */
export async function send<T>(name: string, payload: T): Promise<void> {
  if (inTauri) {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(name, payload);
  } else {
    // Round-trip through JSON, the same as the desktop app does, so reactive
    // objects from the UI can be sent.
    bus().postMessage(JSON.parse(JSON.stringify({ name, payload })));
  }
}

/** Listen for messages from the other window (or the native side). Returns an unlisten function. */
export async function on<T>(name: string, handler: Handler<T>): Promise<() => void> {
  if (inTauri) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(name, (event) => handler(event.payload));
  }
  const listener = (event: MessageEvent) => {
    if (event.data?.name === name) handler(event.data.payload as T);
  };
  bus().addEventListener('message', listener);
  return () => bus().removeEventListener('message', listener);
}

// ---------------------------------------------------------------- storage

const STORE_FILE = 'pit-wall.json';
const LS_PREFIX = 'pit-wall:';
type TauriStore = Awaited<ReturnType<typeof import('@tauri-apps/plugin-store').load>>;
let storePromise: Promise<TauriStore> | null = null;

function store(): Promise<TauriStore> {
  storePromise ??= import('@tauri-apps/plugin-store').then((m) =>
    m.load(STORE_FILE, { autoSave: 300, defaults: {} }),
  );
  return storePromise;
}

export async function loadKey(key: string): Promise<unknown> {
  if (inTauri) return (await (await store()).get(key)) ?? null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveKey(key: string, value: unknown): Promise<void> {
  if (inTauri) {
    await (await store()).set(key, value);
    return;
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in a private window; the app still runs.
  }
}

// ---------------------------------------------------------------- windows

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export async function togglePanel(): Promise<void> {
  if (inTauri) await invoke('toggle_panel');
  else window.open('panel.html', 'pit-wall-panel', 'width=380,height=620');
}

export async function showPanel(): Promise<void> {
  if (inTauri) await invoke('show_panel');
  else window.open('panel.html', 'pit-wall-panel', 'width=380,height=620');
}

export async function setPetVisible(visible: boolean): Promise<void> {
  if (inTauri) await invoke('set_pet_visible', { visible });
}

export async function quitApp(): Promise<void> {
  if (inTauri) await invoke('quit_app');
}

// ---------------------------------------------------------------- system services

let notifyAllowed: boolean | null = null;

export async function notify(title: string, body: string): Promise<void> {
  if (inTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    if (notifyAllowed === null) {
      notifyAllowed = await n.isPermissionGranted();
      if (!notifyAllowed) notifyAllowed = (await n.requestPermission()) === 'granted';
    }
    if (notifyAllowed) n.sendNotification({ title, body });
    return;
  }
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted') new Notification(title, { body });
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (!inTauri) return;
  const a = await import('@tauri-apps/plugin-autostart');
  if (enabled) await a.enable();
  else if (await a.isEnabled()) await a.disable();
}

let registeredHotkey: string | null = null;

/** Register (or clear, with null) the global start/pause shortcut. */
export async function setHotkey(accelerator: string | null, onPress: () => void): Promise<void> {
  if (!inTauri) return;
  const g = await import('@tauri-apps/plugin-global-shortcut');
  if (registeredHotkey) {
    await g.unregister(registeredHotkey).catch(() => {});
    registeredHotkey = null;
  }
  if (!accelerator) return;
  await g.register(accelerator, (event) => {
    if (event.state === 'Pressed') onPress();
  });
  registeredHotkey = accelerator;
}

/** fetch() with a timeout, shaped the way the core modules expect. */
export async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}
