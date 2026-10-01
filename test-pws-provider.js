/**
 * Smoke / unit checks for the MagicMirror² v2.35+ PWS weather provider.
 * Mocks MM internals (logger, provider-utils, HTTPFetcher) so the file can
 * be required outside a MagicMirror install.
 */

const Module = require("node:module");
const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");

// "modern" matches MagicMirror 2.38 (options object, constructor length 0).
// "legacy" matches 2.35–2.37 `(url, options)` (constructor length 1).
let fetcherApi = "modern";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "logger") {
		return {
			error: () => {},
			warn: () => {},
			info: () => {},
			log: () => {}
		};
	}
	if (request === "../provider-utils") {
		return {
			getSunTimes: (date, lat, lon) => {
				if (lat === 999) {
					throw new Error("sun failed");
				}
				return {
					sunrise: new Date(date.getTime() - 6 * 60 * 60 * 1000),
					sunset: new Date(date.getTime() + 6 * 60 * 60 * 1000),
					lat,
					lon
				};
			},
			isDayTime: (date, sunrise, sunset) => date >= sunrise && date < sunset
		};
	}
	if (request === "#http_fetcher") {
		if (fetcherApi === "legacy") {
			class LegacyHTTPFetcher extends EventEmitter {
				constructor (url, options = {}) {
					super();
					if (typeof url !== "string") {
						throw new Error("legacy fetcher expected a URL string");
					}
					this.url = url;
					this.options = options;
					LegacyHTTPFetcher.lastInstance = this;
				}
				startPeriodicFetch (initialDelay = 0) {
					this.started = true;
					this.initialDelay = initialDelay;
				}
				clearTimer () {
					this.cleared = true;
				}
			}
			LegacyHTTPFetcher.lastInstance = null;
			globalThis.__MockHTTPFetcher = LegacyHTTPFetcher;
			return LegacyHTTPFetcher;
		}

		// MagicMirror 2.38: a single options object. A positional URL string
		// has neither url nor urlFactory and throws the production error.
		class MockHTTPFetcher extends EventEmitter {
			constructor (options = {}) {
				super();
				this.options = options;
				this.url = options.url || null;
				this.urlFactory = options.urlFactory || null;
				if (!this.url && !this.urlFactory) {
					throw new Error("Either url or urlFactory must be provided");
				}
				MockHTTPFetcher.lastInstance = this;
			}
			startPeriodicFetch (initialDelay = 0) {
				this.started = true;
				this.initialDelay = initialDelay;
			}
			clearTimer () {
				this.cleared = true;
			}
		}
		MockHTTPFetcher.lastInstance = null;
		globalThis.__MockHTTPFetcher = MockHTTPFetcher;
		return MockHTTPFetcher;
	}
	return originalLoad.call(this, request, parent, isMain);
};

function loadProvider () {
	delete require.cache[require.resolve("./pws.js")];
	return require("./pws.js");
}

const PWSProvider = loadProvider();

function makeObs (overrides = {}) {
	return {
		observations: [
			{
				stationID: "KTEST123",
				obsTimeUtc: "2026-04-01T18:00:00Z",
				obsTimeLocal: "2026-04-01 14:00:00",
				neighborhood: "Testville",
				lat: 40.7,
				lon: -74.0,
				humidity: 55,
				winddir: 180,
				uv: 3,
				imperial: {
					temp: 68,
					heatIndex: 70,
					windChill: 66,
					windSpeed: 9,
					precipTotal: 0.1,
					precipRate: 0
				},
				...overrides
			}
		]
	};
}

