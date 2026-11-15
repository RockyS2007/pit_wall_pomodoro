/**
 * Native window behaviour for the pet: dragging, remembering its position,
 * resizing, and the right-click menu. Everything is a no-op in a plain
 * browser tab.
 */
import { inTauri, loadKey, saveKey } from '../lib/platform';
import { clampToScreens, type Point, type Screen } from '../core/position';
import { PET_BASE } from '../core/settings';

const POSITION_KEY = 'petPosition';

async function win() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

async function screens(): Promise<Screen[]> {
  const { availableMonitors, primaryMonitor } = await import('@tauri-apps/api/window');
  const [all, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
  const toScreen = (m: (typeof all)[number]): Screen => ({
    x: m.position.x,
    y: m.position.y,
    width: m.size.width,
    height: m.size.height,
  });
  // Primary first, so it is the fallback when the pet's own screen is gone.
  const sorted = [...all].sort((a, b) => Number(b.name === primary?.name) - Number(a.name === primary?.name));
  return sorted.map(toScreen);
}

/** Put the pet back where it was last time, or somewhere visible if that spot is gone. */
export async function restorePosition(): Promise<void> {
  if (!inTauri) return;
  try {
    const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
    const w = await win();
    const saved = (await loadKey(POSITION_KEY)) as Point | null;
    const valid = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
    const size = await w.outerSize();
    const target = clampToScreens(valid, { width: size.width, height: size.height }, await screens());
    if (target) await w.setPosition(new PhysicalPosition(target.x, target.y));
  } catch (err) {
    console.warn('[pet] could not restore position', err);
  }
}

export async function startDrag(): Promise<void> {
  if (!inTauri) return;
  await (await win()).startDragging();
}

/**
 * Save the position as the pet is moved. `onMove` gets the horizontal change
 * (for the tilt), `onSettle` fires once the window has stopped moving.
 */
export async function watchMoves(onMove: (dx: number) => void, onSettle: () => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const w = await win();
  let last: Point | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return w.onMoved(({ payload }) => {
    const here = { x: payload.x, y: payload.y };
    if (last) onMove(here.x - last.x);
    last = here;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void saveKey(POSITION_KEY, here);
      onSettle();
    }, 350);
  });
}

export async function resizePet(scale: number): Promise<void> {
  if (!inTauri) return;
  const { LogicalSize } = await import('@tauri-apps/api/dpi');
  const w = await win();
  await w.setSize(new LogicalSize(Math.round(PET_BASE.width * scale), Math.round(PET_BASE.height * scale)));
}

export interface MenuActions {
  running: boolean;
  idle: boolean;
  toggle: () => void;
  skip: () => void;
  openPanel: () => void;
  hidePet: () => void;
  quit: () => void;
}

/** Native right-click menu on the car. */
export async function showContextMenu(a: MenuActions): Promise<void> {
  if (!inTauri) return;
  const { Menu } = await import('@tauri-apps/api/menu');
  const menu = await Menu.new({
    items: [
      { id: 'toggle', text: a.running ? 'Pause' : a.idle ? 'Start stint' : 'Resume', action: a.toggle },
      { id: 'skip', text: 'Skip to next', enabled: !a.idle, action: a.skip },
      { item: 'Separator' },
      { id: 'panel', text: 'Open Pit Wall', action: a.openPanel },
      { id: 'hide', text: 'Hide car', action: a.hidePet },
      { item: 'Separator' },
      { id: 'quit', text: 'Quit Pit Wall Pomodoro', action: a.quit },
    ],
  });
  await menu.popup();
}
