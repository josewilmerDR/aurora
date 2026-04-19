// PRNG determinista + sampler normal. Sin dependencias externas.
//
// Se usa para Monte Carlo: misma semilla → mismos trials, fundamental para
// reproducibilidad y tests.
//
// Algoritmo: Mulberry32 para uniforme [0,1). Box-Muller para normal(μ, σ).
//
// Rationale:
//   - Mulberry32 es rápido, simple y "good enough" para MC con N ≤ 10.000
//     trials. No es criptográficamente seguro — no aplica a este dominio.
//   - Box-Muller produce dos normales independientes por par de uniformes;
//     cacheamos la segunda para la siguiente llamada.

function createPrng(seed = 1) {
  // Normaliza la semilla a uint32 ≥ 1.
  let state = (seed >>> 0) || 1;

  // Next uniform in [0, 1).
  function nextUniform() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Cache de la segunda muestra de Box-Muller.
  let spare = null;

  // Next standard normal N(0, 1).
  function nextNormal() {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    // Box-Muller: dos uniformes en (0,1] (evitamos log(0)).
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = nextUniform();
    while (u2 === 0) u2 = nextUniform();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const z0 = mag * Math.cos(2 * Math.PI * u2);
    const z1 = mag * Math.sin(2 * Math.PI * u2);
    spare = z1;
    return z0;
  }

  // N(μ, σ).
  function nextNormalScaled(mu = 0, sigma = 1) {
    return mu + sigma * nextNormal();
  }

  return { nextUniform, nextNormal, nextNormalScaled };
}

module.exports = { createPrng };
