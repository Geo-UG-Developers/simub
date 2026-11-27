// SIMUB · Centro de mando (varias emergencias a la vez), bitácora de servicios (folio único),
// parte de servicio con el formato de SIMUB, informes mensual y anual como su Excel, e importación del histórico.
import L from 'leaflet';
import { I } from '../iconos';
import { FORMULARIOS } from '../formularios';
import { CORPORACIONES, MEDIOS, MESES_TXT, leerHistorico, type Clase } from './catalogo';
import { descargar, escribirExcel, leerExcel, type Celda } from './excel';
import { entregarPdf, servicioPdf } from './pdf';
import { clima, detalleClima, pastillaClima, widgetClima } from './clima';
import { columnas } from './graficas';
import { activarClaves, campoClave, valorClave } from './clave';
import { avisarVentanas } from './ventanas';
import { activarBuscadores, buscador, cargarLugares, fuente } from './buscador';
import { inicioSesion } from './control';
import {
  CODIGOS_PERSONA, COLORES, ESPECIFICACIONES, TIPOS_VEHICULO, activarAgregables, activarArea, activarMulti, area, datalist, filasAgregables, huella,
  lienzoFirma, multi, persona, valoresMulti,
} from './selectores';
import {
  anularServicio, autorizarEdicion, detalle as detalleReporte, bitacora, enviarInterno as enviarInternoD, enviarOficial as enviarOficialD, oficiales, cerrarServicio, conteos, desbloquear, estadoUnidad, firmar, guardarServicio, importarServicios, mando, reabrirServicio,
  registrarImportacion, servicio, servicioDesdeReporte, guardarGuardia, notificar, accion, urlsEvidencias, servicioParcial as servicioParcialP,  servicios, tabla, type Mando, type Rol, type Servicio, type ServicioLista, type Unidad, type Yo,
} from './datos';

export interface Ctx {
  raiz: HTMLElement; rol: () => Rol;
  marco: (activa: string, titulo: string, sub: string, contenido: string, acciones?: string) => void;
  aviso: (t: string, error?: boolean) => void;
  ciclo: (fn: () => void, ms: number) => void;
  nuevoMapa: (id: string) => L.Map;
  errores: Record<string, string>;
  yo: () => Yo;
  turno: () => void;
}

const BASE = import.meta.env.BASE_URL;
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hora = (f?: string | null) => f ? new Date(f).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const fechaCorta = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
const localInput = (f?: string | null) => { if (!f) return ''; const d = new Date(f); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const desdeLocal = (v: string) => v ? new Date(v).toISOString() : '';
const minDesde = (f?: string | null) => f ? Math.max(0, Math.floor((Date.now() - new Date(f).getTime()) / 60000)) : 0;
const dur = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
export const folioTxt = (s: { anio: number; folio: number }) => `${s.anio}-${String(s.folio).padStart(4, '0')}`;
const puedeExportar = (c: Ctx) => c.rol() !== 'guardia';

// ---------------------------------------------------------------- catálogo (una vez por sesión)
let CAT: Clase[] = [];
let CATM: Record<string, Clase> = {};
async function catalogo() {
  if (!CAT.length) { CAT = await tabla<Clase>('catalogo_servicios', 'orden'); CATM = Object.fromEntries(CAT.map((c) => [c.id, c])); }
  return CAT;
}
const clase = (id: string) => CATM[id] ?? { id, grupo: 'Otros', nombre: id, color: '#ddd', orden: 999, activo: true };
const claveCuenta = (s: { falsa_alarma: boolean; clasificacion: string }) => s.falsa_alarma ? 'falsa' : s.clasificacion;
const opcionesClase = (sel = '') => {
  const grupos = [...new Set(CAT.filter((c) => c.id !== 'falsa').map((c) => c.grupo))];
  return `<option value="">Elige el tipo de servicio…</option>` + grupos.map((g) => `<optgroup label="${esc(g)}">${CAT.filter((c) => c.grupo === g && c.id !== 'falsa' && (c.activo || c.id === sel))
    .map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</optgroup>`).join('');
};
const pildora = (id: string, falsa = false) => { const c = clase(id); return `<em class="pill-cls" style="--c:${c.color}">${falsa ? 'FALSA ALARMA · ' : ''}${esc(c.nombre)}</em>`; };

function cajon(html: string, etiqueta: string) {
  document.querySelector('.cajon-fondo')?.remove();
  const fondo = document.createElement('div'); fondo.className = 'cajon-fondo';
  fondo.innerHTML = `<aside class="cajon" role="dialog" aria-modal="true" aria-label="${esc(etiqueta)}">${html}</aside>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  fondo.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-x]')) cerrar(); });
  (fondo.querySelector('input,select,textarea') as HTMLElement | null)?.focus();
  return { fondo, cerrar };
}
const cabCajon = (t: string, sub = '') => `<div class="det-cab"><div><h2>${t}</h2>${sub ? `<span class="tenue">${sub}</span>` : ''}</div><button class="btn cerrar-x" data-x aria-label="Cerrar">${I.cerrar(18)}</button></div>`;

// ================================================================ CENTRO DE MANDO
const HITOS: [keyof Servicio, string, string][] = [['h_despacho', 'despacho', 'Despacho'], ['h_llegada', 'llegada', 'En la escena'], ['h_disponible', 'disponible', 'Unidad disponible'], ['h_base', 'base', 'En base']];
const EST_U: Record<string, { txt: string; cls: string }> = {
  disponible: { txt: 'Disponible', cls: 'u-verde' }, en_servicio: { txt: 'En servicio', cls: 'u-rojo' }, fuera_servicio: { txt: 'Fuera de servicio', cls: 'u-gris' },
};

export async function vistaMando(c: Ctx) {
  c.marco('mando', 'Centro de mando', 'Servicios en curso, estado de las unidades y bitácora. Se actualiza solo cada 15 segundos.',
    `<div id="m-guardia" class="m-guardia"></div><div id="m-clima-w"></div><div id="m-alertas"></div><div id="m-pend"></div>
     <section class="tarjeta"><div class="fila-tit"><h3>Unidades</h3><span class="tenue chica">Toca una unidad para cambiar su estado.</span></div><div id="m-unidades" class="unidades"></div></section>
     <div class="fila-tit"><h3 id="m-tit">Servicios activos</h3><span class="tenue chica" id="m-act"></span></div>
     <div id="m-servicios" class="m-rejilla"><p class="tenue">Cargando…</p></div>`,
    `<button class="btn" id="m-turno">${I.lista(16)} Cambio de cabinero</button>
     <a class="btn" href="#guardia" target="simub-tablero" title="Se abre en otra ventana">${I.campana(16)} Tablero de guardia</a>
     <a class="btn primario btn-generar" href="#captura">${I.mas(20)} Generar servicio</a>`);
  $('m-turno').addEventListener('click', () => c.turno());
  const pintarClima = async () => { const k = await clima(); const e = document.getElementById('m-clima-w'); if (e) e.innerHTML = widgetClima(k); };
  pintarClima(); c.ciclo(pintarClima, 15 * 60000);
  document.querySelector('.cabecera p.tenue')!.insertAdjacentHTML('afterend', `<p class="en-turno">En turno: <b>${esc(c.yo().nombre)}</b>${c.yo().cargo ? ` · ${esc(c.yo().cargo)}` : ''}${inicioSesion() ? ` · desde ${hora(inicioSesion())}` : ''}</p>`);
  await catalogo().catch(() => c.aviso('No se pudo cargar el catálogo de servicios.', true));
  let m: Mando | null = null;
  const pintar = () => {
    if (!m) return;
    $('m-act').textContent = `Actualizado ${hora(new Date().toISOString())} · ${m.hoy} servicios hoy`;
    $('m-tit').textContent = `Servicios activos (${m.servicios.length})`;
    const n = document.getElementById('n-mando'); if (n) n.textContent = m.servicios.length ? String(m.servicios.length) : '';
    const g = m.guardia, al = m.alertas;
    $('m-guardia').innerHTML = g ? `<span class="pill ${g.turno === 'dia' ? 'p-dorado' : 'p-noche'}">Turno de ${g.turno === 'dia' ? 'día' : 'noche'}</span>
      <span>Jefe de guardia: <b>${esc(g.jefe ?? 'sin registrar')}</b> · ${g.personal.length} en el pase de lista</span>
      <button class="btn chico" data-pase="1">${g.jefe ? 'Editar guardia' : 'Registrar guardia y pase de lista'}</button>` : '';
    const avisos: string[] = [];
    if (al?.sin_inspeccion.length) avisos.push(`<a href="#unidades">${al.sin_inspeccion.length} unidad(es) sin revisión este turno: ${esc(al.sin_inspeccion.join(', '))}</a>`);
    if (al?.caducidades.length) avisos.push(`<a href="#unidades">${al.caducidades.length} artículo(s) caducan en 30 días o menos</a>`);
    if (al?.mantenimiento.length) avisos.push(`<a href="#unidades">Mantenimiento próximo: ${esc(al.mantenimiento.map((x) => `${x.unidad} (${x.tipo})`).join(', '))}</a>`);
    if (al?.certificaciones.length) avisos.push(`<a href="#capacitacion">${al.certificaciones.length} certificación(es) por vencer</a>`);
    if (al?.sin_firma) avisos.push(`<a href="#servicios">${al.sin_firma} parte(s) concluidos hace más de 24 h sin firma</a>`);
    $('m-alertas').innerHTML = avisos.length ? `<div class="m-avisos">${avisos.map((x) => `<span>${x}</span>`).join('')}</div>` : '';
    $('m-pend').innerHTML = m.pendientes.length ? `<section class="tarjeta aviso-app"><h3>${I.campana(18)} Reportes de la app sin servicio (${m.pendientes.length})</h3>
      ${m.pendientes.map((p) => `<div class="fila-pend"><span class="ic-t" style="background:${FORMULARIOS[p.tipo].color}">${I[p.tipo](16)}</span>
        <span class="f-info"><b>${esc(FORMULARIOS[p.tipo].nombre)} · ${esc(p.folio)}</b><small>${hora(p.creado_en)} · hace ${dur(minDesde(p.creado_en))}${p.referencia ? ` · ${esc(p.referencia)}` : ''}${(p.resumen ?? []).length ? ` · ${esc(p.resumen!.slice(0, 2).join(' · '))}` : ''}</small></span>
        <a class="btn chico" href="#reportes/${p.id}">Ver</a><a class="btn chico primario" href="#captura/${p.id}">${I.mas(14)} Generar servicio</a></div>`).join('')}</section>` : '';
    $('m-unidades').innerHTML = m.unidades.map((u) => `<button class="unidad ${EST_U[u.estado].cls}" data-u="${u.id}" title="${esc(u.tipo ?? '')}">
      <b>${esc(u.nombre)}</b><small>${u.estado === 'en_servicio' && u.folio ? `Folio ${u.folio}` : esc(u.nota ?? EST_U[u.estado].txt)}</small></button>`).join('')
      || '<p class="tenue">Agrega las unidades en Ajustes.</p>';
    $('m-servicios').innerHTML = m.servicios.length ? m.servicios.map((s) => {
      const cl = clase(s.clasificacion), min = minDesde(s.h_reporte ?? s.creado_en);
      const sig = HITOS.find(([k]) => !s[k]);
      return `<article class="m-card" style="--c:${cl.color}">
        <header><span class="m-folio">#${s.folio}</span>${pildora(s.clasificacion, s.falsa_alarma)}${s.turno ? `<em class="pill ${s.turno === 'dia' ? 'p-dorado' : 'p-noche'}">${s.turno === 'dia' ? 'Día' : 'Noche'}</em>` : ''}<span class="m-min ${min >= 60 ? 'largo' : ''}">${dur(min)}</span></header>
        <p class="m-lugar">${I.pin(14)} ${esc([s.colonia, s.lugar].filter(Boolean).join(', ') || 'Sin lugar')}${s.especificacion ? ` · <span class="tenue">${esc(s.especificacion)}</span>` : ''}</p>
        <p class="tenue chica">${esc(s.medio ?? '')}${s.datos?.folio_911 ? ` ${esc(s.datos.folio_911)}` : ''}${s.reportante ? ` · ${esc(s.reportante)}` : ''} · reporte ${hora(s.h_reporte)} · capturó ${esc(s.capturo ?? '')}</p>
        <div class="m-unid">${s.unidades.map((u) => `<span class="u-chip">${esc(u)}</span>`).join('') || '<span class="alerta-txt chica">Sin unidad asignada</span>'}
          ${s.escena ? `<span class="pill p-ambar">${s.escena} en escena</span>` : ''}${(s.voy ?? []).length ? `<span class="tenue chica">Van: ${esc(s.voy!.join(', '))}</span>` : ''}
          ${Object.keys(s.apoyos ?? {}).length ? `<span class="tenue chica">Apoyo: ${esc(Object.keys(s.apoyos).join(', '))}</span>` : ''}</div>
        <ol class="m-cron">${HITOS.map(([k, , t]) => `<li class="${s[k] ? 'ok' : ''}"><span>${t}</span><b>${hora(s[k] as string | null) || '—'}</b></li>`).join('')}</ol>
        <ul class="m-bit">${(s.bitacora ?? []).slice(0, 3).map((b) => `<li><b>${hora(b.en)}</b> ${esc(b.texto)} <small>${esc(b.autor ?? '')}</small></li>`).join('')}</ul>
        <footer class="m-acciones">
          <div class="m-fila"><span class="m-etq">Operación</span>${sig ? `<button class="btn chico primario" data-hito="${sig[1]}" data-s="${s.id}">${sig[2]} ahora</button>` : ''}
            <button class="btn chico" data-nota="${s.id}">Nota</button><a class="btn chico" href="#servicio/${s.id}">Parte</a>
            <button class="btn chico btn-concluir" data-fin="${s.id}">Concluir</button></div>
          <div class="m-fila m-com"><span class="m-etq">Telegram</span>
            <button class="btn chico ${(s.enviado_oficial ?? []).length ? 'enviado' : 'btn-of'}" data-oficial="${s.id}">${(s.enviado_oficial ?? []).length ? 'Reenviar al oficial' : 'Enviar a oficial'}</button>
            <button class="btn chico ${s.enviado_interno ? 'enviado' : ''}" data-interno="${s.id}">${s.enviado_interno ? 'Reenviar a com. interna' : 'Enviar a comunicación interna'}</button>
            ${(s.enviado_oficial ?? []).length ? `<small class="tenue">✔ ${esc(s.enviado_oficial!.join(', '))}</small>` : ''}${s.enviado_interno ? '<small class="tenue">✔ grupo interno</small>' : ''}</div></footer></article>`;
    }).join('') : `<div class="vacio-m">${I.check(40)}<b>Sin servicios activos</b><span>Captura aquí cada salida: llamadas, radio, 911, app o servicios de rutina.</span></div>`;
  };
  const cargar = async () => { try { m = await mando(); pintar(); } catch { $('m-act').innerHTML = '<span class="alerta-txt">Sin conexión con el servidor</span>'; } };
  // El escuchador vive en el marco de esta vista: al cambiar de sección se descarta junto con él.
  c.raiz.querySelector('.marco')!.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.clima !== undefined) { const k = await clima(); cajon(`${cabCajon('Tiempo y riesgo de incendio', 'Guanajuato capital')}${detalleClima(k)}`, 'Clima'); return; }
    if (!m) return;
    if (b.dataset.u) return menuUnidad(c, m.unidades.find((u) => u.id === Number(b.dataset.u))!, cargar);
    if (b.dataset.nota) return notaServicio(c, b.dataset.nota, cargar);
    if (b.dataset.oficial) return enviarAOficial(c, m.servicios.find((x) => x.id === b.dataset.oficial)!, cargar);
    if (b.dataset.interno) return enviarAInterno(c, m.servicios.find((x) => x.id === b.dataset.interno)!, cargar);
    try {
      if (b.dataset.pase) return paseDeLista(c, m.guardia, cargar);
      if (b.dataset.hito) { b.disabled = true; await bitacora(b.dataset.s!, null, b.dataset.hito); notificar(b.dataset.s!); avisarVentanas(); }
      else if (b.dataset.fin) {
        if (!confirm('¿Concluir el servicio? Las unidades quedan disponibles. Después llena o revisa el parte.')) return;
        await cerrarServicio(b.dataset.fin); notificar(b.dataset.fin); avisarVentanas(); c.aviso('Servicio concluido. Revisa su parte de servicio.');
      } else if (b.dataset.desde) { b.disabled = true; const r = await servicioDesdeReporte(b.dataset.desde); notificar(r.id); location.hash = `#servicio/${r.id}`; return; }
      else return;
    } catch (err) { c.aviso(c.errores[(err as Error).message] ?? 'No se pudo guardar.', true); }
    cargar();
  });
  await cargar(); c.ciclo(cargar, 15000);
}

