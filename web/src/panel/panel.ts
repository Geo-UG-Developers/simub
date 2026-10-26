// SIMUB · panel de la estación: tablero de guardia, reportes, parte de servicio,
// agenda de revisiones, informe mensual y ajustes (sin programar).
import './panel.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { I } from '../iconos';
import { FORMULARIOS, MOTIVOS_REVISION, ORDEN_TIPOS } from '../formularios';
import type { Estado } from '../api';
import { columnas, horizontales } from './graficas';
import { entregarPdf, partePdf } from './pdf';
import {
  accion, actualizar, cerrarRevision, codigos, dbp, detalle, guardarConfig, guardarParte, informe, insertar, proponerFecha,
  reportes, revisiones, tabla, urlsFotos, yo, type Detalle, type Informe, type Parte, type Reporte, type Revision, type Yo,
} from './datos';

const BASE = import.meta.env.BASE_URL;
const raiz = document.getElementById('app')!;
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fecha = (f: string) => new Date(f).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fechaLarga = (f: string) => new Date(f).toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const horaCorta = (f: string) => new Date(f).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const minutos = (f: string) => Math.max(0, Math.floor((Date.now() - new Date(f).getTime()) / 60000));
const dur = (m: number | null) => m == null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const ESTADO: Record<Estado, { txt: string; cls: string }> = {
  enviado: { txt: 'Sin ver', cls: 'p-rojo' }, visto: { txt: 'Visto', cls: 'p-dorado' }, en_camino: { txt: 'En camino', cls: 'p-ambar' },
  atendiendo: { txt: 'En el lugar', cls: 'p-ambar' }, cerrado: { txt: 'Cerrado', cls: 'p-verde' }, falso: { txt: 'Falso o duplicado', cls: 'p-gris' },
};
const SIGUIENTES: Estado[] = ['visto', 'en_camino', 'atendiendo'];
const ORDEN_E: Estado[] = ['enviado', 'visto', 'en_camino', 'atendiendo', 'cerrado'];
const ES_CIERRE = (e: Estado) => e === 'cerrado' || e === 'falso';
const ESTADO_REV: Record<string, { txt: string; cls: string }> = {
  solicitada: { txt: 'Por agendar', cls: 'p-rojo' }, propuesta: { txt: 'Fecha propuesta', cls: 'p-ambar' },
  confirmada: { txt: 'Confirmada', cls: 'p-verde' }, realizada: { txt: 'Realizada', cls: 'p-gris' }, cancelada: { txt: 'Cancelada', cls: 'p-gris' },
};
const MOT = Object.fromEntries(MOTIVOS_REVISION);
const ERRORES: Record<string, string> = {
  solo_admin: 'Solo un administrador puede cerrar un reporte.', transicion_invalida: 'Ese estado ya se había marcado.',
  cerrado: 'Este reporte ya está cerrado.', tiempo_vencido: 'Ya pasaron 2 minutos; ese cambio ya no se puede deshacer.',
  sin_permiso: 'Tu cuenta no tiene permiso para esto.', fecha_pasada: 'La fecha ya pasó.',
};
const ROL_TXT = { admin: 'Administrador', coordinador: 'Coordinación', guardia: 'Guardia' };

let mio: Yo | null = null;
let correo = '';
let mapa: L.Map | null = null;
let ciclo: number | undefined;
let reloj: number | undefined;

function aviso(txt: string, error = false) {
  const t = document.createElement('div');
  t.className = `toast ${error ? 'error' : ''}`; t.setAttribute('role', 'status'); t.textContent = txt;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4500);
}
function limpiar() {
  document.querySelector('.cajon-fondo')?.remove();
  if (mapa) { mapa.remove(); mapa = null; }
  if (ciclo) { clearInterval(ciclo); ciclo = undefined; }
  if (reloj) { clearInterval(reloj); reloj = undefined; }
  alarma.parar(); document.body.classList.remove('modo-guardia');
}
const capaBase = (m: L.Map) => {
  m.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
};
const pinTipo = (r: { tipo: keyof typeof FORMULARIOS; estado: Estado }) => L.divIcon({
  className: '', iconSize: [30, 30], iconAnchor: [15, 15],
  html: `<span class="pin-p ${r.estado === 'enviado' ? 'parpadea' : ''}" style="background:${FORMULARIOS[r.tipo].color}">${I[r.tipo](16)}</span>`,
});

