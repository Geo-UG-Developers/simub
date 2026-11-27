// SIMUB · Mapa operativo: agua (hidrantes, tomas, presas, pipas), accesos (callejones, túneles, por dónde cabe
// cada unidad), puntos de reunión, preplanes de inmuebles y riesgos; además unidades en servicio y servicios activos.
import L from 'leaflet';
import { insertar, actualizar, mando, tabla } from './datos';
import type { Ctx } from './mando';

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Punto { id: number; tipo: string; nombre: string; lat: number; lon: number; datos: Record<string, string>; notas: string | null; activo: boolean; actualizado_en: string }
export const TIPOS: Record<string, { txt: string; color: string; letra: string; campos: [string, string][] }> = {
  hidrante: { txt: 'Hidrante', color: '#1565C0', letra: 'H', campos: [['estado', 'Estado (funciona / no)'], ['presion', 'Presión o caudal']] },
  toma_agua: { txt: 'Toma de agua', color: '#0288D1', letra: 'T', campos: [['capacidad', 'Capacidad (litros)'], ['acceso', 'Cómo se accede']] },
  presa: { txt: 'Presa o cuerpo de agua', color: '#00838F', letra: 'P', campos: [['acceso', 'Acceso para succión'], ['temporada', 'Temporada con agua']] },
  pipa: { txt: 'Pipa (proveedor)', color: '#4527A0', letra: 'Pi', campos: [['capacidad', 'Capacidad (litros)'], ['contacto', 'Contacto y teléfono']] },
  acceso: { txt: 'Acceso / vialidad', color: '#E65100', letra: 'A', campos: [['ancho_m', 'Ancho (m)'], ['pasan', 'Unidades que pasan'], ['restriccion', 'Restricción (escalinata, túnel, altura)']] },
  reunion: { txt: 'Punto de reunión', color: '#2E7D32', letra: 'R', campos: [['capacidad', 'Capacidad aprox.']] },
  inmueble: { txt: 'Preplán de inmueble', color: '#6E1C22', letra: 'I', campos: [['direccion', 'Dirección'], ['uso', 'Uso (escuela, mercado, mina…)'], ['pisos', 'Pisos / niveles'],
    ['accesos', 'Accesos y salidas'], ['gas', 'Llave de gas (dónde)'], ['luz', 'Corte de luz (dónde)'], ['riesgos', 'Riesgos especiales'], ['contacto', 'Contacto y teléfono']] },
  riesgo: { txt: 'Zona de riesgo', color: '#B3261E', letra: '!', campos: [['descripcion', 'Descripción']] },
};
const icono = (t: string) => L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
  html: `<span class="pin-p" style="background:${TIPOS[t]?.color ?? '#555'};font:700 11px/26px sans-serif;color:#fff;text-align:center">${TIPOS[t]?.letra ?? '?'}</span>` });
const resumen = (p: Punto) => TIPOS[p.tipo]?.campos.map(([k, t]) => p.datos?.[k] ? `${t}: ${p.datos[k]}` : '').filter(Boolean).join(' · ') ?? '';

let cache: Punto[] | null = null;
async function puntos(fresco = false) { if (!cache || fresco) cache = (await tabla<Punto>('puntos', 'nombre').catch(() => [])).filter((p) => p.activo); return cache; }
const distKm = (a: number, b: number, c: number, d: number) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * 6371; };
/** Puntos del mapa operativo cerca de una ubicación (agua, accesos, preplanes). */
export async function puntosCercanos(lat: number, lon: number, km = 1) {
  return (await puntos()).map((p) => ({ ...p, km: distKm(lat, lon, p.lat, p.lon), tipoTxt: TIPOS[p.tipo]?.txt ?? p.tipo, resumen: resumen(p) }))
    .filter((p) => p.km <= km).sort((a, b) => a.km - b.km);
}

