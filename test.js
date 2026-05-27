const Module = { register: (name, config) => console.log(`✅ Module ${name} would register`) };

$(document).ready = () => {};   // fake jQuery if needed

// Now include the actual module file
require('./MMM-PWSWeather.js');

console.log("File loaded without crashing");
