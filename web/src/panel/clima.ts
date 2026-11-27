// Tiempo atmosférico de Guanajuato capital (Open-Meteo, gratis y sin llave) y regla 30-30-30 de riesgo de incendio:
// más de 30 °C, menos de 30 % de humedad y viento de más de 30 km/h. Cada condición que se cumple sube el riesgo.
export interface Clima {
  temp: number; humedad: number; viento: number; rachas: number; codigo: number;
  maxT: number; minH: number; maxV: number; lluvia: number; en: number;
  direccion?: number; uv?: number; amanecer?: string; atardecer?: string;
  horas?: { h: string; t: number; hum: number; v: number; p: number; k: number }[];
}
const URL_CLIMA = 'https://api.open-meteo.com/v1/forecast?latitude=21.019&longitude=-101.257'
  + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code,wind_direction_10m'
  + '&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation_probability,weather_code'
  + '&daily=temperature_2m_max,relative_humidity_2m_min,wind_speed_10m_max,precipitation_probability_max,sunrise,sunset,uv_index_max'
  + '&timezone=America%2FMexico_City&forecast_days=1';

let cache: Clima | null = null;
export async function clima(): Promise<Clima | null> {
  if (cache && Date.now() - cache.en < 15 * 60000) return cache;
  try {
    const j = await (await fetch(URL_CLIMA)).json();
    cache = { temp: j.current.temperature_2m, humedad: j.current.relative_humidity_2m, viento: j.current.wind_speed_10m, rachas: j.current.wind_gusts_10m,
      codigo: j.current.weather_code, maxT: j.daily.temperature_2m_max[0], minH: j.daily.relative_humidity_2m_min[0], maxV: j.daily.wind_speed_10m_max[0],
      lluvia: j.daily.precipitation_probability_max[0] ?? 0, en: Date.now(),
      direccion: j.current.wind_direction_10m, uv: j.daily.uv_index_max?.[0], amanecer: j.daily.sunrise?.[0], atardecer: j.daily.sunset?.[0],
      horas: (j.hourly?.time ?? []).map((h: string, i: number) => ({ h, t: j.hourly.temperature_2m[i], hum: j.hourly.relative_humidity_2m[i], v: j.hourly.wind_speed_10m[i],
        p: j.hourly.precipitation_probability[i] ?? 0, k: j.hourly.weather_code[i] })) };
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

// ---------------------------------------------------------------- tarjeta grande del Centro de mando
const ICONOS: Record<string, string> = {
  sol: '<circle cx="24" cy="24" r="9" fill="#F5B301"/><g stroke="#F5B301" stroke-width="3" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2"/></g>',
  luna: '<path d="M30 6a16 16 0 1 0 12 26A13 13 0 0 1 30 6z" fill="#8C9CC8"/>',
  parcial: '<circle cx="18" cy="17" r="8" fill="#F5B301"/><g stroke="#F5B301" stroke-width="2.6" stroke-linecap="round"><path d="M18 3v4M4 17h4M8 7l2.8 2.8M28 7l-2.8 2.8"/></g><path d="M15 40h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z" fill="#C9D2DC"/>',
  parcialNoche: '<path d="M22 4a11 11 0 1 0 9 17A9 9 0 0 1 22 4z" fill="#8C9CC8"/><path d="M15 40h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z" fill="#C9D2DC"/>',
  nube: '<path d="M12 38h25a9 9 0 0 0 0-18 12 12 0 0 0-23 3 7.5 7.5 0 0 0-2 15z" fill="#AEB8C4"/>',
  lluvia: '<path d="M12 30h25a9 9 0 0 0 0-18 12 12 0 0 0-23 3 7.5 7.5 0 0 0-2 15z" fill="#8F9BA8"/><g stroke="#1E88E5" stroke-width="3" stroke-linecap="round"><path d="M16 35l-2 6M25 35l-2 6M34 35l-2 6"/></g>',
  tormenta: '<path d="M12 28h25a9 9 0 0 0 0-18 12 12 0 0 0-23 3 7.5 7.5 0 0 0-2 15z" fill="#6E7883"/><path d="M26 26l-6 10h6l-3 9 9-12h-6l3-7z" fill="#F5B301"/>',
};
const icono = (k: number, noche = false) => {
  const n = k === 0 ? (noche ? 'luna' : 'sol') : k <= 2 ? (noche ? 'parcialNoche' : 'parcial') : k <= 48 ? 'nube' : k <= 82 ? 'lluvia' : 'tormenta';
  return `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">${ICONOS[n]}</svg>`;
};
const PUNTOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const rumbo = (g?: number) => g == null ? '' : PUNTOS[Math.round(g / 45) % 8];
const hh = (f?: string) => f ? f.slice(11, 16) : '—';
/** Pronóstico del día en tres partes, con el clima que más se repite y la temperatura máxima/mínima de cada una. */
function partes(c: Clima) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const h = (c.horas ?? []).filter((x) => x.h.startsWith(hoy));
  return ([['Mañana', 6, 12, false], ['Tarde', 12, 19, false], ['Noche', 19, 24, true]] as const).map(([t, a, b, noche]) => {
    const xs = h.filter((x) => { const n = +x.h.slice(11, 13); return n >= a && n < b; });
    if (!xs.length) return { t, txt: '—', ic: '', max: null as number | null, min: null as number | null, p: 0, v: 0, hum: 0, ahora: false };
    const k = Math.max(...xs.map((x) => x.k)) > 50 ? Math.max(...xs.map((x) => x.k)) : xs.map((x) => x.k).sort((p, q) => xs.filter((x) => x.k === q).length - xs.filter((x) => x.k === p).length)[0];
    const hora = +new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', hour12: false });
    return { t, txt: cielo(k), ic: icono(k, noche), max: Math.max(...xs.map((x) => x.t)), min: Math.min(...xs.map((x) => x.t)), p: Math.max(...xs.map((x) => x.p)),
      v: Math.max(...xs.map((x) => x.v)), hum: Math.min(...xs.map((x) => x.hum)), ahora: hora >= a && hora < b };
  });
}
export function widgetClima(c: Clima | null) {
  if (!c) return '<section class="tarjeta wclima"><p class="tenue">Clima no disponible por ahora (se reintenta cada 15 min).</p></section>';
  const r = regla303030(c), noche = (() => { const h = new Date().getHours(); return h < 7 || h >= 19; })();
  const dato = (etq: string, v: string, u: string, ok?: boolean) => `<div class="wc-dato ${ok ? 'cumple' : ''}"><span>${etq}</span><b>${v}<small>${u}</small></b></div>`;
  return `<section class="tarjeta wclima">
    <div class="wc-riesgo ${r.nivel.cls}" data-clima role="button" tabindex="0" title="Ver detalle de la regla 30-30-30">
      <span>Riesgo de incendio</span><b>${r.nivel.txt}</b><small>${r.n} de 3 condiciones (30-30-30)</small>
      <ul>${[['> 30 °C', `${Math.round(r.t)} °C`], ['< 30 % humedad', `${Math.round(r.h)} %`], ['> 30 km/h viento', `${Math.round(r.v)} km/h`]]
        .map(([t, v], i) => `<li class="${r.cumple[i] ? 'si' : ''}">${r.cumple[i] ? '●' : '○'} ${t}: <b>${v}</b></li>`).join('')}</ul></div>
    <div class="wc-ahora"><div class="wc-cielo">${icono(c.codigo, noche)}<div><b class="wc-temp">${Math.round(c.temp)}<small>°C</small></b><span>${cielo(c.codigo)} · ahora</span></div></div>
      <div class="wc-datos">${dato('Temperatura', String(Math.round(c.temp)), '°C', c.temp > 30)}${dato('Humedad', String(Math.round(c.humedad)), '%', c.humedad < 30)}
        ${dato(`Viento ${rumbo(c.direccion)}`, String(Math.round(c.viento)), 'km/h', c.viento > 30)}${dato('Rachas', String(Math.round(c.rachas)), 'km/h', c.rachas > 38)}</div></div>
    <div class="wc-pron">${partes(c).map((p) => `<div class="wc-parte ${p.ahora ? 'ahora' : ''}"><span class="wc-pt">${p.t}</span>${p.ic}<b>${p.max != null ? `${Math.round(p.max)}° / ${Math.round(p.min!)}°` : '—'}</b>
        <small>${p.txt}</small><small>💧 ${p.p} % · 💨 ${Math.round(p.v)} km/h</small></div>`).join('')}</div>
    <div class="wc-extra"><span>Hoy máx. <b>${Math.round(c.maxT)} °C</b></span><span>Humedad mín. <b>${Math.round(c.minH)} %</b></span><span>Viento máx. <b>${Math.round(c.maxV)} km/h</b></span>
      <span>Lluvia <b>${c.lluvia} %</b></span>${c.uv != null ? `<span>UV máx. <b>${Math.round(c.uv)}</b></span>` : ''}<span>☀ ${hh(c.amanecer)} · 🌙 ${hh(c.atardecer)}</span>
      <span class="tenue">Open-Meteo · ${new Date(c.en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span></div>
  </section>`;
}

// ---------------------------------------------------------------- tablero de guardia (pantalla grande, fondo oscuro)
/** Clima para decidir: riesgo grande, condiciones 30-30-30, datos con unidades, viento con flecha y pronóstico del día. */
export function climaTablero(c: Clima | null) {
  if (!c) return '<div class="tb-sin">Clima no disponible · se reintenta en 15 min</div>';
  const r = regla303030(c), noche = (() => { const h = new Date().getHours(); return h < 7 || h >= 19; })();
  const flecha = c.direccion == null ? '' : `<svg class="tb-flecha" viewBox="0 0 24 24" style="transform:rotate(${(c.direccion + 180) % 360}deg)" aria-hidden="true"><path d="M12 3l5 9h-3.5v9h-3v-9H7z" fill="currentColor"/></svg>`;
  const dato = (etq: string, v: string, u: string, malo = false, extra = '') => `<div class="tb-dato ${malo ? 'malo' : ''}"><span>${etq}</span><b>${v}<small>${u}</small>${extra}</b></div>`;
  const consejo = r.n >= 3 ? 'Condiciones extremas: rutas de escape y zona segura antes de atacar; reforzar el despacho forestal.'
    : r.n === 2 ? 'Riesgo alto: avisar a unidades forestales y vigilar cambios de viento.'
    : r.n === 1 ? 'Riesgo moderado: atención a incendios de pastizal.' : 'Riesgo bajo de incendio.';
  return `<h2>Clima y riesgo de incendio</h2>
    <div class="tb-riesgo ${r.nivel.cls}"><div><span>Riesgo de incendio · regla 30-30-30</span><b>${r.nivel.txt}</b></div>
      <ul class="tb-303030">${[['>30 °C', `${Math.round(r.t)}°`], ['<30 % hum.', `${Math.round(r.h)}%`], ['>30 km/h', `${Math.round(r.v)}`]]
        .map(([t, v], i) => `<li class="${r.cumple[i] ? 'si' : ''}"><b>${v}</b>${t}</li>`).join('')}</ul></div>
    <p class="tb-consejo">${consejo}</p>
    <div class="tb-datos"><div class="tb-dato tb-temp">${icono(c.codigo, noche)}<b>${Math.round(c.temp)}<small>°C</small></b></div>
      ${dato('Humedad', String(Math.round(c.humedad)), '%', c.humedad < 30)}${dato(`Viento ${rumbo(c.direccion)}`, String(Math.round(c.viento)), 'km/h', c.viento > 30, flecha)}
      ${dato('Rachas', String(Math.round(c.rachas)), 'km/h', c.rachas > 38)}</div>
    <div class="tb-pron">${partes(c).map((p) => `<div class="${p.ahora ? 'ahora' : ''}">${p.ic}<div><span>${p.t}</span><b>${p.max != null ? `${Math.round(p.max)}°/${Math.round(p.min!)}°` : '—'}</b>
      <small>Lluvia ${p.p}% · ${Math.round(p.v)} km/h</small></div></div>`).join('')}</div>
    <p class="tb-pie-clima">${cielo(c.codigo)} · máx. ${Math.round(c.maxT)} °C · hum. mín. ${Math.round(c.minH)} %${c.uv != null ? ` · UV ${Math.round(c.uv)}` : ''} · amanece ${hh(c.amanecer)} · anochece ${hh(c.atardecer)}</p>`;
}
