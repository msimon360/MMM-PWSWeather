const Log = require("logger");
const { getSunTimes, isDayTime } = require("../provider-utils");
const HTTPFetcher = require("#http_fetcher");

// The weather module ignores a DOM update that arrives before its wrapper
// exists, and the first paint then stays on "Loading". Deliver the same
// observation again once that wrapper is on screen.
const REDISPLAY_DELAYS_MS = [1000, 3000];

/**
 * Server-side weather provider for Weather Underground Personal Weather Stations (PWS).
 * Compatible with MagicMirror² v2.35.0+ weather module.
 * v2.38.0 changed HTTPFetcher to `new HTTPFetcher({ url })`; this provider
 * still accepts the v2.35–v2.37 `(url, options)` constructor as well.
 *
 * API: https://api.weather.com/v2/pws/observations/current
 * Docs: https://docs.magicmirror.builders/module-development/weather-provider.html
 *
 * Only `type: "current"` is supported. The weather module expects metric units
 * (Celsius, m/s, mm); this provider converts from the PWS response as needed.
 */
class PWSProvider {
	#lastWeatherData = null;
	#redisplayTimers = [];

	/**
	 * @param {object} config - Full weather module config
	 */
	constructor (config) {
		this.config = {
			stationId: "",
			apiKey: "",
			// Optional override for the Weather Underground API units param (e|m|h).
			// Do not confuse with MagicMirror's display `units` (metric|imperial).
			apiUnits: null,
			type: "current",
			updateInterval: 10 * 60 * 1000,
			...config
		};

		this.fetcher = null;
		this.onDataCallback = null;
		this.onErrorCallback = null;
		this.locationName = null;
	}

	/**
	 * @param {(data: object|object[]) => void} onData
	 * @param {(error: object) => void} onError
	 */
	setCallbacks (onData, onError) {
		this.onDataCallback = onData;
		this.onErrorCallback = onError;
	}

	initialize () {
		if (typeof this.onErrorCallback !== "function") {
			throw new Error("setCallbacks() must be called before initialize()");
		}

		if (!this.config.apiKey) {
			Log.error("[pws] API key is required");
			this.onErrorCallback({
				message: "Weather Underground API key is required",
				translationKey: "MODULE_ERROR_UNSPECIFIED"
			});
			return;
		}

		if (!this.config.stationId) {
			Log.error("[pws] Station ID is required");
			this.onErrorCallback({
				message: "Weather Underground station ID is required",
				translationKey: "MODULE_ERROR_UNSPECIFIED"
			});
			return;
		}

		if (this.config.type && this.config.type !== "current") {
			Log.error(`[pws] Unsupported type "${this.config.type}". Only "current" is supported.`);
			this.onErrorCallback({
				message: 'PWS provider only supports type: "current"',
				translationKey: "MODULE_ERROR_UNSPECIFIED"
			});
			return;
		}

		// Header text is captured when the provider finishes initializing,
		// which is before the first observation arrives.
		this.locationName = this.config.stationId;

		this.#initializeFetcher();
	}

	/**
	 * @param {number} [initialDelay] - Delay before the first fetch in ms.
	 *   MagicMirror 2.38 passes `config.initialLoadDelay` here.
	 */
	start (initialDelay = 0) {
		this.fetcher?.startPeriodicFetch(initialDelay);
	}

	stop () {
		this.#clearRedisplayTimers();
		this.fetcher?.clearTimer();
	}

	#initializeFetcher () {
		const url = this.#getUrl();
		const fetcherOptions = {
			reloadInterval: this.config.updateInterval,
			headers: {
				"Cache-Control": "no-cache",
				Accept: "application/json"
			},
			logContext: "weatherprovider.pws"
		};

		this.fetcher = this.#createFetcher(url, fetcherOptions);

