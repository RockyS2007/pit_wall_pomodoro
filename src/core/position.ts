/**
 * Keeps the pet window on a screen that still exists. All values are in
 * physical pixels, the same units Tauri reports for windows and monitors.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Screen extends Point, Size {}

/** Where the pet goes the first time, or when its screen has gone away. */
export function defaultPosition(size: Size, screen: Screen, margin = 48): Point {
  return {
    x: Math.round(screen.x + screen.width - size.width - margin),
    y: Math.round(screen.y + screen.height - size.height - margin * 2),
  };
}

function containsCenter(pos: Point, size: Size, s: Screen): boolean {
  const cx = pos.x + size.width / 2;
  const cy = pos.y + size.height / 2;
  return cx >= s.x && cx < s.x + s.width && cy >= s.y && cy < s.y + s.height;
}

/**
 * Returns a position that is fully on one of the given screens.
 * - If the saved spot is still on a screen, it is nudged so the whole window fits.
 * - If its screen is gone (monitor unplugged) or nothing was saved, the pet
 *   goes to the bottom-right corner of the first (primary) screen.
 */
export function clampToScreens(saved: Point | null, size: Size, screens: Screen[]): Point | null {
  if (screens.length === 0) return saved;
  const home = saved && screens.find((s) => containsCenter(saved, size, s));
  if (!saved || !home) return defaultPosition(size, screens[0]);
  const maxX = home.x + Math.max(0, home.width - size.width);
  const maxY = home.y + Math.max(0, home.height - size.height);
  return {
    x: Math.round(Math.min(maxX, Math.max(home.x, saved.x))),
    y: Math.round(Math.min(maxY, Math.max(home.y, saved.y))),
  };
}

/** True once the pointer has moved far enough to count as a drag, not a click. */
export function isDrag(start: Point, current: Point, threshold = 4): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
