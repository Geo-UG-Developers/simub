// SIMUB · panel de la estación: tablero de guardia, reportes, parte de servicio,
// agenda de revisiones, informe mensual y ajustes (sin programar).
import './panel.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { I } from '../iconos';
import { FORMULARIOS, MOTIVOS_REVISION, ORDEN_TIPOS } from '../formularios';
import type { Estado } from '../api';
import { columnas, horizontales } from './graficas';
import { MESES_TXT } from './catalogo';
import { entregarPdf, partePdf } from './pdf';
import { activarImportar, paseDeLista, tarjetaImportar, vistaCaptura, vistaInformes, vistaMando, vistaServicio, vistaServicios, type Ctx } from './mando';
import { pararCampo, vistaCampo } from './campo';
import { vistaUnidades } from './unidades';
import { vistaMapa } from './mapa';
import { vistaForestal } from './forestal';
import { vistaHerramientas } from './herramientas';
import { vistaCapacitacion } from './capacitacion';
import { guardia as leerGuardia, entrar, textoAcceso } from './datos';
import { activarClaves, campoClave } from './clave';
import { alCambiar, avisarVentanas } from './ventanas';
import { activarRespaldo, arrancarSesion, cambioTurno, copiaAutomatica, tarjetaRespaldo, terminarSesion, vistaControl, vistaVoluntarios } from './control';
import { clima, pastillaClima, detalleClima } from './clima';
import {
  accion, actualizar, cerrarRevision, codigos, dbp, detalle, guardarConfig, guardarParte, informe, insertar, proponerFecha,
  cuentas, desbloquearAcceso, guardarCuenta, oficiales, type Cuenta, type Oficial, mando, reportes, revisiones, servicioDesdeReporte, tabla, urlsFotos, yo, type Detalle, type Informe, type Parte, type Reporte, type Revision, type Yo,
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
  solo_admin: 'Solo el Comandante o el responsable de la app pueden hacer esto.', bloqueado: 'Este parte ya está cerrado o firmado: solo un administrador puede corregirlo.',
  firma_invalida: 'La firma no es válida; vuelve a firmar.', transicion_invalida: 'Ese estado ya se había marcado.',
  cerrado: 'Este reporte ya está cerrado.', tiempo_vencido: 'Ya pasaron 2 minutos; ese cambio ya no se puede deshacer.',
  sin_permiso: 'Tu cuenta no tiene permiso para esto.', fecha_pasada: 'La fecha ya pasó.',
  clasificacion_invalida: 'Elige el tipo de servicio.', anulado: 'Este folio está anulado.', texto_vacio: 'Escribe el texto.',
  solo_admin_imp: 'Solo un administrador puede importar.',
};
interface Persona { id: number; nombre: string; cargo: string | null; activo: boolean; nombre_corto: string | null; telefono: string | null; email: string | null; comunicacion_interna: boolean; reportes_app: boolean }
const ROL_CUENTA: Record<string, string> = { admin: 'Admin. Maestro', coordinador: 'Admin (coordinación)', guardia: 'Cabinero', campo: 'Campo (celular de unidad)' };
const ROL_TXT = { admin: 'Administrador', coordinador: 'Coordinación', guardia: 'Cabina', campo: 'Campo (unidad)' };

let mio: Yo | null = null;
let correo = '';
let mapa: L.Map | null = null;
let ciclos: number[] = [];
let refrescos: (() => void)[] = [];
let mapa2: L.Map | null = null;
let reloj: number | undefined;

