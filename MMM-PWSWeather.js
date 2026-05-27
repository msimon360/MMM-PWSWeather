Module.register("MMM-PWSWeather", {
  defaults: {
    stationId: "",
    apiKey: "",
    units: "e",
    updateInterval: 300000,
    maxWindSpeed: 40
  },

  start() {
    this.weather = null;
    this.sendSocketNotification("GET_PWS_WEATHER", this.config);
    setInterval(() => {
      this.sendSocketNotification("GET_PWS_WEATHER", this.config);
    }, this.config.updateInterval);
  },

  getStyles() {
    return ["font-awesome.css"];
  },

  getTempClass(temp) {
    if (temp >= 90) return "hot";
    if (temp <= 40) return "cold";
    return "mild";
  },

  getPressureStatus(p) {
    if (p >= 30.1) return "high";
    if (p <= 29.7) return "low";
    return "steady";
  },

  getWindColor(speed) {
    if (speed < 10) return "#1dd1a1";   // green
    if (speed < 20) return "#feca57";   // yellow
    if (speed < 30) return "#ff9f43";   // orange
    return "#ff6b6b";                   // red
  },

  getWindRingSvg(speed, gust, direction) {
    const max = this.config.maxWindSpeed;

    const r1 = 22; // wind
    const r2 = 27; // gust
    const c1 = 2 * Math.PI * r1;
    const c2 = 2 * Math.PI * r2;

    const windPct = Math.min(speed / max, 1);
    const gustPct = Math.min(gust / max, 1);

    const windOffset = c1 * (1 - windPct);
    const gustOffset = c2 * (1 - gustPct);

    const windColor = this.getWindColor(speed);
    const gustColor = this.getWindColor(gust);

    return `
      <svg width="80" height="80" viewBox="0 0 80 80">
        <!-- gust ring -->
        <circle cx="40" cy="40" r="${r2}"
          stroke="#333" stroke-width="3" fill="none"/>
        <circle cx="40" cy="40" r="${r2}"
          stroke="${gustColor}" stroke-width="3" fill="none"
          stroke-dasharray="${c2}"
          stroke-dashoffset="${gustOffset}"
          transform="rotate(-90 40 40)"
          opacity="0.6"/>

        <!-- wind ring -->
        <circle cx="40" cy="40" r="${r1}"
          stroke="#333" stroke-width="4" fill="none"/>
        <circle cx="40" cy="40" r="${r1}"
          stroke="${windColor}" stroke-width="4" fill="none"
          stroke-dasharray="${c1}"
          stroke-dashoffset="${windOffset}"
          transform="rotate(-90 40 40)"/>

        <!-- direction arrow -->
        <g transform="rotate(${direction} 40 40)">
          <polygon
            points="40,12 35,24 40,20 45,24"
            fill="#ffffff"/>
        </g>

        <!-- speed text -->
        <text x="40" y="46" text-anchor="middle"
          font-size="12" fill="#ffffff">
          ${speed}
        </text>
      </svg>
    `;
  },

  getDom() {
    const wrapper = document.createElement("div");

    if (!this.weather) {
      wrapper.innerHTML = "Loading PWS weather...";
      return wrapper;
    }

    const tempClass = this.getTempClass(this.weather.temp);
    const pressureStatus = this.getPressureStatus(this.weather.pressure);
    const raining = this.weather.precipTotal > 0;

    wrapper.innerHTML = `
      <style>
        .pws { text-align: center; }

        .temp {
          font-size: 72px;
          font-weight: 300;
          margin: 10px 0;
        }
        .temp.hot { color: #ff6b6b; }
        .temp.mild { color: #feca57; }
        .temp.cold { color: #54a0ff; }

        .humidity-bar {
          height: 60px;
          width: 12px;
          border: 1px solid #666;
          margin: 10px auto;
          position: relative;
        }
        .humidity-fill {
          position: absolute;
          bottom: 0;
          width: 100%;
          background: #48dbfb;
        }

        .pressure.high { color: #1dd1a1; }
        .pressure.low { color: #ff6b6b; }
        .pressure.steady { color: #c8d6e5; }

        .wind-ring {
          margin-top: 12px;
        }

        .icon-row {
          margin-top: 8px;
        }
      </style>

      <div class="pws small">
        <div><strong>Our Weather Station</strong></div>
        <div><strong>${this.weather.neighborhood || this.weather.stationID}</strong></div>
        <div class="xsmall">${this.weather.obsTimeLocal}</div>

        <div class="temp ${tempClass}">
          ${this.weather.temp}°
        </div>

        <div class="xsmall">
          Feels ${this.weather.heatIndex}° · Dew ${this.weather.dewpt}° · Chill ${this.weather.windChill}°
        </div>

        <div class="humidity-bar">
          <div class="humidity-fill" style="height:${this.weather.humidity}%"></div>
        </div>
        <div class="xsmall">Humidity ${this.weather.humidity}%</div>

        <div class="pressure ${pressureStatus}">
          ${this.weather.pressure} inHg
        </div>

        <div class="wind-ring">
          ${this.getWindRingSvg(
            this.weather.windSpeed,
            this.weather.windGust,
            this.weather.winddir
          )}
          <div class="xsmall">
            gust ${this.weather.windGust} mph
          </div>
        </div>

        <div class="icon-row">
          <i class="fa ${raining ? "fa-cloud-rain" : "fa-cloud"}"></i>
          ${this.weather.precipTotal} in today
        </div>
      </div>
    `;

    return wrapper;
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "PWS_WEATHER_DATA") {
      this.weather = payload;
      this.updateDom();
    }
  }
});
