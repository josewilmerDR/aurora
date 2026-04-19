// Registry de proveedores externos. Cada provider expone:
//   { id, signalTypes: [...], validateConfig(config), fetchSignal?, ... }
//
// `fetchSignal` es opcional — los providers "manuales" no lo exponen.
//
// Centralizar aquí evita que las rutas y el cron conozcan nombres de
// archivos; basta con `getProvider('openweathermap')`.

const openWeatherMap = require('./openWeatherMap');
const manualSignal = require('./manualSignal');

const REGISTRY = new Map();
REGISTRY.set(openWeatherMap.id, openWeatherMap);
REGISTRY.set(manualSignal.id, manualSignal);

function getProvider(id) {
  return REGISTRY.get(id) || null;
}

function listProviders() {
  return Array.from(REGISTRY.values()).map(p => ({
    id: p.id,
    signalTypes: p.signalTypes,
    supportsFetch: typeof p.fetchSignal === 'function',
  }));
}

module.exports = { getProvider, listProviders };
