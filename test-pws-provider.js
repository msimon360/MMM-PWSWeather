/**
 * Smoke / unit checks for the MagicMirror² v2.35+ PWS weather provider.
 * Mocks MM internals (logger, provider-utils, HTTPFetcher) so the file can
 * be required outside a MagicMirror install.
 */

const Module = require("node:module");
const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");

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
			getSunTimes: (date, lat, lon) => ({
				sunrise: new Date(date.getTime() - 6 * 60 * 60 * 1000),
				sunset: new Date(date.getTime() + 6 * 60 * 60 * 1000),
				lat,
				lon
			})
		};
	}
	if (request === "#http_fetcher") {
		class MockHTTPFetcher extends EventEmitter {
			constructor (url, options) {
				super();
				this.url = url;
				this.options = options;
				MockHTTPFetcher.lastInstance = this;
			}
			startPeriodicFetch () {
				this.started = true;
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

const PWSProvider = require("./pws.js");

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

	// Happy path: imperial observation converted to metric
	{
		let data = null;
		const provider = new PWSProvider({
			apiKey: "x".repeat(32),
			stationId: "KTEST123",
			type: "current",
			units: "e",
			updateInterval: 60000
		});
		provider.setCallbacks((payload) => { data = payload; }, (err) => {
			throw new Error(`unexpected provider error: ${err.message}`);
		});
		provider.initialize();
		provider.start();

		const fetcher = globalThis.__MockHTTPFetcher.lastInstance;
		assert.ok(fetcher, "HTTPFetcher should be created");
		assert.ok(fetcher.url.includes("stationId=KTEST123"));
		assert.ok(fetcher.url.includes("apiKey="));
		assert.equal(fetcher.started, true);

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
			units: "m"
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

	console.log("All pws provider tests passed");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