// ---------------------------------------------------------------- alarma (Web Audio, sin archivos)
const alarma = {
  ctx: null as AudioContext | null, timer: 0 as number | undefined, silencioHasta: 0,
  activar() {
    try { this.ctx ??= new AudioContext(); void this.ctx.resume(); } catch { this.ctx = null; }
  },
  sonar() {
    if (!this.ctx || Date.now() < this.silencioHasta) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(880, t0 + i * 0.5); o.frequency.linearRampToValueAtTime(660, t0 + i * 0.5 + 0.4);
      g.gain.setValueAtTime(0.0001, t0 + i * 0.5); g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.5 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.5 + 0.42);
      o.connect(g).connect(this.ctx.destination); o.start(t0 + i * 0.5); o.stop(t0 + i * 0.5 + 0.45);
    }
  },
  iniciar() { if (this.timer) return; this.sonar(); this.timer = window.setInterval(() => this.sonar(), 5000); },
  parar() { if (this.timer) { clearInterval(this.timer); this.timer = undefined; } },
};
let wakeLock: { release(): Promise<void> } | null = null;
async function pantallaEncendida() {
  try { wakeLock = await (navigator as unknown as { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen'); } catch { /* no soportado */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeLock) pantallaEncendida(); });

// ---------------------------------------------------------------- acceso
function pantallaAcceso(mensaje = '') {
  limpiar();
  raiz.innerHTML = `
  <main class="acceso"><form class="caja-acceso" id="form">
    <img src="${BASE}escudo-192.png" alt="" class="escudo-acc"><h1>Panel de la estación</h1>
    <p class="tenue">Bomberos SIMUB Voluntarios, A.C.</p>
    <label>Correo<input type="email" id="correo" autocomplete="username" required></label>
    <label>Contraseña<input type="password" id="clave" autocomplete="current-password" required></label>
    ${mensaje ? `<p class="error-txt" role="alert">${esc(mensaje)}</p>` : ''}
    <button class="btn primario" type="submit">Entrar</button>
    <p class="tenue chica">Las cuentas las da de alta el administrador de SIMUB.</p>
    <p class="credito"><img src="${BASE}geoug.png" alt=""> GEO UG Developers</p>
  </form></main>`;
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await dbp.auth.signInWithPassword({ email: $<HTMLInputElement>('correo').value.trim(), password: $<HTMLInputElement>('clave').value });
    if (error) return pantallaAcceso('Correo o contraseña incorrectos.');
    iniciar();
  });
}
async function iniciar() {
  const { data } = await dbp.auth.getSession();
  if (!data.session || data.session.user.is_anonymous) return pantallaAcceso();
  correo = data.session.user.email ?? '';
  try { mio = await yo(); } catch { mio = null; }
  if (!mio) {
    raiz.innerHTML = `<main class="acceso"><div class="caja-acceso"><h1>Cuenta sin permiso</h1>
      <p class="tenue">Tu cuenta (${esc(correo)}) todavía no está dada de alta en el panel. Pide al administrador que te agregue.</p>
      <button class="btn" id="salir">Salir</button></div></main>`;
    $('salir').addEventListener('click', salir); return;
  }
  ir();
}
async function salir() { limpiar(); await dbp.auth.signOut(); mio = null; history.replaceState(null, '', location.pathname); pantallaAcceso(); }

// ---------------------------------------------------------------- marco
const SECCIONES = [
  { id: 'guardia', txt: 'Tablero de guardia', ic: I.campana },
  { id: 'reportes', txt: 'Reportes', ic: I.lista },
  { id: 'agenda', txt: 'Revisiones', ic: I.calendario },
  { id: 'informe', txt: 'Informe mensual', ic: I.noticias },
  { id: 'ajustes', txt: 'Ajustes', ic: I.escudo, admin: true },
];
function marco(activa: string, titulo: string, sub: string, contenido: string, acciones = '') {
  raiz.innerHTML = `
  <div class="marco">
    <aside class="lateral">
      <a class="logo" href="#reportes"><img src="${BASE}escudo-192.png" alt=""><span><b>SIMUB</b><small>Panel de la estación</small></span></a>
      <nav aria-label="Secciones">${SECCIONES.filter((s) => !s.admin || mio!.rol === 'admin').map((s) =>
        `<a href="#${s.id}" class="${s.id === activa ? 'on' : ''}" ${s.id === activa ? 'aria-current="page"' : ''}>${s.ic(18)}<span>${s.txt}</span><em id="n-${s.id}"></em></a>`).join('')}</nav>
      <div class="pie-lateral"><b>${esc(mio!.nombre || correo)}</b><span>${ROL_TXT[mio!.rol]}</span>
        ${mio!.alertas_vinculado ? '' : '<span class="alerta-txt">Falta vincular el grupo de Telegram</span>'}
        <button class="btn salir-lat" id="salir">Cerrar sesión</button>
        <span class="credito"><img src="${BASE}geoug-clara.png" alt=""> GEO UG Developers</span></div>
    </aside>
    <main class="contenido">
      <header class="cabecera"><div><h1>${titulo}</h1><p class="tenue">${sub}</p></div><div class="acciones">${acciones}</div></header>
      ${contenido}
    </main>
  </div>`;
  $('salir').addEventListener('click', salir);
  revisiones(new Date(Date.now() - 864e5)).then((vs) => {
    const n = vs.filter((v) => v.estado === 'solicitada').length; const e = document.getElementById('n-agenda'); if (e) e.textContent = n ? String(n) : '';
  }).catch(() => {});
}

// ================================================================ TABLERO DE GUARDIA
function vistaGuardia() {
  document.body.classList.add('modo-guardia');
  raiz.innerHTML = `
  <div class="guardia">
    <header class="g-barra">
      <img src="${BASE}escudo-192.png" alt=""><div class="g-tit"><b>SIMUB · GUARDIA</b><span id="g-estado-red">Conectando…</span></div>
      <span class="g-reloj" id="g-reloj"></span>
      <button class="btn g-btn" id="g-activar">${I.campana(18)} Activar tablero</button>
      <button class="btn g-btn" id="g-silencio" hidden>Silenciar 1 min</button>
      <button class="btn g-btn" id="g-pantalla">Pantalla completa</button>
      <a class="btn g-btn" href="#reportes">Salir</a>
    </header>
    <div class="g-cuerpo">
      <section class="g-lista" id="g-lista" aria-live="polite"></section>
      <section class="g-mapa"><div id="mapa"></div></section>
    </div>
    <footer class="g-pie" id="g-pie"></footer>
  </div>`;
  const pintarReloj = () => { const e = document.getElementById('g-reloj'); if (e) e.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  pintarReloj(); reloj = window.setInterval(pintarReloj, 1000);
  mapa = L.map('mapa', { zoomControl: true }).setView([21.019, -101.257], 13); capaBase(mapa);
  const capa = L.layerGroup().addTo(mapa);
  let activado = false;
  $('g-activar').addEventListener('click', () => {
    alarma.activar(); pantallaEncendida(); activado = true;
    $('g-activar').hidden = true; $('g-silencio').hidden = false; aviso('Tablero activo: sonará la alarma con cada reporte nuevo.');
    cargar();
  });
  $('g-silencio').addEventListener('click', () => { alarma.silencioHasta = Date.now() + 60000; aviso('Alarma en silencio 1 minuto.'); });
  $('g-pantalla').addEventListener('click', () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); });

  let primeraVez = true;
  const cargar = async () => {
    let xs: Reporte[], vs: Revision[];
    try { [xs, vs] = await Promise.all([reportes(new Date(Date.now() - 864e5)), revisiones(new Date(Date.now() - 864e5))]); }
    catch { $('g-estado-red').innerHTML = '<span class="sin-red">SIN CONEXIÓN · revisa el internet</span>'; return; }
    $('g-estado-red').textContent = `En línea · actualizado ${horaCorta(new Date().toISOString())}`;
    const activos = xs.filter((r) => !ES_CIERRE(r.estado));
    const nuevos = activos.filter((r) => r.estado === 'enviado');
    if (nuevos.length && activado) alarma.iniciar(); else alarma.parar();
    document.title = nuevos.length ? `(${nuevos.length}) NUEVO · SIMUB` : 'SIMUB · Guardia';
    $('g-lista').innerHTML = activos.length ? activos.map((r) => {
      const f = FORMULARIOS[r.tipo], m = minutos(r.creado_en);
      const nivel = r.estado !== 'enviado' ? '' : m >= 10 ? 'rojo' : m >= 5 ? 'ambar' : 'verde';
      return `<article class="g-tarjeta ${r.estado === 'enviado' ? 'nuevo' : ''}" style="--c:${f.color}">
        <span class="g-ic" style="background:${f.color}">${I[r.tipo](30)}</span>
        <div class="g-info"><b>${esc(f.nombre)}</b><span>${esc(r.folio)} · ${horaCorta(r.creado_en)}${r.referencia ? ` · ${esc(r.referencia)}` : ''}</span>
          <span class="g-res">${esc((r.detalles.resumen ?? []).slice(0, 2).join(' · '))}</span></div>
        <div class="g-der"><span class="g-min ${nivel}">${m} min</span><em class="pill ${ESTADO[r.estado].cls}">${ESTADO[r.estado].txt}</em>
          ${r.estado === 'enviado' ? `<button class="btn g-enterado" data-ent="${r.id}">Enterado</button>` : ''}</div></article>`;
    }).join('') : `<div class="g-vacio">${I.check(48)}<b>Sin reportes activos</b><span>La alarma sonará cuando llegue uno nuevo.</span></div>`;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const cerradosHoy = xs.filter((r) => ES_CIERRE(r.estado) && new Date(r.actualizado_en) >= hoy).length;
    const sinParte = xs.filter((r) => r.estado === 'cerrado' && !r.tiene_parte).length;
    const porAgendar = vs.filter((v) => v.estado === 'solicitada').length;
    const proximas = vs.filter((v) => v.estado === 'confirmada' && v.fecha && new Date(v.fecha) > new Date()).sort((a, b) => a.fecha!.localeCompare(b.fecha!));
    $('g-pie').innerHTML = `<span><b>${activos.length}</b> activos</span><span><b>${cerradosHoy}</b> cerrados hoy</span>
      <span class="${sinParte ? 'pendiente' : ''}"><b>${sinParte}</b> sin parte de servicio</span>
      <span class="${porAgendar ? 'pendiente' : ''}"><b>${porAgendar}</b> revisiones por agendar</span>
      ${proximas[0] ? `<span>Próxima revisión: <b>${fecha(proximas[0].fecha!)}</b>${proximas[0].asignado ? ` · ${esc(proximas[0].asignado)}` : ''}</span>` : ''}`;
    capa.clearLayers();
    const pts: L.LatLngTuple[] = [];
    for (const r of activos) { L.marker([r.lat, r.lon], { icon: pinTipo(r) }).addTo(capa).bindTooltip(`${FORMULARIOS[r.tipo].nombre} · ${r.folio}`); pts.push([r.lat, r.lon]); }
    if (pts.length && primeraVez) { mapa?.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 15 }); primeraVez = false; }
    raiz.querySelectorAll<HTMLButtonElement>('[data-ent]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Marcando…';
      try { await accion({ accion: 'estado', reporte: b.dataset.ent, estado: 'visto' }); aviso('Marcado como visto. Ya se le avisó a quien reportó.'); }
      catch (e) { aviso(ERRORES[(e as Error).message] ?? 'No se pudo marcar.', true); }
      cargar();
    }));
  };
  cargar(); ciclo = window.setInterval(cargar, 10000);
}