		this.fetcher.on("response", async (response) => {
			// 304 has no body. Keep the last observation on screen.
			if (response.status === 304) {
				return;
			}

			try {
				const data = await response.json();
				this.#handleResponse(data);
			} catch (error) {
				Log.error("[pws] Failed to parse JSON:", error);
				this.onErrorCallback?.({
					message: "Failed to parse API response",
					translationKey: "MODULE_ERROR_UNSPECIFIED"
				});
			}
		});

		this.fetcher.on("error", (errorInfo) => {
			this.onErrorCallback?.(errorInfo);
		});
	}

	/**
	 * Build an HTTPFetcher for the current MagicMirror version.
	 * v2.38+ takes one options object and throws unless `url` or `urlFactory`
	 * is set. v2.35–v2.37 take `(url, options)`. The new signature's only
	 * parameter has a default, so its constructor length is 0.
	 * @param {string} url
	 * @param {object} fetcherOptions
	 * @returns {object}
	 */
	#createFetcher (url, fetcherOptions) {
		if (HTTPFetcher.length === 0) {
			return new HTTPFetcher({
				...fetcherOptions,
				url
			});
		}

		return new HTTPFetcher(url, fetcherOptions);
	}

	#getUrl () {
		const url = new URL("https://api.weather.com/v2/pws/observations/current");
		url.searchParams.set("stationId", this.config.stationId);
		url.searchParams.set("format", "json");
		// Weather Underground only accepts e|m|h. MagicMirror's config.units is
		// metric|imperial for display, so map (or ignore) it for the API call.
		url.searchParams.set("units", this.#getApiUnits());
		url.searchParams.set("apiKey", this.config.apiKey);
		url.searchParams.set("numericPrecision", "decimal");
		return url.toString();
	}

	/**
	 * Resolve Weather Underground `units` query value.
	 * Prefer explicit `apiUnits`, else map MagicMirror display units, else metric.
	 * @returns {"e"|"m"|"h"}
	 */
	#getApiUnits () {
		const explicit = this.config.apiUnits || this.config.pwsUnits;
		if (explicit === "e" || explicit === "m" || explicit === "h") {
			return explicit;
		}

		// Legacy: some configs set units to the PWS codes directly.
		if (this.config.units === "e" || this.config.units === "m" || this.config.units === "h") {
			return this.config.units;
		}

		if (this.config.units === "imperial") {
			return "e";
		}

		// Default to metric API response; provider already normalizes to °C / m/s / mm.
		return "m";
	}

	#handleResponse (data) {
		try {
			const obs = data?.observations?.[0];
			if (!obs) {
				throw new Error("No observations in PWS API response");
			}

			this.locationName = obs.neighborhood || obs.stationID || "PWS";

			const weatherData = this.#generateCurrentWeather(obs);
			this.#publishWeatherData(weatherData);
		} catch (error) {
			Log.error("[pws] Error processing weather data:", error);
			this.onErrorCallback?.({
				message: error.message,
				translationKey: "MODULE_ERROR_UNSPECIFIED"
			});
		}
	}

	/**
	 * Build a current-weather plain object for the weather module.
	 * @param {object} obs - Single PWS observation
	 * @returns {object}
	 */
	#generateCurrentWeather (obs) {
		const { unitSystem, values } = this.#extractUnitBlock(obs);

		const temperature = this.#toCelsius(values.temp, unitSystem);
		const windSpeed = this.#toMetersPerSecond(values.windSpeed ?? 0, unitSystem);
		const precipitationAmount = this.#toMillimeters(values.precipTotal ?? values.precipRate ?? 0, unitSystem);

		const date = obs.obsTimeUtc
			? new Date(obs.obsTimeUtc)
			: (obs.epoch ? new Date(obs.epoch * 1000) : new Date());

		const current = {
			date,
			humidity: obs.humidity ?? null,
			temperature,
			windSpeed,
			windFromDirection: obs.winddir ?? 0,
			weatherType: "day-sunny", // PWS current observations do not include conditions
			precipitationAmount,
			precipitationUnits: "mm",
			uvIndex: obs.uv ?? null
		};

		const feelsLike = values.heatIndex ?? values.windChill ?? values.temp;
		if (feelsLike != null) {
			current.feelsLikeTemp = this.#toCelsius(feelsLike, unitSystem);
		}

		const lat = this.#finiteCoordinate(obs.lat ?? this.config.lat);
		const lon = this.#finiteCoordinate(obs.lon ?? this.config.lon);
		if (lat != null && lon != null) {
			try {
				const { sunrise, sunset } = getSunTimes(date, lat, lon);
				current.sunrise = sunrise;
				current.sunset = sunset;
				if (sunrise && sunset && typeof isDayTime === "function") {
					current.weatherType = isDayTime(date, sunrise, sunset) ? "day-sunny" : "night-clear";
				}
			} catch (error) {
				Log.error("[pws] Failed to calculate sunrise/sunset:", error);
				current.sunrise = null;
				current.sunset = null;
			}
		} else {
			current.sunrise = null;
			current.sunset = null;
		}

		return current;
	}

	/**
	 * @param {unknown} value
	 * @returns {number|null}
	 */
	#finiteCoordinate (value) {
		if (value == null || value === "") {
			return null;
		}
		const coordinate = typeof value === "number" ? value : Number(value);
		return Number.isFinite(coordinate) ? coordinate : null;
	}

	/**
	 * @param {object|null|undefined} weatherData
	 */
	#publishWeatherData (weatherData) {
		if (!weatherData || !this.onDataCallback) {
			return;
		}

		this.#lastWeatherData = weatherData;
		this.onDataCallback(weatherData);
		this.#scheduleRedisplay();
	}

	#scheduleRedisplay () {
		this.#clearRedisplayTimers();
		for (const delay of REDISPLAY_DELAYS_MS) {
			const timer = setTimeout(() => {
				if (this.#lastWeatherData && this.onDataCallback) {
					this.onDataCallback(this.#lastWeatherData);
				}
			}, delay);
			timer.unref?.();
			this.#redisplayTimers.push(timer);
		}
	}

	#clearRedisplayTimers () {
		for (const timer of this.#redisplayTimers) {
			clearTimeout(timer);
		}
		this.#redisplayTimers = [];
	}

	/**
	 * Pick the unit block from the observation (`imperial`, `metric`, etc.).
	 * @param {object} obs
	 * @returns {{unitSystem: string, values: object}}
	 */
	#extractUnitBlock (obs) {
		if (obs.imperial) {
			return { unitSystem: "imperial", values: obs.imperial };
		}
		if (obs.metric) {
			return { unitSystem: "metric", values: obs.metric };
		}
		if (obs.metric_si) {
			return { unitSystem: "metric_si", values: obs.metric_si };
		}
		if (obs.uk_hybrid) {
			return { unitSystem: "uk_hybrid", values: obs.uk_hybrid };
		}

		throw new Error("PWS observation is missing a unit measurement block");
	}

	#toCelsius (temp, unitSystem) {
		if (temp == null || Number.isNaN(temp)) {
			return null;
		}
		if (unitSystem === "imperial") {
			return ((temp - 32) * 5) / 9;
		}
		return temp;
	}

	#toMetersPerSecond (speed, unitSystem) {
		if (speed == null || Number.isNaN(speed)) {
			return 0;
		}
		if (unitSystem === "imperial" || unitSystem === "uk_hybrid") {
			// mph -> m/s
			return speed / 2.2369362920544;
		}
		if (unitSystem === "metric" || unitSystem === "metric_si") {
			// km/h -> m/s
			return speed / 3.6;
		}
		return speed;
	}

	#toMillimeters (amount, unitSystem) {
		if (amount == null || Number.isNaN(amount)) {
			return 0;
		}
		if (unitSystem === "imperial") {
			// inches -> mm
			return amount * 25.4;
		}
		return amount;
	}
}

module.exports = PWSProvider;
