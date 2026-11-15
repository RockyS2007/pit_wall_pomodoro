# Pit Wall Pomodoro

A racing-themed pomodoro study timer. A small car floats on your desktop, on top of
everything else, and its tires change with your local weather.

| Weather | Tires | Stripe |
|---|---|---|
| Raining | Wet | Blue |
| Cold or snowing | Hard | White |
| Cloudy | Medium | Yellow |
| Sunny / clear | Soft | Red |

## Install (macOS, Apple Silicon)

The ready-made installer is for Apple Silicon Macs (M1 and later). On other platforms, build it
from source (see [Running it](#running-it)).

1. Download the `.dmg` from the [Releases page](https://github.com/RockyS2007/pit_wall_pomodoro/releases).
2. Open it and drag **Pit Wall Pomodoro** into **Applications**.
3. The app is not signed, so macOS blocks it the first time. Try to open it once, then go to
   **System Settings → Privacy & Security**, scroll down to the message about Pit Wall Pomodoro,
   and click **Open Anyway**. On older macOS versions, right-click the app and choose **Open** instead.

Or, in Terminal, clear the download flag and then open the app normally:

```sh
xattr -dr com.apple.quarantine "/Applications/Pit Wall Pomodoro.app"
```

## Using it

- **Drag the car** anywhere. It remembers its spot, and comes back on screen if a monitor is unplugged.
- **Click the car** to open or close the Pit Wall (timer, weather, stats, settings). Closing the Pit Wall never stops the timer.
- **Right-click the car** for Start/Pause, Skip, Open Pit Wall, Hide car, Quit. Click the Dock icon to bring a hidden car back.
- **Hover the car** for time left, phase, and the tire compound with the reason.
- A focus session is a **stint** (25 min). A short break is a **pit stop** (5 min). After the last stint of a **Grand Prix** (4 by default, anywhere from 1 to 8) you get the chequered flag and a long **podium** break (20 min).
- **Box box** ends the current stint early, counts it, and starts the pit stop. **Skip** moves on without counting the stint.
- On the car: speed lines mean a stint is running, a chequered flag is the final minute, a yellow flag is paused, the crew and jack are a pit stop, a trophy and chequered flag are the podium break after a full Grand Prix. Tires wear visibly through a stint and are fresh after the stop.
- A padlock badge means you pinned a compound in settings ("Driver's choice"). A crossed-out signal badge means the weather could not be reached ("no telemetry"); the last tires stay on for up to 3 hours, then mediums.

Everything is adjustable in **Settings**: stint and break lengths, stints per Grand Prix, auto-start, city, °C/°F, the
cold cutoff for hard tires (default 7 °C / 45 °F), sounds and volume, notifications, pinned compound,
car size, livery and number, open at login, and an optional global start/pause shortcut.

Hidden debug menu: in Settings, click the version line at the bottom five times. It can force any
weather so you can see each compound, and lists recent weather requests.

## Running it

You need [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs), and on macOS the Xcode
Command Line Tools (`xcode-select --install`).

```sh
npm install
npm run tauri dev      # run the app
npm run tauri build    # build the installer (src-tauri/target/release/bundle)
```

The macOS build is unsigned. To open it the first time, follow step 3 under [Install](#install-macos-apple-silicon).

## Tests

```sh
npm test               # logic: timer, tire rules, weather, stats, settings, engine
npm run check          # type check
npx playwright install chromium   # once
npm run test:ui        # interface tests (two windows as two browser tabs, canned weather)
```

`npm run dev` on its own also serves the two windows as plain pages at
<http://localhost:1420/index.html> (car) and <http://localhost:1420/panel.html> (Pit Wall).

## How it is built

Tauri v2 shell, Svelte 5 + TypeScript UI, Vite. Almost everything is TypeScript:

- `src/core/timer.ts`: pure state machine. Uses wall-clock end times, so sleep and throttling cannot make it drift.
- `src/core/tires.ts`: the weather to compound rules, the no-flicker rules, offline fallbacks.
- `src/core/weather.ts`, `location.ts`: Open-Meteo (free, no key), at most one request per 15 minutes; city search, system location, IP fallback.
- `src/core/stats.ts`, `settings.ts`, `position.ts`: stats by local day, settings with limits, keeping the pet on screen.
- `src/engine/engine.ts`: owns all live state. Runs in the pet window and publishes snapshots to the Pit Wall.
- `src/pet/`: the car (layered SVG, tire colour from `--tire-color`), animations, dragging.
- `src/panel/`: the Pit Wall.
- `src-tauri/`: two windows, plugins (store, notification, autostart, global shortcut), a one-second heartbeat.

Settings, stats and the car's position are saved in `pit-wall.json` in the app's data folder.
Your location is stored only there and is sent only to the weather and city-search services.

## Originality

All art, sounds and names here are original. The car, liveries and icon are hand-written SVG,
the sounds are synthesized at run time, and fonts are the system's own. There are no real team
liveries or names, no driver names, no sponsor or series logos, no tire-maker branding and no
recorded audio.