// ================================================================ REPORTES
let seleccion: string | null = null;
async function vistaReportes(id?: string) {
  if (id) seleccion = id;
  marco('reportes', 'Reportes', 'Activos y de los últimos 30 días. Se actualiza solo cada 20 segundos.',
    `<div class="kpis" id="kpis"></div>
     <div class="dos-col"><section class="panel-lista"><div class="filtro-ch" id="filtro"></div><div id="lista" class="lista"></div></section>
     <section class="panel-det"><div id="mapa" class="mapa-chico"></div><div id="detalle"></div></section></div>`,
    `<a class="btn" href="#guardia">${I.campana(16)} Abrir tablero de guardia</a>`);
  mapa = L.map('mapa').setView([21.019, -101.257], 12); capaBase(mapa);
  const capa = L.layerGroup().addTo(mapa);
  let filtro: 'activos' | 'todos' | 'sin_parte' = 'activos';
  let xs: Reporte[] = [];
  const pintar = () => {
    const vis = xs.filter((r) => filtro === 'todos' ? true : filtro === 'activos' ? !ES_CIERRE(r.estado) : r.estado === 'cerrado' && !r.tiene_parte);
    $('filtro').innerHTML = ([['activos', 'Activos'], ['sin_parte', 'Sin parte'], ['todos', 'Todos (30 días)']] as const).map(([k, t]) =>
      `<button class="chip ${filtro === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('');
    raiz.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.f as typeof filtro; pintar(); }));
    $('lista').innerHTML = vis.length ? vis.map((r) => { const f = FORMULARIOS[r.tipo]; return `
      <button class="fila ${seleccion === r.id ? 'sel' : ''}" data-id="${r.id}"><span class="ic-t" style="background:${f.color}">${I[r.tipo](18)}</span>
      <span class="f-info"><b>${esc(f.nombre)}</b><small>${esc(r.folio)} · ${fecha(r.creado_en)}${r.escalado ? ' · <span class="alerta-txt">escalado</span>' : ''}</small></span>
      <span class="f-der"><em class="pill ${ESTADO[r.estado].cls}">${ESTADO[r.estado].txt}</em>${r.estado === 'cerrado' && !r.tiene_parte ? '<small class="alerta-txt">sin parte</small>' : ''}</span></button>`; }).join('')
      : '<p class="tenue vacio-l">No hay reportes en esta vista.</p>';
    raiz.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => b.addEventListener('click', () => { seleccion = b.dataset.id!; pintar(); pintarDetalle(seleccion, true); }));
    capa.clearLayers();
    for (const r of vis) L.marker([r.lat, r.lon], { icon: pinTipo(r) }).addTo(capa).on('click', () => { seleccion = r.id; pintar(); pintarDetalle(r.id, false); });
    const act = xs.filter((r) => !ES_CIERRE(r.estado));
    const cerr = xs.filter((r) => r.estado === 'cerrado');
    const med = (a: (number | null)[]) => { const v = a.filter((x): x is number => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
    $('kpis').innerHTML = `<div class="kpi"><span>Activos</span><b>${act.length}</b></div>
      <div class="kpi"><span>Sin ver</span><b class="${act.some((r) => r.estado === 'enviado') ? 'rojo' : ''}">${act.filter((r) => r.estado === 'enviado').length}</b></div>
      <div class="kpi"><span>Tiempo típico a «Visto»</span><b>${dur(med(xs.map((r) => r.min_a_visto)))}</b></div>
      <div class="kpi"><span>Cerrados sin parte</span><b>${cerr.filter((r) => !r.tiene_parte).length}</b></div>`;
    const n = document.getElementById('n-reportes'); if (n) n.textContent = act.length ? String(act.length) : '';
  };
  const cargar = async () => {
    try { xs = await reportes(new Date(Date.now() - 30 * 864e5)); pintar(); } catch { aviso('Sin conexión con el servidor.', true); }
  };
  await cargar();
  if (seleccion) pintarDetalle(seleccion, true); else $('detalle').innerHTML = `<div class="vacio-det">${I.pin(28)}<p>Elige un reporte para ver fotos, datos y cambiar su estado.</p></div>`;
  ciclo = window.setInterval(cargar, 20000);
}

let confirmando: Estado | null = null;
async function pintarDetalle(id: string, centrar: boolean) {
  const caja = $('detalle'); if (!caja) return;
  let d: Detalle | null;
  try { d = await detalle(id); } catch { d = null; }
  if (!d) { caja.innerHTML = '<p class="tenue">No se encontró el reporte.</p>'; return; }
  const f = FORMULARIOS[d.tipo];
  if (centrar) mapa?.setView([d.lat, d.lon], 15);
  const admin = mio!.rol === 'admin';
  const sig = SIGUIENTES.filter((e) => ORDEN_E.indexOf(e) > ORDEN_E.indexOf(d!.estado));
  caja.innerHTML = `
    <div class="det-cab"><span class="ic-t grande" style="background:${f.color}">${I[d.tipo](22)}</span>
      <div><h2>${esc(f.nombre)}</h2><span class="tenue">${esc(d.folio)} · ${fechaLarga(d.creado_en)}</span></div><em class="pill ${ESTADO[d.estado].cls}">${ESTADO[d.estado].txt}</em></div>
    <div id="fotos" class="fotos-det"></div>
    ${(d.detalles.resumen ?? []).length ? `<ul class="resumen">${d.detalles.resumen!.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${d.comentario ? `<blockquote>«${esc(d.comentario)}»</blockquote>` : ''}
    ${d.agregados.map((a) => `<blockquote class="agregado"><small>Agregado ${horaCorta(a.en)}</small>«${esc(a.texto)}»</blockquote>`).join('')}
    <dl class="datos">
      <dt>Referencia</dt><dd>${esc(d.referencia ?? '—')}</dd>
      <dt>Reporta</dt><dd>${d.anonimo ? 'Anónimo' : esc(d.nombre ?? 'Sin nombre')}</dd>
      <dt>Teléfono</dt><dd>${d.telefono ? `<a href="tel:${esc(d.telefono)}">${esc(d.telefono)}</a>` : '—'}</dd>
      <dt>Ubicación</dt><dd><a href="https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lon}" target="_blank" rel="noopener">Abrir ruta en Google Maps</a>${d.precision_m ? ` · ±${d.precision_m} m` : ''}</dd>
    </dl>
    ${!ES_CIERRE(d.estado) ? `<div class="acciones-det">
      ${sig.map((e) => `<button class="btn" data-e="${e}">${ESTADO[e].txt}</button>`).join('')}
      ${admin ? `<button class="btn rojo" data-e="cerrado">Cerrar</button><button class="btn" data-e="falso">Falso</button>` : '<span class="tenue chica">Cerrar lo hace un administrador.</span>'}</div>` : ''}
    ${confirmando ? `<div class="confirmar"><b>¿Confirmas ${confirmando === 'cerrado' ? 'CERRAR' : 'marcar como FALSO'} este reporte?</b>
      <div><button class="btn rojo" id="si">Sí, confirmar</button><button class="btn" id="no">Cancelar</button></div></div>` : ''}
    ${d.puede_deshacer ? '<button class="btn tenue-btn" id="deshacer">Deshacer último cambio (2 min)</button>' : ''}
    ${!d.tg_message_id && !ES_CIERRE(d.estado) ? '<button class="btn" id="reenviar">Enviar al grupo de Telegram</button>' : ''}
    ${d.estado === 'cerrado' ? `<a class="btn ${d.parte ? '' : 'primario'}" href="#parte/${d.id}">${d.parte ? 'Ver o editar parte de servicio' : 'Llenar parte de servicio'}</a>` : ''}
    <h3>Historial</h3><ol class="hist"><li><b>Enviado</b> · ${horaCorta(d.creado_en)}</li>${d.historial.map((h) => `<li><b>${ESTADO[h.estado].txt}</b>${h.actor ? ` por ${esc(h.actor)}` : ''} · ${horaCorta(h.en)}</li>`).join('')}</ol>`;
  urlsFotos(d.fotos).then((us) => { const e = document.getElementById('fotos'); if (e) e.innerHTML = us.map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Foto del reporte"></a>`).join(''); });
  const cambiar = async (e: Estado) => {
    try { await accion({ accion: 'estado', reporte: id, estado: e }); aviso(`Marcado: ${ESTADO[e].txt}.`); }
    catch (err) { aviso(ERRORES[(err as Error).message] ?? 'No se pudo cambiar el estado.', true); }
    confirmando = null; pintarDetalle(id, false);
  };
  caja.querySelectorAll<HTMLButtonElement>('[data-e]').forEach((b) => b.addEventListener('click', () => {
    const e = b.dataset.e as Estado; if (ES_CIERRE(e)) { confirmando = e; pintarDetalle(id, false); } else cambiar(e);
  }));
  document.getElementById('si')?.addEventListener('click', () => cambiar(confirmando!));
  document.getElementById('no')?.addEventListener('click', () => { confirmando = null; pintarDetalle(id, false); });
  document.getElementById('reenviar')?.addEventListener('click', async () => {
    try { await accion({ accion: 'reenviar', reporte: id }); aviso('Enviado al grupo de alertas.'); } catch { aviso('No se pudo enviar. ¿Está vinculado el grupo?', true); }
    pintarDetalle(id, false);
  });
  document.getElementById('deshacer')?.addEventListener('click', async () => {
    try { await accion({ accion: 'deshacer', reporte: id }); aviso('Cambio deshecho.'); } catch (e) { aviso(ERRORES[(e as Error).message] ?? 'No se pudo deshacer.', true); }
    pintarDetalle(id, false);
  });
}

// ================================================================ PARTE DE SERVICIO
async function vistaParte(id: string) {
  marco('reportes', 'Parte de servicio', '', '<div id="parte"><p class="tenue">Cargando…</p></div>',
    '<a class="btn" href="#reportes">Volver a reportes</a>');
  let d: Detalle | null = null;
  const [unidades, personal] = await Promise.all([tabla<{ nombre: string; activa: boolean }>('unidades', 'nombre').catch(() => []),
    tabla<{ nombre: string; cargo: string | null; activo: boolean }>('personal', 'nombre').catch(() => [])]);
  try { d = await detalle(id); } catch { d = null; }
  if (!d) { $('parte').innerHTML = '<p class="tenue">No se encontró el reporte.</p>'; return; }
  const f = FORMULARIOS[d.tipo];
  const p: Partial<Parte> = d.parte ?? {};
  const ev = (e: Estado) => d!.historial.find((h) => h.estado === e)?.en;
  const v = (k: keyof Parte) => esc(p[k] ?? '');
  const hora = (k: 'hora_salida' | 'hora_llegada' | 'hora_retorno', def?: string) => { const x = p[k] ?? def; return x ? localInput(new Date(x)) : ''; };
  const elegidos = new Set(p.personal ?? []);
  $('parte').innerHTML = `
  <form class="parte" id="form-parte">
    <div class="parte-cab solo-impresion"><img src="${BASE}escudo-192.png" alt=""><div><b>BOMBEROS SIMUB VOLUNTARIOS, A.C.</b><span>Parte de servicio</span></div></div>
    <section class="bloque"><div class="rejilla-3">
      <div><span class="etq">Folio</span><b>${esc(d.folio)}</b></div><div><span class="etq">Tipo</span><b>${esc(f.nombre)}</b></div>
      <div><span class="etq">Reporte recibido</span><b>${fechaLarga(d.creado_en)}</b></div></div>
      ${(d.detalles.resumen ?? []).length ? `<p class="tenue">${esc(d.detalles.resumen!.join(' · '))}</p>` : ''}
      <p class="tenue">Ubicación: ${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}${d.referencia ? ` · ${esc(d.referencia)}` : ''}</p></section>
    <section class="bloque"><h3>Salida</h3><div class="rejilla-3">
      <label>Unidad<input list="lista-unidades" name="unidad" value="${v('unidad')}" placeholder="Ej. Unidad 1"></label>
      <label>Hora de salida<input type="datetime-local" name="hora_salida" value="${hora('hora_salida', ev('en_camino'))}"></label>
      <label>Hora de llegada<input type="datetime-local" name="hora_llegada" value="${hora('hora_llegada', ev('atendiendo'))}"></label>
      <label>Hora de regreso<input type="datetime-local" name="hora_retorno" value="${hora('hora_retorno', ev('cerrado'))}"></label>
      <label>Folio 911 <small>(si hay)</small><input name="folio_911" value="${v('folio_911')}"></label>
      <label>Responsable del servicio<input name="responsable" value="${v('responsable')}" placeholder="Nombre de quien firma"></label></div>
      <datalist id="lista-unidades">${unidades.filter((u) => u.activa).map((u) => `<option value="${esc(u.nombre)}">`).join('')}</datalist></section>
    <section class="bloque"><h3>Personal que acudió</h3>
      ${personal.length ? `<div class="chips-p">${personal.filter((x) => x.activo).map((x) => `<label class="chip-p"><input type="checkbox" name="personal" value="${esc(x.nombre)}" ${elegidos.has(x.nombre) ? 'checked' : ''}>${esc(x.nombre)}${x.cargo ? ` <small>${esc(x.cargo)}</small>` : ''}</label>`).join('')}</div>` : ''}
      <label>Otros (separados por coma)<input name="personal_otros" value="${esc([...elegidos].filter((n) => !personal.some((x) => x.nombre === n)).join(', '))}"></label></section>
    <section class="bloque"><h3>Atención</h3>
      <label>Qué se hizo<textarea name="acciones" rows="3">${v('acciones')}</textarea></label>
      <div class="rejilla-4">
        <label>Agua usada (litros)<input type="number" min="0" name="agua_litros" value="${v('agua_litros')}"></label>
        <label>Extintores<input type="number" min="0" name="extintores" value="${v('extintores')}"></label>
        <label>Personas lesionadas<input type="number" min="0" name="lesionados" value="${v('lesionados')}"></label>
        <label>Traslados en ambulancia<input type="number" min="0" name="traslados" value="${v('traslados')}"></label></div>
      <div class="rejilla-3">
        <label>Causa probable<input name="causa" value="${v('causa')}"></label>
        <label>Daños materiales<input name="danos" value="${v('danos')}"></label>
        <label>Autoridades presentes<input name="autoridades" value="${v('autoridades')}" placeholder="Ej. Tránsito, PC municipal"></label></div>
      <label>Observaciones<textarea name="observaciones" rows="2">${v('observaciones')}</textarea></label></section>
    <div class="firma solo-impresion"><span>Firma del responsable</span></div>
    <div class="pie-parte no-imprimir">
      <button class="btn primario" type="submit">Guardar parte</button>
      <button class="btn" type="button" id="pdf-parte">Descargar PDF</button>
      <button class="btn tenue-btn" type="button" id="imprimir">Imprimir</button>
      ${d.parte?.actualizado_en ? `<span class="tenue">Guardado ${fecha(d.parte.actualizado_en)}</span>` : ''}</div>
  </form>`;
  const form = $<HTMLFormElement>('form-parte');
  const recolectar = () => {
    const fd = new FormData(form);
    const otros = String(fd.get('personal_otros') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const datos: Record<string, unknown> = {};
    for (const k of ['unidad', 'acciones', 'agua_litros', 'extintores', 'lesionados', 'traslados', 'danos', 'causa', 'autoridades', 'folio_911', 'observaciones', 'responsable']) datos[k] = String(fd.get(k) ?? '').trim();
    for (const k of ['hora_salida', 'hora_llegada', 'hora_retorno']) { const x = String(fd.get(k) ?? ''); datos[k] = x ? new Date(x).toISOString() : ''; }
    datos.personal = [...fd.getAll('personal').map(String), ...otros];
    return datos;
  };
  const guardar = async () => {
    try { await guardarParte(id, recolectar()); return true; }
    catch (err) { aviso(ERRORES[(err as Error).message] ?? 'No se pudo guardar.', true); return false; }
  };
  form.addEventListener('submit', async (e) => { e.preventDefault(); if (await guardar()) { aviso('Parte de servicio guardado.'); vistaParte(id); } });
  $('imprimir').addEventListener('click', () => window.print());
  $('pdf-parte').addEventListener('click', async () => {
    const b = $<HTMLButtonElement>('pdf-parte'); b.disabled = true; b.textContent = 'Generando PDF…';
    if (await guardar()) {
      const datos = recolectar();
      const txt = Object.fromEntries(Object.entries(datos).map(([k, x]) => [k, Array.isArray(x) ? x.join(', ') : String(x ?? '')]));
      try { const { blob, nombre } = await partePdf(d!, txt, datos.personal as string[], `${BASE}escudo-192.png`); await entregarPdf(blob, nombre); aviso('Parte guardado y PDF listo.'); }
      catch { aviso('No se pudo generar el PDF.', true); }
    }
    b.disabled = false; b.textContent = 'Descargar PDF';
  });
}

// ================================================================ AGENDA DE REVISIONES
let semana = 0;
async function vistaAgenda(id?: string) {
  const puede = mio!.rol !== 'guardia';
  marco('agenda', 'Revisiones de seguridad', 'Solicitudes de visita (no son emergencias). Propón fecha y la persona la confirma desde su app.',
    `<div class="dos-col agenda"><section class="panel-lista"><h3>Por atender</h3><div id="pendientes" class="lista"></div></section>
     <section><div class="sem-nav"><button class="btn" id="ant">‹ Semana anterior</button><b id="sem-tit"></b><button class="btn" id="sig">Semana siguiente ›</button></div>
     <div id="calendario" class="calendario"></div></section></div>`);
  let vs: Revision[] = [];
  try { vs = await revisiones(new Date(Date.now() - 90 * 864e5)); } catch { aviso('Sin conexión.', true); }
  const pend = vs.filter((v) => ['solicitada', 'propuesta'].includes(v.estado));
  $('pendientes').innerHTML = pend.length ? pend.map((v) => `<button class="fila" data-rev="${v.id}"><span class="ic-t" style="background:#7A5A17">${I.revision(18)}</span>
    <span class="f-info"><b>${esc(v.nombre)}</b><small>${esc(v.motivos.map((m) => MOT[m] ?? m).join(', '))}</small><small>${esc(v.horario_preferido ?? '')}</small></span>
    <em class="pill ${ESTADO_REV[v.estado].cls}">${ESTADO_REV[v.estado].txt}</em></button>`).join('') : '<p class="tenue vacio-l">Nada pendiente.</p>';
  const lunes = new Date(); lunes.setHours(0, 0, 0, 0); lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7) + semana * 7);
  const dias = [...Array(7)].map((_, i) => new Date(lunes.getTime() + i * 864e5));
  $('sem-tit').textContent = `${dias[0].toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${dias[6].toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  $('calendario').innerHTML = dias.map((d) => {
    const del = vs.filter((v) => v.fecha && new Date(v.fecha).toDateString() === d.toDateString()).sort((a, b) => a.fecha!.localeCompare(b.fecha!));
    const hoy = d.toDateString() === new Date().toDateString();
    return `<div class="dia ${hoy ? 'hoy' : ''}"><b>${d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })}</b>
      ${del.map((v) => `<button class="cita ${v.estado}" data-rev="${v.id}"><span>${horaCorta(v.fecha!)}</span>${esc(v.nombre)}<small>${ESTADO_REV[v.estado].txt}</small></button>`).join('')}</div>`;
  }).join('');
  $('ant').addEventListener('click', () => { semana--; vistaAgenda(); });
  $('sig').addEventListener('click', () => { semana++; vistaAgenda(); });
  raiz.querySelectorAll<HTMLButtonElement>('[data-rev]').forEach((b) => b.addEventListener('click', () => abrirRevision(vs.find((v) => v.id === b.dataset.rev)!, puede)));
  if (id) { const v = vs.find((x) => x.id === id); if (v) abrirRevision(v, puede); }
}

const CHECKS = ['Instalación de gas', 'Instalación eléctrica', 'Extintores', 'Rutas de salida', 'Señalización'];
function abrirRevision(v: Revision, puede: boolean) {
  document.querySelector('.cajon-fondo')?.remove();
  const fondo = document.createElement('div');
  fondo.className = 'cajon-fondo';
  const manana = new Date(Date.now() + 864e5); manana.setHours(10, 0, 0, 0);
  fondo.innerHTML = `<aside class="cajon" role="dialog" aria-modal="true" aria-label="Revisión ${esc(v.folio)}">
    <div class="det-cab"><div><h2>Revisión ${esc(v.folio)}</h2><span class="tenue">Solicitada ${fecha(v.creado_en)}</span></div>
      <em class="pill ${ESTADO_REV[v.estado].cls}">${ESTADO_REV[v.estado].txt}</em><button class="btn cerrar-x" id="x" aria-label="Cerrar">${I.cerrar(18)}</button></div>
    <dl class="datos"><dt>Motivo</dt><dd>${esc(v.motivos.map((m) => MOT[m] ?? m).join(', '))}</dd>
      <dt>Inmueble</dt><dd>${esc(v.inmueble ?? '—')}</dd><dt>Dirección</dt><dd>${esc(v.direccion)} · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.direccion + ', Guanajuato')}" target="_blank" rel="noopener">Mapa</a></dd>
      <dt>Contacto</dt><dd>${esc(v.nombre)} · <a href="tel:${esc(v.telefono)}">${esc(v.telefono)}</a></dd>
      <dt>Horario preferido</dt><dd>${esc(v.horario_preferido ?? '—')}</dd>
      ${v.comentario ? `<dt>Comentario</dt><dd>${esc(v.comentario)}</dd>` : ''}
      ${v.fecha ? `<dt>Fecha</dt><dd><b>${fechaLarga(v.fecha)}</b>${v.asignado ? ` · va ${esc(v.asignado)}` : ''}</dd>` : ''}</dl>
    ${puede && ['solicitada', 'propuesta', 'confirmada'].includes(v.estado) ? `
      <form class="bloque" id="f-fecha"><h3>${v.estado === 'solicitada' ? 'Proponer fecha' : 'Cambiar fecha'}</h3>
        <div class="rejilla-2"><label>Día y hora<input type="datetime-local" name="fecha" required value="${localInput(v.fecha ? new Date(v.fecha) : manana)}"></label>
        <label>Quién va<input name="asignado" value="${esc(v.asignado ?? '')}"></label></div>
        <label>Nota para la persona <small>(opcional)</small><input name="nota" maxlength="200" placeholder="Ej. tener a la mano el recibo del gas"></label>
        <button class="btn primario" type="submit">Enviar propuesta</button></form>
      ${v.estado !== 'solicitada' ? `<form class="bloque" id="f-hecha"><h3>Registrar visita</h3>
        ${CHECKS.map((c) => `<label class="fila-check"><span>${c}</span><select name="${c}"><option value="">—</option><option>Bien</option><option>Con observaciones</option><option>Riesgo</option></select></label>`).join('')}
        <label>Recomendaciones para la persona<textarea name="rec" rows="3"></textarea></label>
        <div class="fila-btn"><button class="btn primario" type="submit">Marcar realizada</button><button class="btn" type="button" id="cancelar-rev">Cancelar visita</button></div></form>` : '<button class="btn" id="cancelar-rev">Cancelar solicitud</button>'}` : ''}
    ${v.recomendaciones ? `<div class="bloque"><h3>Recomendaciones</h3><p>${esc(v.recomendaciones)}</p></div>` : ''}
    <h3>Historial</h3><ol class="hist">${(v.historial ?? []).map((h) => `<li><b>${ESTADO_REV[h.estado]?.txt ?? h.estado}</b>${h.actor ? ` · ${esc(h.actor)}` : ''} · ${fecha(h.en)}${h.nota ? `<br><small>${esc(h.nota)}</small>` : ''}</li>`).join('')}</ol>
  </aside>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  $('x').addEventListener('click', cerrar);
  const listo = async (msg: string) => { await accion({ accion: 'revision', revision: v.id }).catch(() => {}); aviso(msg); cerrar(); vistaAgenda(); };
  document.getElementById('f-fecha')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target as HTMLFormElement);
    try { await proponerFecha(v.id, new Date(String(fd.get('fecha'))), String(fd.get('asignado') ?? ''), String(fd.get('nota') ?? '')); await listo('Fecha enviada. La persona recibirá un aviso para confirmar.'); }
    catch (err) { aviso(ERRORES[(err as Error).message] ?? 'No se pudo guardar.', true); }
  });
  document.getElementById('f-hecha')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target as HTMLFormElement);
    const ch: Record<string, string> = {}; CHECKS.forEach((c) => { const x = String(fd.get(c) ?? ''); if (x) ch[c] = x; });
    try { await cerrarRevision(v.id, true, ch, String(fd.get('rec') ?? '')); await listo('Visita registrada como realizada.'); }
    catch (err) { aviso(ERRORES[(err as Error).message] ?? 'No se pudo guardar.', true); }
  });
  document.getElementById('cancelar-rev')?.addEventListener('click', async () => {
    if (!confirm('¿Cancelar esta revisión? La persona recibirá un aviso.')) return;
    try { await cerrarRevision(v.id, false, null, ''); await listo('Revisión cancelada.'); } catch (err) { aviso(ERRORES[(err as Error).message] ?? 'No se pudo cancelar.', true); }
  });
}

