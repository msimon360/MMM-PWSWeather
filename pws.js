const HTTPFetcher = require("#http_fetcher");

class PWSProvider {
  constructor(config) {
    this.config = config;
    this.locationName = null;
    this.fetcher = null;
    this.onDataCallback = null;
    this.onErrorCallback = null;
  }

  setCallbacks(onData, onError) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;
  }

  async initialize() {
    // Validate required config
    if (!this.config.apiKey) {
      this.onErrorCallback({
        message: "PWS Weather: Missing apiKey",
        translationKey: "MODULE_ERROR_UNAUTHORIZED"
      });
      return;
    }

    if (!this.config.stationId) {
      this.onErrorCallback({
        message: "PWS Weather: Missing stationId",
        translationKey: "MODULE_ERROR_UNAUTHORIZED"
      });
      return;
    }

    // Build the API URL
    const url = new URL("https://api.weather.com/v2/pws/observations/current");
    url.searchParams.append("stationId", this.config.stationId);
    url.searchParams.append("format", "json");
    url.searchParams.append("units", this.config.units || "e");
    url.searchParams.append("apiKey", this.config.apiKey);

    // Initialize the HTTPFetcher
    this.fetcher = new HTTPFetcher(url.toString(), {
      reloadInterval: this.config.updateInterval || 300000,
      logContext: "weatherprovider.pws",
    });

    // Handle successful responses
    this.fetcher.on("response", async (response) => {
      try {
        const data = await response.json();
        
        if (!data.observations || !data.observations[0]) {
          this.onErrorCallback({
            message: "PWS Weather: No observations in response",
            translationKey: "MODULE_ERROR_UNSPECIFIED"
          });
          return;
        }

        const obs = data.observations[0];
        const weatherData = this.parseWeather(obs);
        this.onDataCallback(weatherData);
      } catch (error) {
        this.onErrorCallback({
          message: `PWS Weather: ${error.message}`,
          translationKey: "MODULE_ERROR_UNSPECIFIED"
        });
      }
    });

    // Handle fetch errors
    this.fetcher.on("error", (errorInfo) => {
      this.onErrorCallback({
        message: `PWS Weather: ${errorInfo.message || "Network error"}`,
        translationKey: "MODULE_ERROR_NO_CONNECTION"
      });
    });
  }

  start() {
    if (this.fetcher) {
      this.fetcher.startPeriodicFetch();
    }
  }

  stop() {
    if (this.fetcher) {
      this.fetcher.clearTimer();
    }
  }

  /**
   * Convert imperial temp to celsius
   */
  fahrenheitToCelsius(f) {
    return Math.round(((f - 32) * 5) / 9 * 10) / 10;
  }

  /**
   * Convert mph to meters per second
   */
  mphToMs(mph) {
    return Math.round(mph * 0.44704 * 100) / 100;
  }

  /**
   * Map PWS conditions to weathericons icon names
   * Reference: https://erikflowers.github.io/weather-icons/
   */
  mapWeatherIcon(obs) {
    const icons = {
      sunny: "wi-day-sunny",
      clear: "wi-night-clear",
      cloudy: "wi-cloud",
      rain: "wi-rain",
      "heavy rain": "wi-rain-wind",
      snow: "wi-snow",
      sleet: "wi-sleet",
      fog: "wi-fog",
      mist: "wi-mist",
      overcast: "wi-cloudy",
      "partly cloudy": "wi-day-cloudy",
      thunderstorm: "wi-thunderstorm",
      tornado: "wi-tornado",
      hail: "wi-hail",
      windy: "wi-strong-wind",
      unknown: "wi-na"
    };

    // Try to match based on observation
    const condition = obs.condition?.toLowerCase() || "";
    
    // Check for exact match
    if (icons[condition]) {
      return icons[condition];
    }

    // Check for partial matches
    if (condition.includes("rain")) return icons.rain;
    if (condition.includes("snow")) return icons.snow;
    if (condition.includes("cloud")) return icons.cloudy;
    if (condition.includes("clear") || condition.includes("sunny")) {
      return obs.obsTimeLocal?.includes("PM") ? icons.sunny : icons.clear;
    }
    if (condition.includes("fog")) return icons.fog;
    if (condition.includes("storm") || condition.includes("thunder")) return icons.thunderstorm;
    if (condition.includes("sleet")) return icons.sleet;
    if (condition.includes("hail")) return icons.hail;

    return icons.unknown;
  }

  /**
   * Parse PWS observation data into WeatherObject format
   */
  parseWeather(obs) {
    // Extract imperial values (PWS API returns these)
    const tempF = obs.imperial?.temp ?? obs.temp ?? 70;

    const humidity = obs.humidity ?? 50;
    const windSpeedMph = obs.imperial?.windSpeed ?? obs.windSpeed ?? 0;
    const windGustMph = obs.imperial?.windGust ?? obs.windGust ?? 0;
    const windDirection = obs.winddir ?? 0;
    const dewpointF = obs.imperial?.dewpt ?? obs.dewpt ?? tempF - 5;
    const pressureInHg = obs.imperial?.pressure ?? obs.pressure ?? 30;

    // Convert to metric
    const temperature = this.fahrenheitToCelsius(tempF);
    const windSpeed = this.mphToMs(windSpeedMph);
    const windGust = this.mphToMs(windGustMph);
    const dewpoint = this.fahrenheitToCelsius(dewpointF);

    // Parse observation time
    const obsDate = new Date(obs.obsTimeLocal || new Date());

    // Create sunrise/sunset - PWS doesn't always provide these
    // So we'll use reasonable defaults (6am and 6pm)
    const sunrise = new Date(obsDate);
    sunrise.setHours(6, 0, 0, 0);
    const sunset = new Date(obsDate);
    sunset.setHours(18, 0, 0, 0);

    return {
      // Required fields for "current" weather type
      temperature,
      humidity,
      windSpeed,
      windFromDirection: windDirection,
      sunrise,
      sunset,
      weatherType: this.mapWeatherIcon(obs),
      
      // Optional but useful fields
      date: obsDate,
      dewpoint,
      pressure: pressureInHg,
      windGust,
      
      // Additional metadata
      locationName: obs.neighborhood || obs.stationID || "Personal Weather Station"
    };
  }
}

module.exports = PWSProvider;
