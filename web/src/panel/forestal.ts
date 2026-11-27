// SIMUB · Incendios forestales y de pastizal: riesgo 30-30-30, focos de calor satelitales (NASA FIRMS),
// áreas afectadas dibujadas en campo y resumen para CONAFOR.
import L from 'leaflet';
import { clima, detalleClima } from './clima';
import { guardarFirms, servicios, servicio } from './datos';
import { descargar, escribirExcel, type Celda } from './excel';
import type { Ctx } from './mando';

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const FORESTALES = ['inc_pastizal', 'inc_forestal', 'inc_baldio', 'inc_carrizos', 'inc_arbol'];
const h = (f?: string | null) => f ? new Date(f).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export async function vistaForestal(c: Ctx) {
  const anio = new Date().getFullYear();
  c.marco('forestal', 'Incendios', 'Riesgo del día, focos de calor detectados por satélite y áreas afectadas.',
    `<div class="rejilla-graf"><section class="tarjeta" id="fo-clima"><p class="tenue">Cargando clima…</p></section>
      <section class="tarjeta"><h3>Focos de calor (satélite, últimas 48 h)</h3><div id="fo-firms" class="tenue">Consultando…</div></section></div>
     <section class="tarjeta"><h3>Mapa</h3><div id="fo-mapa" class="mapa-op"></div>
       <p class="tenue chica">Puntos naranjas: focos de calor (NASA FIRMS). Rojo: áreas afectadas dibujadas en campo. Un foco no siempre es incendio (quemas agrícolas, industria): confirmar antes de despachar.</p></section>
     <section class="tarjeta"><div class="fila-tit"><h3>Servicios forestales y de pastizal ${anio}</h3><button class="btn" id="fo-xls">Resumen para CONAFOR (Excel)</button></div><div id="fo-lista"></div></section>`);
  clima().then((k) => { const e = document.getElementById('fo-clima'); if (e) e.innerHTML = `<h3>Riesgo de hoy</h3>${detalleClima(k)}`; });
  const mapa = c.nuevoMapa('fo-mapa'); mapa.setView([21.03, -101.27], 11);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Esri' }).addTo(mapa);
  // focos FIRMS
  try {
    const { dbp } = await import('./datos'); const { data: ses } = await dbp.auth.getSession();
    const { SUPABASE_URL, SUPABASE_KEY } = await import('../api');
    const r = await fetch(`${SUPABASE_URL}/functions/v1/panel`, { method: 'POST', headers: { Authorization: `Bearer ${ses.session?.access_token}`, apikey: SUPABASE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'firms' }) });
    const j = await r.json();
    if (j.error === 'sin_llave') {
      $('fo-firms').innerHTML = `<p>Falta la llave gratuita de NASA FIRMS.</p><ol class="chica"><li>Entra a <a href="https://firms.modaps.eosdis.nasa.gov/api/map_key/" target="_blank" rel="noopener">firms.modaps.eosdis.nasa.gov/api/map_key</a> y pide una llave con el correo de SIMUB (llega al instante).</li><li>Pégala aquí (solo administradores).</li></ol>
        ${c.rol() === 'admin' ? '<form class="fila-btn" id="fo-llave"><input name="k" placeholder="MAP_KEY" required><button class="btn primario">Guardar</button></form>' : ''}`;
      document.getElementById('fo-llave')?.addEventListener('submit', async (e) => { e.preventDefault(); try { await guardarFirms(String(new FormData(e.target as HTMLFormElement).get('k'))); c.aviso('Llave guardada.'); vistaForestal(c); } catch { c.aviso('No se pudo guardar.', true); } });
    } else {
      const ps = (j.puntos ?? []) as Record<string, string>[];
      for (const p of ps) L.circleMarker([+p.latitude, +p.longitude], { radius: 7, color: '#fff', weight: 1, fillColor: '#FF8F00', fillOpacity: .95 }).addTo(mapa)
        .bindPopup(`<b>Foco de calor</b><br>${esc(p.acq_date)} ${esc(String(p.acq_time).padStart(4, '0').replace(/(\d\d)(\d\d)/, '$1:$2'))} UTC<br>Satélite: ${esc(p.fuente)}<br>Confianza: ${esc(p.confidence)} · FRP ${esc(p.frp)} MW
          <br><a href="https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}" target="_blank" rel="noopener">Cómo llegar</a>`);
      $('fo-firms').innerHTML = ps.length ? `<p><b>${ps.length}</b> focos detectados en el municipio y alrededores.</p>` : '<p>Sin focos de calor detectados en las últimas 48 h.</p>';
    }
  } catch { $('fo-firms').textContent = 'No se pudo consultar NASA FIRMS.'; }
  // servicios del año con su área
  const xs = (await servicios(new Date(anio, 0, 1), new Date(anio + 1, 0, 1)).catch(() => [])).filter((s) => FORESTALES.includes(s.clasificacion) && s.estado !== 'anulado' && !s.falsa_alarma);
  const conArea = xs.filter((s) => s.estado === 'activo' || s.origen !== 'historico').slice(-40);
  for (const s of conArea) servicio(s.id).then((d) => { const g = d?.perimetro as { coordinates?: number[][][] } | undefined;
    if (g?.coordinates?.[0]) L.polygon(g.coordinates[0].map(([lo, la]) => [la, lo] as [number, number]), { color: '#B3261E', fillOpacity: .3 }).addTo(mapa).bindTooltip(`#${s.folio} · ${String(s.area_afectada ?? '').replace(/[<>&"']/g, '')}`); });
  $('fo-lista').innerHTML = `<p>${xs.length} servicios en ${anio}.</p><div class="tabla-caja"><table class="tabla"><thead><tr><th>Folio</th><th>Fecha</th><th>Tipo</th><th>Lugar</th><th>Área</th><th>Duración</th><th></th></tr></thead><tbody>
    ${xs.slice().reverse().slice(0, 80).map((s) => { const m = s.h_despacho && s.h_base ? Math.round((+new Date(s.h_base) - +new Date(s.h_despacho)) / 60000) : null;
      return `<tr><td>${s.folio}</td><td class="nw">${esc(s.fecha)}</td><td>${esc(s.especificacion ?? s.clasificacion)}</td><td>${esc([s.colonia, s.lugar].filter(Boolean).join(', '))}</td>
      <td class="nw">${esc(s.area_afectada ?? '')}</td><td class="nw">${m != null && m >= 0 ? `${Math.floor(m / 60)} h ${m % 60} min` : ''}</td><td><a class="btn chico" href="#servicio/${s.id}">Abrir</a></td></tr>`; }).join('')}</tbody></table></div>`;
  $('fo-xls').addEventListener('click', () => {
    const filas: Celda[][] = [['FOLIO', 'FECHA', 'HORA INICIO', 'HORA TÉRMINO', 'TIPO', 'VEGETACIÓN / ESPECIFICACIÓN', 'LUGAR', 'LATITUD', 'LONGITUD', 'SUPERFICIE AFECTADA', 'UNIDADES', 'PERSONAL', 'CORPORACIONES']];
    for (const s of xs) filas.push([`${s.anio}-${s.folio}`, s.fecha, h(s.h_despacho), h(s.h_base), s.clasificacion.replace('inc_', ''), s.especificacion, [s.colonia, s.lugar].filter(Boolean).join(', '),
      s.lat, s.lon, s.area_afectada, s.unidades.join(' / '), s.personal_num, Object.keys(s.apoyos ?? {}).join(', ')]);
    descargar(escribirExcel([{ nombre: `Incendios ${anio}`, filas, anchos: filas[0].map(() => 16) }]), `SIMUB_incendios_forestales_${anio}.xlsx`);
  });
}