// ================================================================ INFORME MENSUAL
let mesInforme = new Date().toISOString().slice(0, 7);
const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
async function vistaInforme() {
  marco('informe', 'Informe mensual', 'Para el ayuntamiento, Protección Civil, donantes y empresas. Se guarda en PDF o Excel.',
    '<div id="informe"><p class="tenue">Calculando…</p></div>',
    `<label class="mes">Mes <input type="month" id="mes" value="${mesInforme}"></label><button class="btn" id="csv">Excel (CSV)</button><button class="btn primario" id="pdf">Guardar PDF</button>`);
  $<HTMLInputElement>('mes').addEventListener('change', (e) => { mesInforme = (e.target as HTMLInputElement).value; vistaInforme(); });
  $('pdf').addEventListener('click', () => window.print());
  const [a, m] = mesInforme.split('-').map(Number);
  const desde = new Date(a, m - 1, 1), hasta = new Date(a, m, 1);
  let x: Informe;
  try { x = await informe(desde, hasta); } catch { $('informe').innerHTML = '<p class="tenue">No se pudo calcular.</p>'; return; }
  const nombreMes = desde.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  const atendidos = x.total - x.falsos;
  $('informe').innerHTML = `
    <div class="informe-cab solo-impresion"><img src="${BASE}escudo-192.png" alt=""><div><b>BOMBEROS SIMUB VOLUNTARIOS, A.C.</b><span>Informe de servicios · ${nombreMes}</span></div></div>
    <p class="resumen-txt">En <b>${nombreMes}</b> SIMUB recibió <b>${x.total}</b> reportes por la app${x.falsos ? ` (${x.falsos} falsos o duplicados)` : ''} y atendió <b>${atendidos}</b>.
      El tiempo típico para ver un reporte fue de <b>${dur(x.mediana_min_visto == null ? null : Math.round(x.mediana_min_visto))}</b> y para llegar al lugar, <b>${dur(x.mediana_min_lugar == null ? null : Math.round(x.mediana_min_lugar))}</b>.
      Se realizaron <b>${x.revisiones.realizadas}</b> revisiones de seguridad.</p>
    <div class="kpis"><div class="kpi"><span>Reportes</span><b>${x.total}</b></div><div class="kpi"><span>Partes de servicio</span><b>${x.partes}</b>${x.sin_parte ? `<small class="alerta-txt">${x.sin_parte} sin parte</small>` : ''}</div>
      <div class="kpi"><span>Agua usada</span><b>${x.agua_litros.toLocaleString('es-MX')} L</b></div><div class="kpi"><span>Lesionados / traslados</span><b>${x.lesionados} / ${x.traslados}</b></div></div>
    <div class="rejilla-graf">
      <section class="tarjeta"><h3>Servicios por tipo</h3>${horizontales(ORDEN_TIPOS.map((t) => ({ etiqueta: FORMULARIOS[t].nombre, valor: x.por_tipo[t] ?? 0, color: FORMULARIOS[t].color })).sort((p, q) => q.valor - p.valor))}</section>
      <section class="tarjeta"><h3>Por día de la semana</h3>${columnas([1, 2, 3, 4, 5, 6, 7].map((d) => ({ etiqueta: DIAS[d], valor: x.por_dia[d] ?? 0 })))}</section>
      <section class="tarjeta ancho"><h3>Por hora del día</h3>${columnas([...Array(24)].map((_, h) => ({ etiqueta: `${h}h`, valor: x.por_hora[h] ?? 0 })), '#C9A866', 130)}</section>
      ${Object.keys(x.por_unidad).length ? `<section class="tarjeta"><h3>Salidas por unidad</h3>${horizontales(Object.entries(x.por_unidad).map(([k, v]) => ({ etiqueta: k, valor: v })).sort((p, q) => q.valor - p.valor))}</section>` : ''}
      <section class="tarjeta"><h3>Mapa de servicios</h3><div id="mapa" class="mapa-inf"></div></section>
    </div>
    <section class="tarjeta"><h3>Detalle de servicios</h3><div class="tabla-caja"><table class="tabla"><thead><tr><th>Folio</th><th>Fecha</th><th>Tipo</th><th>Estado</th><th>Unidad</th><th>Personal</th><th>Qué se hizo</th></tr></thead>
      <tbody>${x.servicios.map((s) => `<tr><td class="nw">${esc(s.folio)}</td><td class="nw">${fecha(s.creado_en)}</td><td>${esc(FORMULARIOS[s.tipo].nombre)}</td><td>${ESTADO[s.estado].txt}</td>
      <td>${esc(s.unidad ?? '—')}</td><td>${esc((s.personal ?? []).join(', ') || '—')}</td><td>${esc(s.acciones ?? '')}</td></tr>`).join('') || '<tr><td colspan="7" class="tenue">Sin servicios en este mes.</td></tr>'}</tbody></table></div></section>
    <p class="tenue chica">Generado ${fecha(new Date().toISOString())} con la app SIMUB · GEO UG Developers.</p>`;
  mapa = L.map('mapa', { zoomControl: false }).setView([21.019, -101.257], 12); capaBase(mapa);
  const pts: L.LatLngTuple[] = x.servicios.map((s) => { L.circleMarker([s.lat, s.lon], { radius: 6, color: '#fff', weight: 1.5, fillColor: FORMULARIOS[s.tipo].color, fillOpacity: .9 }).addTo(mapa!); return [s.lat, s.lon]; });
  if (pts.length) mapa.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 15 });
  $('csv').addEventListener('click', () => {
    const filas = [['Folio', 'Fecha', 'Tipo', 'Estado', 'Referencia', 'Unidad', 'Personal', 'Qué se hizo', 'Latitud', 'Longitud'],
      ...x.servicios.map((s) => [s.folio, new Date(s.creado_en).toLocaleString('es-MX'), FORMULARIOS[s.tipo].nombre, ESTADO[s.estado].txt, s.referencia ?? '', s.unidad ?? '', (s.personal ?? []).join(', '), s.acciones ?? '', s.lat, s.lon])];
    const csv = '﻿' + filas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a2.download = `SIMUB_servicios_${mesInforme}.csv`; a2.click();
  });
}