// ---------------------------------------------------------------- envíos por Telegram (con confirmación para evitar envíos por error)
function enviarAOficial(c: Ctx, s: Servicio & { enviado_oficial?: string[] }, listo: () => void) {
  const { fondo, cerrar } = cajon(`${cabCajon('Enviar a oficial', `Folio #${s.folio} · ${esc(clase(s.clasificacion).nombre)}`)}<div class="bloque" id="of-caja"><p class="tenue">Cargando oficiales…</p></div>`, 'Enviar a oficial');
  const caja = fondo.querySelector<HTMLElement>('#of-caja')!;
  oficiales().then((xs) => {
    if (!xs.length) { caja.innerHTML = '<p class="tenue">No hay personal marcado con «Comunicación interna». El Admin. Maestro lo marca en Ajustes › Personal.</p>'; return; }
    caja.innerHTML = `<p>Se envía <b>por mensaje privado de Telegram</b>: resumen, ubicación en Google Maps, folio, <b>nombre y teléfono de quien reporta</b>,
        botón para compartir su ubicación y enlace para llenar el parte.</p>
      <form id="of-f"><div class="of-lista">${xs.map((o) => `<label class="of-item ${o.vinculado ? '' : 'sin'}"><input type="checkbox" name="of" value="${o.id}" ${o.vinculado ? '' : 'disabled'}
        ${(s.enviado_oficial ?? []).includes(o.corto) ? 'data-ya="1"' : ''}><span><b>${esc(o.corto)}</b><small>${esc(o.nombre)}${o.vinculado ? '' : ' · aún no abre su enlace del bot'}</small></span>
        ${(s.enviado_oficial ?? []).includes(o.corto) ? '<em class="pill p-verde">Ya enviado</em>' : ''}${o.comparte ? '<em class="pill p-dorado">En mapa</em>' : ''}</label>`).join('')}</div>
      <div class="fila-btn"><button class="btn primario" type="submit">Continuar</button><button class="btn" type="button" data-x>Cancelar</button></div></form>`;
    caja.querySelector('[data-x]')!.addEventListener('click', cerrar);
    caja.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault(); const ids = new FormData(e.target as HTMLFormElement).getAll('of').map(Number);
      if (!ids.length) return c.aviso('Marca al menos un oficial.', true);
      const nombres = xs.filter((o) => ids.includes(o.id)).map((o) => o.corto);
      caja.innerHTML = `<div class="confirmar"><p>¿Enviar el folio <b>#${s.folio}</b> a <b>${esc(nombres.join(', '))}</b>?</p>
        <p class="tenue chica">Incluye datos personales de quien reporta: verifica que sean los oficiales correctos.</p>
        <div class="fila-btn"><button class="btn primario" id="of-si">Sí, enviar</button><button class="btn" id="of-no">Volver</button></div></div>`;
      caja.querySelector('#of-no')!.addEventListener('click', () => { cerrar(); enviarAOficial(c, s, listo); });
      caja.querySelector<HTMLButtonElement>('#of-si')!.addEventListener('click', async (ev) => {
        const b = ev.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = 'Enviando…';
        try {
          const r = await enviarOficialD(s.id, ids);
          caja.innerHTML = `<div class="folio-ok">${I.check(40)}<b>${r.enviados.length ? 'Mensaje enviado' : 'No se envió'}</b>
            ${r.enviados.length ? `<p>Enviado por Telegram a: <b>${esc(r.enviados.join(', '))}</b>.</p>` : ''}
            ${r.sin_telegram.length ? `<p class="alerta-txt">Sin Telegram vinculado: ${esc(r.sin_telegram.join(', '))}. Pídeles abrir su enlace del bot.</p>` : ''}
            <button class="btn" data-x>Cerrar</button></div>`;
          caja.querySelector('[data-x]')!.addEventListener('click', cerrar); avisarVentanas(); listo();
        } catch (err) { c.aviso(c.errores[(err as Error).message] ?? 'No se pudo enviar. Revisa el internet.', true); b.disabled = false; b.textContent = 'Sí, enviar'; }
      });
    });
  }).catch(() => { caja.innerHTML = '<p class="alerta-txt">No se pudo cargar la lista de oficiales.</p>'; });
}
function enviarAInterno(c: Ctx, s: Servicio & { enviado_interno?: boolean }, listo: () => void) {
  const { fondo, cerrar } = cajon(`${cabCajon(s.enviado_interno ? 'Reenviar a comunicación interna' : 'Enviar a comunicación interna', `Folio #${s.folio}`)}
    <div class="bloque confirmar"><p>Se envía al <b>grupo de comunicación interna</b> un resumen de la emergencia y su folio:
      <b>${esc(clase(s.clasificacion).nombre)}</b> en ${esc([s.colonia, s.lugar].filter(Boolean).join(', ') || 'sin lugar')}, unidades y horas.</p>
      <p class="tenue chica">No incluye nombre ni teléfono de quien reporta ni otros datos personales.</p>
      <div class="fila-btn"><button class="btn primario" id="in-si">Sí, enviar al grupo</button><button class="btn" data-x>Cancelar</button></div></div>`, 'Comunicación interna');
  fondo.querySelector<HTMLButtonElement>('#in-si')!.addEventListener('click', async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = 'Enviando…';
    try { await enviarInternoD(s.id); cerrar(); c.aviso('Enviado al grupo de comunicación interna.'); avisarVentanas(); listo(); }
    catch (err) { c.aviso((err as Error).message === 'sin_grupo' ? 'Falta vincular el grupo de comunicación interna (Ajustes › Telegram).' : 'No se pudo enviar.', true); b.disabled = false; b.textContent = 'Sí, enviar al grupo'; }
  });
}

function notaServicio(c: Ctx, id: string, listo: () => void) {
  const { fondo, cerrar } = cajon(`${cabCajon('Nota en la bitácora', 'Queda con tu nombre y la hora')}
    <form class="bloque"><label>Qué pasó<textarea name="t" rows="4" maxlength="1000" required placeholder="Ej. Se solicita apoyo de Cruz Roja; 2 lesionados"></textarea></label>
    <button class="btn primario">Agregar</button></form>`, 'Nota');
  fondo.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault(); const t = String(new FormData(e.target as HTMLFormElement).get('t') ?? '').trim(); if (!t) return;
    try { await bitacora(id, t); cerrar(); listo(); } catch { c.aviso('No se pudo guardar la nota.', true); }
  });
}

function menuUnidad(c: Ctx, u: Unidad, listo: () => void) {
  const { fondo, cerrar } = cajon(`${cabCajon(`Unidad ${esc(u.nombre)}`, `${esc(u.tipo ?? '')} · ${EST_U[u.estado].txt}${u.folio ? ` (folio ${u.folio})` : ''}`)}
    <form class="bloque"><label>Nota <small>(opcional: taller, sin combustible, comisión…)</small><input name="nota" maxlength="120" value="${esc(u.nota ?? '')}"></label>
    <div class="fila-btn"><button class="btn primario" value="disponible">Disponible</button><button class="btn" value="fuera_servicio">Fuera de servicio</button></div>
    ${u.estado === 'en_servicio' ? '<p class="tenue chica">Marcarla disponible la libera de su servicio y queda anotado en la bitácora.</p>' : ''}</form>`, 'Unidad');
  fondo.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault(); const sub = (e as SubmitEvent).submitter as HTMLButtonElement;
    try { await estadoUnidad(u.id, sub.value as 'disponible', String(new FormData(e.target as HTMLFormElement).get('nota') ?? '')); cerrar(); listo(); }
    catch { c.aviso('No se pudo cambiar la unidad.', true); }
  });
}

// ================================================================ BITÁCORA DE SERVICIOS (lista mensual)
let mesLista = new Date().toISOString().slice(0, 7);
export async function vistaServicios(c: Ctx) {
  c.marco('servicios', 'Servicios', 'Todos los servicios del mes con su folio. Reemplaza la hoja mensual del Excel.',
    `<div class="filtros"><input id="buscar" type="search" placeholder="Buscar folio, lugar, unidad…"><select id="f-cls"><option value="">Todos los tipos</option></select></div>
     <section class="tarjeta"><div class="tabla-caja"><table class="tabla t-serv"><thead><tr><th>Folio</th><th>Fecha</th><th>Turno</th><th>Servicio</th><th>Especificación</th><th>Lugar</th><th>Área</th><th>Unidades</th><th>Pers.</th><th>Salida</th><th>Regreso</th><th>Total</th><th></th></tr></thead>
     <tbody id="t-serv"><tr><td colspan="12" class="tenue">Cargando…</td></tr></tbody></table></div></section>`,
    `<label class="mes">Mes <input type="month" id="mes" value="${mesLista}"></label>${puedeExportar(c) ? '<button class="btn" id="xls">Descargar Excel</button>' : ''}<a class="btn primario" href="#captura">${I.mas(16)} Capturar servicio</a>`);
  await catalogo();
  $<HTMLInputElement>('mes').addEventListener('change', (e) => { mesLista = (e.target as HTMLInputElement).value; vistaServicios(c); });
  const [a, m] = mesLista.split('-').map(Number);
  let xs: ServicioLista[] = [];
  try { xs = await servicios(new Date(a, m - 1, 1), new Date(a, m, 1)); } catch { c.aviso('No se pudieron cargar los servicios.', true); }
  const usados = [...new Set(xs.map(claveCuenta))].sort((p, q) => clase(p).orden - clase(q).orden);
  $('f-cls').innerHTML += usados.map((k) => `<option value="${k}">${esc(clase(k).nombre)}</option>`).join('');
  const pintar = () => {
    const q = $<HTMLInputElement>('buscar').value.trim().toLowerCase(), fc = $<HTMLSelectElement>('f-cls').value;
    const vis = xs.filter((s) => (!fc || claveCuenta(s) === fc) && (!q || [s.folio, s.colonia, s.lugar, s.especificacion, s.unidades.join(' '), clase(s.clasificacion).nombre].join(' ').toLowerCase().includes(q)));
    $('t-serv').innerHTML = vis.map((s) => {
      const tot = s.h_despacho && s.h_base ? Math.round((+new Date(s.h_base) - +new Date(s.h_despacho)) / 60000) : null;
      return `<tr class="${s.estado}"><td class="nw"><b>${s.folio}</b></td><td class="nw">${fechaCorta(s.fecha)}</td><td>${s.turno === 'dia' ? 'Día' : s.turno === 'noche' ? 'Noche' : ''}</td><td>${pildora(s.clasificacion, s.falsa_alarma)}</td>
        <td>${esc(s.especificacion ?? '')}</td><td>${esc([s.colonia, s.lugar].filter(Boolean).join(', '))}</td><td class="nw">${esc(s.area_afectada ?? '')}</td><td class="nw">${esc(s.unidades.join(' / '))}</td>
        <td>${s.personal_num ?? ''}</td><td class="nw">${hora(s.h_despacho)}</td><td class="nw">${hora(s.h_base)}</td><td class="nw">${tot != null && tot >= 0 ? dur(tot) : ''}</td>
        <td class="nw">${s.estado === 'activo' ? '<em class="pill p-ambar">Activo</em>' : s.estado === 'anulado' ? '<em class="pill p-gris">Anulado</em>' : s.firmado ? '<em class="pill p-dorado">Firmado</em>' : ''}<a class="btn chico" href="#servicio/${s.id}">Abrir</a></td></tr>`;
    }).join('') || '<tr><td colspan="13" class="tenue">Sin servicios en este mes.</td></tr>';
  };
  $('buscar').addEventListener('input', pintar); $('f-cls').addEventListener('change', pintar); pintar();
  document.getElementById('xls')?.addEventListener('click', () => {
    const nombreMes = `${MESES_TXT[m - 1].toUpperCase()} ${a}`;
    descargar(escribirExcel([hojaServicios(nombreMes, xs.filter((s) => s.estado !== 'anulado')), hojaGrafica(`GRAFICA ${nombreMes}`, contar(xs, m))]), `SIMUB_servicios_${mesLista}.xlsx`);
  });
}

const tiempo = (desde?: string | null, hasta?: string | null) => {
  if (!desde || !hasta) return ''; const mm = Math.round((+new Date(hasta) - +new Date(desde)) / 60000);
  return mm >= 0 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}` : '';
};
function hojaServicios(nombre: string, xs: ServicioLista[]) {
  const filas: Celda[][] = [['FOLIO', 'FECHA', 'SERVICIO', 'TIPO DE SERVICIO (ESPECIFICACIÓN)', 'LUGAR', 'AREA AFECTADA M2', 'EQUIPO UTILIZADO', 'PERSONAL', 'TIEMPO', 'TIEMPO2', 'TOTAL DE TIEMPO', 'APOYOS', 'TURNO']];
  for (const s of xs) filas.push([s.folio, new Date(`${s.fecha}T12:00:00`).toLocaleDateString('es-MX'), s.falsa_alarma ? 'FALSA ALARMA' : clase(s.clasificacion).nombre,
    s.falsa_alarma ? `${clase(s.clasificacion).nombre}${s.especificacion ? ` · ${s.especificacion}` : ''}` : s.especificacion ?? '', [s.colonia, s.lugar].filter(Boolean).join(', '), s.area_afectada ?? 'N/A',
    s.unidades.join(' / '), s.personal_num, hora(s.h_despacho), hora(s.h_base), tiempo(s.h_despacho, s.h_base), Object.keys(s.apoyos ?? {}).join(', '), s.turno === 'dia' ? 'DÍA' : s.turno === 'noche' ? 'NOCHE' : '']);
  return { nombre, filas, anchos: [8, 12, 26, 32, 40, 14, 16, 9, 8, 8, 10, 24, 8] };
}
const contar = (xs: ServicioLista[], mes?: number) => {
  const n: Record<string, number> = {};
  for (const s of xs) if (s.estado !== 'anulado' && (!mes || +s.fecha.slice(5, 7) === mes)) n[claveCuenta(s)] = (n[claveCuenta(s)] ?? 0) + 1;
  return n;
};
function hojaGrafica(nombre: string, n: Record<string, number>) {
  const filas: Celda[][] = [['SERVICIOS', 'TOTAL']];
  for (const cl of CAT) if (n[cl.id]) filas.push([cl.nombre, n[cl.id]]);
  filas.push(['TOTAL', Object.values(n).reduce((p, q) => p + q, 0)]);
  return { nombre, filas, anchos: [34, 10] };
}

// ================================================================ REPORTE 911 / EXTERNO (captura rápida)
const ORIGENES = ['911', 'Radio', 'Teléfono de cabina', 'WhatsApp', 'Presencial', 'Otra corporación'];
let ORIGEN_ULT = '911';
async function listas() {
  const [uds, per, col] = await Promise.all([
    tabla<{ nombre: string; activa: boolean; tipo: string | null }>('unidades', 'nombre').catch(() => []),
    tabla<{ nombre: string; cargo: string | null; activo: boolean }>('personal', 'nombre').catch(() => []),
    tabla<{ nombre: string; tipo: string | null; activa: boolean }>('colonias', 'nombre').catch(() => [])]);
  const personal = per.filter((p) => p.activo);
  fuente('personal', () => personal.map((p) => ({ n: p.nombre, t: p.cargo ?? '' })));
  await cargarLugares(BASE, col.filter((x) => x.activa));
  return { unidades: uds.filter((u) => u.activa).map((u) => u.nombre), personal: personal.map((p) => p.nombre),
    colonias: col.filter((x) => x.activa).map((x) => x.nombre) };
}

export async function vistaCaptura(c: Ctx, reporteId?: string) {
  c.marco('captura', 'Generar servicio', 'Da folio al servicio y asigna unidades y brigada. Para 911, radio, teléfono, en persona o un reporte de la app. Toca en vez de escribir.',
    '<div id="cap"><p class="tenue">Cargando…</p></div>', `<a class="btn" href="#mando">Centro de mando</a>`);
  await catalogo();
  const [L2, m, rep] = await Promise.all([listas(), mando().catch(() => null), reporteId ? detalleReporte(reporteId).catch(() => null) : Promise.resolve(null)]);
  if (rep?.servicio_id) { c.aviso('Ese reporte ya tiene servicio.'); location.hash = `#servicio/${rep.servicio_id}`; return; }
  const origenes = rep ? ['App SIMUB', ...ORIGENES] : ORIGENES; const origen = rep ? 'App SIMUB' : ORIGEN_ULT;
  const ocupadas = new Map((m?.unidades ?? []).filter((u) => u.estado !== 'disponible').map((u) => [u.nombre, u.estado === 'en_servicio' ? `folio ${u.folio}` : 'fuera']));
  const grupos = [...new Set(CAT.filter((x) => x.id !== 'falsa' && x.activo).map((x) => x.grupo))];
  $('cap').innerHTML = `<form id="f-cap" class="captura" autocomplete="off">
    ${rep ? `<section class="tarjeta aviso-app"><h3>${I.campana(18)} Reporte de la app ${esc(rep.folio)}</h3><p><b>${esc(FORMULARIOS[rep.tipo].nombre)}</b> · ${hora(rep.creado_en)}${rep.referencia ? ` · ${esc(rep.referencia)}` : ''}</p>
      ${(rep.detalles.resumen ?? []).length ? `<p class="tenue">${esc(rep.detalles.resumen!.join(' · '))}</p>` : ''}${rep.comentario ? `<p class="tenue">«${esc(rep.comentario)}»</p>` : ''}</section>` : ''}
    <section class="bloque"><h3>1. ¿Quién lo reporta?</h3>
      <div class="chips-sel" data-radio="medio">${origenes.map((o) => `<button type="button" class="mchip ${o === origen ? 'on' : ''}" data-v="${o}">${o}</button>`).join('')}</div>
      <input type="hidden" name="medio" value="${origen}">
      <div class="rejilla-3"><label id="c-f911" ${origen === '911' ? '' : 'hidden'}>Folio 911<input name="folio_911" inputmode="numeric" placeholder="Si lo dieron"></label>
        <label id="c-corp" hidden>Corporación que lo pasó<select name="corp">${CORPORACIONES.map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label>Hora en que llegó<input type="datetime-local" name="h_reporte" value="${localInput(rep?.creado_en ?? new Date().toISOString())}"></label></div></section>
    <section class="bloque"><h3>2. ¿Qué pasa?</h3>
      ${grupos.map((g) => `<div class="tipos-g"><span>${esc(g)}</span><div>${CAT.filter((x) => x.grupo === g && x.id !== 'falsa' && x.activo)
        .map((x) => `<button type="button" class="tipo-b" data-cls="${x.id}" style="--c:${x.color}">${esc(x.nombre.replace(/^(INCENDIO|ACCIDENTE|RESCATE|PACIENTE|CAÍDA) (DE )?/, ''))}</button>`).join('')}</div></div>`).join('')}
      <input type="hidden" name="clasificacion" required>
      <div id="c-esp" class="chips-sel" data-radio="especificacion"></div>
      <div class="rejilla-2"><label>Detalle <small>(opcional; toca una sugerencia o escribe)</small><input name="especificacion" maxlength="200"></label>
      <label class="fila-check"><span>Falsa alarma</span><input type="checkbox" name="falsa_alarma"></label></div></section>
    <section class="bloque"><h3>3. ¿Dónde?</h3><div class="rejilla-2">
      <label>Colonia o comunidad${buscador('colonia', '', 'colonias', 'placeholder="Toca y empieza a escribir…" required')}</label>
      <label>Calle, número o referencia${buscador('lugar', rep?.referencia ?? '', 'calles', 'maxlength="300" placeholder="Ej. Calle Pino 12, frente a la tienda"')}</label></div>
      <input type="hidden" name="lat" value="${rep?.lat ?? ''}"><input type="hidden" name="lon" value="${rep?.lon ?? ''}">
      ${rep ? `<p class="tenue chica">Ubicación enviada por la app: <a href="https://www.google.com/maps/search/?api=1&query=${rep.lat},${rep.lon}" target="_blank" rel="noopener">${rep.lat.toFixed(5)}, ${rep.lon.toFixed(5)}</a></p>` : ''}
      <div class="rejilla-2"><label>Quién reporta <small>(opcional)</small><input name="reportante" maxlength="120" value="${esc(rep ? (rep.anonimo ? 'Anónimo' : rep.nombre ?? '') : '')}"></label>
      <label>Teléfono <small>(opcional)</small><input name="telefono" inputmode="tel" maxlength="20" value="${esc(rep?.telefono ?? '')}"></label></div></section>
    <section class="bloque"><h3>4. Unidades</h3>
      <div class="multi" data-multi="unidades"><input type="hidden" name="unidades" value="">
        <div class="multi-chips">${L2.unidades.map((u) => `<button type="button" class="mchip ${ocupadas.has(u) ? 'ocupada' : ''}" data-v="${esc(u)}" ${ocupadas.get(u) === 'fuera' ? 'disabled' : ''}>${esc(u)}${ocupadas.has(u) ? ` <small>${esc(ocupadas.get(u))}</small>` : ''}</button>`).join('')}</div></div>
      <div class="chips-sel" data-radio="modo"><button type="button" class="mchip on" data-v="ahora">Sale ahora (despacho)</button><button type="button" class="mchip" data-v="pendiente">Solo registrar</button>
        <button type="button" class="mchip" data-v="concluido">Ya se atendió (captura posterior)</button></div><input type="hidden" name="modo" value="ahora">
      <div class="rejilla-3" id="c-horas" hidden><label>Salida<input type="datetime-local" name="h_despacho"></label><label>Llegada a la escena<input type="datetime-local" name="h_llegada"></label><label>Regreso a base<input type="datetime-local" name="h_base"></label></div>
</section>
    <section class="bloque"><h3>5. Brigada y responsables</h3><p class="tenue chica">Quién va a cargo de cada unidad. Se puede completar después en el parte.</p>
      <label>Jefe de servicio (a cargo de la emergencia)${buscador('jefe_servicio', '', 'personal', 'placeholder="Toca y escribe el nombre"')}</label>
      <div id="c-brig"><p class="tenue chica">Elige primero las unidades.</p></div></section>
    <div class="cap-pie"><button class="btn primario grande" type="submit">${I.mas(18)} Generar servicio y dar folio</button><span class="tenue chica">Captura: <b>${esc(c.yo().nombre)}</b></span></div>
  </form><div id="cap-ok"></div>`;
  const form = $<HTMLFormElement>('f-cap');
  const set = (n: string, v: string) => { (form.elements.namedItem(n) as HTMLInputElement).value = v; };
  activarMulti(form);
  activarBuscadores(form, (_i, o) => { if (o.lat) { set('lat', String(o.lat)); set('lon', String(o.lon)); } });
  form.querySelectorAll<HTMLElement>('[data-radio]').forEach((g) => g.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.mchip'); if (!b) return;
    g.querySelectorAll('.mchip').forEach((x) => x.classList.toggle('on', x === b)); set(g.dataset.radio!, b.dataset.v!);
    if (g.dataset.radio === 'medio') { ORIGEN_ULT = b.dataset.v!; $('c-f911').hidden = b.dataset.v !== '911'; $('c-corp').hidden = b.dataset.v !== 'Otra corporación'; }
    if (g.dataset.radio === 'modo') $('c-horas').hidden = b.dataset.v !== 'concluido';
  }));
  const brig = new Map<string, { maquinista: string; jefe: string; bomberos: string }>();
  const leerBrig = () => form.querySelectorAll<HTMLElement>('[data-brig]').forEach((f) => {
    const u = f.dataset.brig!, q = (n: string) => (f.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value ?? '';
    brig.set(u, { maquinista: q(`b_maq_${u}`), jefe: q(`b_jefe_${u}`), bomberos: q(`b_bom_${u}`) });
  });
  const pintarBrig = () => {
    leerBrig(); const uds = valoresMulti((form.elements.namedItem('unidades') as HTMLInputElement).value);
    $('c-brig').innerHTML = uds.length ? `<div class="tabla-caja"><table class="tabla t-form"><thead><tr><th>Unidad</th><th>Maquinista</th><th>Jefe de unidad</th><th>Bomberos</th></tr></thead><tbody>
      ${uds.map((u) => { const b = brig.get(u); return `<tr data-brig="${esc(u)}"><th>${esc(u)}</th><td>${buscador(`b_maq_${u}`, b?.maquinista ?? '', 'personal', 'placeholder="Nombre"')}</td>
        <td>${buscador(`b_jefe_${u}`, b?.jefe ?? '', 'personal', 'placeholder="Nombre"')}</td><td>${multi(`b_bom_${u}`, [], valoresMulti(b?.bomberos ?? ''), 'Toca para elegir', false, [], 'personal')}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<p class="tenue chica">Elige primero las unidades.</p>';
    activarBuscadores($('c-brig')); activarMulti($('c-brig'));
  };
  form.querySelector('[data-multi="unidades"]')!.addEventListener('click', () => setTimeout(pintarBrig, 0));
  form.querySelectorAll<HTMLButtonElement>('[data-cls]').forEach((b) => b.addEventListener('click', () => {
    form.querySelectorAll('[data-cls]').forEach((x) => x.classList.toggle('on', x === b)); set('clasificacion', b.dataset.cls!);
    const sug = ESPECIFICACIONES[b.dataset.cls!] ?? [];
    $('c-esp').innerHTML = sug.map((x) => `<button type="button" class="mchip" data-v="${esc(x)}">${esc(x)}</button>`).join('');
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(form); const g = (k: string) => String(fd.get(k) ?? '').trim();
    if (!g('clasificacion')) return c.aviso('Toca qué tipo de servicio es.', true);
    const modo = g('modo'), uds = valoresMulti(fd.get('unidades'));
    if (modo === 'concluido' && !g('h_despacho')) return c.aviso('Escribe al menos la hora de salida.', true);
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!; btn.disabled = true; btn.textContent = 'Registrando…';
    const medio = g('medio') === 'Otra corporación' ? `Otra corporación (${g('corp')})` : g('medio') === 'App SIMUB' && rep ? `App SIMUB (${rep.folio})` : g('medio');
    leerBrig();
    try {
      const base = rep ? await servicioDesdeReporte(rep.id) : null;
      const r = await guardarServicio(base?.id ?? null, {
        clasificacion: g('clasificacion'), especificacion: g('especificacion'), colonia: g('colonia'), lugar: g('lugar'), medio,
        reportante: g('reportante'), telefono: g('telefono'), h_reporte: desdeLocal(g('h_reporte')), lat: g('lat'), lon: g('lon'), unidades: modo === 'concluido' ? uds : uds,
        falsa_alarma: fd.get('falsa_alarma') === 'on', datos: g('folio_911') ? { folio_911: g('folio_911') } : {},
        apoyos: g('medio') === 'Otra corporación' ? { [g('corp')]: { unidades: '', encargado: '' } } : {},
        h_despacho: desdeLocal(g('h_despacho')), h_llegada: desdeLocal(g('h_llegada')), h_base: desdeLocal(g('h_base')),
        tripulacion: uds.map((u) => ({ unidad: u, maquinista: brig.get(u)?.maquinista ?? '', jefe: brig.get(u)?.jefe ?? '', bomberos: brig.get(u)?.bomberos ?? '' })),
        jefe_servicio: g('jefe_servicio'),
        personal_num: (() => { const n = new Set([g('jefe_servicio'), ...uds.flatMap((u) => [brig.get(u)?.maquinista, brig.get(u)?.jefe, ...valoresMulti(brig.get(u)?.bomberos ?? '')])].filter(Boolean)); return n.size || ''; })(),
      });
      if (modo === 'ahora') await bitacora(r.id, null, 'despacho');
      if (modo === 'concluido') await cerrarServicio(r.id);
      notificar(r.id); avisarVentanas();
      if (modo === 'concluido') {
        form.hidden = true;
        $('cap-ok').innerHTML = `<section class="tarjeta folio-ok">${I.check(44)}<span>Folio asignado</span><b>${folioTxt(r)}</b>
          <p>${pildora(g('clasificacion'), fd.get('falsa_alarma') === 'on')} · ${esc(g('colonia'))}${uds.length ? ` · ${esc(uds.join(', '))}` : ''}</p>
          <div class="fila-btn"><a class="btn primario" href="#servicio/${r.id}">Completar el parte</a><button class="btn" id="otro">Registrar otro</button><a class="btn" href="#mando">Centro de mando</a></div></section>`;
        $('otro').addEventListener('click', () => vistaCaptura(c));
      } else { c.aviso(`Servicio generado: folio ${folioTxt(r)}. Ya aparece en servicios activos.`); location.hash = '#mando'; }
    } catch (err) { c.aviso(c.errores[(err as Error).message] ?? 'No se pudo registrar.', true); btn.disabled = false; btn.textContent = 'Generar servicio y dar folio'; }
  });
  form.querySelector<HTMLInputElement>('[name=folio_911]')?.focus();
}

// ================================================================ PARTE DE SERVICIO (formato SIMUB, con listas y firma en pantalla)
const FIRMAS: [string, string][] = [['jefe_servicio', 'Jefe de servicio'], ['radio_operador', 'Radio operador'], ['jefe_guardia', 'Jefe de guardia']];
export async function vistaServicio(c: Ctx, id: string) {
  c.marco('servicios', 'Parte de servicio', 'Formato de SIMUB. Toca las listas en vez de escribir. Se firma en la pantalla y se descarga en PDF.', '<div id="parte"><p class="tenue">Cargando…</p></div>',
    '<a class="btn" href="#mando">Centro de mando</a><a class="btn" href="#servicios">Servicios</a>');
  let s: Servicio | null = null; let L2: Awaited<ReturnType<typeof listas>>;
  try { [s, L2] = await Promise.all([servicio(id), listas(), catalogo()]) as [Servicio | null, typeof L2, Clase[]]; } catch { s = null; L2 = { unidades: [], personal: [], colonias: [] }; }
  if (!s) { $('parte').innerHTML = '<p class="tenue">No se encontró el servicio.</p>'; return; }
  const S = s;
  const v = (x: unknown) => esc(x ?? '');
  const admin = c.rol() === 'admin', editable = S.puede_editar !== false;
  const dis = editable ? '' : 'disabled';
  const trip = S.tripulacion?.length ? [...S.tripulacion] : S.unidades.map((u) => ({ unidad: u, maquinista: '', jefe: '', bomberos: '' }));
  if (!trip.length) trip.push({ unidad: '', maquinista: '', jefe: '', bomberos: '' });
  const veh = S.vehiculos?.length ? [...S.vehiculos] : [{}];
  const per = S.personas?.length ? [...S.personas] : [{ nombre: '', codigo: '', edad: '' }];
  const corpsSel = Object.keys(S.apoyos ?? {});
  const filaTrip = (i: number, t = trip[i] ?? { unidad: '', maquinista: '', jefe: '', bomberos: '' }) => `<tr data-trip="${i}">
    <td><select name="t_unidad_${i}" ${dis}><option value="">—</option>${[...new Set([...L2.unidades, t.unidad].filter(Boolean))].map((u) => `<option ${u === t.unidad ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></td>
    <td>${buscador(`t_maquinista_${i}`, t.maquinista, 'personal', dis)}</td><td>${buscador(`t_jefe_${i}`, t.jefe, 'personal', dis)}</td>
    <td>${multi(`t_bomberos_${i}`, [], valoresMulti(t.bomberos), 'Toca para elegir', !editable, [], 'personal')}</td></tr>`;
  const filaVeh = (i: number, x: Record<string, string> = veh[i] ?? {}) => `<tr data-veh="${i}">${([['placas', ''], ['color', 'l-color'], ['tipo', 'l-tveh'], ['modelo', ''], ['conductor', ''], ['propietario', '']] as const)
    .map(([k, l]) => `<td><input name="v_${k}_${i}" value="${v(x[k])}" ${l ? `list="${l}"` : ''} placeholder="${k[0].toUpperCase() + k.slice(1)}" ${dis}></td>`).join('')}</tr>`;
  const filaPer = (i: number, x = per[i] ?? { nombre: '', codigo: '', edad: '' }) => `<tr data-per="${i}"><td><input name="p_nombre_${i}" value="${v(x.nombre)}" placeholder="Nombre" ${dis}></td>
    <td><input name="p_codigo_${i}" value="${v(x.codigo)}" list="l-cod" placeholder="Código" ${dis}></td><td><input name="p_edad_${i}" value="${v(x.edad)}" inputmode="numeric" placeholder="Edad" class="corto" ${dis}></td></tr>`;
  const filasCorp = (sel: string[], prev: Record<string, { unidades?: string; encargado?: string }>) => sel.map((k, i) => `<tr><th>${esc(k)}<input type="hidden" name="a_k_${i}" value="${esc(k)}"></th>
    <td><input name="a_u_${i}" value="${v(prev[k]?.unidades)}" placeholder="Unidad(es)" ${dis}></td><td><input name="a_e_${i}" value="${v(prev[k]?.encargado)}" placeholder="Encargado(s)" ${dis}></td></tr>`).join('');
  const firmaCaja = (k: string, t: string) => { const f = S.firmas?.[k]; const nombre = (S as unknown as Record<string, string | null>)[k] ?? f?.nombre ?? '';
    return `<div class="firma-caja"><span class="etq">${t}</span>${buscador(`f_${k}`, nombre, 'personal', dis + ' placeholder="Nombre"')}
      ${f?.imagen ? `<img src="${f.imagen}" alt="Firma de ${esc(f.nombre ?? t)}"><small class="tenue">Firmó ${new Date(f.en).toLocaleString('es-MX')} · registró ${esc(f.registro)}</small>` : '<div class="firma-vacia">Sin firma</div>'}
      ${editable ? `<button type="button" class="btn chico" data-firmar="${k}">${f?.imagen ? 'Volver a firmar' : 'Firmar en pantalla'}</button>` : ''}</div>`; };
  const corregible = !admin && S.estado !== 'anulado' && S.origen !== 'historico';
  $('parte').innerHTML = `
  <div class="volver-barra"><a class="btn" href="#servicios">← Volver a la lista de servicios</a><b>Folio ${folioTxt(S)}</b><a class="btn chico" href="#mando">Centro de mando</a>
    <button type="button" class="btn chico" id="arriba" aria-label="Ir arriba">↑ Arriba</button></div>
  ${!editable ? `<div class="aviso-candado">${S.bloqueado ? 'Parte <b>firmado</b> por el jefe de servicio: ya no se puede modificar.' : 'Este registro ya está cerrado: solo el <b>Admin. Maestro</b> puede corregirlo.'}
     ${admin && S.bloqueado ? '<button class="btn chico" id="desbloquear">Desbloquear para corregir</button>' : ''}
     ${corregible ? '<button class="btn chico primario" id="autorizar">Corregir con autorización del Admin. Maestro</button>' : ''}</div>` : ''}
  ${editable && S.bloqueado ? `<div class="aviso-candado">Parte firmado. Como administrador puedes corregirlo; el cambio queda en el control interno.</div>` : ''}
  <form class="parte" id="f-parte" autocomplete="off"><fieldset class="sin-borde" ${dis}>
    <section class="bloque parte-cab2"><div><span class="etq">Folio</span><b class="folio-g">${folioTxt(S)}</b></div>
      <div>${pildora(S.clasificacion, S.falsa_alarma)} <em class="pill ${S.estado === 'activo' ? 'p-ambar' : S.estado === 'anulado' ? 'p-gris' : 'p-verde'}">${S.estado === 'activo' ? 'En curso' : S.estado === 'anulado' ? 'Anulado' : 'Concluido'}</em>
      ${S.turno ? `<em class="pill ${S.turno === 'dia' ? 'p-dorado' : 'p-noche'}">Turno ${S.turno === 'dia' ? 'día' : 'noche'}</em>` : ''}${S.bloqueado ? '<em class="pill p-dorado">Firmado</em>' : ''}${S.origen === 'historico' ? '<em class="pill p-gris">Importado del Excel</em>' : ''}${S.reporte_folio ? `<a class="pill p-dorado" href="#reportes/${S.reporte_id}">Reporte app ${esc(S.reporte_folio)}</a>` : ''}
      <br><small class="tenue">Capturó: <b>${esc(S.capturo ?? '—')}</b>${S.editado_por ? ` · última edición: ${esc(S.editado_por)}` : ''} · llenando ahora: <b>${esc(c.yo().nombre)}</b></small></div>
      <label>Fecha<input type="date" name="fecha" value="${v(S.fecha)}" required></label>
      <label class="fila-check"><span>Falsa alarma</span><input type="checkbox" name="falsa_alarma" ${S.falsa_alarma ? 'checked' : ''}></label></section>
    <section class="bloque"><h3>Cronología</h3><div class="rejilla-5">
      ${([['h_reporte', 'Reporte'], ['h_despacho', 'Despacho'], ['h_llegada', 'Llegada a la escena'], ['h_disponible', 'Unidad disponible'], ['h_base', 'Llegada a la base']] as const)
        .map(([k, t]) => `<label>${t}<span class="con-ahora"><input type="datetime-local" name="${k}" value="${localInput(S[k])}"><button type="button" class="btn chico" data-ahora="${k}" title="Poner la hora actual">Ahora</button></span></label>`).join('')}</div>
      <div class="rejilla-4"><label>Kilometraje salida<input type="number" step="0.1" min="0" name="km_salida" value="${v(S.km_salida)}"></label>
      <label>Kilometraje llegada<input type="number" step="0.1" min="0" name="km_llegada" value="${v(S.km_llegada)}"></label>
      <label>Folio 911<input name="d_folio_911" value="${v(S.datos?.folio_911)}"></label><label>Personal total <small>(se calcula)</small><input type="number" min="0" name="personal_num" value="${v(S.personal_num)}"></label></div></section>
    <section class="bloque"><h3>Reporte y lugar</h3><div class="rejilla-3">
      <label>Medio<select name="medio">${[...new Set([...MEDIOS, S.medio].filter(Boolean))].map((x) => `<option ${x === S.medio ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label>Reportante<input name="reportante" value="${v(S.reportante)}"></label><label>Teléfono<input name="telefono" value="${v(S.telefono)}" inputmode="tel"></label></div>
      <div class="rejilla-2"><label>Colonia o comunidad${buscador('colonia', S.colonia, 'colonias', 'placeholder="Toca y empieza a escribir…"')}</label>
      <label>Calle, número o referencia${buscador('lugar', S.lugar, 'calles')}</label></div><input type="hidden" name="lat"><input type="hidden" name="lon">
      ${S.lat != null ? `<p class="tenue chica">Ubicación de la app: <a href="https://www.google.com/maps/search/?api=1&query=${S.lat},${S.lon}" target="_blank" rel="noopener">${S.lat.toFixed(5)}, ${S.lon!.toFixed(5)}</a></p>` : ''}</section>
    <section class="bloque"><h3>Tipo de servicio</h3><div class="rejilla-3">
      <label>Servicio<select name="clasificacion" required>${opcionesClase(S.clasificacion)}</select></label>
      <label>Especificación<input name="especificacion" value="${v(S.especificacion)}" list="l-esp"></label>
      <label>Área afectada${area('area_afectada', S.area_afectada, dis)}</label></div>
      <div class="rejilla-3"><label>Gas: compañía<input name="d_compania" value="${v(S.datos?.compania)}"></label><label>Gas: kilos<input name="d_kilos" value="${v(S.datos?.kilos)}" inputmode="decimal"></label></div></section>
    <section class="bloque"><h3>Unidades y tripulación</h3>
      <div class="tabla-caja"><table class="tabla t-form" id="t-trip"><thead><tr><th>Unidad</th><th>Maquinista</th><th>Jefe de servicio</th><th>Bomberos</th></tr></thead>
      <tbody>${trip.map((_, i) => filaTrip(i)).join('')}</tbody></table></div>
      ${editable ? '<button type="button" class="btn chico" data-agregar="t-trip">+ Agregar unidad</button>' : ''}
      ${!L2.personal.length ? '<p class="tenue chica">Para elegir nombres de una lista, el administrador agrega al personal en Ajustes.</p>' : ''}</section>
    <section class="bloque"><h3>Vehículos involucrados</h3>
      ${filasAgregables('t-veh', veh.length, (i) => filaVeh(i), 'Agregar vehículo', !editable)}</section>
    <section class="bloque"><h3>Corporaciones presentes</h3><p class="tenue chica">Toca las que acudieron. Sirve para el conteo anual con otras dependencias.</p>
      ${multi('corps', CORPORACIONES, corpsSel, 'Otra corporación y Enter', !editable)}
      <div class="tabla-caja"><table class="tabla t-form"><tbody id="t-corp">${filasCorp(corpsSel, S.apoyos ?? {})}</tbody></table></div></section>
    <section class="bloque"><h3>Personas localizadas en la escena</h3>
      ${filasAgregables('t-per', per.length, (i) => filaPer(i), 'Agregar persona', !editable)}</section>
    <section class="bloque"><h3>Recursos utilizados</h3><div class="rejilla-4">
      <label>Agua (litros)<input type="number" name="r_agua_litros" value="${v(S.recursos?.agua_litros)}"></label><label>Espuma (litros)<input type="number" name="r_espuma_litros" value="${v(S.recursos?.espuma_litros)}"></label>
      <label>Extintores<input type="number" name="r_extintores" value="${v(S.recursos?.extintores)}"></label><label>Tramos de manguera<input type="number" name="r_mangueras" value="${v(S.recursos?.mangueras)}"></label></div>
      <label>Daños<input name="r_danos" value="${v(S.recursos?.danos)}"></label></section>
    ${(S.evidencias ?? []).length || (S.escena ?? []).length || Object.keys(S.sci ?? {}).length || S.perimetro ? `<section class="bloque"><h3>Desde el lugar (app de campo)</h3>
      ${S.perimetro ? `<p>Área dibujada en el mapa: <b>${esc(S.area_afectada ?? '')}</b></p>` : ''}
      ${Object.values(S.sci ?? {}).some(Boolean) ? `<p><b>Comando del incidente:</b> ${esc(S.sci?.comandante ?? '—')}${S.sci?.puesto ? ` · puesto: ${esc(S.sci.puesto)}` : ''}<br>
        ${S.sci?.situacion ? `<b>Situación:</b> ${esc(S.sci.situacion)}<br>` : ''}${S.sci?.objetivos ? `<b>Objetivos:</b> ${esc(S.sci.objetivos)}` : ''}</p>` : ''}
      ${(S.escena ?? []).length ? `<p><b>Personal en escena:</b> ${(S.escena ?? []).map((e) => `${esc(e.persona)}${e.asignacion ? ` (${esc(e.asignacion)})` : ''} ${hora(e.entra)}–${e.sale ? hora(e.sale) : 'dentro'}`).join(' · ')}</p>` : ''}
      ${(S.evidencias ?? []).length ? `<div class="cp-galeria" id="p-gal"></div>` : ''}</section>` : ''}
    <section class="bloque"><h3>Observaciones</h3><textarea name="observaciones" rows="5">${v(S.observaciones)}</textarea></section>
    <section class="bloque"><h3>Firmas</h3><div class="rejilla-3 firmas">${FIRMAS.map(([k, t]) => firmaCaja(k, t)).join('')}</div>
      <p class="tenue chica">Se firma con el dedo (celular o tableta) o con el mouse. Al firmar el jefe de servicio, el parte queda cerrado y se guarda su huella digital (SHA-256) para comprobar que no cambió.</p></section>
  </fieldset>
    ${datalist('l-esp', ESPECIFICACIONES[S.clasificacion] ?? [])}
    ${datalist('l-cod', CODIGOS_PERSONA)}${datalist('l-tveh', TIPOS_VEHICULO)}${datalist('l-color', COLORES)}
    <div class="pie-parte">
      ${editable ? '<button class="btn primario" type="submit">Guardar parte</button>' : ''}
      <button class="btn" type="button" id="pdf">Descargar PDF</button>
      ${S.estado === 'activo' ? '<button class="btn" type="button" id="concluir">Concluir servicio</button><button class="btn" type="button" id="apoyo">Pedir apoyo</button>' : ''}
      ${S.estado === 'cerrado' && admin ? '<button class="btn tenue-btn" type="button" id="reabrir">Reabrir</button>' : ''}
      ${admin && S.estado !== 'anulado' ? '<button class="btn tenue-btn" type="button" id="anular">Anular folio</button>' : ''}
      <span class="tenue chica">Actualizado ${new Date(S.actualizado_en).toLocaleString('es-MX')}</span></div>
  </form>
  <section class="tarjeta"><h3>Bitácora</h3><ol class="hist">${(S.bitacora ?? []).map((b) => `<li><b>${new Date(b.en).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b> · ${esc(b.texto)} <small class="tenue">${esc(b.autor ?? '')}</small></li>`).join('')}</ol>
    ${S.estado === 'anulado' ? '' : '<form class="fila-btn" id="f-bit"><input name="t" maxlength="1000" placeholder="Agregar nota a la bitácora" required><button class="btn">Agregar</button></form>'}</section>`;
  const form = $<HTMLFormElement>('f-parte');
  activarMulti(form); activarArea(form);
  if ((S.evidencias ?? []).length) urlsEvidencias(S.evidencias!.map((x) => x.ruta)).then((us) => { const g = document.getElementById('p-gal'); if (g) g.innerHTML = S.evidencias!.map((x, i) => x.tipo === 'video'
    ? `<figure><video src="${us[i]}" controls preload="none"></video><figcaption>${esc(x.nota ?? '')}</figcaption></figure>`
    : `<figure><a href="${us[i]}" target="_blank" rel="noopener"><img src="${us[i]}" alt=""></a><figcaption>${esc(x.nota ?? '')} · ${esc(x.autor ?? '')}</figcaption></figure>`).join(''); });
  document.getElementById('apoyo')?.addEventListener('click', async () => {
    const t = prompt('¿Qué apoyo se necesita? (ej. pipa de agua, ambulancia, Cruz Roja)'); if (!t?.trim()) return;
    try { await accion({ accion: 'apoyo', servicio: id, texto: t.trim() }); c.aviso('Solicitud enviada al grupo interno de Telegram.'); vistaServicio(c, id); }
    catch (e) { c.aviso((e as Error).message === 'sin_grupo' ? 'Falta vincular el grupo interno de Telegram (Ajustes).' : 'No se pudo enviar.', true); }
  });
  activarBuscadores(form, (i, o) => { if (o.lat && S.lat == null && (i.name === 'colonia' || i.name === 'lugar')) {
    (form.elements.namedItem('lat') as HTMLInputElement).value = String(o.lat); (form.elements.namedItem('lon') as HTMLInputElement).value = String(o.lon); } });
  const cuenta = (sel: string) => () => form.querySelectorAll(sel).length;
  activarAgregables(form, { 't-veh': (i) => filaVeh(i, {}), 't-per': (i) => filaPer(i, { nombre: '', codigo: '', edad: '' }) }, { 't-veh': cuenta('[data-veh]'), 't-per': cuenta('[data-per]') });
  form.querySelector('[data-agregar="t-trip"]')?.addEventListener('click', () => {
    const i = form.querySelectorAll('[data-trip]').length; form.querySelector('#t-trip tbody')!.insertAdjacentHTML('beforeend', filaTrip(i, { unidad: '', maquinista: '', jefe: '', bomberos: '' })); activarMulti(form); activarBuscadores(form);
  });
  form.querySelectorAll<HTMLButtonElement>('[data-ahora]').forEach((b) => b.addEventListener('click', () => {
    (form.elements.namedItem(b.dataset.ahora!) as HTMLInputElement).value = localInput(new Date().toISOString());
  }));
  (form.elements.namedItem('clasificacion') as HTMLSelectElement).addEventListener('change', (e) => {
    const k = (e.target as HTMLSelectElement).value; $('l-esp').innerHTML = (ESPECIFICACIONES[k] ?? []).map((x) => `<option value="${esc(x)}">`).join('');
  });
  // corporaciones: al tocar una, aparece su fila (conserva lo ya escrito)
  form.querySelector('input[name=corps]')?.addEventListener('change', () => {
    const prev: Record<string, { unidades: string; encargado: string }> = {};
    form.querySelectorAll<HTMLInputElement>('[name^=a_k_]').forEach((k) => { const i = k.name.slice(4); prev[k.value] = { unidades: (form.elements.namedItem(`a_u_${i}`) as HTMLInputElement).value, encargado: (form.elements.namedItem(`a_e_${i}`) as HTMLInputElement).value }; });
    $('t-corp').innerHTML = filasCorp(valoresMulti((form.elements.namedItem('corps') as HTMLInputElement).value), { ...S.apoyos, ...prev });
  });
  // personal total: se calcula con los nombres de la tripulación si no lo escriben
  const recolectar = () => {
    const fd = new FormData(form); const g = (k: string) => String(fd.get(k) ?? '').trim();
    const nT = form.querySelectorAll('[data-trip]').length, nV = form.querySelectorAll('[data-veh]').length, nP = form.querySelectorAll('[data-per]').length;
    const tripulacion = [...Array(nT)].map((_, i) => ({ unidad: g(`t_unidad_${i}`), maquinista: g(`t_maquinista_${i}`), jefe: g(`t_jefe_${i}`), bomberos: g(`t_bomberos_${i}`) }))
      .filter((t) => t.unidad || t.maquinista || t.jefe || t.bomberos);
    const vehiculos = [...Array(nV)].map((_, i) => Object.fromEntries(['placas', 'color', 'tipo', 'modelo', 'conductor', 'propietario'].map((k) => [k, g(`v_${k}_${i}`)])))
      .filter((x) => Object.values(x).some(Boolean));
    const apoyos: Record<string, { unidades: string; encargado: string }> = {};
    valoresMulti(fd.get('corps')).forEach((k, i) => { apoyos[k] = { unidades: g(`a_u_${i}`), encargado: g(`a_e_${i}`) }; });
    const personas = [...Array(nP)].map((_, i) => ({ nombre: g(`p_nombre_${i}`), codigo: g(`p_codigo_${i}`), edad: g(`p_edad_${i}`) })).filter((p) => p.nombre || p.codigo || p.edad);
    const deTrip = [...new Set(tripulacion.map((t) => t.unidad).filter(Boolean))];
    const nombres = new Set(tripulacion.flatMap((t) => [t.maquinista, t.jefe, ...valoresMulti(t.bomberos)]).filter(Boolean));
    return {
      fecha: g('fecha'), falsa_alarma: fd.get('falsa_alarma') === 'on', clasificacion: g('clasificacion'), especificacion: g('especificacion'),
      area_afectada: g('area_afectada'), colonia: g('colonia'), lugar: g('lugar'), lat: g('lat'), lon: g('lon'), medio: g('medio'), reportante: g('reportante'), telefono: g('telefono'),
      h_reporte: desdeLocal(g('h_reporte')), h_despacho: desdeLocal(g('h_despacho')), h_llegada: desdeLocal(g('h_llegada')),
      h_disponible: desdeLocal(g('h_disponible')), h_base: desdeLocal(g('h_base')), km_salida: g('km_salida'), km_llegada: g('km_llegada'),
      personal_num: g('personal_num') || (nombres.size ? String(nombres.size) : ''), unidades: deTrip.length ? deTrip : S.unidades,
      tripulacion, vehiculos, apoyos, personas, observaciones: g('observaciones'),
      datos: { ...S.datos, folio_911: g('d_folio_911'), compania: g('d_compania'), kilos: g('d_kilos') },
      recursos_p: { agua_litros: Number(g('r_agua_litros')) || 0, espuma_litros: Number(g('r_espuma_litros')) || 0, extintores: Number(g('r_extintores')) || 0, mangueras: Number(g('r_mangueras')) || 0, danos: g('r_danos') },
      jefe_servicio: g('f_jefe_servicio'), radio_operador: g('f_radio_operador'), jefe_guardia: g('f_jefe_guardia'),
    };
  };
  const guardar = async () => {
    if (!editable) return true;
    try { const d = recolectar(); const { recursos_p: rp, ...resto } = d; await guardarServicio(id, resto); await servicioParcialP(id, { recursos: rp }); notificar(id); return true; }
    catch (err) { c.aviso(c.errores[(err as Error).message] ?? 'No se pudo guardar el parte.', true); return false; }
  };
  form.addEventListener('submit', async (e) => { e.preventDefault(); if (await guardar()) { c.aviso('Parte guardado.'); vistaServicio(c, id); } });
  // firma en pantalla
  form.querySelectorAll<HTMLButtonElement>('[data-firmar]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.firmar!, t = FIRMAS.find((x) => x[0] === k)![1];
    const campoNombre = form.elements.namedItem(`f_${k}`) as HTMLInputElement;
    const { fondo, cerrar } = cajon(`${cabCajon(`Firma · ${t}`, folioTxt(S))}
      <label>Nombre de quien firma${buscador('firmante', campoNombre.value, 'personal', 'placeholder="Toca para elegir o escribe"')}</label>
      <p class="tenue">Firma dentro del recuadro blanco con el dedo, el lápiz o el mouse.</p>
      <div class="lienzo-caja"><canvas class="lienzo-firma" id="lienzo"></canvas><span class="lienzo-linea">Firme aquí</span></div>
      ${k === 'jefe_servicio' ? '<p class="aviso-candado chico">Al firmar el jefe de servicio el parte queda <b>cerrado</b>. Revisa que todo esté completo.</p>' : ''}
      <div class="fila-btn"><button class="btn" id="f-limpiar" type="button">Borrar</button><button class="btn primario" id="f-ok" type="button">Guardar firma</button></div>`, 'Firma');
    activarBuscadores(fondo);
    if (campoNombre.value) (document.activeElement as HTMLElement | null)?.blur();
    const lz = lienzoFirma(fondo.querySelector<HTMLCanvasElement>('#lienzo')!);
    fondo.querySelector('#f-limpiar')!.addEventListener('click', () => lz.limpiar());
    fondo.querySelector('#f-ok')!.addEventListener('click', async () => {
      const nombre = fondo.querySelector<HTMLInputElement>('[name=firmante]')!.value.trim();
      if (!nombre) return c.aviso('Escribe o elige el nombre de quien firma.', true);
      if (lz.vacia()) return c.aviso('Falta la firma: dibújala en el recuadro blanco.', true);
      campoNombre.value = nombre;
      if (!(await guardar())) return;
      try {
        const h = k === 'jefe_servicio' ? await huella({ folio: folioTxt(S), ...recolectar() }) : null;
        await firmar(id, k, nombre, lz.imagen(), h); cerrar(); c.aviso('Firma guardada.'); vistaServicio(c, id);
      } catch (err) { c.aviso(c.errores[(err as Error).message] ?? 'No se pudo guardar la firma.', true); }
    });
  }));
  $('pdf').addEventListener('click', async () => {
    const b = $<HTMLButtonElement>('pdf'); b.disabled = true; b.textContent = 'Generando…';
    if (await guardar()) {
      try { const x = await servicio(id); const { blob, nombre } = await servicioPdf(x!, clase(x!.clasificacion).nombre, `${BASE}escudo-192.png`); await entregarPdf(blob, nombre); }
      catch { c.aviso('No se pudo generar el PDF.', true); }
    }
    b.disabled = false; b.textContent = 'Descargar PDF';
  });
  document.getElementById('concluir')?.addEventListener('click', async () => {
    if (!(await guardar())) return;
    try { await cerrarServicio(id); notificar(id); c.aviso('Servicio concluido; unidades disponibles.'); vistaServicio(c, id); } catch (e) { c.aviso(c.errores[(e as Error).message] ?? 'No se pudo concluir.', true); }
  });
  document.getElementById('reabrir')?.addEventListener('click', async () => {
    try { await reabrirServicio(id); vistaServicio(c, id); } catch (e) { c.aviso(c.errores[(e as Error).message] ?? 'No se pudo reabrir.', true); }
  });
  $('arriba').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.getElementById('autorizar')?.addEventListener('click', () => {
    const { fondo, cerrar } = cajon(`${cabCajon('Autorización del Admin. Maestro', `Folio ${folioTxt(S)}`)}
      <form class="bloque" autocomplete="off"><p class="tenue">El Admin. Maestro escribe aquí su correo y contraseña. Quedas autorizado(a) <b>30 minutos</b> para corregir este folio;
        queda anotado en el control interno quién autorizó y quién corrigió. Tu sesión no se cierra.</p>
        <label>Correo del Admin. Maestro<input type="email" name="correo" required autocomplete="off"></label>${campoClave('a-clave', 'Contraseña del Admin. Maestro')}
        <p class="error-txt" id="a-err" hidden></p><button class="btn primario">Autorizar corrección</button></form>`, 'Autorización');
    activarClaves(fondo);
    fondo.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault(); const b = fondo.querySelector<HTMLButtonElement>('form button.primario')!; b.disabled = true; b.textContent = 'Verificando…';
      const err = await autorizarEdicion(S.id, String(new FormData(e.target as HTMLFormElement).get('correo') ?? ''), valorClave(fondo, 'a-clave'));
      if (err) { const x = fondo.querySelector<HTMLElement>('#a-err')!; x.textContent = err; x.hidden = false; b.disabled = false; b.textContent = 'Autorizar corrección'; return; }
      cerrar(); c.aviso('Corrección autorizada por 30 minutos.'); vistaServicio(c, S.id);
    });
  });
  document.getElementById('desbloquear')?.addEventListener('click', async () => {
    const motivo = prompt('¿Por qué se corrige este parte firmado? (queda en el control interno)'); if (!motivo?.trim()) return;
    try { await desbloquear(id, motivo); c.aviso('Parte desbloqueado. Al terminar, vuelve a firmar.'); vistaServicio(c, id); } catch (e) { c.aviso(c.errores[(e as Error).message] ?? 'No se pudo.', true); }
  });
  document.getElementById('anular')?.addEventListener('click', async () => {
    const motivo = prompt('Motivo para anular este folio (queda registrado en la bitácora):'); if (!motivo?.trim()) return;
    try { await anularServicio(id, motivo); c.aviso('Folio anulado. Ya no cuenta en los informes.'); vistaServicio(c, id); } catch (e) { c.aviso(c.errores[(e as Error).message] ?? 'No se pudo anular.', true); }
  });
  document.getElementById('f-bit')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const t = String(new FormData(e.target as HTMLFormElement).get('t') ?? '').trim();
    try { await bitacora(id, t); vistaServicio(c, id); } catch { c.aviso('No se pudo agregar la nota.', true); }
  });
}