async function run () {
	// Validation: missing apiKey
	{
		let error = null;
		const provider = new PWSProvider({ stationId: "KTEST", type: "current" });
		provider.setCallbacks(() => {}, (err) => { error = err; });
		provider.initialize();
		assert.ok(error, "expected error for missing apiKey");
		assert.match(error.message, /API key/i);
	}

	// Validation: forecast unsupported
	{
		let error = null;
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST",
			type: "forecast"
		});
		provider.setCallbacks(() => {}, (err) => { error = err; });
		provider.initialize();
		assert.ok(error, "expected error for unsupported type");
		assert.match(error.message, /current/i);
	}

	// MagicMirror display units=imperial must map to WU units=e (not send "imperial")
	{
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current",
			units: "imperial"
		});
		provider.setCallbacks(() => {}, () => {});
		provider.initialize();
		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		assert.ok(fetcher.url.includes("units=e"), `expected units=e, got ${fetcher.url}`);
		assert.ok(!fetcher.url.includes("units=imperial"));
	}

	// MagicMirror display units=metric maps to WU units=m
	{
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current",
			units: "metric"
		});
		provider.setCallbacks(() => {}, () => {});
		provider.initialize();
		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		assert.ok(fetcher.url.includes("units=m"), `expected units=m, got ${fetcher.url}`);
	}

	// Happy path: imperial observation converted to metric
	{
		let data = null;
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current",
			apiUnits: "e",
			updateInterval: 60000
		});
		provider.setCallbacks((payload) => { data = payload; }, (err) => {
			throw new Error(`unexpected provider error: ${err.message}`);
		});
		provider.initialize();
		provider.start();

		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		assert.ok(fetcher, "HTTPFetcher should be created");
		assert.equal(typeof fetcher.url, "string");
		assert.ok(fetcher.url.includes("stationId=KTEST123"));
		assert.ok(fetcher.url.includes("apiKey="));
		assert.ok(fetcher.url.includes("units=e"));
		assert.equal(fetcher.options.url, fetcher.url);
		assert.equal(fetcher.options.logContext, "weatherprovider.pws");
		assert.equal(fetcher.options.reloadInterval, 60000);
		assert.equal(fetcher.options.headers.Accept, "application/json");
		assert.equal(fetcher.constructor.length, 0);
		assert.equal(fetcher.started, true);
		assert.equal(fetcher.initialDelay, 0);

		const responseHandlers = fetcher.listeners("response");
		assert.equal(responseHandlers.length, 1);

		await responseHandlers[0]({
			json: async () => makeObs()
		});

		assert.ok(data, "onData should receive weather object");
		assert.equal(provider.locationName, "Testville");
		assert.ok(Math.abs(data.temperature - 20) < 0.01, `temp °F 68 -> °C, got ${data.temperature}`);
		assert.ok(data.windSpeed > 0, "wind speed converted");
		assert.ok(Math.abs(data.precipitationAmount - 2.54) < 0.01, "0.1 in -> mm");
		assert.equal(data.humidity, 55);
		assert.equal(data.windFromDirection, 180);
		assert.equal(data.weatherType, "day-sunny");
		assert.ok(data.sunrise instanceof Date);
		assert.ok(data.sunset instanceof Date);

		provider.stop();
		assert.equal(fetcher.cleared, true);
	}

	// Metric observation: temp already Celsius, wind km/h -> m/s
	{
		let data = null;
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current",
			apiUnits: "m"
		});
		provider.setCallbacks((payload) => { data = payload; }, () => {});
		provider.initialize();

		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		await fetcher.listeners("response")[0]({
			json: async () => ({
				observations: [{
					stationID: "KTEST123",
					obsTimeUtc: "2026-04-01T18:00:00Z",
					neighborhood: "Metricville",
					lat: 40.7,
					lon: -74.0,
					humidity: 40,
					winddir: 90,
					metric: {
						temp: 21,
						heatIndex: 21,
						windSpeed: 18, // km/h
						precipTotal: 5
					}
				}]
			})
		});

		assert.equal(data.temperature, 21);
		assert.ok(Math.abs(data.windSpeed - 5) < 0.01, `18 km/h -> 5 m/s, got ${data.windSpeed}`);
		assert.equal(data.precipitationAmount, 5);
	}

	// String coordinates still produce sunrise/sunset, and a sun-calc failure
	// must not swallow the observation (that leaves the module on "Loading").
	{
		let data = null;
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current"
		});
		provider.setCallbacks((payload) => { data = payload; }, (err) => {
			throw new Error(`unexpected provider error: ${err.message}`);
		});
		provider.initialize();
		assert.equal(provider.locationName, "KTEST123");

		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		await fetcher.listeners("response")[0]({
			json: async () => ({
				observations: [{
					stationID: "KTEST123",
					obsTimeUtc: "2026-04-01T18:00:00Z",
					neighborhood: "Stringville",
					lat: "40.7",
					lon: "-74.0",
					humidity: 50,
					winddir: 10,
					metric: { temp: 12, windSpeed: 0, precipTotal: 0 }
				}]
			})
		});
		assert.ok(data.sunrise instanceof Date);
		assert.ok(data.sunset instanceof Date);
		assert.equal(data.temperature, 12);
		assert.equal(provider.locationName, "Stringville");
		provider.stop();
	}

	{
		let data = null;
		let error = null;
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current"
		});
		provider.setCallbacks((payload) => { data = payload; }, (err) => { error = err; });
		provider.initialize();
		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		await fetcher.listeners("response")[0]({
			json: async () => ({
				observations: [{
					stationID: "KTEST123",
					obsTimeUtc: "2026-04-01T18:00:00Z",
					lat: 999,
					lon: 10,
					humidity: 40,
					metric: { temp: 8, windSpeed: 1, precipTotal: 0 }
				}]
			})
		});
		assert.equal(error, null);
		assert.equal(data.temperature, 8);
		assert.equal(data.sunrise, null);
		assert.equal(data.sunset, null);
		provider.stop();
	}

	// Repeat delivery is scheduled so a weather update that arrives before the
	// module is in the DOM is not stuck on "Loading".
	{
		const delays = [];
		const originalSetTimeout = global.setTimeout;
		global.setTimeout = (fn, delay, ...args) => {
			delays.push(delay);
			return originalSetTimeout(fn, delay, ...args);
		};
		let deliveries = 0;
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current"
		});
		provider.setCallbacks(() => { deliveries += 1; }, () => {});
		provider.initialize();
		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		await fetcher.listeners("response")[0]({
			json: async () => makeObs()
		});
		global.setTimeout = originalSetTimeout;
		provider.stop();
		assert.equal(deliveries, 1);
		assert.deepEqual(delays, [1000, 3000]);
	}

	// 304 Not Modified has no body and must not surface as a parse error
	{
		let data = null;
		let error = null;
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current"
		});
		provider.setCallbacks((payload) => { data = payload; }, (err) => { error = err; });
		provider.initialize();
		provider.start(1500);

		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		assert.equal(fetcher.initialDelay, 1500);
		await fetcher.listeners("response")[0]({
			status: 304,
			json: async () => {
				throw new Error("304 responses have no body");
			}
		});
		assert.equal(data, null);
		assert.equal(error, null);
	}

	// MagicMirror 2.35–2.37 still constructs HTTPFetcher as (url, options)
	{
		fetcherApi = "legacy";
		const LegacyPWSProvider = loadProvider();
		const provider = new LegacyPWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current",
			units: "imperial",
			updateInterval: 60000
		});
		provider.setCallbacks(() => {}, (err) => {
			throw new Error(`unexpected provider error: ${err.message}`);
		});
		provider.initialize();
		provider.start(2500);

		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		assert.equal(fetcher.constructor.length, 1);
		assert.equal(typeof fetcher.url, "string");
		assert.ok(fetcher.url.includes("stationId=KTEST123"), fetcher.url);
		assert.ok(fetcher.url.includes("units=e"), fetcher.url);
		assert.equal(fetcher.options.logContext, "weatherprovider.pws");
		assert.equal(fetcher.options.reloadInterval, 60000);
		assert.equal(fetcher.initialDelay, 2500);
	}

	console.log("All pws provider tests passed");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