// ================================================================ AJUSTES (admin)
async function vistaAjustes() {
  if (mio!.rol !== 'admin') { location.hash = '#reportes'; return; }
  marco('ajustes', 'Ajustes', 'Datos que se muestran en la app, catálogos para el parte de servicio y grupos de Telegram.', '<div id="ajustes" class="ajustes"><p class="tenue">Cargando…</p></div>');
  const [cfg, unidades, personal, noticias, necesidades, cods] = await Promise.all([
    tabla<{ clave: string; valor: Record<string, unknown> }>('config_publica', 'clave'), tabla<{ id: number; nombre: string; tipo: string | null; activa: boolean }>('unidades', 'nombre'),
    tabla<{ id: number; nombre: string; cargo: string | null; activo: boolean }>('personal', 'nombre'),
    tabla<{ id: string; titulo: string; categoria: string; visible: boolean; destacada: boolean; publicada_en: string }>('noticias', 'publicada_en'),
    tabla<{ id: number; articulo: string; urgente: boolean; activa: boolean }>('necesidades', 'orden'), codigos().catch(() => [])]);
  const c = Object.fromEntries(cfg.map((x) => [x.clave, x.valor])) as Record<string, Record<string, unknown>>;
  const campo = (grupo: string, k: string, etq: string, tipo = 'text', ayuda = '') => {
    const val = c[grupo]?.[k];
    return tipo === 'textarea' ? `<label>${etq}${ayuda ? ` <small>${ayuda}</small>` : ''}<textarea data-g="${grupo}" data-k="${k}" rows="3">${esc(val ?? '')}</textarea></label>`
      : tipo === 'checkbox' ? `<label class="fila-check"><span>${etq}</span><input type="checkbox" data-g="${grupo}" data-k="${k}" ${val ? 'checked' : ''}></label>`
      : `<label>${etq}${ayuda ? ` <small>${ayuda}</small>` : ''}<input data-g="${grupo}" data-k="${k}" value="${esc(Array.isArray(val) ? val.join(', ') : val ?? '')}"></label>`;
  };
  const ROL_CHAT: Record<string, string> = { alertas: 'Alertas de reportes', comunicacion: 'Comunicación (noticias y donativos)', respaldo: 'Respaldo (si nadie contesta en 10 min)' };
  $('ajustes').innerHTML = `
    <section class="tarjeta"><h3>Grupos de Telegram (@SimubGtoBot)</h3><p class="tenue">Agrega el bot al grupo y un administrador escribe <code>/vincular CÓDIGO</code> dentro del grupo.</p>
      <table class="tabla"><tbody>${cods.map((x) => `<tr><td>${ROL_CHAT[x.rol] ?? x.rol}</td><td><code>${esc(x.codigo)}</code></td><td>${x.vinculado ? '<em class="pill p-verde">Vinculado</em>' : '<em class="pill p-gris">Sin vincular</em>'}</td></tr>`).join('')}</tbody></table></section>
    <form class="tarjeta" id="f-cfg"><h3>Datos de la estación (se ven en la app)</h3>
      <div class="rejilla-2">${campo('estacion', 'telefono', 'Teléfono de la estación', 'text', '10 dígitos; lo marca el botón «Llamar»')}${campo('estacion', 'horario', 'Horario de atención')}
      ${campo('estacion', 'direccion', 'Dirección')}${campo('estacion', 'correo', 'Correo de contacto')}</div>
      ${campo('estacion', 'quienes_somos', 'Quiénes somos', 'textarea')}
      <h3>Donativos</h3><div class="rejilla-2">${campo('donativos', 'titular', 'Titular de la cuenta')}${campo('donativos', 'banco', 'Banco')}
      ${campo('donativos', 'clabe', 'CLABE (18 dígitos)')}${campo('donativos', 'concepto', 'Concepto sugerido')}
      ${campo('donativos', 'enlace_pago', 'Enlace de pago en línea', 'text', 'Mercado Pago, PayPal…')}${campo('donativos', 'montos', 'Montos sugeridos', 'text', 'separados por coma')}
      ${campo('donativos', 'contacto_recibo', 'Dónde pedir recibo')}${campo('donativos', 'recibo_deducible', 'Emitimos recibo deducible', 'checkbox')}</div>
      ${campo('donativos', 'voluntariado', 'Voluntariado: requisitos', 'textarea')}
      <h3>Revisiones de seguridad</h3><div class="rejilla-2">${campo('revisiones', 'dias', 'Días de visita')}${campo('revisiones', 'horario', 'Horario')}${campo('revisiones', 'costo', 'Costo')}</div>
      <button class="btn primario" type="submit">Guardar datos</button></form>
    <section class="tarjeta"><h3>Unidades</h3><ul class="cat">${unidades.map((u) => `<li class="${u.activa ? '' : 'inactivo'}"><span>${esc(u.nombre)} <small>${esc(u.tipo ?? '')}</small></span>
      <button class="btn chico" data-tog="unidades" data-id="${u.id}" data-campo="activa" data-val="${!u.activa}">${u.activa ? 'Desactivar' : 'Activar'}</button></li>`).join('')}</ul>
      <form class="fila-btn" data-nuevo="unidades"><input name="nombre" placeholder="Ej. Unidad 4" required><input name="tipo" placeholder="Tipo (pipa, rescate…)"><button class="btn">Agregar</button></form></section>
    <section class="tarjeta"><h3>Personal</h3><ul class="cat">${personal.map((u) => `<li class="${u.activo ? '' : 'inactivo'}"><span>${esc(u.nombre)} <small>${esc(u.cargo ?? '')}</small></span>
      <button class="btn chico" data-tog="personal" data-id="${u.id}" data-campo="activo" data-val="${!u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button></li>`).join('')}</ul>
      <form class="fila-btn" data-nuevo="personal"><input name="nombre" placeholder="Nombre" required><input name="cargo" placeholder="Cargo o rango"><button class="btn">Agregar</button></form></section>
    <section class="tarjeta"><h3>Necesidades en especie</h3><p class="tenue">También se actualizan desde Telegram con /necesidades.</p><ul class="cat">${necesidades.filter((n) => n.activa).map((n) => `<li><span>${esc(n.articulo)} ${n.urgente ? '<em class="pill p-rojo">Urgente</em>' : ''}</span>
      <span><button class="btn chico" data-tog="necesidades" data-id="${n.id}" data-campo="urgente" data-val="${!n.urgente}">${n.urgente ? 'Normal' : 'Urgente'}</button>
      <button class="btn chico" data-tog="necesidades" data-id="${n.id}" data-campo="activa" data-val="false">Quitar</button></span></li>`).join('')}</ul>
      <form class="fila-btn" data-nuevo="necesidades"><input name="articulo" placeholder="Ej. Guantes talla G" required><label class="fila-check"><input type="checkbox" name="urgente"> Urgente</label><button class="btn">Agregar</button></form></section>
    <section class="tarjeta"><h3>Noticias</h3><p class="tenue">Se publican desde Telegram con /noticia. Aquí puedes ocultarlas o destacarlas.</p>
      <ul class="cat">${noticias.slice().reverse().slice(0, 20).map((n) => `<li class="${n.visible ? '' : 'inactivo'}"><span>${n.destacada ? '★ ' : ''}${esc(n.titulo)} <small>${fecha(n.publicada_en)}</small></span>
      <span>${n.visible ? `<button class="btn chico" data-dest="${n.id}">Destacar</button>` : ''}<button class="btn chico" data-tog="noticias" data-id="${n.id}" data-campo="visible" data-val="${!n.visible}">${n.visible ? 'Ocultar' : 'Mostrar'}</button></span></li>`).join('')}</ul></section>`;
  $('f-cfg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nuevos: Record<string, Record<string, unknown>> = JSON.parse(JSON.stringify(c));
    raiz.querySelectorAll<HTMLInputElement>('[data-g]').forEach((el) => {
      const g = el.dataset.g!, k = el.dataset.k!; nuevos[g] ??= {};
      nuevos[g][k] = el.type === 'checkbox' ? el.checked : k === 'montos' ? el.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0) : el.value.trim();
    });
    try { for (const [g, val] of Object.entries(nuevos)) await guardarConfig(g, val); aviso('Datos guardados. Ya se ven en la app.'); }
    catch { aviso('No se pudo guardar.', true); }
  });
  raiz.querySelectorAll<HTMLButtonElement>('[data-tog]').forEach((b) => b.addEventListener('click', async () => {
    try { await actualizar(b.dataset.tog!, b.dataset.id!, { [b.dataset.campo!]: b.dataset.val === 'true' }); vistaAjustes(); } catch { aviso('No se pudo cambiar.', true); }
  }));
  raiz.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => b.addEventListener('click', async () => {
    try { for (const n of noticias.filter((x) => x.destacada)) await actualizar('noticias', n.id, { destacada: false });
      await actualizar('noticias', b.dataset.dest!, { destacada: true }); vistaAjustes(); } catch { aviso('No se pudo cambiar.', true); }
  }));
  raiz.querySelectorAll<HTMLFormElement>('[data-nuevo]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(f); const fila: Record<string, unknown> = {};
    fd.forEach((v, k) => { fila[k] = k === 'urgente' ? true : String(v).trim(); });
    try { await insertar(f.dataset.nuevo!, fila); vistaAjustes(); } catch { aviso('No se pudo agregar (¿ya existe?).', true); }
  }));
}

// ---------------------------------------------------------------- rutas
function ir() {
  limpiar();
  if (!mio) return;
  const [ruta, arg] = location.hash.replace(/^#\/?/, '').split('/');
  switch (ruta || 'reportes') {
    case 'guardia': return vistaGuardia();
    case 'parte': return vistaParte(arg);
    case 'agenda': return vistaAgenda(arg);
    case 'informe': return vistaInforme();
    case 'ajustes': return vistaAjustes();
    default: return vistaReportes(arg);
  }
}
window.addEventListener('hashchange', ir);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.cajon-fondo')?.remove(); });
iniciar();
