# MMM-PWSWeather

A [MagicMirror²](https://github.com/MichMich/MagicMirror) module that displays real-time weather data from your personal Weather Underground station.

## Features

- Real-time weather data from Weather Underground Personal Weather Stations
- Comprehensive weather information including:
  - Current temperature with feels-like temperature
  - Dew point and wind chill
  - Humidity and barometric pressure
  - Wind speed, gusts, and direction (compass abbreviation)
  - Precipitation rate and daily total
  - UV Index and solar radiation (when available)
  - Station location and elevation
  - Last observation time

## Installation

1. Navigate to your MagicMirror's `modules` folder:
```bash
cd ~/MagicMirror/modules
```

2. Clone this repository:
```bash
git clone https://github.com/yourusername/MMM-PWSWeather.git
```

3. Navigate to the module folder:
```bash
cd MMM-PWSWeather
```

4. Install dependencies:
```bash
npm install
```

## Configuration

Add the module to your `config/config.js` file:

```javascript
{
  module: "MMM-PWSWeather",
  position: "top_right",
  config: {
    apiKey: "your-weather-underground-api-key",
    stationId: "your-station-ID",
    updateInterval: 300000,     // Update every 5 minutes (in milliseconds)
  }
}
```

## Configuration Options

| Option | Description | Default | Required |
|--------|-------------|---------|----------|
| `apiKey` | Your Weather Underground API key | - | **Yes** |
| `stationId` | Your Weather Underground station ID | - | **Yes** |
| `updateInterval` | How often to fetch new data (milliseconds) | `300000` (5 min) | No |

## Getting a Weather Underground API Key

1. Go to [Weather Underground](https://www.wunderground.com/)
2. Sign up or log in to your account
3. Visit the [API Keys page](https://www.wunderground.com/member/api-keys)
4. Create a new API key
5. Copy the 32-character key into your config

**Important:** Make sure you copy all 32 characters of the API key. Missing even one character will cause a 401 authentication error.

## Finding Your Station ID

1. Go to [Weather Underground](https://www.wunderground.com/)
2. Search for your location
3. Find your personal weather station on the map
4. Click on it to see the Station ID (format: `KSSCCCCNNN` where SS is state, CCCC is city, NNN is number)

## Troubleshooting

### "PWS Weather error: Request failed with status code 401"

This means your API key is invalid or incorrectly entered. Check that:
- Your API key is exactly 32 characters
- There are no extra spaces or quotes in the config
- Your API key is still active on Weather Underground

### Module shows "Loading PWS weather..." but never updates

- Verify your station ID is correct
- Check that your station is actively reporting data
- Look at the console output with `npm start` for error messages
- Ensure your Raspberry Pi has internet connectivity

### No data displaying

- Confirm your station is online and reporting
- Try a different nearby station ID to test
- Check the MagicMirror logs for JavaScript errors

## License

MIT License - feel free to use and modify as needed.

## Credits

Developed for MagicMirror² using Weather Underground API.

## Contributing

Pull requests and suggestions are welcome!
