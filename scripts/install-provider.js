/**
 * Copy pws.js into the weather module MagicMirror actually loads.
 * Run from the module directory: npm run install-provider
 */
const fs = require("node:fs");
const path = require("node:path");

const source = path.join(__dirname, "..", "pws.js");
const target = path.resolve(__dirname, "..", "..", "..", "defaultmodules", "weather", "providers", "pws.js");

if (!fs.existsSync(path.dirname(target))) {
	console.error(`Weather providers directory not found: ${path.dirname(target)}`);
	console.error("Run this from MagicMirror/modules/MMM-PWSWeather.");
	process.exit(1);
}

fs.copyFileSync(source, target);
console.log(`Installed ${source}`);
console.log(`       -> ${target}`);