function aviso(txt: string, error = false) {
  const t = document.createElement('div');
  t.className = `toast ${error ? 'error' : ''}`; t.setAttribute('role', 'status'); t.textContent = txt;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4500);
}
function limpiar() {
  document.querySelector('.cajon-fondo')?.remove();
  if (mapa) { mapa.remove(); mapa = null; }
  ciclos.forEach((x) => clearInterval(x)); ciclos = []; refrescos = [];
  if (mapa2) { mapa2.remove(); mapa2 = null; }
  if (reloj) { clearInterval(reloj); reloj = undefined; }
  alarma.parar(); document.body.classList.remove('modo-guardia'); pararCampo();
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
  // Sirena de bomberos (tipo «wail» + «yelp»), saturada y comprimida para que suene lo más fuerte posible.
  sonar(duracion = 4.5) {
    if (!this.ctx || Date.now() < this.silencioHasta) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02, fin = t0 + duracion;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 0; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.1;
    const sat = ctx.createWaveShaper(); const curva = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curva[i] = Math.tanh(3.2 * x); }
    sat.curve = curva;
    const vol = ctx.createGain(); vol.gain.setValueAtTime(0.0001, t0); vol.gain.exponentialRampToValueAtTime(1, t0 + 0.05);
    vol.gain.setValueAtTime(1, fin - 0.08); vol.gain.exponentialRampToValueAtTime(0.0001, fin);
    sat.connect(comp).connect(vol).connect(ctx.destination);
    const voz = (tipo: OscillatorType, mult: number, g: number) => {
      const o = ctx.createOscillator(), ga = ctx.createGain(); o.type = tipo; ga.gain.value = g;
      // primera mitad «wail» (sube y baja lento), segunda mitad «yelp» (rápido)
      let t = t0; const mitad = t0 + duracion * 0.55;
      o.frequency.setValueAtTime(600 * mult, t);
      while (t < mitad) { o.frequency.linearRampToValueAtTime(1500 * mult, t + 0.55); o.frequency.linearRampToValueAtTime(650 * mult, t + 1.1); t += 1.1; }
      while (t < fin) { o.frequency.linearRampToValueAtTime(1600 * mult, t + 0.12); o.frequency.linearRampToValueAtTime(700 * mult, t + 0.24); t += 0.24; }
      o.connect(ga).connect(sat); o.start(t0); o.stop(fin);
    };
    voz('sawtooth', 1, 0.7); voz('square', 0.5, 0.45); voz('square', 1.005, 0.35);
  },
  probar() { this.activar(); const s = this.silencioHasta; this.silencioHasta = 0; this.sonar(2.5); this.silencioHasta = s; },
  iniciar() { if (this.timer) return; this.sonar(); this.timer = window.setInterval(() => this.sonar(), 6000); },
  parar() { if (this.timer) { clearInterval(this.timer); this.timer = undefined; } },
};
let wakeLock: { release(): Promise<void> } | null = null;
async function pantallaEncendida() {
  try { wakeLock = await (navigator as unknown as { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen'); } catch { /* no soportado */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeLock) pantallaEncendida(); });

// ---------------------------------------------------------------- acceso
const activarVerClave = () => activarClaves(raiz);
const URL_PANEL = location.origin + location.pathname;

function pantallaAcceso(mensaje = '', ok = '') {
  limpiar();
  raiz.innerHTML = `
  <main class="acceso"><form class="caja-acceso" id="form" autocomplete="off">
    <img src="${BASE}escudo-192.png" alt="" class="escudo-acc"><h1>Panel de la estación</h1>
    <p class="tenue">Bomberos SIMUB Voluntarios, A.C.</p>
    <label>Correo<input type="email" id="correo" autocomplete="email" required></label>
    ${campoClave('clave', 'Contraseña', 'current-password')}
    ${mensaje ? `<p class="error-txt" role="alert">${esc(mensaje)}</p>` : ''}
    ${ok ? `<p class="ok-txt" role="status">${esc(ok)}</p>` : ''}
    <button class="btn primario" type="submit">Entrar</button>
    <button class="enlace-btn" type="button" id="olvide">¿Olvidaste tu contraseña?</button>
    <p class="tenue chica">Las cuentas las da de alta el administrador de SIMUB.</p>
    <p class="credito"><img src="${BASE}geoug.png" alt=""> GEO UG Developers</p>
  </form></main>`;
  activarVerClave();
  $('olvide').addEventListener('click', async () => {
    const correoTxt = $<HTMLInputElement>('correo').value.trim();
    if (!correoTxt) return pantallaAcceso('Escribe tu correo arriba y vuelve a tocar «¿Olvidaste tu contraseña?».');
    const { error } = await dbp.auth.resetPasswordForEmail(correoTxt, { redirectTo: URL_PANEL });
    if (error) return pantallaAcceso(/rate|limit/i.test(error.message)
      ? 'Se enviaron demasiados correos. Espera una hora o pide al administrador que cambie tu contraseña.'
      : 'No se pudo enviar el correo. Pide al administrador que cambie tu contraseña.');
    pantallaAcceso('', 'Si el correo está dado de alta, te llegará un enlace para crear una contraseña nueva. Revisa también «Spam».');
  });
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = (e.target as HTMLFormElement).querySelector<HTMLButtonElement>('button[type=submit]')!; b.disabled = true; b.textContent = 'Verificando…';
    const correoTxt = $<HTMLInputElement>('correo').value.trim();
    const r = await entrar(correoTxt, $<HTMLInputElement>('clave').value);
    if (!r.ok) { pantallaAcceso(textoAcceso(r)); $<HTMLInputElement>('correo').value = correoTxt; return; }
    avisarVentanas('sesion'); iniciar();
  });
}
// Al abrir el enlace del correo de recuperación, Supabase avisa con PASSWORD_RECOVERY.
function pantallaNuevaClave(mensaje = '') {
  limpiar();
  raiz.innerHTML = `<main class="acceso"><form class="caja-acceso" id="form-nueva">
    <img src="${BASE}escudo-192.png" alt="" class="escudo-acc"><h1>Contraseña nueva</h1>
    <p class="tenue">Usa al menos 8 caracteres. Una frase larga es más segura y fácil de recordar.</p>
    ${campoClave('nueva1', 'Contraseña nueva', 'new-password')}${campoClave('nueva2', 'Repítela', 'new-password')}
    ${mensaje ? `<p class="error-txt" role="alert">${esc(mensaje)}</p>` : ''}
    <button class="btn primario" type="submit">Guardar contraseña</button></form></main>`;
  activarVerClave();
  $('form-nueva').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $<HTMLInputElement>('nueva1').value, b = $<HTMLInputElement>('nueva2').value;
    if (a.length < 8) return pantallaNuevaClave('Debe tener al menos 8 caracteres.');
    if (a !== b) return pantallaNuevaClave('Las dos contraseñas no coinciden.');
    const { error } = await dbp.auth.updateUser({ password: a });
    if (error) return pantallaNuevaClave('No se pudo guardar. El enlace pudo haber vencido: pide otro.');
    history.replaceState(null, '', location.pathname);
    aviso('Contraseña actualizada.'); iniciar();
  });
}
let recuperando = false;
dbp.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') { recuperando = true; pantallaNuevaClave(); } });

async function iniciar() {
  if (recuperando || /type=recovery/.test(location.hash)) return;   // espera la pantalla de contraseña nueva
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
  await arrancarSesion(data.session.user.id);
  ir();
  copiaAutomatica(ctx);
}
async function salir() { limpiar(); await terminarSesion('cierre'); await dbp.auth.signOut(); mio = null; avisarVentanas('sesion'); history.replaceState(null, '', location.pathname); pantallaAcceso(); }

