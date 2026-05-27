console.log("MMM-PWSWeather node_helper LOADED", __filename);
const NodeHelper = require("node_helper");
const axios = require("axios");

module.exports = NodeHelper.create({
  socketNotificationReceived(notification, config) {
    if (notification === "GET_PWS_WEATHER") {
      this.getWeather(config);
    }
  },

  async getWeather(config) {
    console.log("MMM-PWSWeather apiKey length:", config.apiKey?.length);
    try {
      const url = `https://api.weather.com/v2/pws/observations/current`;

      const response = await axios.get(url, {
        params: {
          stationId: config.stationId,
          format: "json",
          units: config.units,
          apiKey: config.apiKey
        }
      });

      const obs = response.data.observations[0];

      const weather = {
        ...obs,  // Spread all top-level fields
        ...obs.imperial  // Spread imperial fields to top level
      };

      this.sendSocketNotification("PWS_WEATHER_DATA", weather);
    } catch (error) {
      console.error("PWS Weather error:", error.message);
    }
  }
});