// ================================================================ INFORMES (mensual y anual, como su Excel)
let anioInf = new Date().getFullYear();
let mesInf = new Date().getMonth() + 1;
function barras(datos: { etiqueta: string; valor: number; color: string }[]) {
  const W = 980, H = 360, mi = 70, mb = 150, ma = 14;
  const max = Math.max(1, ...datos.map((d) => d.valor)); const paso = max > 50 ? 20 : max > 20 ? 10 : max > 8 ? 2 : 1; const tope = Math.ceil(max / paso) * paso;
  const y = (v: number) => ma + (H - ma - mb) * (1 - v / tope); const ab = (W - mi - 6) / Math.max(1, datos.length); const w = Math.min(34, ab * 0.7);
  let s = ''; for (let v = 0; v <= tope; v += paso) s += `<line x1="${mi}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="g-rejilla"/><text x="${mi - 5}" y="${y(v) + 4}" text-anchor="end" class="g-eje">${v}</text>`;
  s += datos.map((d, i) => { const x = mi + ab * i + (ab - w) / 2;
    return `<g><title>${esc(d.etiqueta)}: ${d.valor}</title><rect x="${x}" y="${y(d.valor)}" width="${w}" height="${y(0) - y(d.valor)}" fill="${d.color}" stroke="#8a7f7f" stroke-width=".6"/>
      <text x="${x + w / 2}" y="${y(d.valor) - 4}" text-anchor="middle" class="g-val">${d.valor}</text>
      <text transform="translate(${x + w / 2 + 3},${H - mb + 8}) rotate(-60)" text-anchor="end" class="g-eje g-eti">${esc(d.etiqueta)}</text></g>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="grafica" role="img" aria-label="Servicios por tipo">${s}<line x1="${mi}" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="g-base"/></svg>`;
}

export async function vistaInformes(c: Ctx, modo: 'mes' | 'anio') {
  const mesesOpt = MESES_TXT.map((t, i) => `<option value="${i + 1}" ${i + 1 === mesInf ? 'selected' : ''}>${t}</option>`).join('');
  c.marco('informe', modo === 'mes' ? 'Informe mensual de servicios' : 'Informe anual de servicios',
    'Mismo formato que el Excel de SIMUB: tabla por tipo de servicio, gráfica y totales. Para el Ayuntamiento, Protección Civil y donantes.',
    '<div id="informe"><p class="tenue">Calculando…</p></div>',
    `<div class="chips-modo"><a class="chip ${modo === 'mes' ? 'on' : ''}" href="#informe">Mensual</a><a class="chip ${modo === 'anio' ? 'on' : ''}" href="#anual">Anual</a><a class="chip" href="#app">Reportes de la app</a></div>
     ${modo === 'mes' ? `<select id="i-mes" aria-label="Mes">${mesesOpt}</select>` : ''}<input id="i-anio" type="number" min="2007" max="2100" value="${anioInf}" aria-label="Año" class="anio">
     ${puedeExportar(c) ? '<button class="btn" id="i-xls">Excel</button>' : ''}<button class="btn primario" id="i-pdf">Imprimir / PDF</button>`);
  await catalogo();
  document.getElementById('i-mes')?.addEventListener('change', (e) => { mesInf = +(e.target as HTMLSelectElement).value; vistaInformes(c, modo); });
  $('i-anio').addEventListener('change', (e) => { anioInf = +(e.target as HTMLInputElement).value; vistaInformes(c, modo); });
  $('i-pdf').addEventListener('click', () => window.print());
  let k: Awaited<ReturnType<typeof conteos>>;
  try { k = await conteos(anioInf); } catch { $('informe').innerHTML = '<p class="tenue">No se pudo calcular.</p>'; return; }
  const n = (cid: string, mes?: number) => k.conteos.filter((x) => x.c === cid && (!mes || x.mes === mes)).reduce((p, q) => p + q.n, 0);
  const cab = (t: string) => `<div class="informe-cab solo-impresion"><img src="${BASE}escudo-192.png" alt=""><div><b>BOMBEROS SIMUB VOLUNTARIOS, A.C.</b><span>${t}</span></div></div>`;
  if (modo === 'mes') {
    const filas = CAT.filter((cl) => n(cl.id, mesInf) > 0); const total = filas.reduce((p, cl) => p + n(cl.id, mesInf), 0);
    const titulo = `SERVICIOS ${MESES_TXT[mesInf - 1].toUpperCase()} ${anioInf}`;
    $('informe').innerHTML = `${cab(titulo)}
      <div class="inf-mes"><section class="tarjeta"><h3>${titulo}</h3><table class="tabla t-inf"><thead><tr><th>SERVICIOS</th><th>TOTAL</th></tr></thead><tbody>
        ${filas.map((cl) => `<tr style="background:${cl.color}"><td>${esc(cl.nombre)}</td><td>${n(cl.id, mesInf)}</td></tr>`).join('') || '<tr><td colspan="2" class="tenue">Sin servicios registrados.</td></tr>'}
        <tr class="total"><td>TOTAL</td><td>${total}</td></tr>
        ${(k.turnos ?? []).some((x) => x.mes === mesInf) ? `<tr><td>Turno de día (08:00–20:00)</td><td>${(k.turnos ?? []).filter((x) => x.mes === mesInf && x.turno === 'dia').reduce((p, q) => p + q.n, 0)}</td></tr>
        <tr><td>Turno de noche (20:00–08:00)</td><td>${(k.turnos ?? []).filter((x) => x.mes === mesInf && x.turno === 'noche').reduce((p, q) => p + q.n, 0)}</td></tr>` : ''}</tbody></table></section>
      <section class="tarjeta"><h3>${titulo}</h3>${filas.length ? barras(filas.map((cl) => ({ etiqueta: cl.nombre, valor: n(cl.id, mesInf), color: cl.color }))) : '<p class="tenue">Sin datos.</p>'}</section></div>
      ${(() => { const diasMes = new Date(anioInf, mesInf, 0).getDate(); const pre = `${anioInf}-${String(mesInf).padStart(2, '0')}-`;
        const xs = [...Array(diasMes)].map((_, i) => ({ etiqueta: String(i + 1), valor: (k.dias ?? []).find((d) => d.fecha === pre + String(i + 1).padStart(2, '0'))?.n ?? 0 }));
        const top = xs.slice().sort((p, q) => q.valor - p.valor).filter((x) => x.valor > 0).slice(0, 3);
        return `<section class="tarjeta"><h3>Servicios por día · ${MESES_TXT[mesInf - 1]} ${anioInf}</h3>${columnas(xs, '#6E1C22', 190)}
          ${top.length ? `<p class="tenue chica">Días con más servicios: ${top.map((x) => `<b>${x.etiqueta} de ${MESES_TXT[mesInf - 1].toLowerCase()}</b> (${x.valor})`).join(', ')}.</p>` : ''}</section>`; })()}
      <p class="tenue chica">Cuenta cada folio una vez. Los folios anulados no cuentan. Generado ${new Date().toLocaleString('es-MX')} · App SIMUB.</p>`;
    document.getElementById('i-xls')?.addEventListener('click', async () => {
      const xs = await servicios(new Date(anioInf, mesInf - 1, 1), new Date(anioInf, mesInf, 1));
      const nombre = `${MESES_TXT[mesInf - 1].toUpperCase()} ${anioInf}`;
      descargar(escribirExcel([hojaServicios(nombre, xs.filter((s) => s.estado !== 'anulado')), hojaGrafica(`GRAFICA ${nombre}`, contar(xs))]), `SIMUB_${nombre.replace(' ', '_')}.xlsx`);
    });
    return;
  }
  // ---- anual
  const meses = [...Array(12)].map((_, i) => i + 1);
  const totMes = meses.map((m) => k.conteos.filter((x) => x.mes === m).reduce((p, q) => p + q.n, 0));
  const total = totMes.reduce((p, q) => p + q, 0);
  const grupos = [...new Set(CAT.map((cl) => cl.grupo))].map((g) => ({ g, n: CAT.filter((cl) => cl.grupo === g).reduce((p, cl) => p + n(cl.id), 0), color: CAT.find((cl) => cl.grupo === g)!.color }));
  const apoyos = Object.entries(k.apoyos).sort((p, q) => q[1] - p[1]);
  $('informe').innerHTML = `${cab(`SERVICIOS ANUALES ${anioInf}`)}
    <div class="kpis"><div class="kpi"><span>Servicios ${anioInf}</span><b>${total.toLocaleString('es-MX')}</b></div>
      <div class="kpi"><span>Promedio mensual</span><b>${Math.round(total / Math.max(1, totMes.filter(Boolean).length))}</b></div>
      <div class="kpi"><span>Día / noche</span><b>${(k.turnos ?? []).filter((x) => x.turno === 'dia').reduce((p, q) => p + q.n, 0)} / ${(k.turnos ?? []).filter((x) => x.turno === 'noche').reduce((p, q) => p + q.n, 0)}</b></div>
      <div class="kpi"><span>Tiempo típico de servicio</span><b>${k.minutos_promedio != null ? dur(k.minutos_promedio) : '—'}</b></div>
      <div class="kpi"><span>Con otras corporaciones</span><b>${apoyos.length ? apoyos.reduce((p, q) => Math.max(p, q[1]), 0) : 0}</b><small class="tenue">máx. con una misma corporación</small></div></div>
    <section class="tarjeta"><h3>Servicios anuales ${anioInf}</h3><div class="tabla-caja"><table class="tabla t-inf t-anual"><thead><tr><th>SERVICIOS</th>${MESES_TXT.map((m) => `<th>${m.slice(0, 3).toUpperCase()}</th>`).join('')}<th>TOTAL</th></tr></thead><tbody>
      ${CAT.map((cl) => `<tr style="background:${cl.color}"><td>${esc(cl.nombre)}</td>${meses.map((m) => `<td>${n(cl.id, m) || ''}</td>`).join('')}<td><b>${n(cl.id)}</b></td></tr>`).join('')}
      <tr class="total"><td>TOTAL</td>${totMes.map((t) => `<td>${t}</td>`).join('')}<td>${total}</td></tr></tbody></table></div></section>
    <div class="rejilla-graf"><section class="tarjeta"><h3>Agrupaciones</h3><table class="tabla t-inf"><tbody>${grupos.map((x) => `<tr style="background:${x.color}"><td>${esc(x.g)}</td><td><b>${x.n}</b></td></tr>`).join('')}
      <tr class="total"><td>Total (número de servicios / folios)</td><td>${total}</td></tr></tbody></table></section>
      <section class="tarjeta"><h3>Servicios por mes</h3>${barras(meses.map((m) => ({ etiqueta: MESES_TXT[m - 1], valor: totMes[m - 1], color: '#C9A866' })))}</section>
      ${apoyos.length ? `<section class="tarjeta ancho"><h3>Servicios atendidos junto con otras corporaciones</h3><p class="tenue chica">Evita la doble contabilidad entre dependencias: cada servicio de SIMUB cuenta una vez aunque asistan otras.</p>
        <table class="tabla"><tbody>${apoyos.map(([a, v]) => `<tr><td>${esc(a)}</td><td><b>${v}</b></td></tr>`).join('')}</tbody></table></section>` : ''}</div>
    <p class="tenue chica">Generado ${new Date().toLocaleString('es-MX')} · App SIMUB.</p>`;
  document.getElementById('i-xls')?.addEventListener('click', () => {
    const filas: Celda[][] = [['SERVICIOS', ...MESES_TXT.map((m) => m.toUpperCase()), 'TOTAL'], ...CAT.map((cl) => [cl.nombre, ...meses.map((m) => n(cl.id, m)), n(cl.id)] as Celda[]), ['TOTAL', ...totMes, total]];
    descargar(escribirExcel([{ nombre: `SERVICIOS ANUALES ${anioInf}`, filas, anchos: [34, ...meses.map(() => 9), 9] },
      { nombre: 'AGRUPACIONES', filas: [['GRUPO', 'TOTAL'], ...grupos.map((x) => [x.g, x.n] as Celda[]), ['TOTAL', total]], anchos: [30, 10] }]), `SIMUB_anual_${anioInf}.xlsx`);
  });
}

// ================================================================ IMPORTAR EXCEL HISTÓRICO (Ajustes, admin)
export const tarjetaImportar = `<section class="tarjeta"><h3>Importar servicios desde el Excel de SIMUB</h3>
  <p class="tenue">Sube el archivo de reportes mensuales (.xlsx o .xlsm, con hojas «ENERO 2026», «FEBRERO 2026»…). Se leen FOLIO, FECHA, SERVICIO, TIPO, LUGAR, ÁREA,
  EQUIPO, PERSONAL y TIEMPOS. Se puede volver a subir: no duplica (año + folio) y nunca reemplaza servicios capturados en la app. Sirve también para años anteriores.</p>
  <div class="fila-btn"><input type="file" id="imp-arch" accept=".xlsx,.xlsm"><button class="btn primario" id="imp-btn" type="button" disabled>Importar</button></div>
  <div id="imp-res"></div></section>`;

export function activarImportar(c: Ctx) {
  const arch = $<HTMLInputElement>('imp-arch'), btn = $<HTMLButtonElement>('imp-btn'), res = $('imp-res');
  let lectura: ReturnType<typeof leerHistorico> | null = null;
  arch.addEventListener('change', async () => {
    lectura = null; btn.disabled = true; const f = arch.files?.[0]; if (!f) return;
    res.innerHTML = '<p class="tenue">Leyendo…</p>';
    try {
      lectura = leerHistorico(leerExcel(new Uint8Array(await f.arrayBuffer())));
      const porMes: Record<string, number> = {}; lectura.filas.forEach((x) => { const k = x.fecha.slice(0, 7); porMes[k] = (porMes[k] ?? 0) + 1; });
      res.innerHTML = `<p><b>${lectura.filas.length.toLocaleString('es-MX')}</b> servicios en ${lectura.hojas.length} hojas: ${Object.entries(porMes).map(([k, v]) => `${k} (${v})`).join(', ')}.</p>
        ${lectura.avisos.length ? `<details><summary>${lectura.avisos.length} avisos (folios corregidos o repetidos)</summary><ul class="chica">${lectura.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}`;
      btn.disabled = !lectura.filas.length;
    } catch { res.innerHTML = '<p class="alerta-txt">No se pudo leer el archivo. ¿Es un Excel (.xlsx o .xlsm)?</p>'; }
  });
  btn.addEventListener('click', async () => {
    if (!lectura) return; btn.disabled = true; let ok = 0, omit = 0;
    const filas = lectura.filas;
    for (let i = 0; i < filas.length; i += 400) {
      res.innerHTML = `<p class="tenue">Importando ${Math.min(i + 400, filas.length)} de ${filas.length}…</p>`;
      try { const r = await importarServicios(filas.slice(i, i + 400)); ok += r.importados; omit += r.omitidos; }
      catch { c.aviso('Se interrumpió la importación. Vuelve a intentar: no se duplican.', true); btn.disabled = false; return; }
    }
    registrarImportacion({ archivo: arch.files?.[0]?.name, importados: ok, omitidos: omit, hojas: lectura.hojas }).catch(() => {});
    res.innerHTML = `<p class="ok-txt">Listo: ${ok.toLocaleString('es-MX')} servicios importados o actualizados${omit ? `, ${omit} omitidos (ya capturados en la app con ese folio)` : ''}. Revisa el <a href="#anual">informe anual</a>.</p>`;
  });
}

// ================================================================ guardia del turno y pase de lista
export async function paseDeLista(c: Ctx, g: { turno: string; jefe: string | null; personal: string[] } | undefined, listo: () => void) {
  const per = await tabla<{ nombre: string; cargo: string | null; activo: boolean }>('personal', 'nombre').catch(() => []);
  fuente('personal', () => per.filter((p) => p.activo).map((p) => ({ n: p.nombre, t: p.cargo ?? '' })));
  const turno = new Date().getHours() >= 8 && new Date().getHours() < 20 ? 'día' : 'noche';
  const { fondo, cerrar } = cajon(`${cabCajon(`Guardia del turno de ${turno}`, 'Jefe de guardia y pase de lista')}
    <form class="bloque" id="f-guardia"><label>Jefe de guardia${buscador('jefe', g?.jefe ?? '', 'personal', 'required placeholder="Toca y escribe el nombre"')}</label>
      <label>Personal de guardia (pase de lista)</label>${multi('personal', [], g?.personal ?? [], 'Toca y escribe el nombre', false, [], 'personal')}
      <p class="tenue chica">El jefe de guardia se pone solo en los partes de este turno. Cada persona suma 12 horas de guardia.</p>
      <button class="btn primario">Guardar</button></form>`, 'Guardia');
  activarBuscadores(fondo); activarMulti(fondo);
  fondo.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target as HTMLFormElement);
    try { await guardarGuardia(String(fd.get('jefe') ?? ''), valoresMulti(fd.get('personal'))); c.aviso('Guardia registrada.'); cerrar(); listo(); }
    catch { c.aviso('No se pudo guardar la guardia.', true); }
  });
}
