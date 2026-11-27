// SIMUB · Control interno: sesiones (quién entra, cuándo y cuánto tiempo), cambio de turno con contraseña propia,
// auditoría de ajustes y correcciones, copias de seguridad en la computadora y solicitudes de voluntariado.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../api';
import { activarClaves, campoClave, valorClave } from './clave';
import { avisarVentanas } from './ventanas';
import { CORPORACIONES } from './catalogo';
import { descargar, escribirExcel, type Celda } from './excel';
import {
  borrarAuditoria, control, dbp, entrar, estadoVoluntario, latido, respaldo, sesionCerrar, sesionIniciar, textoAcceso, voluntarios, yo, type Yo,
} from './datos';
import type { Ctx } from './mando';

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fh = (f?: string | null) => f ? new Date(f).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const dur = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;

// ---------------------------------------------------------------- sesión de trabajo
const CLAVE = 'simub-sesion';
let sesion: { id: number; user: string; inicio: string } | null = null;
let pulso: number | undefined;
export const equipo = () => { try { return localStorage.getItem('simub-equipo') || ''; } catch { return ''; } };
const nombreEquipo = () => equipo() || (/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Celular' : 'Computadora');
export const inicioSesion = () => sesion?.inicio ?? null;

/** Abre (o retoma tras recargar) la sesión de trabajo de quien entró y la mantiene viva con un latido cada minuto. */
export async function arrancarSesion(userId: string, anterior: number | null = null) {
  clearInterval(pulso);
  try { const g = JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null'); if (g?.user === userId && !anterior && (await latido(g.id)).activa) sesion = g; else sesion = null; } catch { sesion = null; }
  if (!sesion) {
    try { sesion = { id: await sesionIniciar(nombreEquipo(), anterior), user: userId, inicio: new Date().toISOString() }; } catch { sesion = null; }
  }
  try { sessionStorage.setItem(CLAVE, JSON.stringify(sesion)); } catch { /* */ }
  pulso = window.setInterval(() => { if (sesion) latido(sesion.id).catch(() => {}); }, 60000);
}
export async function terminarSesion(motivo = 'cierre') {
  clearInterval(pulso);
  if (sesion) { await sesionCerrar(sesion.id, motivo).catch(() => {}); }
  sesion = null; try { sessionStorage.removeItem(CLAVE); } catch { /* */ }
}

/** Cambio de turno: quien recibe entra con SU correo y contraseña. Queda anotado quién entregó y quién recibió. */
export function cambioTurno(c: Ctx, actual: Yo, alTerminar: () => void) {
  document.querySelector('.cajon-fondo')?.remove();
  const fondo = document.createElement('div'); fondo.className = 'cajon-fondo';
  fondo.innerHTML = `<aside class="cajon" role="dialog" aria-modal="true" aria-label="Cambio de turno">
    <div class="det-cab"><div><h2>Cambio de turno</h2><span class="tenue">Entrega: <b>${esc(actual.nombre)}</b></span></div><button class="btn cerrar-x" data-x aria-label="Cerrar">✕</button></div>
    <form class="bloque" id="f-turno" autocomplete="off"><p class="tenue">Quien recibe el turno entra con su propio correo y contraseña. El cambio queda en el control interno.</p>
      <label>Correo de quien recibe<input type="email" name="correo" required autocomplete="off"></label>
      ${campoClave('t-clave', 'Su contraseña')}
      <p class="error-txt" id="t-err" hidden></p>
      <button class="btn primario" type="submit">Recibir turno</button></form></aside>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector('[data-x]')!.addEventListener('click', cerrar);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  activarClaves(fondo); (fondo.querySelector('input') as HTMLInputElement).focus();
  fondo.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target as HTMLFormElement); const err = $('t-err'); err.hidden = true;
    const b = fondo.querySelector<HTMLButtonElement>('button[type=submit]')!; b.disabled = true; b.textContent = 'Verificando…';
    // 1) se verifica a quien recibe con un cliente aparte (si falla, el turno actual sigue intacto)
    const temp = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await entrar(String(fd.get('correo')).trim(), valorClave(fondo, 't-clave'), temp);
    const { data } = await temp.auth.getSession();
    if (!r.ok || !data.session) { err.textContent = textoAcceso(r); err.hidden = false; b.disabled = false; b.textContent = 'Recibir turno'; return; }
    // 2) se cierra la sesión de quien entrega y 3) se pasa la sesión a quien recibe
    const anterior = sesion?.id ?? null;
    await terminarSesion('cambio_turno');
    await dbp.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    const nuevo = await yo().catch(() => null);
    if (!nuevo) { c.aviso('Esa cuenta no tiene permiso en el panel. Pide al administrador que la dé de alta.', true); location.reload(); return; }
    await arrancarSesion(data.session.user.id, anterior);
    cerrar(); c.aviso(`Turno recibido por ${nuevo.nombre}.`); avisarVentanas('sesion'); alTerminar();
  });
}

// ---------------------------------------------------------------- vista: control interno (admin)
let diasControl = 7;
export async function vistaControl(c: Ctx) {
  c.marco('control', 'Control interno', 'Quién entró al panel, cuánto tiempo, qué folios capturó en su turno y cada cambio en ajustes o en registros cerrados.',
    '<div id="ctl"><p class="tenue">Cargando…</p></div>',
    `<label class="mes">Periodo <select id="ctl-dias">${[[1, 'Hoy'], [7, '7 días'], [31, '31 días'], [365, '1 año']].map(([d, t]) => `<option value="${d}" ${d === diasControl ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`);
  $<HTMLSelectElement>('ctl-dias').addEventListener('change', (e) => { diasControl = +(e.target as HTMLSelectElement).value; vistaControl(c); });
  const hasta = new Date(Date.now() + 864e5), desde = new Date(); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - diasControl + 1);
  let x: Awaited<ReturnType<typeof control>>;
  try { x = await control(desde, hasta); } catch { $('ctl').innerHTML = '<p class="tenue">Solo un administrador puede ver el control interno.</p>'; return; }
  const ACC: Record<string, string> = { insert: 'Agregó', update: 'Cambió', delete: 'Borró', cambio_turno: 'Cambio de turno', servicio_corregido: 'Corrigió parte',
    folio_anulado: 'Anuló folio', servicio_reabierto: 'Reabrió servicio', parte_desbloqueado: 'Desbloqueó parte', importacion_excel: 'Importó Excel',
    respaldo_descargado: 'Descargó copia', auditoria_borrada: 'Borró auditoría', datos_de_prueba_borrados: 'Borró datos de prueba' };
  const TABLA: Record<string, string> = { config_publica: 'Datos de la estación', unidades: 'Unidades', personal: 'Personal', necesidades: 'Necesidades', noticias: 'Noticias',
    miembros_panel: 'Cuentas del panel', catalogo_servicios: 'Catálogo', colonias: 'Colonias', servicios: 'Servicios', sesiones: 'Turnos' };
  const resumen = (d: Record<string, unknown> | null) => {
    if (!d) return '';
    if ('entrega' in d) return `${esc(d.entrega)} → ${esc(d.recibe)}`;
    if ('motivo' in d) return esc(d.motivo);
    if ('cambios' in d) return `${Object.keys(d.cambios as object).length} campos`;
    const ks = Object.keys(d).slice(0, 4);
    return ks.map((k) => { const v = d[k] as { antes?: unknown; despues?: unknown } | unknown;
      return v && typeof v === 'object' && 'despues' in (v as object) ? `${esc(k)}: ${esc(JSON.stringify((v as { antes: unknown }).antes)).slice(0, 40)} → ${esc(JSON.stringify((v as { despues: unknown }).despues)).slice(0, 40)}` : `${esc(k)}: ${esc(JSON.stringify(v)).slice(0, 60)}`; }).join('<br>');
  };
  $('ctl').innerHTML = `
    <section class="tarjeta"><h3>Sesiones y turnos</h3><div class="tabla-caja"><table class="tabla"><thead><tr><th>Persona</th><th>Cargo</th><th>Turno</th><th>Equipo</th><th>Entró</th><th>Salió</th><th>Tiempo</th><th>Cómo terminó</th><th>Folios capturados</th></tr></thead><tbody>
      ${x.sesiones.map((s) => `<tr><td><b>${esc(s.nombre)}</b>${s.turno_de ? `<br><small class="tenue">recibió de ${esc(s.turno_de)}</small>` : ''}</td><td>${esc(s.rol)}</td><td>${(() => { const h = new Date(s.inicio).getHours(); return h >= 8 && h < 20 ? 'Día' : 'Noche'; })()}</td><td>${esc(s.equipo ?? '')}</td>
        <td class="nw">${fh(s.inicio)}</td><td class="nw">${s.fin ? fh(s.fin) : '<em class="pill p-verde">En línea</em>'}</td><td class="nw">${dur(s.minutos)}</td>
        <td>${esc({ cierre: 'Cerró sesión', cambio_turno: 'Cambio de turno', inactividad: 'Sin actividad', nueva_sesion: 'Nueva sesión' }[s.motivo ?? ''] ?? '')}</td>
        <td>${s.folios.map((f) => `<code>${esc(f)}</code>`).join(' ') || '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="tenue">Sin sesiones en el periodo.</td></tr>'}</tbody></table></div></section>
    <section class="tarjeta"><div class="fila-tit"><h3>Movimientos en ajustes y registros</h3>${x.super ? '<button class="btn chico rojo" id="aud-borrar" disabled>Borrar seleccionados</button>' : '<span class="tenue chica">Solo el desarrollador puede borrar entradas.</span>'}</div>
      <div class="tabla-caja"><table class="tabla"><thead><tr>${x.super ? '<th></th>' : ''}<th>Fecha</th><th>Quién</th><th>Acción</th><th>Dónde</th><th>Registro</th><th>Detalle</th></tr></thead><tbody>
      ${x.auditoria.map((a) => `<tr>${x.super ? `<td><input type="checkbox" data-aud="${a.id}"></td>` : ''}<td class="nw">${fh(a.en)}</td><td>${esc(a.quien ?? 'sistema')}</td><td>${esc(ACC[a.accion] ?? a.accion)}</td>
        <td>${esc(TABLA[a.tabla ?? ''] ?? a.tabla ?? '')}</td><td>${esc(a.registro ?? '')}</td><td class="chica">${resumen(a.detalle)}</td></tr>`).join('') || `<tr><td colspan="7" class="tenue">Sin movimientos.</td></tr>`}</tbody></table></div></section>`;
  if (x.super) {
    const btn = $<HTMLButtonElement>('aud-borrar');
    $('ctl').addEventListener('change', () => { btn.disabled = !$('ctl').querySelector('[data-aud]:checked'); });
    btn.addEventListener('click', async () => {
      const ids = [...$('ctl').querySelectorAll<HTMLInputElement>('[data-aud]:checked')].map((i) => +i.dataset.aud!);
      if (!confirm(`¿Borrar ${ids.length} entradas? Quedará anotado que se borraron.`)) return;
      try { await borrarAuditoria(ids); vistaControl(c); } catch { c.aviso('No se pudo borrar.', true); }
    });
  }
}

// ---------------------------------------------------------------- copias de seguridad en la computadora
const hoyTxt = () => new Date().toLocaleDateString('sv-SE');
async function generarCopia(anio: number, c: Ctx, silencioso = false) {
  const r = await respaldo(anio);
  const S = r.servicios;
  const h = (f: string | null) => f ? new Date(f).toLocaleString('es-MX') : '';
  const filas: Celda[][] = [['AÑO', 'FOLIO', 'ESTADO', 'FECHA', 'CLASIFICACIÓN', 'FALSA ALARMA', 'ESPECIFICACIÓN', 'COLONIA', 'LUGAR', 'ÁREA', 'MEDIO', 'FOLIO 911',
    'REPORTANTE', 'TELÉFONO', 'UNIDADES', 'PERSONAL', 'TRIPULACIÓN', 'REPORTE', 'DESPACHO', 'LLEGADA', 'DISPONIBLE', 'BASE', 'KM SALIDA', 'KM LLEGADA',
    'CORPORACIONES', 'VEHÍCULOS', 'PERSONAS', 'OBSERVACIONES', 'JEFE DE SERVICIO', 'RADIO OPERADOR', 'JEFE DE GUARDIA', 'FIRMADO', 'CAPTURÓ', 'ORIGEN']];
  for (const s of S) filas.push([s.anio, s.folio, s.estado, s.fecha, s.clasificacion, s.falsa_alarma ? 'SÍ' : '', s.especificacion, s.colonia, s.lugar, s.area_afectada,
    s.medio, s.datos?.folio_911 ?? '', s.reportante, s.telefono, (s.unidades ?? []).join(' / '), s.personal_num,
    (s.tripulacion ?? []).map((t) => `${t.unidad}: ${[t.maquinista, t.jefe, t.bomberos].filter(Boolean).join(', ')}`).join(' | '),
    h(s.h_reporte), h(s.h_despacho), h(s.h_llegada), h(s.h_disponible), h(s.h_base), s.km_salida, s.km_llegada,
    Object.entries(s.apoyos ?? {}).map(([k, v]) => `${k}${v?.unidades ? ` (${v.unidades})` : ''}`).join(', '),
    (s.vehiculos ?? []).map((v) => Object.values(v).filter(Boolean).join(' ')).join(' | '),
    (s.personas ?? []).map((p) => [p.nombre, p.codigo, p.edad].filter(Boolean).join(' ')).join(' | '),
    s.observaciones, s.jefe_servicio, s.radio_operador, s.jefe_guardia, s.bloqueado ? 'SÍ' : '', s.capturo, s.origen] as Celda[]);
  const bit: Celda[][] = [['SERVICIO', 'FECHA', 'TEXTO', 'AUTOR'], ...r.bitacora.map((b) => [b.servicio, h(b.en), b.texto, b.autor] as Celda[])];
  const base = `SIMUB_copia_${anio}_${hoyTxt()}`;
  descargar(escribirExcel([{ nombre: `SERVICIOS ${anio}`, filas, anchos: filas[0].map(() => 16) }, { nombre: 'BITACORA', filas: bit, anchos: [12, 20, 60, 20] }]), `${base}.xlsx`);
  // la copia completa (para restaurar) sin las imágenes de firma, que pesan
  const ligera = { ...r, servicios: S.map((s) => ({ ...s, firmas: Object.fromEntries(Object.entries(s.firmas ?? {}).map(([k, v]) => [k, { ...v, imagen: '(imagen)' }])) })) };
  setTimeout(() => descargar(new Blob([JSON.stringify(ligera)], { type: 'application/json' }), `${base}.json`), 600);
  if (!silencioso) c.aviso(`Copia ${anio} descargada: ${S.length} servicios (Excel y archivo completo).`);
  return S.length;
}

const AUTO = 'simub-respaldo-auto';
type Auto = { frecuencia: 'no' | 'diaria' | 'semanal' | 'mensual'; ultima: string | null };
const leerAuto = (): Auto => { try { return { frecuencia: 'no', ultima: null, ...JSON.parse(localStorage.getItem(AUTO) ?? '{}') }; } catch { return { frecuencia: 'no', ultima: null }; } };
const guardarAuto = (a: Auto) => { try { localStorage.setItem(AUTO, JSON.stringify(a)); } catch { /* */ } };

/** Si esta computadora tiene copia automática y ya toca, la descarga sola (en Descargas o la carpeta que use Chrome). */
export async function copiaAutomatica(c: Ctx) {
  const a = leerAuto(); if (a.frecuencia === 'no') return;
  const dias = { diaria: 1, semanal: 7, mensual: 30 }[a.frecuencia];
  if (a.ultima && Date.now() - new Date(a.ultima).getTime() < dias * 864e5 - 36e5) return;
  try { const n = await generarCopia(new Date().getFullYear(), c, true); guardarAuto({ ...a, ultima: new Date().toISOString() }); c.aviso(`Copia automática ${a.frecuencia} guardada en esta computadora (${n} servicios).`); }
  catch { /* se reintenta la próxima vez */ }
}

export const tarjetaRespaldo = () => {
  const a = leerAuto();
  return `<section class="tarjeta"><h3>Copias de seguridad</h3>
  <p class="tenue">Automáticas en la nube: GitHub guarda una copia cifrada de toda la base <b>cada día</b> (30 días), <b>cada semana</b> (90 días) y <b>cada mes</b> (sin vencimiento).</p>
  <h4>Copia en esta computadora</h4>
  <div class="fila-btn"><input type="number" id="rsp-anio" class="anio" value="${new Date().getFullYear()}" min="2007" max="2100" aria-label="Año">
    <button class="btn primario" id="rsp-ya" type="button">Descargar copia del año</button></div>
  <label class="fila-check"><span>Copia automática en esta computadora</span><select id="rsp-auto">${[['no', 'No'], ['diaria', 'Diaria'], ['semanal', 'Semanal'], ['mensual', 'Mensual']]
    .map(([k, t]) => `<option value="${k}" ${a.frecuencia === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
  <p class="tenue chica">${a.ultima ? `Última copia automática: ${fh(a.ultima)}.` : 'Aún no hay copia automática en esta computadora.'}
   Se descarga sola al abrir el panel cuando toca (Excel + archivo completo). Si en Chrome eliges como carpeta de descargas una carpeta de
   Google Drive para escritorio, las copias también quedan en Drive.</p>
  <label>Nombre de esta computadora <small>(aparece en el control interno)</small><input id="rsp-equipo" value="${esc(equipo())}" placeholder="Ej. Cabina"></label></section>`;
};
export function activarRespaldo(c: Ctx) {
  $('rsp-ya').addEventListener('click', async () => {
    const b = $<HTMLButtonElement>('rsp-ya'); b.disabled = true; b.textContent = 'Preparando…';
    try { await generarCopia(+$<HTMLInputElement>('rsp-anio').value, c); } catch { c.aviso('No se pudo generar la copia.', true); }
    b.disabled = false; b.textContent = 'Descargar copia del año';
  });
  $('rsp-auto').addEventListener('change', (e) => { guardarAuto({ ...leerAuto(), frecuencia: (e.target as HTMLSelectElement).value as Auto['frecuencia'] }); c.aviso('Listo. Se aplica en esta computadora.'); });
  $('rsp-equipo').addEventListener('change', (e) => { try { localStorage.setItem('simub-equipo', (e.target as HTMLInputElement).value.trim()); } catch { /* */ } c.aviso('Nombre guardado.'); });
}

// ---------------------------------------------------------------- vista: voluntariado (admin y coordinación)
export async function vistaVoluntarios(c: Ctx) {
  c.marco('voluntarios', 'Solicitudes de voluntariado', 'Llegan desde la app (sección Noticias y Apoya). Se borran solas a los 12 meses.', '<div id="vol"><p class="tenue">Cargando…</p></div>');
  let xs: Awaited<ReturnType<typeof voluntarios>> = [];
  try { xs = await voluntarios(); } catch { $('vol').innerHTML = '<p class="tenue">Sin permiso.</p>'; return; }
  const EST = [['nuevo', 'Nueva'], ['contactado', 'Contactado'], ['aceptado', 'Aceptado'], ['descartado', 'Descartado']];
  $('vol').innerHTML = `<section class="tarjeta"><div class="tabla-caja"><table class="tabla"><thead><tr><th>Fecha</th><th>Nombre</th><th>Edad</th><th>Contacto</th><th>Escolaridad</th><th>Actualmente</th><th>Disponibilidad</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>
    ${xs.map((v) => `<tr><td class="nw">${fh(v.creado_en)}</td><td><b>${esc(v.nombre)}</b></td><td>${v.edad}</td>
      <td class="nw"><a href="tel:${esc(v.telefono)}">${esc(v.telefono)}</a>${v.correo ? `<br><a href="mailto:${esc(v.correo)}">${esc(v.correo)}</a>` : ''}</td>
      <td>${esc(v.escolaridad ?? '')}</td><td>${esc(v.ocupacion ?? '')}</td><td>${esc(v.disponibilidad.join(', '))}</td><td class="chica">${esc(v.motivo ?? '')}</td>
      <td><select data-vol="${v.id}">${EST.map(([k, t]) => `<option value="${k}" ${v.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select></td></tr>`).join('')
      || '<tr><td colspan="9" class="tenue">Aún no hay solicitudes.</td></tr>'}</tbody></table></div></section>`;
  $('vol').querySelectorAll<HTMLSelectElement>('[data-vol]').forEach((s) => s.addEventListener('change', async () => {
    try { await estadoVoluntario(s.dataset.vol!, s.value); c.aviso('Estado actualizado.'); } catch { c.aviso('No se pudo cambiar.', true); }
  }));
}

export const CORPS = CORPORACIONES;