let visibles = new Set(Object.keys(TIPOS));
export async function vistaMapa(c: Ctx) {
  const edita = c.rol() === 'admin' || c.rol() === 'coordinador';
  c.marco('mapa', 'Mapa operativo', edita ? 'Toca el mapa para agregar un punto: agua, accesos, preplanes o riesgos.' : 'Agua, accesos, preplanes, riesgos, unidades y servicios en curso.',
    `<div class="chips-sel" id="mp-capas">${Object.entries(TIPOS).map(([k, t]) => `<button class="mchip ${visibles.has(k) ? 'on' : ''}" data-capa="${k}" style="border-color:${t.color}">${t.txt}</button>`).join('')}</div>
     <div class="mapa-op" id="mp"></div><p class="tenue chica" id="mp-cuenta"></p>`,
    `<button class="btn" id="mp-sat">Satélite</button>`);
  const mapa = c.nuevoMapa('mp'); mapa.setView([21.017, -101.257], 14);
  let sat: L.TileLayer | null = null;
  $('mp-sat').addEventListener('click', () => { if (sat) { mapa.removeLayer(sat); sat = null; return; }
    sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' }).addTo(mapa); });
  const capa = L.layerGroup().addTo(mapa), vivo = L.layerGroup().addTo(mapa);
  const pintar = async (fresco = false) => {
    const xs = await puntos(fresco); capa.clearLayers();
    for (const p of xs.filter((y) => visibles.has(y.tipo))) {
      L.marker([p.lat, p.lon], { icon: icono(p.tipo) }).addTo(capa).bindPopup(`<b>${esc(p.nombre)}</b><br><small>${esc(TIPOS[p.tipo]?.txt)}</small>
        ${TIPOS[p.tipo].campos.filter(([k]) => p.datos?.[k]).map(([k, t]) => `<br><b>${esc(t)}:</b> ${esc(p.datos[k])}`).join('')}${p.notas ? `<br>${esc(p.notas)}` : ''}
        <br><a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" rel="noopener">Cómo llegar</a>
        ${edita ? ` · <a href="#" data-editar="${p.id}">Editar</a> · <a href="#" data-quitar="${p.id}">Quitar</a>` : ''}`);
    }
    $('mp-cuenta').textContent = `${xs.length} puntos registrados.`;
  };
  const enVivo = async () => {
    const m = await mando().catch(() => null); if (!m) return; vivo.clearLayers();
    for (const s of m.servicios.filter((x) => x.lat != null)) L.circleMarker([s.lat!, s.lon!], { radius: 10, color: '#fff', weight: 2, fillColor: '#B3261E', fillOpacity: .9 })
      .addTo(vivo).bindTooltip(`Servicio #${s.folio}`);
    for (const p of m.posiciones ?? []) L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', iconSize: [40, 22], iconAnchor: [20, 11],
      html: `<span class="pin-unidad">${esc(p.unidad)}</span>` }) }).addTo(vivo).bindTooltip(`${p.unidad} · ${new Date(p.en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`);
  };
  await pintar(); enVivo(); c.ciclo(enVivo, 20000);
  $('mp-capas').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-capa]'); if (!b) return;
    visibles.has(b.dataset.capa!) ? visibles.delete(b.dataset.capa!) : visibles.add(b.dataset.capa!); b.classList.toggle('on'); pintar(); });
  const formulario = (lat: number, lon: number, p?: Punto) => {
    const tipo = p?.tipo ?? 'hidrante';
    const html = `<form class="mp-form"><label>Tipo<select name="tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${t.txt}</option>`).join('')}</select></label>
      <label>Nombre<input name="nombre" required value="${esc(p?.nombre ?? '')}"></label><div class="mp-campos"></div>
      <label>Notas<input name="notas" value="${esc(p?.notas ?? '')}"></label><button class="btn primario chico">Guardar</button></form>`;
    const pop = L.popup({ maxWidth: 320 }).setLatLng([lat, lon]).setContent(html).openOn(mapa);
    const el = pop.getElement()!; const f = el.querySelector('form')!;
    const campos = () => { const t = (f.elements.namedItem('tipo') as HTMLSelectElement).value;
      el.querySelector('.mp-campos')!.innerHTML = TIPOS[t].campos.map(([k, txt]) => `<label>${esc(txt)}<input name="d_${k}" value="${esc(p?.datos?.[k] ?? '')}"></label>`).join(''); };
    campos(); (f.elements.namedItem('tipo') as HTMLSelectElement).addEventListener('change', campos);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(f); const datos: Record<string, string> = {};
      fd.forEach((v, k) => { if (k.startsWith('d_') && String(v).trim()) datos[k.slice(2)] = String(v).trim(); });
      const fila = { tipo: fd.get('tipo'), nombre: String(fd.get('nombre')).trim(), lat: +lat.toFixed(6), lon: +lon.toFixed(6), datos, notas: String(fd.get('notas') ?? '').trim() || null };
      try { if (p) await actualizar('puntos', p.id, { ...fila, actualizado_en: new Date().toISOString() }); else await insertar('puntos', fila);
        mapa.closePopup(); c.aviso('Punto guardado.'); pintar(true); } catch { c.aviso('No se pudo guardar.', true); }
    });
  };
  if (edita) {
    mapa.on('click', (e: L.LeafletMouseEvent) => formulario(e.latlng.lat, e.latlng.lng));
    mapa.on('popupopen', (e) => {
      e.popup.getElement()?.querySelectorAll<HTMLAnchorElement>('[data-editar],[data-quitar]').forEach((a) => a.addEventListener('click', async (ev) => {
        ev.preventDefault(); const p = cache?.find((x) => x.id === +(a.dataset.editar ?? a.dataset.quitar!)); if (!p) return;
        if (a.dataset.editar) formulario(p.lat, p.lon, p);
        else if (confirm(`¿Quitar «${p.nombre}» del mapa?`)) { await actualizar('puntos', p.id, { activo: false }); mapa.closePopup(); pintar(true); }
      }));
    });
  }
}
