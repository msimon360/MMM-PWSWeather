/* global WeatherProvider, WeatherObject, WeatherUtils */

WeatherProvider.register("pws", {
  providerName: "PWS",

  defaults: {
    stationId: "",
    apiKey: "",
    units: "e"  // e=imperial, m=metric (API units)
  },

  fetchCurrentWeather() {
    if (!this.config.apiKey || !this.config.stationId) {
      Log.error("[weatherprovider.pws] Missing apiKey or stationId");
      return;
    }

    const url = new URL("https://api.weather.com/v2/pws/observations/current");
    url.searchParams.set("stationId", this.config.stationId);
    url.searchParams.set("format", "json");
    url.searchParams.set("units", this.config.units || "e");
    url.searchParams.set("apiKey", this.config.apiKey);

    this.fetchData(url.toString())
      .then((data) => {
        const obs = data?.observations?.[0];
        if (!obs) {
          Log.error("[weatherprovider.pws] No observations in response");
          return;
        }

        const currentWeather = new WeatherObject();
        const imp = obs.imperial || {};

        currentWeather.date = moment(obs.obsTimeLocal, "YYYY-MM-DD HH:mm:ss");
        currentWeather.humidity = obs.humidity;
        currentWeather.temperature = WeatherUtils.convertTemp(imp.temp ?? obs.temp, "imperial");
        currentWeather.windSpeed = WeatherUtils.convertWindToMs(imp.windSpeed ?? obs.windSpeed ?? 0);
        currentWeather.windFromDirection = obs.winddir ?? 0;
        currentWeather.weatherType = "day-sunny"; // PWS doesn't provide conditions

        // Use lat/lon from observation for sunrise/sunset
        if (obs.lat != null && obs.lon != null) {
          currentWeather.updateSunTime(obs.lat, obs.lon);
        }

        this.setCurrentWeather(currentWeather);
        this.setFetchedLocation(obs.neighborhood || obs.stationID || "PWS");
      })
      .catch((err) => Log.error("[weatherprovider.pws] Could not load data", err))
      .finally(() => this.updateAvailable());
  }
});
