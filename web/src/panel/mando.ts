// SIMUB · Centro de mando (varias emergencias a la vez), bitácora de servicios (folio único),
// parte de servicio con el formato de SIMUB, informes mensual y anual como su Excel, e importación del histórico.
import L from 'leaflet';
import { I } from '../iconos';
import { FORMULARIOS } from '../formularios';
import { CORPORACIONES, MEDIOS, MESES_TXT, leerHistorico, type Clase } from './catalogo';
import { descargar, escribirExcel, leerExcel, type Celda } from './excel';
import { entregarPdf, servicioPdf } from './pdf';
import { clima, detalleClima, pastillaClima } from './clima';
import { inicioSesion } from './control';
import {
  CODIGOS_PERSONA, COLORES, ESPECIFICACIONES, TIPOS_VEHICULO, activarAgregables, activarArea, activarMulti, area, datalist, filasAgregables, huella,
  lienzoFirma, multi, persona, valoresMulti,
} from './selectores';
import {
  anularServicio, bitacora, cerrarServicio, conteos, desbloquear, estadoUnidad, firmar, guardarServicio, importarServicios, mando, reabrirServicio,
  registrarImportacion, servicio, servicioDesdeReporte, servicios, tabla, type Mando, type Rol, type Servicio, type ServicioLista, type Unidad, type Yo,
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
  fondo.querySelector('[data-x]')?.addEventListener('click', cerrar);
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
    `<div id="m-pend"></div>
     <section class="tarjeta"><div class="fila-tit"><h3>Unidades</h3><span class="tenue chica">Toca una unidad para cambiar su estado.</span></div><div id="m-unidades" class="unidades"></div></section>
     <div class="fila-tit"><h3 id="m-tit">Servicios activos</h3><span class="tenue chica" id="m-act"></span></div>
     <div id="m-servicios" class="m-rejilla"><p class="tenue">Cargando…</p></div>`,
    `<span id="m-clima"></span><button class="btn" id="m-turno">Cambio de turno</button><a class="btn" href="#guardia">${I.campana(16)} Tablero</a><a class="btn primario" href="#captura">${I.mas(16)} Reporte 911 / externo</a>`);
  $('m-turno').addEventListener('click', () => c.turno());
  const pintarClima = async () => { const k = await clima(); const e = document.getElementById('m-clima'); if (e) e.innerHTML = pastillaClima(k); };
  pintarClima(); c.ciclo(pintarClima, 15 * 60000);
  document.querySelector('.cabecera p.tenue')!.insertAdjacentHTML('afterend', `<p class="en-turno">En turno: <b>${esc(c.yo().nombre)}</b>${c.yo().cargo ? ` · ${esc(c.yo().cargo)}` : ''}${inicioSesion() ? ` · desde ${hora(inicioSesion())}` : ''}</p>`);
  await catalogo().catch(() => c.aviso('No se pudo cargar el catálogo de servicios.', true));
  let m: Mando | null = null;
  const pintar = () => {
    if (!m) return;
    $('m-act').textContent = `Actualizado ${hora(new Date().toISOString())} · ${m.hoy} servicios hoy`;
    $('m-tit').textContent = `Servicios activos (${m.servicios.length})`;
    const n = document.getElementById('n-mando'); if (n) n.textContent = m.servicios.length ? String(m.servicios.length) : '';
    $('m-pend').innerHTML = m.pendientes.length ? `<section class="tarjeta aviso-app"><h3>${I.campana(18)} Reportes de la app sin servicio (${m.pendientes.length})</h3>
      ${m.pendientes.map((p) => `<div class="fila-pend"><span class="ic-t" style="background:${FORMULARIOS[p.tipo].color}">${I[p.tipo](16)}</span>
        <span class="f-info"><b>${esc(FORMULARIOS[p.tipo].nombre)} · ${esc(p.folio)}</b><small>${hora(p.creado_en)} · hace ${dur(minDesde(p.creado_en))}${p.referencia ? ` · ${esc(p.referencia)}` : ''}${(p.resumen ?? []).length ? ` · ${esc(p.resumen!.slice(0, 2).join(' · '))}` : ''}</small></span>
        <a class="btn chico" href="#reportes/${p.id}">Ver</a><button class="btn chico primario" data-desde="${p.id}">Abrir servicio</button></div>`).join('')}</section>` : '';
    $('m-unidades').innerHTML = m.unidades.map((u) => `<button class="unidad ${EST_U[u.estado].cls}" data-u="${u.id}" title="${esc(u.tipo ?? '')}">
      <b>${esc(u.nombre)}</b><small>${u.estado === 'en_servicio' && u.folio ? `Folio ${u.folio}` : esc(u.nota ?? EST_U[u.estado].txt)}</small></button>`).join('')
      || '<p class="tenue">Agrega las unidades en Ajustes.</p>';
    $('m-servicios').innerHTML = m.servicios.length ? m.servicios.map((s) => {
      const cl = clase(s.clasificacion), min = minDesde(s.h_reporte ?? s.creado_en);
      const sig = HITOS.find(([k]) => !s[k]);
      return `<article class="m-card" style="--c:${cl.color}">
        <header><span class="m-folio">#${s.folio}</span>${pildora(s.clasificacion, s.falsa_alarma)}<span class="m-min ${min >= 60 ? 'largo' : ''}">${dur(min)}</span></header>
        <p class="m-lugar">${I.pin(14)} ${esc([s.colonia, s.lugar].filter(Boolean).join(', ') || 'Sin lugar')}${s.especificacion ? ` · <span class="tenue">${esc(s.especificacion)}</span>` : ''}</p>
        <p class="tenue chica">${esc(s.medio ?? '')}${s.datos?.folio_911 ? ` ${esc(s.datos.folio_911)}` : ''}${s.reportante ? ` · ${esc(s.reportante)}` : ''} · reporte ${hora(s.h_reporte)} · capturó ${esc(s.capturo ?? '')}</p>
        <div class="m-unid">${s.unidades.map((u) => `<span class="u-chip">${esc(u)}</span>`).join('') || '<span class="alerta-txt chica">Sin unidad asignada</span>'}
          ${Object.keys(s.apoyos ?? {}).length ? `<span class="tenue chica">Apoyo: ${esc(Object.keys(s.apoyos).join(', '))}</span>` : ''}</div>
        <ol class="m-cron">${HITOS.map(([k, , t]) => `<li class="${s[k] ? 'ok' : ''}"><span>${t}</span><b>${hora(s[k] as string | null) || '—'}</b></li>`).join('')}</ol>
        <ul class="m-bit">${(s.bitacora ?? []).slice(0, 3).map((b) => `<li><b>${hora(b.en)}</b> ${esc(b.texto)} <small>${esc(b.autor ?? '')}</small></li>`).join('')}</ul>
        <footer>${sig ? `<button class="btn chico primario" data-hito="${sig[1]}" data-s="${s.id}">${sig[2]} ahora</button>` : ''}
          <button class="btn chico" data-nota="${s.id}">Nota</button><a class="btn chico" href="#servicio/${s.id}">Parte</a>
          <button class="btn chico" data-fin="${s.id}">Concluir</button></footer></article>`;
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
    try {
      if (b.dataset.hito) { b.disabled = true; await bitacora(b.dataset.s!, null, b.dataset.hito); }
      else if (b.dataset.fin) {
        if (!confirm('¿Concluir el servicio? Las unidades quedan disponibles. Después llena o revisa el parte.')) return;
        await cerrarServicio(b.dataset.fin); c.aviso('Servicio concluido. Revisa su parte de servicio.');
      } else if (b.dataset.desde) { b.disabled = true; const r = await servicioDesdeReporte(b.dataset.desde); location.hash = `#servicio/${r.id}`; return; }
      else return;
    } catch (err) { c.aviso(c.errores[(err as Error).message] ?? 'No se pudo guardar.', true); }
    cargar();
  });
  await cargar(); c.ciclo(cargar, 15000);
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
     <section class="tarjeta"><div class="tabla-caja"><table class="tabla t-serv"><thead><tr><th>Folio</th><th>Fecha</th><th>Servicio</th><th>Especificación</th><th>Lugar</th><th>Área</th><th>Unidades</th><th>Pers.</th><th>Salida</th><th>Regreso</th><th>Total</th><th></th></tr></thead>
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
      return `<tr class="${s.estado}"><td class="nw"><b>${s.folio}</b></td><td class="nw">${fechaCorta(s.fecha)}</td><td>${pildora(s.clasificacion, s.falsa_alarma)}</td>
        <td>${esc(s.especificacion ?? '')}</td><td>${esc([s.colonia, s.lugar].filter(Boolean).join(', '))}</td><td class="nw">${esc(s.area_afectada ?? '')}</td><td class="nw">${esc(s.unidades.join(' / '))}</td>
        <td>${s.personal_num ?? ''}</td><td class="nw">${hora(s.h_despacho)}</td><td class="nw">${hora(s.h_base)}</td><td class="nw">${tot != null && tot >= 0 ? dur(tot) : ''}</td>
        <td class="nw">${s.estado === 'activo' ? '<em class="pill p-ambar">Activo</em>' : s.estado === 'anulado' ? '<em class="pill p-gris">Anulado</em>' : s.firmado ? '<em class="pill p-dorado">Firmado</em>' : ''}<a class="btn chico" href="#servicio/${s.id}">Abrir</a></td></tr>`;
    }).join('') || '<tr><td colspan="12" class="tenue">Sin servicios en este mes.</td></tr>';
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
  const filas: Celda[][] = [['FOLIO', 'FECHA', 'SERVICIO', 'TIPO DE SERVICIO (ESPECIFICACIÓN)', 'LUGAR', 'AREA AFECTADA M2', 'EQUIPO UTILIZADO', 'PERSONAL', 'TIEMPO', 'TIEMPO2', 'TOTAL DE TIEMPO', 'APOYOS']];
  for (const s of xs) filas.push([s.folio, new Date(`${s.fecha}T12:00:00`).toLocaleDateString('es-MX'), s.falsa_alarma ? 'FALSA ALARMA' : clase(s.clasificacion).nombre,
    s.falsa_alarma ? `${clase(s.clasificacion).nombre}${s.especificacion ? ` · ${s.especificacion}` : ''}` : s.especificacion ?? '', [s.colonia, s.lugar].filter(Boolean).join(', '), s.area_afectada ?? 'N/A',
    s.unidades.join(' / '), s.personal_num, hora(s.h_despacho), hora(s.h_base), tiempo(s.h_despacho, s.h_base), Object.keys(s.apoyos ?? {}).join(', ')]);
  return { nombre, filas, anchos: [8, 12, 26, 32, 40, 14, 16, 9, 8, 8, 10, 24] };
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
  return { unidades: uds.filter((u) => u.activa).map((u) => u.nombre), personal: per.filter((p) => p.activo).map((p) => p.nombre),
    colonias: col.filter((x) => x.activa).map((x) => x.nombre) };
}

