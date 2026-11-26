// Tiempo atmosférico de Guanajuato capital (Open-Meteo, gratis y sin llave) y regla 30-30-30 de riesgo de incendio:
// más de 30 °C, menos de 30 % de humedad y viento de más de 30 km/h. Cada condición que se cumple sube el riesgo.
export interface Clima {
  temp: number; humedad: number; viento: number; rachas: number; codigo: number;
  maxT: number; minH: number; maxV: number; lluvia: number; en: number;
}
const URL_CLIMA = 'https://api.open-meteo.com/v1/forecast?latitude=21.019&longitude=-101.257'
  + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code'
  + '&daily=temperature_2m_max,relative_humidity_2m_min,wind_speed_10m_max,precipitation_probability_max'
  + '&timezone=America%2FMexico_City&forecast_days=1';

let cache: Clima | null = null;
export async function clima(): Promise<Clima | null> {
  if (cache && Date.now() - cache.en < 15 * 60000) return cache;
  try {
    const j = await (await fetch(URL_CLIMA)).json();
    cache = { temp: j.current.temperature_2m, humedad: j.current.relative_humidity_2m, viento: j.current.wind_speed_10m, rachas: j.current.wind_gusts_10m,
      codigo: j.current.weather_code, maxT: j.daily.temperature_2m_max[0], minH: j.daily.relative_humidity_2m_min[0], maxV: j.daily.wind_speed_10m_max[0],
      lluvia: j.daily.precipitation_probability_max[0] ?? 0, en: Date.now() };
    return cache;
  } catch { return cache; }
}

const NIVELES = [
  { txt: 'BAJO', cls: 'r0' }, { txt: 'MODERADO', cls: 'r1' }, { txt: 'ALTO', cls: 'r2' }, { txt: 'MUY ALTO', cls: 'r3' },
];
/** Cuántas condiciones del 30-30-30 se cumplen (0 a 3), con el peor momento del día. */
export function regla303030(c: Clima) {
  const t = Math.max(c.temp, c.maxT), h = Math.min(c.humedad, c.minH), v = Math.max(c.viento, c.maxV, c.rachas * 0.8);
  const cumple = [t > 30, h < 30, v > 30];
  const n = cumple.filter(Boolean).length;
  return { n, nivel: NIVELES[n], cumple, t, h, v };
}
const cielo = (k: number) => k === 0 ? 'Despejado' : k <= 3 ? 'Parcialmente nublado' : k <= 48 ? 'Nublado o neblina' : k <= 67 ? 'Lluvia' : k <= 77 ? 'Nieve' : k <= 82 ? 'Chubascos' : 'Tormenta';

/** Pastilla compacta: «24° · 35 % · 12 km/h | Incendio: BAJO 1/3». El detalle va en el título (al pasar el mouse) y al tocar. */
export function pastillaClima(c: Clima | null) {
  if (!c) return '<span class="clima sin">Clima no disponible</span>';
  const r = regla303030(c);
  const det = `${cielo(c.codigo)}. Ahora ${Math.round(c.temp)} °C, humedad ${Math.round(c.humedad)} %, viento ${Math.round(c.viento)} km/h (rachas ${Math.round(c.rachas)}). `
    + `Hoy: máx. ${Math.round(c.maxT)} °C, humedad mín. ${Math.round(c.minH)} %, viento máx. ${Math.round(c.maxV)} km/h, lluvia ${c.lluvia} %. `
    + `Regla 30-30-30: ${r.cumple[0] ? '✔' : '✘'} >30 °C · ${r.cumple[1] ? '✔' : '✘'} <30 % humedad · ${r.cumple[2] ? '✔' : '✘'} >30 km/h.`;
  return `<button type="button" class="clima" title="${det}" data-clima>
    <span>${Math.round(c.temp)}° · ${Math.round(c.humedad)} % · ${Math.round(c.viento)} km/h</span>
    <b class="riesgo ${r.nivel.cls}">Incendio ${r.nivel.txt} ${r.n}/3</b></button>`;
}
export function detalleClima(c: Clima | null) {
  if (!c) return '<p class="tenue">No se pudo obtener el clima.</p>';
  const r = regla303030(c);
  const fila = (ok: boolean, t: string, v: string) => `<li class="${ok ? 'si' : ''}"><b>${ok ? 'Sí' : 'No'}</b> ${t} <span>${v}</span></li>`;
  return `<p><b>${cielo(c.codigo)}</b> · ahora ${Math.round(c.temp)} °C, humedad ${Math.round(c.humedad)} %, viento ${Math.round(c.viento)} km/h, rachas ${Math.round(c.rachas)} km/h.
    Probabilidad de lluvia hoy: ${c.lluvia} %.</p>
    <h3>Regla 30-30-30 (peor momento del día)</h3><ul class="regla30">
    ${fila(r.cumple[0], 'Temperatura mayor a 30 °C', `${Math.round(r.t)} °C`)}${fila(r.cumple[1], 'Humedad menor a 30 %', `${Math.round(r.h)} %`)}
    ${fila(r.cumple[2], 'Viento mayor a 30 km/h', `${Math.round(r.v)} km/h`)}</ul>
    <p class="riesgo-grande ${r.nivel.cls}">Riesgo de incendio: <b>${r.nivel.txt}</b> (${r.n} de 3)</p>
    <p class="tenue chica">Regla de campo usada por CONAFOR para combatientes. Datos: Open-Meteo, se actualizan cada 15 min.
    Es una guía rápida, no sustituye el pronóstico oficial de peligro de incendio.</p>`;
}