// ---------------------------------------------------------------- marco
const SECCIONES: { id: string; txt: string; ic: (n: number) => string; roles?: string[]; ventana?: string }[] = [
  { id: 'campo', txt: 'Campo (unidad)', ic: I.unidad, roles: ['campo'] },
  { id: 'mando', txt: 'Centro de mando', ic: I.unidad, roles: ['admin', 'coordinador', 'guardia'] },
  { id: 'captura', txt: 'Generar servicio', ic: I.mas, roles: ['admin', 'coordinador', 'guardia'] },
  { id: 'guardia', txt: 'Tablero de guardia', ic: I.campana, roles: ['admin', 'coordinador', 'guardia'], ventana: 'simub-tablero' },
  { id: 'reportes', txt: 'Reportes de la app', ic: I.campana, roles: ['admin', 'coordinador', 'guardia'] },
  { id: 'servicios', txt: 'Servicios y partes', ic: I.lista, roles: ['admin', 'coordinador', 'guardia'] },
  { id: 'unidades', txt: 'Unidades y equipo', ic: I.caja },
  { id: 'mapa', txt: 'Mapa operativo', ic: I.pin },
  { id: 'forestal', txt: 'Incendios forestales', ic: I.incendio, roles: ['admin', 'coordinador', 'guardia'] },
  { id: 'herramientas', txt: 'Herramientas', ic: I.gps },
  { id: 'agenda', txt: 'Revisiones', ic: I.calendario, roles: ['admin', 'coordinador', 'guardia'] },
  { id: 'informe', txt: 'Informes', ic: I.noticias, roles: ['admin'] },
  { id: 'capacitacion', txt: 'Capacitación', ic: I.check, roles: ['admin', 'coordinador'] },
  { id: 'voluntarios', txt: 'Voluntariado', ic: I.mano, roles: ['admin'] },
  { id: 'control', txt: 'Control interno', ic: I.lista, roles: ['admin'] },
  { id: 'ajustes', txt: 'Ajustes', ic: I.escudo, roles: ['admin'] },
];
function marco(activa: string, titulo: string, sub: string, contenido: string, acciones = '') {
  raiz.innerHTML = `
  <div class="marco">
    <aside class="lateral">
      <a class="logo" href="#mando"><img src="${BASE}escudo-192.png" alt=""><span><b>SIMUB</b><small>Panel de la estación</small></span></a>
      <nav aria-label="Secciones">${SECCIONES.filter((s) => !s.roles || s.roles.includes(mio!.rol)).map((s) =>
        `<a href="#${s.id}" class="${s.id === activa ? 'on' : ''}" ${s.id === activa ? 'aria-current="page"' : ''} ${s.ventana ? `target="${s.ventana}" title="Se abre en otra ventana: déjala en la segunda pantalla"` : ''}>${s.ic(18)}<span>${s.txt}</span><em id="n-${s.id}"></em></a>`).join('')}</nav>
      <div class="pie-lateral"><span class="chica">En turno</span><b>${esc(mio!.nombre || correo)}</b><span>${esc(mio!.cargo || ROL_TXT[mio!.rol])}</span>
        <button class="btn salir-lat" id="turno-lat">Cambio de turno</button>
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
  $('turno-lat').addEventListener('click', () => ctx.turno());
  revisiones(new Date(Date.now() - 864e5)).then((vs) => {
    const n = vs.filter((v) => v.estado === 'solicitada').length; const e = document.getElementById('n-agenda'); if (e) e.textContent = n ? String(n) : '';
  }).catch(() => {});
}

// Contexto para los módulos de servicios (centro de mando, partes, informes).
const ctx: Ctx = {
  raiz, rol: () => mio!.rol, marco, aviso, errores: ERRORES,
  ciclo: (fn, ms) => { ciclos.push(window.setInterval(fn, ms)); refrescos.push(fn); },
  nuevoMapa: (id) => { mapa = L.map(id); capaBase(mapa); return mapa; },
  yo: () => mio!,
  turno: () => cambioTurno(ctx, mio!, async () => { mio = await yo(); ir(); if (mio && mio.rol !== 'campo') paseDeLista(ctx, await leerGuardia().catch(() => undefined), () => ir()); }),
};

// ================================================================ TABLERO DE GUARDIA
function vistaGuardia() {
  document.body.classList.add('modo-guardia');
  raiz.innerHTML = `
  <div class="guardia">
    <header class="g-barra">
      <img src="${BASE}escudo-192.png" alt=""><div class="g-tit"><b>SIMUB · GUARDIA</b><span id="g-estado-red">Conectando…</span></div>
      <span class="g-reloj" id="g-reloj"></span><span id="g-clima"></span>
      <button class="btn g-btn" id="g-activar">${I.campana(18)} Activar tablero</button>
      <button class="btn g-btn" id="g-silencio" hidden>Silenciar 1 min</button>
      <button class="btn g-btn" id="g-probar">Probar sirena</button>
      <button class="btn g-btn" id="g-pantalla">Pantalla completa</button>
      <button class="btn g-btn" id="g-turno">Cambio de turno</button>
      <a class="btn g-btn" href="#mando">Salir</a>
    </header>
    <div class="g-cuerpo">
      <section class="g-lista" id="g-lista" aria-live="polite"></section>
      <section class="g-mapas"><div class="g-mapa"><span class="g-mapa-tit">Emergencias</span><div id="mapa"></div></div>
        <div class="g-mapa"><span class="g-mapa-tit">Unidades y oficiales en territorio <small id="g-terr-n"></small></span><div id="mapa2"></div></div></section>
    </div>
    <footer class="g-pie" id="g-pie"></footer>
  </div>`;
  const pintarReloj = () => { const e = document.getElementById('g-reloj'); if (e) e.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  pintarReloj(); reloj = window.setInterval(pintarReloj, 1000);
  mapa = L.map('mapa', { zoomControl: true }).setView([21.019, -101.257], 13); capaBase(mapa);
  const capa = L.layerGroup().addTo(mapa);
  mapa2 = L.map('mapa2', { zoomControl: true }).setView([21.019, -101.257], 13); capaBase(mapa2);
  const capa2 = L.layerGroup().addTo(mapa2); let primera2 = true;
  const territorio = async () => {
    const m = await mando().catch(() => null); if (!m || !mapa2) return;
    capa2.clearLayers(); capaServ.clearLayers(); const pts: L.LatLngTuple[] = [];
    for (const sv of m.servicios.filter((x) => x.lat != null)) {
      L.circleMarker([sv.lat!, sv.lon!], { radius: 11, color: '#fff', weight: 3, fillColor: '#B3261E', fillOpacity: .95 }).addTo(capaServ)
        .bindTooltip(`Servicio #${sv.folio} · ${esc(sv.colonia ?? '')}`, { permanent: false });
      L.circleMarker([sv.lat!, sv.lon!], { radius: 7, color: '#B3261E', weight: 2, fillOpacity: 0 }).addTo(capa2).bindTooltip(`Servicio #${sv.folio}`);
      pts.push([sv.lat!, sv.lon!]);
    }
    for (const p of m.posiciones ?? []) {
      const of = p.tipo === 'oficial', min = Math.round((Date.now() - +new Date(p.en)) / 60000);
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', iconSize: [80, 24], iconAnchor: [40, 12],
        html: `<span class="pin-unidad ${of ? 'oficial' : ''} ${min > 10 ? 'viejo' : ''}">${esc(p.unidad)}</span>` }) }).addTo(capa2)
        .bindPopup(`<b>${esc(p.unidad)}</b>${p.autor ? `<br>${esc(p.autor)}` : ''}<br>${p.folio ? `Servicio #${p.folio}${p.clase ? ` · ${esc(p.clase)}` : ''}` : 'Sin servicio asignado'}
          <br><small>Ubicación de hace ${min} min${p.precision_m ? ` · ±${p.precision_m} m` : ''}</small>`);
      pts.push([p.lat, p.lon]);
    }
    const e = document.getElementById('g-terr-n'); if (e) e.textContent = `(${(m.posiciones ?? []).length} en el mapa · ${m.servicios.length} servicios activos)`;
    if (pts.length && primera2) { mapa2.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 15 }); primera2 = false; }
  };
  const capaServ = L.layerGroup().addTo(mapa);
  territorio(); ctx.ciclo(territorio, 15000);
  let activado = false;
  $('g-activar').addEventListener('click', () => {
    alarma.activar(); pantallaEncendida(); activado = true;
    $('g-activar').hidden = true; $('g-silencio').hidden = false; aviso('Tablero activo: sonará la sirena con cada reporte nuevo hasta que alguien toque «Enterado».');
    cargar();
  });
  $('g-silencio').addEventListener('click', () => { alarma.silencioHasta = Date.now() + 60000; aviso('Alarma en silencio 1 minuto.'); });
  $('g-turno').addEventListener('click', () => ctx.turno());
  $('g-probar').addEventListener('click', () => { alarma.probar(); aviso('Si no se oye fuerte, sube el volumen de la computadora o conecta una bocina.'); });
  const pintarClima = async () => { const k = await clima(); const e = document.getElementById('g-clima'); if (e) e.innerHTML = pastillaClima(k); };
  pintarClima(); const relojClima = window.setInterval(pintarClima, 15 * 60000);
  window.addEventListener('hashchange', () => clearInterval(relojClima), { once: true });
  $('g-clima').addEventListener('click', async () => {
    const k = await clima(); const f = document.createElement('div'); f.className = 'cajon-fondo';
    f.innerHTML = `<aside class="cajon"><div class="det-cab"><div><h2>Tiempo y riesgo de incendio</h2></div><button class="btn cerrar-x" aria-label="Cerrar">✕</button></div>${detalleClima(k)}</aside>`;
    document.body.appendChild(f); f.addEventListener('click', (e) => { if (e.target === f || (e.target as HTMLElement).closest('.cerrar-x')) f.remove(); });
  });
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
  cargar(); ctx.ciclo(cargar, 10000);
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
  ctx.ciclo(cargar, 20000);
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
    ${d.servicio_id ? `<a class="btn primario" href="#servicio/${d.servicio_id}">Ver servicio y parte</a>`
      : d.estado !== 'falso' ? `<a class="btn primario btn-generar" href="#captura/${d.id}">${I.mas(18)} Generar servicio</a>` : ''}
    ${d.parte ? `<a class="btn" href="#parte/${d.id}">Parte anterior (formato simple)</a>` : ''}
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
    try { await accion({ accion: 'reenviar', reporte: id }); aviso('Enviado al grupo de reportes de la app.'); avisarVentanas(); } catch { aviso('No se pudo enviar. ¿Está vinculado el grupo?', true); }
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
  marco('informe', 'Reportes recibidos por la app', 'Tiempos de respuesta y origen de los reportes ciudadanos. El informe de servicios está en «Mensual» y «Anual».',
    '<div id="informe"><p class="tenue">Calculando…</p></div>',
    `<div class="chips-modo"><a class="chip" href="#informe">Mensual</a><a class="chip" href="#anual">Anual</a><a class="chip on" href="#app">Reportes de la app</a></div><select id="app-mes" aria-label="Mes">${MESES_TXT.map((t, i) => `<option value="${i + 1}" ${i + 1 === +mesInforme.slice(5, 7) ? 'selected' : ''}>${t}</option>`).join('')}</select>
     <select id="app-anio" aria-label="Año">${[...Array(new Date().getFullYear() - 2025 + 1)].map((_, i) => 2025 + i).reverse().map((y) => `<option ${y === +mesInforme.slice(0, 4) ? 'selected' : ''}>${y}</option>`).join('')}</select>
     ${mio!.rol !== 'guardia' ? '<button class="btn" id="csv">Excel (CSV)</button>' : ''}<button class="btn primario" id="pdf">Guardar PDF</button>`);
  const cambiaMes = () => { mesInforme = `${$<HTMLSelectElement>('app-anio').value}-${String($<HTMLSelectElement>('app-mes').value).padStart(2, '0')}`; vistaInforme(); };
  $('app-mes').addEventListener('change', cambiaMes); $('app-anio').addEventListener('change', cambiaMes);
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
  document.getElementById('csv')?.addEventListener('click', () => {
    const filas = [['Folio', 'Fecha', 'Tipo', 'Estado', 'Referencia', 'Unidad', 'Personal', 'Qué se hizo', 'Latitud', 'Longitud'],
      ...x.servicios.map((s) => [s.folio, new Date(s.creado_en).toLocaleString('es-MX'), FORMULARIOS[s.tipo].nombre, ESTADO[s.estado].txt, s.referencia ?? '', s.unidad ?? '', (s.personal ?? []).join(', '), s.acciones ?? '', s.lat, s.lon])];
    const csv = '﻿' + filas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a2.download = `SIMUB_servicios_${mesInforme}.csv`; a2.click();
  });
}

// ================================================================ AJUSTES (admin)
async function vistaAjustes() {
  if (mio!.rol !== 'admin') { location.hash = '#mando'; return; }
  marco('ajustes', 'Ajustes', 'Datos que se muestran en la app, catálogos para el parte de servicio y grupos de Telegram.', '<div id="ajustes" class="ajustes"><p class="tenue">Cargando…</p></div>');
  const [cfg, unidades, personal, noticias, necesidades, cods] = await Promise.all([
    tabla<{ clave: string; valor: Record<string, unknown> }>('config_publica', 'clave'), tabla<{ id: number; nombre: string; tipo: string | null; activa: boolean }>('unidades', 'nombre'),
    tabla<Persona>('personal', 'nombre'),
    tabla<{ id: string; titulo: string; categoria: string; visible: boolean; destacada: boolean; publicada_en: string }>('noticias', 'publicada_en'),
    tabla<{ id: number; articulo: string; urgente: boolean; activa: boolean }>('necesidades', 'orden'), codigos().catch(() => [])]);
  const [colonias, ctas, ofs] = await Promise.all([tabla<{ id: number; nombre: string; tipo: string | null; activa: boolean }>('colonias', 'nombre').catch(() => []),
    cuentas().catch(() => [] as Cuenta[]), oficiales().catch(() => [] as Oficial[])]);
  const enlaceDe = new Map(ofs.map((o) => [o.id, o]));
  const c = Object.fromEntries(cfg.map((x) => [x.clave, x.valor])) as Record<string, Record<string, unknown>>;
  const campo = (grupo: string, k: string, etq: string, tipo = 'text', ayuda = '') => {
    const val = c[grupo]?.[k];
    return tipo === 'textarea' ? `<label>${etq}${ayuda ? ` <small>${ayuda}</small>` : ''}<textarea data-g="${grupo}" data-k="${k}" rows="3">${esc(val ?? '')}</textarea></label>`
      : tipo === 'checkbox' ? `<label class="fila-check"><span>${etq}</span><input type="checkbox" data-g="${grupo}" data-k="${k}" ${val ? 'checked' : ''}></label>`
      : `<label>${etq}${ayuda ? ` <small>${ayuda}</small>` : ''}<input data-g="${grupo}" data-k="${k}" value="${esc(Array.isArray(val) ? val.join(', ') : val ?? '')}"></label>`;
  };
  const ROL_CHAT: Record<string, string> = { alertas: 'Alertas de reportes', comunicacion: 'Comunicación (noticias y donativos)', respaldo: 'Respaldo (si nadie contesta en 10 min)',
    interno: 'Comunicación interna (resumen de cada servicio, «Voy», apoyos y entrega de guardia)' };
  $('ajustes').innerHTML = `
    <section class="tarjeta"><h3>Grupos de Telegram (@SimubGtoBot)</h3><p class="tenue">Agrega el bot al grupo y un administrador escribe <code>/vincular CÓDIGO</code> dentro del grupo.</p>
      <table class="tabla"><tbody>${cods.map((x) => `<tr><td>${ROL_CHAT[x.rol] ?? x.rol}</td><td><code>${esc(x.codigo)}</code></td><td>${x.vinculado ? '<em class="pill p-verde">Vinculado</em>' : '<em class="pill p-gris">Sin vincular</em>'}</td></tr>`).join('')}</tbody></table></section>
    ${tarjetaImportar}
    ${tarjetaRespaldo()}
    ${mio!.super ? `<section class="tarjeta peligro"><h3>Preparar para producción (solo desarrollador)</h3>
      <p class="tenue">Borra los reportes, revisiones y servicios capturados en pruebas. El histórico importado se conserva. Queda en el control interno. No se puede deshacer.</p>
      <div class="fila-btn"><input id="confirma-limpiar" placeholder="Escribe BORRAR para confirmar"><button class="btn rojo" id="limpiar" type="button">Borrar datos de prueba</button></div></section>` : ''}
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
    <section class="tarjeta"><h3>Cuentas del panel (${ctas.length})</h3>
      <p class="tenue">Cada persona entra con su correo. <b>Admin. Maestro</b>: todo (informes, voluntariado, control interno, ajustes y corregir partes cerrados).
        <b>Admin</b> (coordinación): operación, capacitación y unidades. <b>Cabinero</b>: centro de mando, servicios y reportes. <b>Campo</b>: celular de la unidad.
        Tras 5 contraseñas equivocadas la cuenta se bloquea 30 min y le llega un correo para restablecerla.</p>
      <div class="tabla-caja"><table class="tabla"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Último acceso</th><th></th></tr></thead><tbody>
      ${ctas.map((x) => `<tr><td>${esc(x.nombre)}${x.superusuario ? ' <em class="pill p-gris">desarrollador</em>' : ''}</td><td class="chica">${esc(x.email ?? '—')}</td><td>${ROL_CUENTA[x.rol] ?? x.rol}</td>
        <td class="nw chica">${x.ultimo_acceso ? fecha(x.ultimo_acceso) : 'nunca'}</td><td class="nw">${x.bloqueado ? `<button class="btn chico rojo" data-desbloq="${esc(x.email)}">Desbloquear</button>` : ''}
        <button class="btn chico" data-cuenta="${x.user_id}">Cambiar</button></td></tr>`).join('') || '<tr><td colspan="5" class="tenue">Sin cuentas.</td></tr>'}</tbody></table></div>
      <button class="btn" id="cta-nueva" type="button">+ Dar de alta una cuenta</button></section>
    <section class="tarjeta"><h3>Personal (${personal.filter((x) => x.activo).length} activos)</h3>
      <p class="tenue chica"><b>Com. interna</b>: oficiales que reciben por Telegram privado el servicio completo (con nombre y teléfono de quien reporta) y pueden aparecer en el mapa de cabina.
        Cada oficial abre una vez su enlace del bot para quedar vinculado.</p>
      <div class="tabla-caja"><table class="tabla t-per"><thead><tr><th>Nombre corto</th><th>Nombre</th><th>Cargo</th><th>Reportes app</th><th>Com. interna</th><th>Teléfono</th><th>Telegram</th><th></th></tr></thead><tbody>
      ${personal.map((u) => { const o = enlaceDe.get(u.id); return `<tr class="${u.activo ? '' : 'inactivo'}"><td><b>${esc(u.nombre_corto ?? '')}</b></td><td>${esc(u.nombre)}</td><td class="chica">${esc(u.cargo ?? '')}</td>
        <td><button class="btn chico ${u.reportes_app ? 'enviado' : ''}" data-tog="personal" data-id="${u.id}" data-campo="reportes_app" data-val="${!u.reportes_app}">${u.reportes_app ? 'Sí' : 'No'}</button></td>
        <td><button class="btn chico ${u.comunicacion_interna ? 'enviado' : ''}" data-tog="personal" data-id="${u.id}" data-campo="comunicacion_interna" data-val="${!u.comunicacion_interna}">${u.comunicacion_interna ? 'Sí' : 'No'}</button></td>
        <td class="nw chica">${esc(u.telefono ?? '')}</td>
        <td class="nw">${o ? (o.vinculado ? '<em class="pill p-verde">Vinculado</em>' : '') + (o.enlace ? ` <button class="btn chico" data-enlace="${esc(o.enlace)}" data-quien="${esc(o.corto)}">Enlace del bot</button>` : '') : ''}</td>
        <td><button class="btn chico" data-tog="personal" data-id="${u.id}" data-campo="activo" data-val="${!u.activo}">${u.activo ? 'Baja' : 'Alta'}</button></td></tr>`; }).join('')}</tbody></table></div>
      <form class="fila-btn" data-nuevo="personal"><input name="nombre" placeholder="Nombre" required><input name="cargo" placeholder="Cargo o rango"><button class="btn">Agregar</button></form>
      <div class="bloque"><b>Importar la lista de personal (Excel)</b><span class="tenue chica">Columnas: Nombre corto, Nombre, Cargo, Reportes App (si/no), Comunicación interna (si/no), Teléfono y Email. Solo «Nombre» es obligatoria. Actualiza sin duplicar.</span>
        <div class="fila-btn"><input type="file" id="per-xls" accept=".xlsx,.xlsm"><label class="fila-check2"><input type="checkbox" id="per-baja"> Desactivar a quien ya no aparezca</label><button class="btn" type="button" id="per-imp" disabled>Importar</button></div>
        <p id="per-res" class="tenue chica"></p></div>
      <details><summary>Agregar varios a la vez (pegar lista)</summary><form class="bloque" id="f-lote"><label>Un nombre por renglón. Si quieres, agrega el cargo después de una coma: «Juan Pérez, Bombero»
        <textarea name="lista" rows="6"></textarea></label><button class="btn">Agregar todos</button></form></details></section>
    <section class="tarjeta"><h3>Colonias y lugares frecuentes (${colonias.filter((x) => x.activa).length})</h3><p class="tenue">Aparecen como sugerencia al escribir el lugar; también se puede escribir uno que no esté.</p>
      <div class="chips-col">${colonias.filter((x) => x.activa).map((x) => `<span class="chip-col">${esc(x.nombre)}<button type="button" data-tog="colonias" data-id="${x.id}" data-campo="activa" data-val="false" aria-label="Quitar ${esc(x.nombre)}">✕</button></span>`).join('')}</div>
      <form class="fila-btn" data-nuevo="colonias"><input name="nombre" placeholder="Ej. Col. Nueva" required><select name="tipo"><option>Colonia</option><option>Fraccionamiento</option><option>Comunidad</option><option>Barrio</option><option>Vialidad</option><option>Otro</option></select><button class="btn">Agregar</button></form></section>
    <section class="tarjeta"><h3>Necesidades en especie</h3><p class="tenue">También se actualizan desde Telegram con /necesidades.</p><ul class="cat">${necesidades.filter((n) => n.activa).map((n) => `<li><span>${esc(n.articulo)} ${n.urgente ? '<em class="pill p-rojo">Urgente</em>' : ''}</span>
      <span><button class="btn chico" data-tog="necesidades" data-id="${n.id}" data-campo="urgente" data-val="${!n.urgente}">${n.urgente ? 'Normal' : 'Urgente'}</button>
      <button class="btn chico" data-tog="necesidades" data-id="${n.id}" data-campo="activa" data-val="false">Quitar</button></span></li>`).join('')}</ul>
      <form class="fila-btn" data-nuevo="necesidades"><input name="articulo" placeholder="Ej. Guantes talla G" required><label class="fila-check"><input type="checkbox" name="urgente"> Urgente</label><button class="btn">Agregar</button></form></section>
    <section class="tarjeta"><h3>Noticias</h3><p class="tenue">Se publican desde Telegram con /noticia. Aquí puedes ocultarlas o destacarlas.</p>
      <ul class="cat">${noticias.slice().reverse().slice(0, 20).map((n) => `<li class="${n.visible ? '' : 'inactivo'}"><span>${n.destacada ? '★ ' : ''}${esc(n.titulo)} <small>${fecha(n.publicada_en)}</small></span>
      <span>${n.visible ? `<button class="btn chico" data-dest="${n.id}">Destacar</button>` : ''}<button class="btn chico" data-tog="noticias" data-id="${n.id}" data-campo="visible" data-val="${!n.visible}">${n.visible ? 'Ocultar' : 'Mostrar'}</button></span></li>`).join('')}</ul></section>`;
  activarImportar(ctx);
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
  activarRespaldo(ctx);
  document.getElementById('limpiar')?.addEventListener('click', async () => {
    if ($<HTMLInputElement>('confirma-limpiar').value.trim().toUpperCase() !== 'BORRAR') return aviso('Escribe BORRAR para confirmar.', true);
    const b = $<HTMLButtonElement>('limpiar'); b.disabled = true; b.textContent = 'Borrando…';
    try { await accion({ accion: 'limpiar' }); aviso('Listo: se borraron los datos de prueba.'); vistaAjustes(); }
    catch (e) { aviso(ERRORES[(e as Error).message] ?? 'No se pudo borrar.', true); b.disabled = false; b.textContent = 'Borrar datos de prueba'; }
  });
  raiz.querySelectorAll<HTMLButtonElement>('[data-tog]').forEach((b) => b.addEventListener('click', async () => {
    try { await actualizar(b.dataset.tog!, b.dataset.id!, { [b.dataset.campo!]: b.dataset.val === 'true' }); vistaAjustes(); } catch { aviso('No se pudo cambiar.', true); }
  }));
  raiz.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => b.addEventListener('click', async () => {
    try { for (const n of noticias.filter((x) => x.destacada)) await actualizar('noticias', n.id, { destacada: false });
      await actualizar('noticias', b.dataset.dest!, { destacada: true }); vistaAjustes(); } catch { aviso('No se pudo cambiar.', true); }
  }));
  let listaPer: Record<string, unknown>[] = [];
  document.getElementById('per-xls')?.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    try {
      const { leerExcel } = await import('./excel');
      const filas = leerExcel(new Uint8Array(await f.arrayBuffer()))[0].filas;
      const norm = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const cab = filas.findIndex((r) => r.some((x) => /^nombre$|^nombre completo/.test(norm(x))) || r.some((x) => /^nombre/.test(norm(x))));
      const h = filas[cab].map(norm); const col = (re: RegExp) => h.findIndex((x) => re.test(x));
      const cN = col(/^nombre$|^nombre completo|^nombre\(s\)/) >= 0 ? col(/^nombre$|^nombre completo|^nombre\(s\)/) : col(/^nombre(?! corto)/);
      const cK = col(/nombre corto|abreviado/), cC = col(/cargo|puesto|rango/), cR = col(/reportes? (de la )?app/), cI = col(/comunicacion interna|com\. interna/),
        cT = col(/telefono|celular/), cE = col(/e-?mail|correo/);
      const si = (x: unknown) => /^(si|sí|x|1|true|verdadero)$/i.test(String(x ?? '').trim());
      listaPer = filas.slice(cab + 1).map((r) => {
        const f: Record<string, unknown> = { nombre: String(r[cN] ?? '').replace(/\s+/g, ' ').trim() };
        if (cK >= 0) f.nombre_corto = String(r[cK] ?? '').trim() || null;
        f.cargo = cC >= 0 ? String(r[cC] ?? '').trim() || null : cN > 0 && cK < 0 ? String(r[cN - 1] ?? '').trim() || null : null;
        if (cR >= 0) f.reportes_app = si(r[cR]); if (cI >= 0) f.comunicacion_interna = si(r[cI]);
        if (cT >= 0) f.telefono = String(r[cT] ?? '').replace(/[^\d+]/g, '') || null;
        if (cE >= 0) f.email = String(r[cE] ?? '').trim().toLowerCase() || null;
        return f; }).filter((x) => String(x.nombre).length > 1);
      $('per-res').textContent = `${listaPer.length} personas leídas${cI >= 0 ? ` · ${listaPer.filter((x) => x.comunicacion_interna).length} con comunicación interna` : ''}.`;
      $<HTMLButtonElement>('per-imp').disabled = !listaPer.length;
    } catch { $('per-res').textContent = 'No se pudo leer el archivo.'; }
  });
  document.getElementById('per-imp')?.addEventListener('click', async () => {
    const b = $<HTMLButtonElement>('per-imp'); b.disabled = true;
    const { error } = await dbp.from('personal').upsert(listaPer.map((x) => ({ ...x, activo: true })), { onConflict: 'nombre' });
    if (error) { aviso('No se pudo importar.', true); b.disabled = false; return; }
    if ($<HTMLInputElement>('per-baja').checked) {
      const nombres = new Set(listaPer.map((x) => String(x.nombre)));
      for (const p of personal.filter((x) => x.activo && !nombres.has(x.nombre))) await actualizar('personal', p.id, { activo: false });
    }
    aviso(`Lista de personal actualizada: ${listaPer.length} personas.`); vistaAjustes();
  });
  document.getElementById('f-lote')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const txt = String(new FormData(e.target as HTMLFormElement).get('lista') ?? '');
    const filas = txt.split(/\n+/).map((l) => l.split(',')).map(([n, ...c]) => ({ nombre: n.trim(), cargo: c.join(',').trim() || null })).filter((x) => x.nombre.length > 2);
    let ok = 0; for (const f of filas) { try { await insertar('personal', f); ok++; } catch { /* repetido */ } }
    aviso(`Se agregaron ${ok} de ${filas.length}.`); vistaAjustes();
  });
  raiz.querySelectorAll<HTMLButtonElement>('[data-enlace]').forEach((b) => b.addEventListener('click', async () => {
    const txt = `Hola ${b.dataset.quien}: abre este enlace UNA vez desde tu Telegram para recibir los servicios de cabina SIMUB: ${b.dataset.enlace}`;
    try { await navigator.clipboard.writeText(txt); aviso('Mensaje con el enlace copiado. Pégalo en un chat privado con el oficial (es personal: no lo compartas en grupos).'); }
    catch { prompt('Copia este mensaje y envíalo al oficial por privado:', txt); }
  }));
  raiz.querySelectorAll<HTMLButtonElement>('[data-desbloq]').forEach((b) => b.addEventListener('click', async () => {
    try { await desbloquearAcceso(b.dataset.desbloq!); aviso('Cuenta desbloqueada.'); vistaAjustes(); } catch { aviso('No se pudo desbloquear.', true); }
  }));
  const formCuenta = (x?: Cuenta) => {
    document.querySelector('.cajon-fondo')?.remove();
    const f = document.createElement('div'); f.className = 'cajon-fondo';
    const sug = Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 56]).join('');
    f.innerHTML = `<aside class="cajon" role="dialog" aria-modal="true"><div class="det-cab"><div><h2>${x ? `Cambiar cuenta: ${esc(x.nombre)}` : 'Alta de cuenta'}</h2></div><button class="btn cerrar-x" data-x aria-label="Cerrar">✕</button></div>
      <form class="bloque" autocomplete="off">${x ? `<p class="tenue">${esc(x.email ?? '')}</p>` : '<label>Correo<input type="email" name="email" required autocomplete="off"></label>'}
        <label>Nombre (como aparece en el panel)<input name="nombre" required value="${esc(x?.nombre ?? '')}"></label>
        <label>Rol<select name="rol">${Object.entries(ROL_CUENTA).map(([k, t]) => `<option value="${k}" ${k === (x?.rol ?? 'guardia') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="rejilla-2"><label>Cargo<input name="cargo" value="${esc(x?.cargo ?? '')}" placeholder="Ej. Cabinero"></label><label>Unidad (solo rol Campo)<input name="unidad" value="${esc(x?.unidad ?? '')}"></label></div>
        <label>${x ? 'Contraseña nueva (déjala vacía para no cambiarla)' : 'Contraseña inicial'} <small>mín. 10 caracteres</small><input name="password" class="clave-oculta visible" autocomplete="off" spellcheck="false" ${x ? '' : `value="${sug}" required`} minlength="10"></label>
        <p class="tenue chica">Entrégala en persona o por el Excel de control con contraseña. Pide que la cambien la primera vez («¿Olvidaste tu contraseña?»).</p>
        <button class="btn primario">${x ? 'Guardar cambios' : 'Crear cuenta'}</button></form></aside>`;
    document.body.appendChild(f);
    f.addEventListener('click', (e) => { if (e.target === f || (e.target as HTMLElement).closest('[data-x]')) f.remove(); });
    f.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target as HTMLFormElement)) as Record<string, string>;
      if (!d.password) delete d.password;
      try { await guardarCuenta({ ...d, user_id: x?.user_id }); f.remove(); aviso(x ? 'Cuenta actualizada.' : 'Cuenta creada.'); vistaAjustes(); }
      catch (err) { aviso((err as Error).message === 'ya_existe' ? 'Ese correo ya tiene cuenta.' : 'No se pudo guardar la cuenta.', true); }
    });
  };
  document.getElementById('cta-nueva')?.addEventListener('click', () => formCuenta());
  raiz.querySelectorAll<HTMLButtonElement>('[data-cuenta]').forEach((b) => b.addEventListener('click', () => formCuenta(ctas.find((x) => x.user_id === b.dataset.cuenta))));
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
  if (mio.rol === 'campo' && !['campo', 'servicio', 'herramientas', 'mapa', 'unidades'].includes(ruta)) return vistaCampo(ctx);
  // Solo el Admin. Maestro: informes, voluntariado, control interno y ajustes.
  if (['informe', 'anual', 'app', 'voluntarios', 'control', 'ajustes'].includes(ruta) && mio.rol !== 'admin' && !mio.super) { location.replace('#mando'); return; }
  switch (ruta || 'mando') {
    case 'campo': return vistaCampo(ctx, arg);
    case 'unidades': return vistaUnidades(ctx);
    case 'mapa': return vistaMapa(ctx);
    case 'forestal': return vistaForestal(ctx);
    case 'herramientas': return vistaHerramientas(ctx);
    case 'capacitacion': return vistaCapacitacion(ctx);
    case 'mando': return vistaMando(ctx);
    case 'captura': return vistaCaptura(ctx, arg);
    case 'control': return vistaControl(ctx);
    case 'voluntarios': return vistaVoluntarios(ctx);
    case 'guardia': return vistaGuardia();
    case 'parte': return vistaParte(arg);
    case 'servicios': return vistaServicios(ctx);
    case 'servicio': return vistaServicio(ctx, arg);
    case 'agenda': return vistaAgenda(arg);
    case 'informe': return vistaInformes(ctx, 'mes');
    case 'anual': return vistaInformes(ctx, 'anio');
    case 'app': return vistaInforme();
    case 'ajustes': return vistaAjustes();
    default: return vistaReportes(arg);
  }
}
window.addEventListener('hashchange', ir);
// ---------------------------------------------------------------- dos ventanas (panel + tablero) siempre al día
const refrescar = () => refrescos.forEach((f) => { try { f(); } catch { /* vista cerrada */ } });
alCambiar(async (motivo) => {
  if (motivo === 'sesion') {
    // En el tablero no se recarga (perdería la sirena activada): solo se vuelve a leer quién está en turno.
    if (document.body.classList.contains('modo-guardia')) {
      const { data } = await dbp.auth.getSession();
      if (!data.session) { pantallaAcceso(); return; }
      mio = await yo().catch(() => mio); aviso(`En turno: ${mio?.nombre ?? ''}`); return;
    }
    location.reload(); return;
  }
  if (mio) refrescar();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && mio) refrescar(); });
window.addEventListener('focus', () => { if (mio) refrescar(); });
// Recarga preventiva cada 4 h (memoria y versión nueva) solo si nadie está escribiendo. El tablero no se recarga
// porque el navegador exige un toque para volver a activar la sirena.
const abierto = Date.now();
window.setInterval(() => {
  if (!mio || Date.now() - abierto < 4 * 3600e3) return;
  const ruta = location.hash.replace(/^#\/?/, '').split('/')[0] || 'mando';
  const ocupado = document.querySelector('.cajon-fondo') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '') || document.querySelector('form.parte, form.captura');
  if (!ocupado && ['mando', 'reportes', 'servicios', 'mapa'].includes(ruta)) location.reload();
}, 5 * 60000);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.cajon-fondo')?.remove(); });
iniciar();
