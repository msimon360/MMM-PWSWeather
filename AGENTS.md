# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
`MMM-PWSWeather` is a [MagicMirror²](https://github.com/MichMich/MagicMirror) module (not a standalone app). It has two entry points that run **inside** a MagicMirror host process:
- `MMM-PWSWeather.js` — the browser-side module (`Module.register`) that renders the weather card via `getDom()`.
- `node_helper.js` — the Node backend helper that fetches from the Weather Underground PWS API (`https://api.weather.com/v2/pws/observations/current`) using `axios` and returns flattened observation data over a socket notification.
- `pws.js` — an optional `weatherProvider` (`WeatherProvider.register("pws", ...)`) for use by MagicMirror's default weather module.

### Dependencies / setup
- Node.js (tested with v22) + npm. The only runtime dependency is `axios`; install with `npm install` (this is the update script, already run before each session).

### Lint / test / build
- There is **no linter** configured (no ESLint/Prettier config).
- There is **no real test suite**: `npm test` is the default placeholder that intentionally prints `Error: no test specified` and exits 1, and the checked-in `test.js` references browser globals (`$`) and throws under plain Node — do not treat either as a working test.
- There is **no build step**; the `.js` files are consumed directly by MagicMirror.

### Running / demonstrating the module
Normally these files run inside a full MagicMirror install (`~/MagicMirror/modules/MMM-PWSWeather`), which is a separate app not included in this repo, and live data requires a Weather Underground **apiKey** + **stationId** (see `README.md`). To validate the code here without installing MagicMirror or supplying real credentials, you can exercise the real repo files with lightweight shims:
- Backend: mock the `node_helper` core module and stub `axios.get`, then drive `helper.socketNotificationReceived("GET_PWS_WEATHER", config)` and assert the emitted `PWS_WEATHER_DATA` payload.
- Frontend: shim the global `Module` (capture the registered spec), then call `spec.socketNotificationReceived(instance, "PWS_WEATHER_DATA", samplePayload)` and mount `spec.getDom()` in a browser to render the weather card.

Non-obvious detail: `node_helper.js` flattens `observations[0]` and spreads `observations[0].imperial` to the top level, so `getDom()` reads fields like `temp`, `windGust`, `pressure`, and `precipTotal` directly off the payload (not under `imperial`).
