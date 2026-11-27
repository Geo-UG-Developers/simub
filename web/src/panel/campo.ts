// SIMUB Campo: el celular o tableta de la unidad. Botones grandes, funciona sin señal y se sincroniza solo
// con el folio en el panel de cabina (hitos con GPS, fotos, notas por voz, personal en escena y tiempo de aire,
// comando de incidentes, área afectada en el mapa, recursos, personas, vehículos y solicitud de apoyo).
import L from 'leaflet';
import { comprimir } from '../api';
import { activarBuscadores, buscador, fuente } from './buscador';
import { enviar, escucharCola, gps, pendientes, vaciar } from './cola';
import { campo, tabla, urlsEvidencias, type Escena, type ServicioCampo } from './datos';
import { CORPORACIONES } from './catalogo';
import { CODIGOS_PERSONA } from './selectores';
import { formInspeccion } from './unidades';
import { puntosCercanos } from './mapa';
import type { Ctx } from './mando';

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hora = (f?: string | null) => f ? new Date(f).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const folioTxt = (s: { anio: number; folio: number }) => `${s.anio}-${String(s.folio).padStart(4, '0')}`;
const TURNO = (h = new Date().getHours()) => (h >= 8 && h < 20 ? 'Día' : 'Noche');
export const ASIGNACIONES = ['Ataque', 'Búsqueda', 'Rescate', 'Ventilación', 'Abastecimiento de agua', 'Seguridad', 'Atención prehospitalaria', 'Apoyo'];

let compartir: number | null = null;
let relojAire: number | undefined;
export function pararCampo() { if (compartir != null) navigator.geolocation?.clearWatch(compartir); compartir = null; clearInterval(relojAire); }

/** Pitido fuerte + vibración (alarma de tiempo de aire). */
function alarmaCorta() {
  try { navigator.vibrate?.([400, 150, 400, 150, 400]); } catch { /* */ }
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 1200; g.gain.value = 0.6; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 1.2);
  } catch { /* */ }
}
/** Dictado por voz (si el navegador lo permite); si no, el teclado del celular tiene micrófono. */
function dictar(destino: HTMLInputElement | HTMLTextAreaElement, aviso: (t: string, e?: boolean) => void) {
  const R = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
  if (!R) return aviso('Este navegador no permite dictado: usa el micrófono del teclado.', true);
  const r = new R(); r.lang = 'es-MX'; r.interimResults = false;
  r.onresult = (e) => { destino.value = `${destino.value ? `${destino.value} ` : ''}${e.results[0][0].transcript}`; };
  r.onerror = () => aviso('No se entendió; intenta de nuevo.', true);
  r.start(); aviso('Habla ahora…');
}
interface SpeechRec { lang: string; interimResults: boolean; start(): void; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onerror: () => void }