export async function vistaCaptura(c: Ctx) {
  c.marco('captura', 'Reporte 911 o externo', 'Para servicios que llegan por 911, radio, teléfono o en persona. Toca en vez de escribir: se registra con el siguiente folio del año.',
    '<div id="cap"><p class="tenue">Cargando…</p></div>', `<a class="btn" href="#mando">Centro de mando</a>`);
  await catalogo();
  const [L2, m] = await Promise.all([listas(), mando().catch(() => null)]);
  const ocupadas = new Map((m?.unidades ?? []).filter((u) => u.estado !== 'disponible').map((u) => [u.nombre, u.estado === 'en_servicio' ? `folio ${u.folio}` : 'fuera']));
  const grupos = [...new Set(CAT.filter((x) => x.id !== 'falsa' && x.activo).map((x) => x.grupo))];
  $('cap').innerHTML = `<form id="f-cap" class="captura" autocomplete="off">
    <section class="bloque"><h3>1. ¿Quién lo reporta?</h3>
      <div class="chips-sel" data-radio="medio">${ORIGENES.map((o) => `<button type="button" class="mchip ${o === ORIGEN_ULT ? 'on' : ''}" data-v="${o}">${o}</button>`).join('')}</div>
      <input type="hidden" name="medio" value="${ORIGEN_ULT}">
      <div class="rejilla-3"><label id="c-f911">Folio 911<input name="folio_911" inputmode="numeric" placeholder="Si lo dieron"></label>
        <label id="c-corp" hidden>Corporación que lo pasó<select name="corp">${CORPORACIONES.map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label>Hora en que llegó<input type="datetime-local" name="h_reporte" value="${localInput(new Date().toISOString())}"></label></div></section>
    <section class="bloque"><h3>2. ¿Qué pasa?</h3>
      ${grupos.map((g) => `<div class="tipos-g"><span>${esc(g)}</span><div>${CAT.filter((x) => x.grupo === g && x.id !== 'falsa' && x.activo)
        .map((x) => `<button type="button" class="tipo-b" data-cls="${x.id}" style="--c:${x.color}">${esc(x.nombre.replace(/^(INCENDIO|ACCIDENTE|RESCATE|PACIENTE|CAÍDA) (DE )?/, ''))}</button>`).join('')}</div></div>`).join('')}
      <input type="hidden" name="clasificacion" required>
      <div id="c-esp" class="chips-sel" data-radio="especificacion"></div>
      <div class="rejilla-2"><label>Detalle <small>(opcional; toca una sugerencia o escribe)</small><input name="especificacion" maxlength="200"></label>
      <label class="fila-check"><span>Falsa alarma</span><input type="checkbox" name="falsa_alarma"></label></div></section>
    <section class="bloque"><h3>3. ¿Dónde?</h3><div class="rejilla-2">
      <label>Colonia o comunidad<input name="colonia" list="l-col" placeholder="Empieza a escribir…" required></label>
      <label>Calle, número o referencia<input name="lugar" maxlength="300" placeholder="Ej. Calle Pino 12, frente a la tienda"></label></div>
      ${datalist('l-col', L2.colonias)}
      <div class="rejilla-2"><label>Quién reporta <small>(opcional)</small><input name="reportante" maxlength="120"></label>
      <label>Teléfono <small>(opcional)</small><input name="telefono" inputmode="tel" maxlength="20"></label></div></section>
    <section class="bloque"><h3>4. Unidades</h3>
      <div class="multi" data-multi="unidades"><input type="hidden" name="unidades" value="">
        <div class="multi-chips">${L2.unidades.map((u) => `<button type="button" class="mchip ${ocupadas.has(u) ? 'ocupada' : ''}" data-v="${esc(u)}" ${ocupadas.get(u) === 'fuera' ? 'disabled' : ''}>${esc(u)}${ocupadas.has(u) ? ` <small>${esc(ocupadas.get(u))}</small>` : ''}</button>`).join('')}</div></div>
      <div class="chips-sel" data-radio="modo"><button type="button" class="mchip on" data-v="ahora">Sale ahora (despacho)</button><button type="button" class="mchip" data-v="pendiente">Solo registrar</button>
        <button type="button" class="mchip" data-v="concluido">Ya se atendió (captura posterior)</button></div><input type="hidden" name="modo" value="ahora">
      <div class="rejilla-3" id="c-horas" hidden><label>Salida<input type="datetime-local" name="h_despacho"></label><label>Llegada a la escena<input type="datetime-local" name="h_llegada"></label><label>Regreso a base<input type="datetime-local" name="h_base"></label></div>
</section>
    <div class="cap-pie"><button class="btn primario grande" type="submit">Registrar y dar folio</button><span class="tenue chica">Captura: <b>${esc(c.yo().nombre)}</b></span></div>
  </form><div id="cap-ok"></div>`;
  const form = $<HTMLFormElement>('f-cap');
  activarMulti(form);
  const set = (n: string, v: string) => { (form.elements.namedItem(n) as HTMLInputElement).value = v; };
  form.querySelectorAll<HTMLElement>('[data-radio]').forEach((g) => g.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.mchip'); if (!b) return;
    g.querySelectorAll('.mchip').forEach((x) => x.classList.toggle('on', x === b)); set(g.dataset.radio!, b.dataset.v!);
    if (g.dataset.radio === 'medio') { ORIGEN_ULT = b.dataset.v!; $('c-f911').hidden = b.dataset.v !== '911'; $('c-corp').hidden = b.dataset.v !== 'Otra corporación'; }
    if (g.dataset.radio === 'modo') $('c-horas').hidden = b.dataset.v !== 'concluido';
  }));
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
    const medio = g('medio') === 'Otra corporación' ? `Otra corporación (${g('corp')})` : g('medio');
    try {
      const r = await guardarServicio(null, {
        clasificacion: g('clasificacion'), especificacion: g('especificacion'), colonia: g('colonia'), lugar: g('lugar'), medio,
        reportante: g('reportante'), telefono: g('telefono'), h_reporte: desdeLocal(g('h_reporte')), unidades: modo === 'concluido' ? uds : uds,
        falsa_alarma: fd.get('falsa_alarma') === 'on', datos: g('folio_911') ? { folio_911: g('folio_911') } : {},
        apoyos: g('medio') === 'Otra corporación' ? { [g('corp')]: { unidades: '', encargado: '' } } : {},
        h_despacho: desdeLocal(g('h_despacho')), h_llegada: desdeLocal(g('h_llegada')), h_base: desdeLocal(g('h_base')),
        tripulacion: uds.map((u) => ({ unidad: u, maquinista: '', jefe: '', bomberos: '' })),
      });
      if (modo === 'ahora') await bitacora(r.id, null, 'despacho');
      if (modo === 'concluido') await cerrarServicio(r.id);
      form.hidden = true;
      $('cap-ok').innerHTML = `<section class="tarjeta folio-ok">${I.check(44)}<span>Folio asignado</span><b>${folioTxt(r)}</b>
        <p>${pildora(g('clasificacion'), fd.get('falsa_alarma') === 'on')} · ${esc(g('colonia'))}${uds.length ? ` · ${esc(uds.join(', '))}` : ''}</p>
        <div class="fila-btn"><a class="btn primario" href="#servicio/${r.id}">Completar el parte</a><button class="btn" id="otro">Registrar otro</button><a class="btn" href="#mando">Centro de mando</a></div></section>`;
      $('otro').addEventListener('click', () => vistaCaptura(c));
    } catch (err) { c.aviso(c.errores[(err as Error).message] ?? 'No se pudo registrar.', true); btn.disabled = false; btn.textContent = 'Registrar y dar folio'; }
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
    <td>${persona(`t_maquinista_${i}`, t.maquinista, 'l-per', dis)}</td><td>${persona(`t_jefe_${i}`, t.jefe, 'l-per', dis)}</td>
    <td>${multi(`t_bomberos_${i}`, [], valoresMulti(t.bomberos), 'Nombre y Enter', !editable, L2.personal)}</td></tr>`;
  const filaVeh = (i: number, x: Record<string, string> = veh[i] ?? {}) => `<tr data-veh="${i}">${([['placas', ''], ['color', 'l-color'], ['tipo', 'l-tveh'], ['modelo', ''], ['conductor', ''], ['propietario', '']] as const)
    .map(([k, l]) => `<td><input name="v_${k}_${i}" value="${v(x[k])}" ${l ? `list="${l}"` : ''} placeholder="${k[0].toUpperCase() + k.slice(1)}" ${dis}></td>`).join('')}</tr>`;
  const filaPer = (i: number, x = per[i] ?? { nombre: '', codigo: '', edad: '' }) => `<tr data-per="${i}"><td><input name="p_nombre_${i}" value="${v(x.nombre)}" placeholder="Nombre" ${dis}></td>
    <td><input name="p_codigo_${i}" value="${v(x.codigo)}" list="l-cod" placeholder="Código" ${dis}></td><td><input name="p_edad_${i}" value="${v(x.edad)}" inputmode="numeric" placeholder="Edad" class="corto" ${dis}></td></tr>`;
  const filasCorp = (sel: string[], prev: Record<string, { unidades?: string; encargado?: string }>) => sel.map((k, i) => `<tr><th>${esc(k)}<input type="hidden" name="a_k_${i}" value="${esc(k)}"></th>
    <td><input name="a_u_${i}" value="${v(prev[k]?.unidades)}" placeholder="Unidad(es)" ${dis}></td><td><input name="a_e_${i}" value="${v(prev[k]?.encargado)}" placeholder="Encargado(s)" ${dis}></td></tr>`).join('');
  const firmaCaja = (k: string, t: string) => { const f = S.firmas?.[k]; const nombre = (S as unknown as Record<string, string | null>)[k] ?? f?.nombre ?? '';
    return `<div class="firma-caja"><span class="etq">${t}</span>${persona(`f_${k}`, nombre, 'l-per', dis + ' placeholder="Nombre"')}
      ${f?.imagen ? `<img src="${f.imagen}" alt="Firma de ${esc(f.nombre ?? t)}"><small class="tenue">Firmó ${new Date(f.en).toLocaleString('es-MX')} · registró ${esc(f.registro)}</small>` : '<div class="firma-vacia">Sin firma</div>'}
      ${editable ? `<button type="button" class="btn chico" data-firmar="${k}">${f?.imagen ? 'Volver a firmar' : 'Firmar en pantalla'}</button>` : ''}</div>`; };
  $('parte').innerHTML = `
  ${!editable ? `<div class="aviso-candado">${S.bloqueado ? 'Parte <b>firmado</b> por el jefe de servicio: ya no se puede modificar.' : 'Este registro ya está cerrado: solo el Comandante o el responsable de la app pueden corregirlo.'}
     ${admin && S.bloqueado ? '<button class="btn chico" id="desbloquear">Desbloquear para corregir</button>' : ''}</div>` : ''}
  ${editable && S.bloqueado ? `<div class="aviso-candado">Parte firmado. Como administrador puedes corregirlo; el cambio queda en el control interno.</div>` : ''}
  <form class="parte" id="f-parte" autocomplete="off"><fieldset class="sin-borde" ${dis}>
    <section class="bloque parte-cab2"><div><span class="etq">Folio</span><b class="folio-g">${folioTxt(S)}</b></div>
      <div>${pildora(S.clasificacion, S.falsa_alarma)} <em class="pill ${S.estado === 'activo' ? 'p-ambar' : S.estado === 'anulado' ? 'p-gris' : 'p-verde'}">${S.estado === 'activo' ? 'En curso' : S.estado === 'anulado' ? 'Anulado' : 'Concluido'}</em>
      ${S.bloqueado ? '<em class="pill p-dorado">Firmado</em>' : ''}${S.origen === 'historico' ? '<em class="pill p-gris">Importado del Excel</em>' : ''}${S.reporte_folio ? `<a class="pill p-dorado" href="#reportes/${S.reporte_id}">Reporte app ${esc(S.reporte_folio)}</a>` : ''}
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
      <div class="rejilla-2"><label>Colonia o comunidad<input name="colonia" list="l-col" value="${v(S.colonia)}" placeholder="Empieza a escribir…"></label>
      <label>Calle, número o referencia<input name="lugar" value="${v(S.lugar)}"></label></div>
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
    <section class="bloque"><h3>Observaciones</h3><textarea name="observaciones" rows="5">${v(S.observaciones)}</textarea></section>
    <section class="bloque"><h3>Firmas</h3><div class="rejilla-3 firmas">${FIRMAS.map(([k, t]) => firmaCaja(k, t)).join('')}</div>
      <p class="tenue chica">Se firma con el dedo (celular o tableta) o con el mouse. Al firmar el jefe de servicio, el parte queda cerrado y se guarda su huella digital (SHA-256) para comprobar que no cambió.</p></section>
  </fieldset>
    ${datalist('l-per', L2.personal)}${datalist('l-col', L2.colonias)}${datalist('l-esp', ESPECIFICACIONES[S.clasificacion] ?? [])}
    ${datalist('l-cod', CODIGOS_PERSONA)}${datalist('l-tveh', TIPOS_VEHICULO)}${datalist('l-color', COLORES)}
    <div class="pie-parte">
      ${editable ? '<button class="btn primario" type="submit">Guardar parte</button>' : ''}
      <button class="btn" type="button" id="pdf">Descargar PDF</button>
      ${S.estado === 'activo' ? '<button class="btn" type="button" id="concluir">Concluir servicio</button>' : ''}
      ${S.estado === 'cerrado' && admin ? '<button class="btn tenue-btn" type="button" id="reabrir">Reabrir</button>' : ''}
      ${admin && S.estado !== 'anulado' ? '<button class="btn tenue-btn" type="button" id="anular">Anular folio</button>' : ''}
      <span class="tenue chica">Actualizado ${new Date(S.actualizado_en).toLocaleString('es-MX')}</span></div>
  </form>
  <section class="tarjeta"><h3>Bitácora</h3><ol class="hist">${(S.bitacora ?? []).map((b) => `<li><b>${new Date(b.en).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b> · ${esc(b.texto)} <small class="tenue">${esc(b.autor ?? '')}</small></li>`).join('')}</ol>
    ${S.estado === 'anulado' ? '' : '<form class="fila-btn" id="f-bit"><input name="t" maxlength="1000" placeholder="Agregar nota a la bitácora" required><button class="btn">Agregar</button></form>'}</section>`;
  const form = $<HTMLFormElement>('f-parte');
  activarMulti(form); activarArea(form);
  const cuenta = (sel: string) => () => form.querySelectorAll(sel).length;
  activarAgregables(form, { 't-veh': (i) => filaVeh(i, {}), 't-per': (i) => filaPer(i, { nombre: '', codigo: '', edad: '' }) }, { 't-veh': cuenta('[data-veh]'), 't-per': cuenta('[data-per]') });
  form.querySelector('[data-agregar="t-trip"]')?.addEventListener('click', () => {
    const i = form.querySelectorAll('[data-trip]').length; form.querySelector('#t-trip tbody')!.insertAdjacentHTML('beforeend', filaTrip(i, { unidad: '', maquinista: '', jefe: '', bomberos: '' })); activarMulti(form);
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
      area_afectada: g('area_afectada'), colonia: g('colonia'), lugar: g('lugar'), medio: g('medio'), reportante: g('reportante'), telefono: g('telefono'),
      h_reporte: desdeLocal(g('h_reporte')), h_despacho: desdeLocal(g('h_despacho')), h_llegada: desdeLocal(g('h_llegada')),
      h_disponible: desdeLocal(g('h_disponible')), h_base: desdeLocal(g('h_base')), km_salida: g('km_salida'), km_llegada: g('km_llegada'),
      personal_num: g('personal_num') || (nombres.size ? String(nombres.size) : ''), unidades: deTrip.length ? deTrip : S.unidades,
      tripulacion, vehiculos, apoyos, personas, observaciones: g('observaciones'),
      datos: { ...S.datos, folio_911: g('d_folio_911'), compania: g('d_compania'), kilos: g('d_kilos') },
      jefe_servicio: g('f_jefe_servicio'), radio_operador: g('f_radio_operador'), jefe_guardia: g('f_jefe_guardia'),
    };
  };
  const guardar = async () => {
    if (!editable) return true;
    try { await guardarServicio(id, recolectar()); return true; }
    catch (err) { c.aviso(c.errores[(err as Error).message] ?? 'No se pudo guardar el parte.', true); return false; }
  };
  form.addEventListener('submit', async (e) => { e.preventDefault(); if (await guardar()) { c.aviso('Parte guardado.'); vistaServicio(c, id); } });
  // firma en pantalla
  form.querySelectorAll<HTMLButtonElement>('[data-firmar]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.firmar!, t = FIRMAS.find((x) => x[0] === k)![1];
    const nombre = (form.elements.namedItem(`f_${k}`) as HTMLInputElement).value.trim();
    if (!nombre) return c.aviso(`Escribe o elige el nombre del ${t.toLowerCase()} antes de firmar.`, true);
    const { fondo, cerrar } = cajon(`${cabCajon(`Firma · ${t}`, esc(nombre))}
      <p class="tenue">Firma dentro del recuadro con el dedo o el mouse.</p><canvas class="lienzo-firma" id="lienzo"></canvas>
      ${k === 'jefe_servicio' ? '<p class="aviso-candado chico">Al firmar el jefe de servicio el parte queda <b>cerrado</b>. Revisa que todo esté completo.</p>' : ''}
      <div class="fila-btn"><button class="btn" id="f-limpiar" type="button">Borrar</button><button class="btn primario" id="f-ok" type="button">Guardar firma</button></div>`, 'Firma');
    const lz = lienzoFirma(fondo.querySelector<HTMLCanvasElement>('#lienzo')!);
    fondo.querySelector('#f-limpiar')!.addEventListener('click', () => lz.limpiar());
    fondo.querySelector('#f-ok')!.addEventListener('click', async () => {
      if (lz.vacia()) return c.aviso('La firma está vacía.', true);
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
    try { await cerrarServicio(id); c.aviso('Servicio concluido; unidades disponibles.'); vistaServicio(c, id); } catch (e) { c.aviso(c.errores[(e as Error).message] ?? 'No se pudo concluir.', true); }
  });
  document.getElementById('reabrir')?.addEventListener('click', async () => {
    try { await reabrirServicio(id); vistaServicio(c, id); } catch (e) { c.aviso(c.errores[(e as Error).message] ?? 'No se pudo reabrir.', true); }
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
        <tr class="total"><td>TOTAL</td><td>${total}</td></tr></tbody></table></section>
      <section class="tarjeta"><h3>${titulo}</h3>${filas.length ? barras(filas.map((cl) => ({ etiqueta: cl.nombre, valor: n(cl.id, mesInf), color: cl.color }))) : '<p class="tenue">Sin datos.</p>'}</section></div>
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