const AREA_M2 = (pts: [number, number][]) => {   // área geodésica aproximada (fórmula esférica)
  if (pts.length < 3) return 0;
  const R = 6378137, rad = Math.PI / 180; let s = 0;
  for (let i = 0; i < pts.length; i++) { const [la1, lo1] = pts[i], [la2, lo2] = pts[(i + 1) % pts.length]; s += (lo2 - lo1) * rad * (2 + Math.sin(la1 * rad) + Math.sin(la2 * rad)); }
  return Math.abs(s * R * R / 2);
};
export const areaTexto = (m2: number) => m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`;

// ================================================================ lista de servicios de la unidad
export async function vistaCampo(c: Ctx, id?: string) {
  if (id === 'revision') return vistaRevision(c);
  if (id) return vistaServicioCampo(c, id);
  pararCampo();
  c.marco('campo', `Campo${c.yo().unidad ? ` · ${esc(c.yo().unidad)}` : ''}`, `Turno ${TURNO()} · ${esc(c.yo().nombre)}`,
    `<div class="campo">
      <div class="campo-estado" id="cp-red"></div>
      <a class="btn grande ancho" href="#campo/revision">Revisión de la unidad (inicio de turno)</a>
      <div id="cp-lista"><p class="tenue">Cargando…</p></div>
      <div class="fila-btn"><a class="btn" href="#herramientas">Herramientas y calculadoras</a><a class="btn" href="#mapa">Mapa operativo</a></div></div>`);
  pintarRed();
  const cargar = async () => {
    let x: Awaited<ReturnType<typeof campo>>;
    try { x = await campo(); } catch { $('cp-lista').innerHTML = '<p class="alerta-txt">Sin conexión. Lo que captures se guardará en el teléfono.</p>'; return; }
    const el = document.getElementById('cp-lista'); if (!el) return;
    el.innerHTML = x.servicios.length ? x.servicios.map((s) => `<a class="cp-tarjeta ${s.estado}" href="#campo/${s.id}" style="--c:${s.color}">
      <b>#${s.folio} · ${esc(s.clase)}</b><span>${esc([s.colonia, s.lugar].filter(Boolean).join(', ') || 'Sin dirección')}</span>
      <small>${s.estado === 'activo' ? 'En curso' : 'Concluido'} · ${hora(s.h_reporte)} · ${esc(s.unidades.join(', '))}</small></a>`).join('')
      : `<div class="vacio-m"><b>Sin servicios asignados${x.unidad ? ` a ${esc(x.unidad)}` : ''}</b><span>Cuando cabina asigne la unidad, el servicio aparecerá aquí solo.</span></div>`;
  };
  await cargar(); c.ciclo(cargar, 8000);
}
function pintarRed() {
  const f = (n: number) => { const e = document.getElementById('cp-red'); if (e) e.innerHTML = `<span class="${navigator.onLine ? 'p-verde' : 'p-rojo'} pill">${navigator.onLine ? 'En línea' : 'Sin señal'}</span>${n ? ` <span class="pill p-ambar">${n} por enviar</span>` : ''}`; };
  escucharCola(f); window.addEventListener('online', () => f(pendientes())); window.addEventListener('offline', () => f(pendientes()));
}

// ================================================================ servicio en campo
const HITOS: [string, string | null, string][] = [['despacho', null, 'En camino'], ['llegada', null, 'En la escena'], ['', 'Situación controlada', 'Controlado'], ['disponible', null, 'Disponible'], ['base', null, 'En base']];
let pestana = 'hitos';
async function vistaServicioCampo(c: Ctx, id: string) {
  pararCampo();
  c.marco('campo', 'Servicio en campo', '', '<div id="cp"><p class="tenue">Cargando…</p></div>', '<a class="btn" href="#campo">← Mis servicios</a>');
  const [x, per] = await Promise.all([campo().catch(() => null), tabla<{ nombre: string; cargo: string | null; activo: boolean }>('personal', 'nombre').catch(() => [])]);
  fuente('personal', () => per.filter((p) => p.activo).map((p) => ({ n: p.nombre, t: p.cargo ?? '' })));
  const s = x?.servicios.find((y) => y.id === id) as ServicioCampo | undefined;
  if (!s) { $('cp').innerHTML = '<p class="tenue">No se encontró el servicio (o no está asignado a tu unidad).</p>'; return; }
  const unidad = c.yo().unidad ?? s.unidades[0] ?? null;
  // compartir ubicación de la unidad mientras el servicio está activo y la pantalla abierta
  const etiqueta = unidad ?? `Of. ${c.yo().nombre}`;
  let quiere = true; try { quiere = localStorage.getItem('simub-ubicacion') !== 'no'; } catch { /* sin almacenamiento */ }
  const encender = () => {
    if (compartir != null || s.estado !== 'activo' || !navigator.geolocation) return;
    let ultimo = 0;
    compartir = navigator.geolocation.watchPosition((p) => {
      if (Date.now() - ultimo < 45000) return; ultimo = Date.now();
      enviar({ tipo: 'rpc', fn: 'panel_posicion', args: { p_unidad: etiqueta, p_lat: p.coords.latitude, p_lon: p.coords.longitude, p_precision: Math.round(p.coords.accuracy), p_servicio: id } }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, maximumAge: 30000 });
  };
  if (quiere) encender();
  const maps = s.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([s.lugar, s.colonia, 'Guanajuato, Gto.'].filter(Boolean).join(', '))}`;
  const P = [['hitos', 'Avance'], ['evidencia', 'Fotos y notas'], ['escena', 'Personal y aire'], ['datos', 'Datos'], ['area', 'Área'], ['sci', 'Comando'], ['apoyo', 'Apoyo']];
  $('cp').innerHTML = `<div class="campo">
    <div class="cp-cab" style="--c:${s.color}"><b>#${s.folio} · ${esc(s.clase)}</b>${s.especificacion ? `<span>${esc(s.especificacion)}</span>` : ''}
      <span>${esc([s.colonia, s.lugar].filter(Boolean).join(', ') || 'Sin dirección')}</span>
      <div class="fila-btn"><a class="btn" href="${maps}" target="_blank" rel="noopener">Cómo llegar</a>${s.telefono ? `<a class="btn" href="tel:${esc(s.telefono)}">Llamar a quien reporta</a>` : ''}
      <a class="btn" href="#servicio/${s.id}">Parte completo</a></div></div>
    ${s.estado === 'activo' ? `<label class="ubic-sw"><input type="checkbox" id="cp-ubic" ${quiere ? 'checked' : ''}><span><b>Mi posición en el mapa de cabina</b><br>
      <small class="tenue">${esc(etiqueta)} · se envía cada 45 s mientras esta pantalla está abierta</small></span></label>` : ''}
    <div class="campo-estado" id="cp-red"></div>
    <nav class="cp-tabs">${P.map(([k, t]) => `<button class="${pestana === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</nav>
    <div id="cp-cuerpo"></div></div>`;
  document.getElementById('cp-ubic')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked; try { localStorage.setItem('simub-ubicacion', on ? 'si' : 'no'); } catch { /* */ }
    if (on) { encender(); c.aviso('Tu posición se muestra en el mapa de cabina.'); }
    else { if (compartir != null) navigator.geolocation.clearWatch(compartir); compartir = null; c.aviso('Ya no se envía tu posición (desaparece del mapa en 30 min).'); }
  });
  pintarRed();
  $('cp').querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { pestana = b.dataset.tab!; vistaServicioCampo(c, id); }));
  const cuerpo = $('cp-cuerpo');
  const avisar = () => enviar({ tipo: 'accion', args: { accion: 'servicio', servicio: id } }).catch(() => {});
  const listo = async (msg: string, enviado: boolean) => { c.aviso(enviado ? msg : `${msg} Se enviará al recuperar la señal.`); avisar(); };

  if (pestana === 'hitos') {
    const hecho: Record<string, string | null> = { despacho: s.h_despacho, llegada: s.h_llegada, disponible: s.h_disponible, base: s.h_base };
    cuerpo.innerHTML = `<div class="cp-hitos">${HITOS.map(([k, txt, t]) => `<button class="cp-hito ${k && hecho[k] ? 'ok' : ''}" data-h="${k}" data-t="${esc(txt ?? '')}" ${s.estado !== 'activo' ? 'disabled' : ''}>
        <b>${t}</b><small>${k && hecho[k] ? hora(hecho[k]) : 'Tocar al llegar a este punto'}</small></button>`).join('')}</div>
      <form class="bloque" id="cp-nota"><label>Nota rápida para cabina<span class="con-ahora"><input name="t" placeholder="Ej. Se requiere pipa"><button type="button" class="btn" id="cp-voz">🎤</button></span></label>
        <button class="btn primario">Enviar nota</button></form>
      <h3>Últimos movimientos</h3><ol class="hist">${(s.bitacora ?? []).map((b) => `<li><b>${hora(b.en)}</b> ${esc(b.texto)} <small class="tenue">${esc(b.autor ?? '')}</small></li>`).join('')}</ol>
      <div id="cp-cerca"></div>`;
    cuerpo.querySelectorAll<HTMLButtonElement>('[data-h]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; const p = await gps();
      const ok = await enviar({ tipo: 'rpc', fn: 'panel_bitacora', args: { p_servicio: id, p_texto: b.dataset.t || null, p_hito: b.dataset.h || null, p_lat: p?.coords.latitude ?? null, p_lon: p?.coords.longitude ?? null } })
        .catch((e) => { c.aviso((e as Error).message, true); return null; });
      if (ok !== null) { await listo(`${b.querySelector('b')!.textContent} registrado.`, ok); vistaServicioCampo(c, id); }
    }));
    $('cp-voz').addEventListener('click', () => dictar(cuerpo.querySelector<HTMLInputElement>('[name=t]')!, c.aviso));
    $('cp-nota').addEventListener('submit', async (e) => {
      e.preventDefault(); const t = String(new FormData(e.target as HTMLFormElement).get('t') ?? '').trim(); if (!t) return;
      const p = await gps(4000);
      const ok = await enviar({ tipo: 'rpc', fn: 'panel_bitacora', args: { p_servicio: id, p_texto: t, p_hito: null, p_lat: p?.coords.latitude ?? null, p_lon: p?.coords.longitude ?? null } });
      await listo('Nota enviada.', ok); vistaServicioCampo(c, id);
    });
    if (s.lat != null) puntosCercanos(s.lat, s.lon!, 1.5).then((xs) => { const e = document.getElementById('cp-cerca'); if (e && xs.length) e.innerHTML = `<h3>Cerca del servicio</h3><ul class="cp-cerca">${xs.slice(0, 8).map((p) =>
      `<li><b>${esc(p.nombre)}</b> <small>${esc(p.tipoTxt)} · ${p.km < 1 ? `${Math.round(p.km * 1000)} m` : `${p.km.toFixed(1)} km`}</small>${p.resumen ? `<br><small>${esc(p.resumen)}</small>` : ''}
       <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" rel="noopener">Ir</a></li>`).join('')}</ul>`; }).catch(() => {});
  }

  if (pestana === 'evidencia') {
    cuerpo.innerHTML = `<form class="bloque" id="cp-foto"><label class="btn grande ancho">📷 Tomar foto o video<input type="file" name="f" accept="image/*,video/*" capture="environment" multiple hidden></label>
      <label>Nota de la foto <small>(opcional)</small><span class="con-ahora"><input name="nota" placeholder="Ej. Origen del fuego"><button type="button" class="btn" id="cp-voz2">🎤</button></span></label>
      <p class="tenue chica" id="cp-sel">Sin archivos elegidos.</p><button class="btn primario">Enviar</button></form>
      <div class="cp-galeria" id="cp-gal"></div>`;
    const inp = cuerpo.querySelector<HTMLInputElement>('[name=f]')!;
    inp.addEventListener('change', () => { $('cp-sel').textContent = `${inp.files?.length ?? 0} archivo(s) listos para enviar.`; });
    $('cp-voz2').addEventListener('click', () => dictar(cuerpo.querySelector<HTMLInputElement>('[name=nota]')!, c.aviso));
    $('cp-foto').addEventListener('submit', async (e) => {
      e.preventDefault(); const fs = [...(inp.files ?? [])]; if (!fs.length) return c.aviso('Toma o elige una foto.', true);
      const nota = String(new FormData(e.target as HTMLFormElement).get('nota') ?? ''); const p = await gps(4000); let todas = true;
      for (const f of fs) {
        const video = f.type.startsWith('video');
        if (video && f.size > 25 * 1024 * 1024) { c.aviso('El video pesa más de 25 MB; grábalo más corto.', true); continue; }
        const b = video ? f : await comprimir(f);
        const ok = await enviar({ tipo: 'foto', meta: { servicio: id, ext: video ? (f.name.split('.').pop() || 'mp4') : 'jpg', nota, lat: p?.coords.latitude ?? null, lon: p?.coords.longitude ?? null, tipo: video ? 'video' : 'foto' } }, b);
        todas &&= ok;
      }
      await listo('Evidencia enviada.', todas); vistaServicioCampo(c, id);
    });
    const ev = s.evidencias ?? [];
    urlsEvidencias(ev.map((v) => v.ruta)).then((us) => { const g = document.getElementById('cp-gal'); if (g) g.innerHTML = ev.map((v, i) => v.tipo === 'video'
      ? `<figure><video src="${us[i]}" controls preload="none"></video><figcaption>${esc(v.nota ?? '')} · ${hora(v.en)}</figcaption></figure>`
      : `<figure><a href="${us[i]}" target="_blank" rel="noopener"><img src="${us[i]}" alt=""></a><figcaption>${esc(v.nota ?? '')} · ${hora(v.en)}</figcaption></figure>`).join('') || '<p class="tenue">Aún no hay evidencias.</p>'; });
  }

  if (pestana === 'escena') {
    const dentro = (s.escena ?? []).filter((e) => !e.sale), fuera = (s.escena ?? []).filter((e) => e.sale);
    cuerpo.innerHTML = `<form class="bloque" id="cp-entra"><h3>Registrar entrada a la escena</h3>
        <label>Persona${buscador('persona', '', 'personal', 'placeholder="Toca y escribe el nombre" required')}</label>
        <div class="chips-sel" id="cp-asig">${ASIGNACIONES.map((a) => `<button type="button" class="mchip" data-v="${a}">${a}</button>`).join('')}</div>
        <button class="btn primario">Entra a la escena</button></form>
      <h3>En escena (${dentro.length})</h3><div class="cp-escena">${dentro.map((e) => filaEscena(e)).join('') || '<p class="tenue">Nadie registrado dentro.</p>'}</div>
      ${fuera.length ? `<details><summary>Ya salieron (${fuera.length})</summary><ul>${fuera.map((e) => `<li>${esc(e.persona)} · ${hora(e.entra)}–${hora(e.sale)}</li>`).join('')}</ul></details>` : ''}`;
    activarBuscadores(cuerpo);
    let asig = ''; cuerpo.querySelectorAll<HTMLButtonElement>('#cp-asig .mchip').forEach((b) => b.addEventListener('click', () => { asig = b.dataset.v!; cuerpo.querySelectorAll('#cp-asig .mchip').forEach((y) => y.classList.toggle('on', y === b)); }));
    $('cp-entra').addEventListener('submit', async (e) => {
      e.preventDefault(); const persona = String(new FormData(e.target as HTMLFormElement).get('persona') ?? '').trim(); if (!persona) return;
      const ok = await enviar({ tipo: 'rpc', fn: 'panel_escena', args: { p_servicio: id, p_accion: 'entra', p_persona: persona, p_asignacion: asig || null, p_aire_min: null, p_id: null } });
      await listo(`${persona} en escena.`, ok); vistaServicioCampo(c, id);
    });
    cuerpo.querySelectorAll<HTMLButtonElement>('[data-esc]').forEach((b) => b.addEventListener('click', async () => {
      const [acc, eid, min] = b.dataset.esc!.split('|');
      const ok = await enviar({ tipo: 'rpc', fn: 'panel_escena', args: { p_servicio: id, p_accion: acc, p_persona: null, p_asignacion: null, p_aire_min: min ? +min : null, p_id: +eid } });
      await listo('Registrado.', ok); vistaServicioCampo(c, id);
    }));
    // cronómetros de aire: avisan a la mitad y con 5 minutos restantes
    const avisados = new Set<string>();
    const tic = () => cuerpo.querySelectorAll<HTMLElement>('[data-aire]').forEach((el) => {
      const [ini, min, quien] = el.dataset.aire!.split('|'); const rest = +min * 60 - (Date.now() - +new Date(ini)) / 1000;
      el.textContent = rest > 0 ? `${Math.floor(rest / 60)}:${String(Math.floor(rest % 60)).padStart(2, '0')}` : 'SIN AIRE';
      el.className = `aire ${rest <= 300 ? 'rojo' : rest <= +min * 30 ? 'ambar' : ''}`;
      const k1 = `${ini}-m`, k2 = `${ini}-5`;
      if (rest <= +min * 30 && !avisados.has(k1)) { avisados.add(k1); alarmaCorta(); c.aviso(`${quien}: mitad del aire.`); }
      if (rest <= 300 && !avisados.has(k2)) { avisados.add(k2); alarmaCorta(); c.aviso(`${quien}: quedan 5 minutos de aire. ¡Salir!`, true); }
    });
    tic(); relojAire = window.setInterval(tic, 1000);
  }

  if (pestana === 'datos') {
    const r = s.recursos ?? {};
    cuerpo.innerHTML = `<form class="bloque" id="cp-rec"><h3>Recursos utilizados</h3><div class="rejilla-2">
        <label>Agua (litros)<input type="number" inputmode="numeric" name="agua_litros" value="${esc(r.agua_litros ?? '')}"></label>
        <label>Espuma (litros)<input type="number" inputmode="numeric" name="espuma_litros" value="${esc(r.espuma_litros ?? '')}"></label>
        <label>Extintores<input type="number" inputmode="numeric" name="extintores" value="${esc(r.extintores ?? '')}"></label>
        <label>Tramos de manguera<input type="number" inputmode="numeric" name="mangueras" value="${esc(r.mangueras ?? '')}"></label></div>
        <label>Daños<input name="danos" value="${esc(r.danos ?? '')}"></label><button class="btn primario">Guardar recursos</button></form>
      <form class="bloque" id="cp-per"><h3>Persona atendida o localizada</h3>
        <label>Nombre<input name="nombre"></label><div class="rejilla-2"><label>Edad<input name="edad" inputmode="numeric"></label>
        <label>Estado<select name="codigo"><option value="">—</option>${CODIGOS_PERSONA.map((x) => `<option>${x}</option>`).join('')}</select></label></div>
        <button class="btn primario">Agregar persona</button><p class="tenue chica">${(s.personas ?? []).length} registradas.</p></form>
      <form class="bloque" id="cp-veh"><h3>Vehículo involucrado</h3><div class="rejilla-2">
        <label>Placas<input name="placas" autocapitalize="characters"></label><label>Tipo<input name="tipo" placeholder="Automóvil, moto…"></label>
        <label>Color<input name="color"></label><label>Conductor<input name="conductor"></label></div>
        <button class="btn primario">Agregar vehículo</button><p class="tenue chica">${(s.vehiculos ?? []).length} registrados. Toma foto de las placas en «Fotos y notas».</p></form>`;
    const guardar = async (p: Record<string, unknown>, msg: string) => { const ok = await enviar({ tipo: 'rpc', fn: 'panel_servicio_parcial', args: { p_id: id, p } }); await listo(msg, ok); vistaServicioCampo(c, id); };
    $('cp-rec').addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target as HTMLFormElement);
      guardar({ recursos: Object.fromEntries([...fd.entries()].map(([k, v]) => [k, k === 'danos' ? String(v) : Number(v) || 0])) }, 'Recursos guardados.'); });
    $('cp-per').addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target as HTMLFormElement);
      guardar({ personas: [...(s.personas ?? []), { nombre: String(fd.get('nombre') ?? ''), edad: String(fd.get('edad') ?? ''), codigo: String(fd.get('codigo') ?? '') }] }, 'Persona agregada.'); });
    $('cp-veh').addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target as HTMLFormElement);
      guardar({ vehiculos: [...(s.vehiculos ?? []), Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))] }, 'Vehículo agregado.'); });
  }

  if (pestana === 'area') {
    cuerpo.innerHTML = `<p class="tenue">Toca el mapa en cada esquina del área afectada, o camina el borde con «Caminar perímetro». El área se calcula sola.</p>
      <div id="cp-mapa" class="cp-mapa"></div><p class="area-res" id="cp-area">—</p>
      <div class="fila-btn"><button class="btn" id="cp-caminar">Caminar perímetro</button><button class="btn" id="cp-deshacer">Quitar último punto</button>
      <button class="btn" id="cp-borrar">Borrar</button><button class="btn primario" id="cp-guardar-area">Guardar área</button></div>`;
    const mapa = c.nuevoMapa('cp-mapa'); mapa.setView([s.lat ?? 21.019, s.lon ?? -101.257], s.lat != null ? 17 : 13);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' }).addTo(mapa);
    const geo = s.perimetro as { coordinates?: number[][][] } | null;
    let pts: [number, number][] = geo?.coordinates?.[0]?.slice(0, -1).map(([lo, la]) => [la, lo] as [number, number]) ?? [];
    const capa = L.layerGroup().addTo(mapa);
    const pintar = () => { capa.clearLayers(); if (pts.length) L.polygon(pts, { color: '#B3261E', fillOpacity: .25 }).addTo(capa);
      pts.forEach((p) => L.circleMarker(p, { radius: 4, color: '#fff', fillColor: '#B3261E', fillOpacity: 1 }).addTo(capa));
      $('cp-area').textContent = pts.length >= 3 ? `Área: ${areaTexto(AREA_M2(pts))}` : `${pts.length} punto(s): faltan ${Math.max(0, 3 - pts.length)}`; };
    pintar(); if (pts.length >= 3) mapa.fitBounds(L.latLngBounds(pts).pad(.3));
    mapa.on('click', (e: L.LeafletMouseEvent) => { pts.push([e.latlng.lat, e.latlng.lng]); pintar(); });
    let camino: number | null = null;
    $('cp-caminar').addEventListener('click', () => {
      if (camino != null) { navigator.geolocation.clearWatch(camino); camino = null; $('cp-caminar').textContent = 'Caminar perímetro'; return; }
      camino = navigator.geolocation.watchPosition((p) => {
        const nuevo: [number, number] = [p.coords.latitude, p.coords.longitude], u = pts[pts.length - 1];
        if (!u || mapa.distance(u, nuevo) > 8) { pts.push(nuevo); pintar(); mapa.panTo(nuevo); }
      }, () => c.aviso('Activa la ubicación del teléfono.', true), { enableHighAccuracy: true });
      $('cp-caminar').textContent = 'Terminar recorrido';
    });
    $('cp-deshacer').addEventListener('click', () => { pts.pop(); pintar(); });
    $('cp-borrar').addEventListener('click', () => { pts = []; pintar(); });
    $('cp-guardar-area').addEventListener('click', async () => {
      if (pts.length < 3) return c.aviso('Marca al menos 3 puntos.', true);
      const geojson = { type: 'Polygon', coordinates: [[...pts, pts[0]].map(([la, lo]) => [+lo.toFixed(6), +la.toFixed(6)])] };
      const ok = await enviar({ tipo: 'rpc', fn: 'panel_servicio_parcial', args: { p_id: id, p: { perimetro: geojson, area_afectada: areaTexto(AREA_M2(pts)), lat: pts[0][0], lon: pts[0][1] } } });
      await listo(`Área guardada: ${areaTexto(AREA_M2(pts))}.`, ok);
    });
  }

  if (pestana === 'sci') {
    const k = s.sci ?? {};
    cuerpo.innerHTML = `<form class="bloque" id="cp-sci"><h3>Comando del incidente (briefing inicial)</h3>
      <label>Comandante del incidente${buscador('comandante', k.comandante ?? '', 'personal')}</label>
      <label>Puesto de comando<span class="con-ahora"><input name="puesto" value="${esc(k.puesto ?? '')}" placeholder="Dónde está"><button type="button" class="btn" id="cp-aqui">Aquí</button></span></label>
      <label>Situación actual<textarea name="situacion" rows="3">${esc(k.situacion ?? '')}</textarea></label>
      <label>Objetivos<textarea name="objetivos" rows="3">${esc(k.objetivos ?? '')}</textarea></label>
      <label>Acciones y estrategia<textarea name="acciones" rows="2">${esc(k.acciones ?? '')}</textarea></label>
      <div class="rejilla-2"><label>Oficial de seguridad${buscador('seguridad', k.seguridad ?? '', 'personal')}</label>
        <label>Jefe de operaciones${buscador('operaciones', k.operaciones ?? '', 'personal')}</label></div>
      <label>Recursos solicitados<input name="recursos" value="${esc(k.recursos ?? '')}"></label>
      <label>Riesgos para el personal<input name="riesgos" value="${esc(k.riesgos ?? '')}"></label>
      <button class="btn primario">Guardar briefing</button></form>`;
    activarBuscadores(cuerpo);
    $('cp-aqui').addEventListener('click', async () => { const p = await gps(); if (p) cuerpo.querySelector<HTMLInputElement>('[name=puesto]')!.value = `GPS ${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`; });
    $('cp-sci').addEventListener('submit', async (e) => {
      e.preventDefault(); const sci = Object.fromEntries([...new FormData(e.target as HTMLFormElement).entries()].map(([kk, v]) => [kk, String(v).trim()]));
      const ok = await enviar({ tipo: 'rpc', fn: 'panel_servicio_parcial', args: { p_id: id, p: { sci } } }); await listo('Briefing guardado.', ok);
    });
  }

  if (pestana === 'apoyo') {
    const OPC = ['Otra unidad de SIMUB', 'Pipa de agua', 'Ambulancia', ...CORPORACIONES.filter((x) => x !== 'Otros'), 'CFE', 'Gasera'];
    cuerpo.innerHTML = `<form class="bloque" id="cp-apoyo"><h3>Pedir apoyo</h3><p class="tenue">Llega como alerta al grupo interno de Telegram y queda en la bitácora.</p>
      <div class="chips-sel" id="cp-qué">${OPC.map((o) => `<button type="button" class="mchip" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      <label>Detalle<span class="con-ahora"><input name="t" placeholder="Ej. 2 lesionados, se necesita ambulancia"><button type="button" class="btn" id="cp-voz3">🎤</button></span></label>
      <button class="btn rojo grande">Enviar solicitud de apoyo</button></form>`;
    const sel = new Set<string>();
    cuerpo.querySelectorAll<HTMLButtonElement>('#cp-qué .mchip').forEach((b) => b.addEventListener('click', () => { b.classList.toggle('on'); b.classList.contains('on') ? sel.add(b.dataset.v!) : sel.delete(b.dataset.v!); }));
    $('cp-voz3').addEventListener('click', () => dictar(cuerpo.querySelector<HTMLInputElement>('[name=t]')!, c.aviso));
    $('cp-apoyo').addEventListener('submit', async (e) => {
      e.preventDefault(); const t = [...sel].join(', ') + (sel.size ? '. ' : '') + String(new FormData(e.target as HTMLFormElement).get('t') ?? '').trim();
      if (!t.trim()) return c.aviso('Elige qué se necesita.', true);
      const ok = await enviar({ tipo: 'accion', args: { accion: 'apoyo', servicio: id, texto: t } }).catch((err) => { c.aviso((err as Error).message === 'sin_grupo' ? 'Falta vincular el grupo interno de Telegram.' : 'No se pudo enviar.', true); return null; });
      if (ok !== null) c.aviso(ok ? 'Solicitud enviada al grupo interno.' : 'Sin señal: se enviará al recuperarla.');
    });
  }
  vaciar();
}
const filaEscena = (e: Escena) => `<div class="cp-persona"><div><b>${esc(e.persona)}</b><small>${esc(e.asignacion ?? '')} · entró ${hora(e.entra)}</small></div>
  ${e.aire_inicio ? `<span class="aire" data-aire="${e.aire_inicio}|${e.aire_min}|${esc(e.persona)}"></span><button class="btn chico" data-esc="aire_fin|${e.id}">Fin aire</button>`
    : `<span class="fila-btn">${[30, 45, 60].map((m) => `<button class="btn chico" data-esc="aire|${e.id}|${m}">Aire ${m}′</button>`).join('')}</span>`}
  <button class="btn chico rojo" data-esc="sale|${e.id}">Sale</button></div>`;

// ================================================================ revisión de la unidad desde el celular
async function vistaRevision(c: Ctx) {
  pararCampo();
  c.marco('campo', 'Revisión de la unidad', `Turno ${TURNO()} · se registra con tu nombre`, '<div id="cp-rev"></div>', '<a class="btn" href="#campo">← Mis servicios</a>');
  await formInspeccion(c, $('cp-rev'), c.yo().unidad ?? null, () => { location.hash = '#campo'; });
}
