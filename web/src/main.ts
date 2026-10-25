// SIMUB · app ciudadana. Pantallas con rutas en el "#" de la URL.
import './estilos.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { I } from './iconos';
import { FORMULARIOS, INMUEBLES, MOTIVOS_REVISION, ORDEN_TIPOS, resumen, type Tipo } from './formularios';
import {
  activarAvisos, agregarInfo, comprimir, enviarReporte, estadoAvisos, infoPublica, misReportes, misRevisiones,
  registrarServiceWorker, responderRevision, solicitarRevision, urlFotoNoticia,
  type Estado, type InfoPublica, type MiReporte, type MiRevision, type Noticia,
} from './api';
import { prepararSonido, sonarEnviado } from './sonido';

const BASE = import.meta.env.BASE_URL;
const app = document.getElementById('app')!;
const CENTRO: L.LatLngTuple = [21.0190, -101.2574];   // Guanajuato capital

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hora = (f: string) => new Date(f).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fechaLarga = (f: string) => new Date(f).toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const pendiente = (v: string | undefined | null, texto: string) => (v && v.trim() ? esc(v) : `<span class="pendiente">${esc(texto)}</span>`);

const ESTADO: Record<Estado, { txt: string; cls: string }> = {
  enviado: { txt: 'Enviado', cls: 'p-gris' }, visto: { txt: 'Visto por la estación', cls: 'p-dorado' },
  en_camino: { txt: 'Unidad en camino', cls: 'p-ambar' }, atendiendo: { txt: 'Atendiendo', cls: 'p-ambar' },
  cerrado: { txt: 'Cerrado', cls: 'p-verde' }, falso: { txt: 'Descartado', cls: 'p-gris' },
};
const PASOS: { e: Estado; t: string }[] = [
  { e: 'enviado', t: 'Reporte enviado' }, { e: 'visto', t: 'Visto por la estación' }, { e: 'en_camino', t: 'Unidad en camino' },
  { e: 'atendiendo', t: 'Atendiendo en el lugar' }, { e: 'cerrado', t: 'Reporte cerrado' },
];
const ESTADO_REV: Record<string, { txt: string; cls: string }> = {
  solicitada: { txt: 'Solicitada', cls: 'p-gris' }, propuesta: { txt: 'Fecha propuesta', cls: 'p-ambar' },
  confirmada: { txt: 'Confirmada', cls: 'p-dorado' }, realizada: { txt: 'Realizada', cls: 'p-verde' }, cancelada: { txt: 'Cancelada', cls: 'p-gris' },
};

// ---------------------------------------------------------------- estado en memoria
let mapa: L.Map | null = null;
let sondeo: number | undefined;
let info: InfoPublica | null = null;
const borrador = {
  tipo: 'incendio' as Tipo, valores: {} as Record<string, string | string[]>, comentario: '', referencia: '',
  fotos: [] as { blob: Blob; url: string }[], lat: 0, lon: 0, precision: 0, tieneUbicacion: false, ajustada: false,
  nombre: '', telefono: '', anonimo: false, checklist: [] as number[],
};
try { const c = JSON.parse(localStorage.getItem('simub-contacto') ?? '{}'); borrador.nombre = c.nombre ?? ''; borrador.telefono = c.telefono ?? ''; } catch { /* */ }

function limpiar() {
  if (mapa) { mapa.remove(); mapa = null; }
  if (sondeo) { clearInterval(sondeo); sondeo = undefined; }
  document.querySelector('.dialogo-fondo')?.remove();
}
function aviso(txt: string) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = txt;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}
const telEstacion = () => info?.config.estacion?.telefono?.replace(/\D/g, '') ?? '';

// ---------------------------------------------------------------- piezas
const nav = (activo: string) => `
<nav class="nav" aria-label="Navegación principal">
  ${([['inicio', 'Reportar', I.escudo], ['mis', 'Mis reportes', I.lista], ['noticias', 'Noticias', I.noticias], ['apoya', 'Apoya', I.corazon]] as const)
    .map(([id, txt, ic]) => `<a href="#/${id}" class="${activo === id ? 'on' : ''}" ${activo === id ? 'aria-current="page"' : ''}>${ic(24)}<span>${txt}</span></a>`).join('')}
</nav>`;
const cabecera = (titulo: string, atras: string, color = 'var(--guinda)', sub = '') => `
<header class="cab-color" style="background:${color}">
  <div class="fila"><a class="redondo claro" href="${atras}" aria-label="Regresar">${I.atras(24)}</a>
  <div>${sub ? `<span class="sub-cab">${sub}</span>` : ''}<h1>${titulo}</h1></div></div>
</header>`;

const TEXTO_AVISOS: Record<string, string> = {
  apagados: 'Activa los avisos y te diremos cuando la estación vea tu reporte y cuando la unidad vaya en camino.',
  bloqueados: 'Los avisos están bloqueados. Actívalos en la configuración del navegador.',
  no_soportado: 'Este navegador no permite avisos. Revisa el estado en «Mis reportes».',
  instalar_ios: 'En iPhone: toca Compartir y luego «Agregar a inicio». Abre SIMUB desde ese ícono para activar los avisos.',
};
function tarjetaAvisos(cajaId: string, texto?: string) {
  estadoAvisos().then((e) => {
    const caja = document.getElementById(cajaId);
    if (!caja || e === 'activos') return;
    caja.innerHTML = `<section class="tarjeta avisos">${I.campana(22)}<div><b>Recibe avisos en tu teléfono</b><p>${texto && e === 'apagados' ? texto : TEXTO_AVISOS[e]}</p></div>
      ${e === 'apagados' ? '<button class="boton chico" id="btn-avisos" type="button">Activar</button>' : ''}</section>`;
    document.getElementById('btn-avisos')?.addEventListener('click', async () => {
      try {
        const r = await activarAvisos();
        if (r === 'activos') { caja.innerHTML = ''; aviso('Listo: te avisaremos.'); } else tarjetaAvisos(cajaId, texto);
      } catch { aviso('No se pudieron activar los avisos. Inténtalo de nuevo.'); }
    });
  }).catch(() => {});
}

// ---------------------------------------------------------------- bienvenida (primera vez)
const CLAVE_BV = 'simub-bienvenida';
const vioBienvenida = () => { try { return localStorage.getItem(CLAVE_BV) === '1'; } catch { return true; } };
function bienvenida() {
  app.innerHTML = `
  <main class="bienvenida">
    <span class="bv-region">Guanajuato capital</span>
    <div class="bv-centro">
      <img src="${BASE}escudo.png" alt="Escudo de Bomberos SIMUB Voluntarios, A.C." class="bv-escudo">
      <h1>SIMUB</h1><p>Reporte de emergencias</p>
    </div>
    <div class="bv-pie">
      <button class="boton dorado" id="comenzar" type="button">Comenzar</button>
      <p class="lema">Honor, valor y servicio</p>
      <div class="credito"><img src="${BASE}geoug-clara.png" alt=""><span>Desarrollado por <b>GEO UG Developers</b></span></div>
    </div>
  </main>`;
  $('comenzar').addEventListener('click', () => {
    try { localStorage.setItem(CLAVE_BV, '1'); } catch { /* */ }
    location.hash = '#/inicio'; if (location.hash === '#/inicio') ir();
  });
}

// ---------------------------------------------------------------- inicio
function inicio() {
  if (!vioBienvenida()) { bienvenida(); return; }
  app.innerHTML = `
  <div class="con-nav">
  <header class="cab-inicio">
    <div class="fila-marca">
      <img src="${BASE}escudo-192.png" alt="" class="escudo-chico">
      <div><b>SIMUB</b><span>Bomberos Voluntarios · Guanajuato</span></div>
      <a class="redondo borde" href="#/mis" aria-label="Mis reportes">${I.campana(22)}</a>
    </div>
    <a class="banner-911" href="tel:911"><span class="ic">${I.tel(22)}</span><span><b>¿Hay vidas en riesgo? Llama al 911</b><small>La app no sustituye una llamada de emergencia</small></span></a>
  </header>
  <main class="pantalla">
    <h2 class="titulo">¿Qué quieres reportar?</h2>
    <div class="rejilla">
      ${ORDEN_TIPOS.map((t) => { const f = FORMULARIOS[t]; return `<a class="tarjeta-tipo" href="#/reportar/${t}">
        <span class="ic" style="background:${f.tinte};color:${f.color}">${I[t](26)}</span><b>${f.nombre}</b></a>`; }).join('')}
    </div>
    <a class="tarjeta-revision" href="#/revision"><span class="ic">${I.revision(22)}</span>
      <span><b>Solicitar revisión de seguridad</b><small>Agenda una visita a tu domicilio o negocio</small></span>${I.flecha(20)}</a>
  </main></div>${nav('inicio')}`;
}

// ---------------------------------------------------------------- formulario (uno para todos los tipos)
function formulario(tipo: string) {
  if (!(tipo in FORMULARIOS)) { location.hash = '#/inicio'; return; }
  if (borrador.tipo !== tipo) Object.assign(borrador, { tipo, valores: {}, comentario: '', checklist: [] });
  const f = FORMULARIOS[tipo as Tipo];
  const chips = (p: typeof f.preguntas[number]) => p.opciones.map(([v, t]) => {
    const val = borrador.valores[p.clave];
    const on = p.multiple ? Array.isArray(val) && val.includes(v) : val === v;
    return `<button type="button" class="chip-op ${on ? 'on' : ''}" style="--c:${f.color};--t:${f.tinte}" data-preg="${p.clave}" data-val="${v}" aria-pressed="${on}">${esc(t)}</button>`;
  }).join('');
  const fotos = borrador.fotos.map((x, i) => `<button type="button" class="foto" data-quitar="${i}" aria-label="Quitar foto ${i + 1}"><img src="${x.url}" alt=""><span>${I.cerrar(14)}</span></button>`).join('');
  app.innerHTML = `
  ${cabecera(f.titulo, '#/inicio', f.color)}
  <main class="pantalla form">
    ${f.aviso ? `<div class="aviso-seg">${I.gas(20)}<span>${esc(f.aviso)}</span></div>` : ''}
    ${f.checklist ? `<section class="tarjeta"><h2 class="sec">Antes de reportar</h2>
      ${f.checklist.map((c, i) => `<label class="check"><input type="checkbox" data-check="${i}" ${borrador.checklist.includes(i) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</section>` : ''}
    <section class="tarjeta"><h2 class="sec">¿Dónde es?</h2>
      <div class="mapa-caja"><div id="mapa"></div><span class="etiqueta">Toca el mapa o arrastra el pin</span>
        <button type="button" class="redondo gps" id="gps" aria-label="Usar mi ubicación">${I.gps(20)}</button></div>
      <div class="fila-ubic"><span class="ic verde">${I.gps(20)}</span><div><b id="ubic-tit">Buscando tu ubicación…</b><span id="ubic-sub" class="tenue">Permite el acceso a la ubicación</span></div></div>
      <label class="campo"><span>Referencia <span class="tenue">(opcional)</span></span>
        <input id="referencia" maxlength="200" placeholder="Ej. frente a la tienda, casa con portón verde" value="${esc(borrador.referencia)}"></label>
    </section>
    <section class="tarjeta"><h2 class="sec">¿Qué pasó?</h2>
      ${f.preguntas.map((p) => `<div class="pregunta"><span class="etq">${esc(p.texto)}</span><div class="chips">${chips(p)}</div></div>`).join('')}
      ${f.sugerencias ? `<div class="chips">${f.sugerencias.map((s) => `<button type="button" class="chip-op" style="--c:${f.color};--t:${f.tinte}" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
      <label class="campo"><span>Describe la emergencia${f.tipo === 'otra' ? '' : ' <span class="tenue">(opcional)</span>'}</span>
        <div class="con-mic"><textarea id="comentario" rows="3" maxlength="1000" placeholder="${esc(f.placeholder)}">${esc(borrador.comentario)}</textarea>
        <button type="button" class="mic" id="mic" aria-label="Dictar por voz" hidden>${I.mic(20)}</button></div></label>
    </section>
    <section class="tarjeta"><div class="fila-tit"><h2 class="sec">Fotos</h2><span class="tenue">${borrador.fotos.length} de 3</span></div>
      <div class="fotos">${fotos}
        ${borrador.fotos.length < 3 ? `<label class="foto agregar">${I.camara(22)}<span>Cámara</span><input id="camara" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="foto agregar">${I.galeria(22)}<span>Galería</span><input id="galeria" type="file" accept="image/*" hidden></label>` : ''}</div>
    </section>
    <section class="tarjeta"><h2 class="sec">Contacto</h2>
      <label class="campo"><span>Teléfono para devolverte la llamada</span><input id="telefono" type="tel" inputmode="tel" maxlength="20" placeholder="473 000 0000" value="${esc(borrador.telefono)}"></label>
      <label class="campo"><span>Nombre <span class="tenue">(opcional)</span></span><input id="nombre" maxlength="120" placeholder="Opcional" value="${esc(borrador.nombre)}" ${borrador.anonimo ? 'disabled' : ''}></label>
      <label class="interruptor"><span><b>Reporte anónimo</b><small>Tu nombre no se compartirá con nadie</small></span>
        <input type="checkbox" id="anonimo" ${borrador.anonimo ? 'checked' : ''}></label>
    </section>
  </main>
  <div class="pie-fijo"><button type="button" class="boton" id="enviar">${I.enviar(20)} Enviar reporte a SIMUB</button></div>`;

  // Ubicación: GPS automático y ajuste tocando el mapa.
  const centro: L.LatLngTuple = borrador.tieneUbicacion ? [borrador.lat, borrador.lon] : CENTRO;
  mapa = L.map('mapa', { zoomControl: false }).setView(centro, borrador.tieneUbicacion ? 16 : 13);
  mapa.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  const pin = L.marker(centro, { draggable: true, icon: L.divIcon({ className: 'pin-simub', html: '<span></span>', iconSize: [34, 44], iconAnchor: [17, 42] }) }).addTo(mapa);
  const pintar = () => {
    $('ubic-tit').textContent = borrador.ajustada ? 'Ubicación ajustada en el mapa' : 'Ubicación detectada por GPS';
    $('ubic-sub').textContent = `${borrador.lat.toFixed(5)}, ${borrador.lon.toFixed(5)}${borrador.precision && !borrador.ajustada ? ` · ±${Math.round(borrador.precision)} m` : ''}`;
  };
  const fijar = (p: L.LatLng) => { Object.assign(borrador, { lat: p.lat, lon: p.lng, tieneUbicacion: true, ajustada: true, precision: 0 }); pintar(); };
  pin.on('dragend', () => fijar(pin.getLatLng()));
  mapa.on('click', (e: L.LeafletMouseEvent) => { pin.setLatLng(e.latlng); fijar(e.latlng); });
  const pedirGps = () => navigator.geolocation?.getCurrentPosition((pos) => {
    Object.assign(borrador, { lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy, tieneUbicacion: true, ajustada: false });
    pin.setLatLng([borrador.lat, borrador.lon]); mapa?.setView([borrador.lat, borrador.lon], 16); pintar();
  }, () => {
    $('ubic-tit').textContent = 'No pudimos obtener tu ubicación';
    $('ubic-sub').textContent = 'Toca el mapa en el lugar de la emergencia';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  if (borrador.tieneUbicacion) pintar(); else pedirGps();
  $('gps').addEventListener('click', pedirGps);

  // Respuestas.
  app.querySelectorAll<HTMLButtonElement>('[data-preg]').forEach((b) => b.addEventListener('click', () => {
    const p = f.preguntas.find((x) => x.clave === b.dataset.preg)!;
    const v = b.dataset.val!;
    if (p.multiple) {
      const a = new Set((borrador.valores[p.clave] as string[]) ?? []);
      if (a.has(v)) a.delete(v); else a.add(v);
      borrador.valores[p.clave] = [...a];
    } else borrador.valores[p.clave] = borrador.valores[p.clave] === v ? '' : v;
    guardarCampos(); formulario(tipo);
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-sug]').forEach((b) => b.addEventListener('click', () => {
    const t = $<HTMLTextAreaElement>('comentario');
    t.value = t.value ? `${b.dataset.sug}. ${t.value}` : `${b.dataset.sug}: `; t.focus(); borrador.comentario = t.value;
  }));
  app.querySelectorAll<HTMLInputElement>('[data-check]').forEach((c) => c.addEventListener('change', () => {
    const i = Number(c.dataset.check);
    borrador.checklist = c.checked ? [...borrador.checklist, i] : borrador.checklist.filter((x) => x !== i);
  }));
  const guardarCampos = () => {
    borrador.comentario = $<HTMLTextAreaElement>('comentario').value;
    borrador.referencia = $<HTMLInputElement>('referencia').value;
    borrador.telefono = $<HTMLInputElement>('telefono').value;
    borrador.nombre = $<HTMLInputElement>('nombre').value;
  };
  ['comentario', 'referencia', 'telefono', 'nombre'].forEach((id) => $(id).addEventListener('input', guardarCampos));
  $<HTMLInputElement>('anonimo').addEventListener('change', (e) => {
    borrador.anonimo = (e.target as HTMLInputElement).checked; $<HTMLInputElement>('nombre').disabled = borrador.anonimo;
  });

  // Dictado por voz (si el navegador lo permite).
  const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec });
  const Rec = SR.SpeechRecognition ?? SR.webkitSpeechRecognition;
  if (Rec) {
    const mic = $<HTMLButtonElement>('mic'); mic.hidden = false;
    mic.addEventListener('click', () => {
      const r = new Rec(); r.lang = 'es-MX'; r.interimResults = false;
      mic.classList.add('grabando');
      r.onresult = (e) => { const t = $<HTMLTextAreaElement>('comentario'); t.value = `${t.value} ${e.results[0][0].transcript}`.trim(); borrador.comentario = t.value; };
      r.onend = () => mic.classList.remove('grabando');
      r.start();
    });
  }

  // Fotos.
  const agregar = async (input: HTMLInputElement | null) => {
    const a = input?.files?.[0]; if (!a) return;
    try { const blob = await comprimir(a); borrador.fotos.push({ blob, url: URL.createObjectURL(blob) }); guardarCampos(); formulario(tipo); }
    catch { aviso('No se pudo leer la foto. Intenta con otra.'); }
  };
  (['camara', 'galeria'] as const).forEach((id) => { const el = document.getElementById(id) as HTMLInputElement | null; el?.addEventListener('change', () => agregar(el)); });
  app.querySelectorAll<HTMLButtonElement>('[data-quitar]').forEach((b) => b.addEventListener('click', () => {
    borrador.fotos.splice(Number(b.dataset.quitar), 1); guardarCampos(); formulario(tipo);
  }));

  // Enviar.
  const boton = $<HTMLButtonElement>('enviar');
  boton.addEventListener('click', async () => {
    guardarCampos();
    if (!borrador.tieneUbicacion) { aviso('Toca el mapa en el lugar de la emergencia o activa tu ubicación.'); return; }
    if (f.tipo === 'otra' && !borrador.comentario.trim()) { aviso('Describe brevemente la emergencia.'); $('comentario').focus(); return; }
    if (borrador.telefono.replace(/\D/g, '').length < 7 && !confirm('Sin teléfono la estación no podrá llamarte. ¿Enviar de todos modos?')) return;
    boton.disabled = true; boton.textContent = 'Enviando…';
    prepararSonido();
    try {
      try { localStorage.setItem('simub-contacto', JSON.stringify({ nombre: borrador.anonimo ? '' : borrador.nombre, telefono: borrador.telefono })); } catch { /* */ }
      const r = await enviarReporte({
        tipo: f.tipo, lat: borrador.lat, lon: borrador.lon, precision: borrador.ajustada ? 0 : borrador.precision,
        detalles: { valores: borrador.valores, resumen: resumen(f, borrador.valores) }, comentario: borrador.comentario.trim(),
        referencia: borrador.referencia.trim(), nombre: borrador.nombre.trim(), telefono: borrador.telefono.trim(),
        anonimo: borrador.anonimo, fotos: borrador.fotos.map((x) => x.blob),
      });
      borrador.fotos.forEach((x) => URL.revokeObjectURL(x.url));
      Object.assign(borrador, { fotos: [], valores: {}, comentario: '', referencia: '', tieneUbicacion: false, ajustada: false, precision: 0, checklist: [] });
      sonarEnviado();
      location.hash = `#/seguimiento/${r.id}?nuevo`;
    } catch (e) {
      const m = (e as Error).message;
      aviso(m === 'limite' ? 'Enviaste muchos reportes en poco tiempo. Espera un momento o llama al 911.' : 'No se pudo enviar. Revisa tu conexión o llama al 911.');
      boton.disabled = false; boton.innerHTML = `${I.enviar(20)} Enviar reporte a SIMUB`;
    }
  });
}
interface SpeechRec { lang: string; interimResults: boolean; start(): void; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void }

// ---------------------------------------------------------------- seguimiento
function seguimiento(id: string, nuevo: boolean) {
  const pintar = (r: MiReporte | undefined) => {
    if (!r) { $('contenido').innerHTML = '<p class="tenue">Cargando tu reporte…</p>'; return; }
    const f = FORMULARIOS[r.tipo];
    const idx = r.estado === 'falso' ? -1 : PASOS.findIndex((p) => p.e === r.estado);
    $('folio').textContent = `Reporte ${r.folio}`;
    $('estado-grande').innerHTML = `<span class="ic-estado">${r.estado === 'cerrado' ? I.check(24) : I.unidad(24)}</span>
      <span><b>${ESTADO[r.estado].txt}</b><small>${r.estado === 'enviado' ? 'Esperando a que la estación lo vea' : r.estado === 'cerrado' ? 'Gracias por avisar' : 'Esta pantalla se actualiza sola'}</small></span>`;
    $('contenido').innerHTML = `
      <section class="tarjeta"><h2 class="sec">Estado del reporte</h2>
        ${r.estado === 'falso' ? '<p>La estación marcó este reporte como duplicado o no confirmado. Si la emergencia sigue, llama al 911.</p>' :
        `<ol class="linea">${PASOS.map((p, i) => { const ev = r.eventos.find((x) => x.estado === p.e);
          return `<li class="${i < idx ? 'ok' : i === idx ? 'actual' : ''}"><i></i><div><b>${p.t}</b><span>${ev ? hora(ev.en) : 'Pendiente'}</span></div></li>`; }).join('')}</ol>`}
      </section>
      ${r.estado !== 'cerrado' && r.estado !== 'falso' ? `<section class="consejo">${I.escudo(22)}<span><b>Mientras llega la unidad</b>${esc(f.consejo)}</span></section>` : ''}
      <div id="caja-avisos"></div>
      <div class="dos">
        <a class="boton claro" href="${telEstacion() ? `tel:${telEstacion()}` : 'tel:911'}">${I.tel(18)} ${telEstacion() ? 'Llamar a la estación' : 'Llamar al 911'}</a>
        <button type="button" class="boton claro" id="agregar">${I.mas(18)} Agregar información</button>
      </div>
      ${r.agregados ? `<p class="tenue centro">Agregaste información ${r.agregados} ${r.agregados === 1 ? 'vez' : 'veces'}.</p>` : ''}`;
    tarjetaAvisos('caja-avisos');
    $('agregar').addEventListener('click', () => dialogoAgregar(r.id));
  };
  app.innerHTML = `
  <header class="cab-color"><div class="fila"><a class="redondo claro" href="#/mis" aria-label="Regresar">${I.atras(24)}</a>
    <div><span class="sub-cab" id="folio">${nuevo ? '¡Reporte enviado!' : 'Reporte'}</span><h1 id="tit-seg">Seguimiento</h1></div></div>
    <div class="estado-grande" id="estado-grande"></div></header>
  <main class="pantalla" id="contenido"><p class="tenue">Cargando tu reporte…</p></main>`;
  const cargar = () => misReportes().then((xs) => {
    const r = xs.find((x) => x.id === id);
    if (r) $('tit-seg').textContent = FORMULARIOS[r.tipo].nombre;
    pintar(r);
    if (r && (r.estado === 'cerrado' || r.estado === 'falso') && sondeo) { clearInterval(sondeo); sondeo = undefined; }
  }).catch(() => { $('contenido').innerHTML = '<p class="tenue">Sin conexión. Reintentando…</p>'; });
  cargar(); sondeo = window.setInterval(cargar, 15000);
}

function dialogoAgregar(id: string) {
  const d = document.createElement('div');
  d.className = 'dialogo-fondo';
  d.innerHTML = `<div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><h2 id="dlg-t">Agregar información</h2>
    <p class="tenue">Llega directo al grupo de la estación.</p>
    <textarea id="dlg-txt" rows="4" maxlength="800" placeholder="Ej. ya salieron todas las personas, el fuego creció"></textarea>
    <div class="dos"><button type="button" class="boton claro" id="dlg-no">Cancelar</button><button type="button" class="boton" id="dlg-si">Enviar</button></div></div>`;
  document.body.appendChild(d);
  $('dlg-txt').focus();
  const cerrar = () => d.remove();
  $('dlg-no').addEventListener('click', cerrar);
  d.addEventListener('click', (e) => { if (e.target === d) cerrar(); });
  $('dlg-si').addEventListener('click', async () => {
    const t = $<HTMLTextAreaElement>('dlg-txt').value.trim(); if (!t) return;
    try { await agregarInfo(id, t); cerrar(); aviso('Información enviada a la estación.'); ir(); }
    catch { aviso('No se pudo enviar. Revisa tu conexión.'); }
  });
}

// ---------------------------------------------------------------- mis reportes
function mis() {
  app.innerHTML = `<div class="con-nav">${cabecera('Mis reportes', '#/inicio')}
  <main class="pantalla"><div id="caja-avisos"></div><div id="lista"><p class="tenue">Cargando…</p></div></main></div>${nav('mis')}`;
  tarjetaAvisos('caja-avisos');
  Promise.all([misReportes(), misRevisiones()]).then(([rs, vs]) => {
    $('lista').innerHTML = (rs.length || vs.length) ? `
      ${rs.length ? `<h2 class="sec">Reportes</h2>${rs.map((r) => { const f = FORMULARIOS[r.tipo]; return `<a class="fila-rep" href="#/seguimiento/${r.id}">
        <span class="ic" style="background:${f.tinte};color:${f.color}">${I[r.tipo](22)}</span>
        <span><b>${esc(f.nombre)}</b><small>${esc(r.folio)} · ${hora(r.creado_en)}</small></span><em class="pill ${ESTADO[r.estado].cls}">${ESTADO[r.estado].txt}</em></a>`; }).join('')}` : ''}
      ${vs.length ? `<h2 class="sec">Revisiones de seguridad</h2>${vs.map((v) => `<a class="fila-rep" href="#/revision/${v.id}">
        <span class="ic" style="background:#F5ECD9;color:#7A5A17">${I.revision(22)}</span>
        <span><b>Revisión · ${esc(v.folio)}</b><small>${v.fecha ? fechaLarga(v.fecha) : hora(v.creado_en)}</small></span><em class="pill ${ESTADO_REV[v.estado].cls}">${ESTADO_REV[v.estado].txt}</em></a>`).join('')}` : ''}`
      : `<div class="vacio">${I.lista(40)}<b>Aún no tienes reportes</b><p>Cuando reportes una emergencia podrás seguirla aquí en tiempo real.</p><a class="boton" href="#/inicio">Reportar</a></div>`;
  }).catch(() => { $('lista').innerHTML = '<p class="tenue">Sin conexión con el servidor.</p>'; });
}

// ---------------------------------------------------------------- revisión de seguridad
const revBorrador = { motivos: [] as string[], inmueble: '', direccion: '', horario: '', comentario: '' };
function revisionForm() {
  const r = info?.config.revisiones;
  const chips = (lista: [string, string][], sel: (v: string) => boolean, attr: string) =>
    lista.map(([v, t]) => `<button type="button" class="chip-op ${sel(v) ? 'on' : ''}" style="--c:#7A5A17;--t:#F5ECD9" ${attr}="${v}" aria-pressed="${sel(v)}">${esc(t)}</button>`).join('');
  app.innerHTML = `${cabecera('Revisión de seguridad', '#/inicio', '#7A5A17')}
  <main class="pantalla form">
    <div class="aviso-info">${I.calendario(20)}<span><b>No es una emergencia.</b> Agenda una visita para revisar tu casa o negocio.
      ${r ? `Visitas: ${esc(r.dias)}, ${esc(r.horario)}. Costo: ${pendiente(r.costo.startsWith('[') ? '' : r.costo, r.costo)}.` : ''}</span></div>
    <section class="tarjeta"><h2 class="sec">¿Qué quieres revisar?</h2><div class="chips">${chips(MOTIVOS_REVISION, (v) => revBorrador.motivos.includes(v), 'data-motivo')}</div></section>
    <section class="tarjeta"><h2 class="sec">Lugar</h2>
      <div class="pregunta"><span class="etq">Tipo de inmueble</span><div class="chips">${chips(INMUEBLES, (v) => revBorrador.inmueble === v, 'data-inmueble')}</div></div>
      <label class="campo"><span>Dirección completa</span><textarea id="direccion" rows="2" maxlength="300" placeholder="Calle, número, colonia">${esc(revBorrador.direccion)}</textarea></label>
      <label class="campo"><span>Horario preferido <span class="tenue">(opcional)</span></span><input id="horario" maxlength="120" placeholder="Ej. martes o jueves por la mañana" value="${esc(revBorrador.horario)}"></label>
    </section>
    <section class="tarjeta"><h2 class="sec">Contacto</h2>
      <label class="campo"><span>Nombre</span><input id="nombre" maxlength="120" value="${esc(borrador.nombre)}"></label>
      <label class="campo"><span>Teléfono</span><input id="telefono" type="tel" inputmode="tel" maxlength="20" placeholder="473 000 0000" value="${esc(borrador.telefono)}"></label>
      <label class="campo"><span>Comentarios <span class="tenue">(opcional)</span></span><textarea id="comentario" rows="2" maxlength="800">${esc(revBorrador.comentario)}</textarea></label>
    </section>
  </main>
  <div class="pie-fijo"><button type="button" class="boton cafe" id="solicitar">${I.calendario(20)} Solicitar visita</button></div>`;
  const guardar = () => {
    Object.assign(revBorrador, { direccion: $<HTMLTextAreaElement>('direccion').value, horario: $<HTMLInputElement>('horario').value, comentario: $<HTMLTextAreaElement>('comentario').value });
    borrador.nombre = $<HTMLInputElement>('nombre').value; borrador.telefono = $<HTMLInputElement>('telefono').value;
  };
  app.querySelectorAll<HTMLButtonElement>('[data-motivo]').forEach((b) => b.addEventListener('click', () => {
    guardar(); const v = b.dataset.motivo!;
    revBorrador.motivos = revBorrador.motivos.includes(v) ? revBorrador.motivos.filter((x) => x !== v) : [...revBorrador.motivos, v]; revisionForm();
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-inmueble]').forEach((b) => b.addEventListener('click', () => { guardar(); revBorrador.inmueble = b.dataset.inmueble!; revisionForm(); }));
  const boton = $<HTMLButtonElement>('solicitar');
  boton.addEventListener('click', async () => {
    guardar();
    if (!revBorrador.motivos.length) return aviso('Elige qué quieres revisar.');
    if (!revBorrador.direccion.trim() || !borrador.nombre.trim() || borrador.telefono.replace(/\D/g, '').length < 7) return aviso('Escribe dirección, nombre y teléfono.');
    boton.disabled = true; boton.textContent = 'Enviando…';
    try {
      const r = await solicitarRevision({ ...revBorrador, inmueble: INMUEBLES.find((x) => x[0] === revBorrador.inmueble)?.[1] ?? '', nombre: borrador.nombre, telefono: borrador.telefono });
      Object.assign(revBorrador, { motivos: [], inmueble: '', direccion: '', horario: '', comentario: '' });
      try { localStorage.setItem('simub-contacto', JSON.stringify({ nombre: borrador.nombre, telefono: borrador.telefono })); } catch { /* */ }
      location.hash = `#/revision/${r.id}`;
      aviso('Solicitud enviada. La estación te propondrá una fecha.');
    } catch (e) {
      aviso((e as Error).message === 'limite' ? 'Ya enviaste varias solicitudes hoy.' : 'No se pudo enviar. Revisa tu conexión.');
      boton.disabled = false; boton.innerHTML = `${I.calendario(20)} Solicitar visita`;
    }
  });
}

function revisionEstado(id: string) {
  app.innerHTML = `${cabecera('Revisión de seguridad', '#/mis', '#7A5A17')}<main class="pantalla" id="contenido"><p class="tenue">Cargando…</p></main>`;
  const pintar = (v: MiRevision | undefined) => {
    if (!v) { $('contenido').innerHTML = '<p class="tenue">No encontramos esta solicitud.</p>'; return; }
    const MOT = Object.fromEntries(MOTIVOS_REVISION);
    $('contenido').innerHTML = `
      <section class="tarjeta"><div class="fila-tit"><b>Folio ${esc(v.folio)}</b><em class="pill ${ESTADO_REV[v.estado].cls}">${ESTADO_REV[v.estado].txt}</em></div>
        <p>${esc(v.motivos.map((m) => MOT[m] ?? m).join(', '))}</p><p class="tenue">${esc(v.direccion)}</p></section>
      ${v.estado === 'solicitada' ? '<section class="tarjeta"><b>Esperando fecha</b><p class="tenue">La estación revisará tu solicitud y te propondrá un día y hora. Te avisaremos.</p></section>' : ''}
      ${v.fecha && ['propuesta', 'confirmada'].includes(v.estado) ? `<section class="tarjeta fecha"><span class="tenue">${v.estado === 'propuesta' ? 'Fecha propuesta por SIMUB' : 'Visita confirmada'}</span>
        <b class="fecha-grande">${fechaLarga(v.fecha)}</b>${v.asignado ? `<span>Va: ${esc(v.asignado)}</span>` : ''}${v.nota_estacion ? `<p>«${esc(v.nota_estacion)}»</p>` : ''}
        ${v.estado === 'propuesta' ? '<div class="dos"><button type="button" class="boton claro" id="otra">Pedir otra fecha</button><button type="button" class="boton" id="confirmar">Confirmar</button></div>' : ''}</section>` : ''}
      ${v.estado === 'realizada' ? `<section class="tarjeta"><b>Visita realizada</b>${v.recomendaciones ? `<p>${esc(v.recomendaciones)}</p>` : '<p class="tenue">Gracias por cuidar tu seguridad.</p>'}</section>` : ''}
      ${v.estado === 'cancelada' ? '<section class="tarjeta"><b>Solicitud cancelada</b><p class="tenue">Puedes volver a solicitar una visita cuando quieras.</p><a class="boton claro" href="#/revision">Nueva solicitud</a></section>' : ''}
      <div id="caja-avisos"></div>`;
    tarjetaAvisos('caja-avisos', 'Activa los avisos y te diremos cuando la estación proponga la fecha, y un día antes de la visita.');
    document.getElementById('confirmar')?.addEventListener('click', async () => {
      try { await responderRevision(v.id, true); aviso('Visita confirmada.'); cargar(); } catch { aviso('No se pudo confirmar.'); }
    });
    document.getElementById('otra')?.addEventListener('click', async () => {
      const nota = prompt('¿Qué día u horario te queda mejor?') ?? '';
      if (!nota.trim()) return;
      try { await responderRevision(v.id, false, nota); aviso('Le avisamos a la estación.'); cargar(); } catch { aviso('No se pudo enviar.'); }
    });
  };
  const cargar = () => misRevisiones().then((xs) => pintar(xs.find((x) => x.id === id))).catch(() => { $('contenido').innerHTML = '<p class="tenue">Sin conexión.</p>'; });
  cargar(); sondeo = window.setInterval(cargar, 30000);
}

// ---------------------------------------------------------------- noticias
const CAT: Record<string, string> = { evento: 'Eventos', donacion: 'Donaciones', aviso: 'Avisos' };
let filtroNoticias = '';
function noticias() {
  app.innerHTML = `<div class="con-nav">${cabecera('Noticias', '#/inicio')}
  <main class="pantalla"><div class="chips filtro">${[['', 'Todas'], ...Object.entries(CAT)].map(([k, t]) =>
    `<button type="button" class="chip-op ${filtroNoticias === k ? 'on' : ''}" style="--c:var(--guinda);--t:#F1E3E4" data-cat="${k}">${t}</button>`).join('')}</div>
  <div id="lista"><p class="tenue">Cargando…</p></div><div id="caja-avisos"></div></main></div>${nav('noticias')}`;
  app.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => { filtroNoticias = b.dataset.cat!; noticias(); }));
  tarjetaAvisos('caja-avisos', 'Activa los avisos para enterarte de eventos, colectas y avisos importantes de SIMUB.');
  infoPublica(true).then((i) => {
    info = i;
    const xs = i.noticias.filter((n) => !filtroNoticias || n.categoria === filtroNoticias);
    if (!xs.length) { $('lista').innerHTML = '<p class="tenue">No hay noticias en esta sección.</p>'; return; }
    const [d, ...resto] = xs[0].destacada ? xs : [null, ...xs];
    $('lista').innerHTML = `${d ? `<a class="noticia-dest" href="#/noticia/${d.id}">${d.foto ? `<img src="${urlFotoNoticia(d.foto)}" alt="">` : `<div class="sin-foto">${I.noticias(40)}</div>`}
      <div><em class="pill p-dorado">${CAT[d.categoria] ?? ''}</em><b>${esc(d.titulo)}</b><small>${hora(d.publicada_en)}</small></div></a>` : ''}
      ${resto.map((n) => tarjetaNoticia(n!)).join('')}`;
  }).catch(() => { $('lista').innerHTML = '<p class="tenue">Sin conexión con el servidor.</p>'; });
}
const tarjetaNoticia = (n: Noticia) => `<a class="fila-noticia" href="#/noticia/${n.id}">
  ${n.foto ? `<img src="${urlFotoNoticia(n.foto)}" alt="">` : `<span class="sin-foto">${I.noticias(24)}</span>`}
  <span><em>${CAT[n.categoria] ?? ''}</em><b>${esc(n.titulo)}</b><small>${hora(n.publicada_en)}</small></span></a>`;
function noticia(id: string) {
  app.innerHTML = `${cabecera('Noticia', '#/noticias')}<main class="pantalla" id="contenido"><p class="tenue">Cargando…</p></main>`;
  infoPublica().then((i) => {
    const n = i.noticias.find((x) => x.id === id);
    $('contenido').innerHTML = n ? `<article class="articulo">${n.foto ? `<img src="${urlFotoNoticia(n.foto)}" alt="">` : ''}
      <em class="pill p-dorado">${CAT[n.categoria] ?? ''}</em><h1>${esc(n.titulo)}</h1><small class="tenue">${fechaLarga(n.publicada_en)}</small>
      ${esc(n.texto).split(/\n+/).map((p) => `<p>${p}</p>`).join('')}</article>` : '<p class="tenue">Esta noticia ya no está disponible.</p>';
  }).catch(() => { $('contenido').innerHTML = '<p class="tenue">Sin conexión.</p>'; });
}

// ---------------------------------------------------------------- apoya
function apoya() {
  app.innerHTML = `<div class="con-nav">${cabecera('Apoya a SIMUB', '#/inicio')}<main class="pantalla" id="contenido"><p class="tenue">Cargando…</p></main></div>${nav('apoya')}`;
  infoPublica(true).then((i) => {
    info = i;
    const d = i.config.donativos, e = i.config.estacion;
    const clabe = d?.clabe?.replace(/\s/g, '') ?? '';
    $('contenido').innerHTML = `
      <section class="hero-apoya"><img src="${BASE}escudo-192.png" alt=""><div><b>Somos voluntarios</b><p>Tu donativo mantiene las unidades, el equipo y la capacitación de quienes te atienden.</p></div></section>
      <section class="tarjeta"><h2 class="sec">Donar en línea</h2>
        <div class="montos">${(d?.montos ?? [100, 200, 500]).map((m) => `<a class="monto" ${d?.enlace_pago ? `href="${esc(d.enlace_pago)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>$${m}</a>`).join('')}
        <a class="monto" ${d?.enlace_pago ? `href="${esc(d.enlace_pago)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>Otro</a></div>
        ${d?.enlace_pago ? '<p class="tenue">Se abre la página segura del proveedor de pagos.</p>' : '<p class="tenue"><span class="pendiente">[Enlace de pago pendiente de SIMUB]</span></p>'}
      </section>
      <section class="tarjeta"><h2 class="sec">Transferencia</h2>
        <dl class="datos-banco"><dt>Titular</dt><dd>${pendiente(d?.titular?.startsWith('[') ? '' : d?.titular, d?.titular ?? '[Titular]')}</dd>
        <dt>Banco</dt><dd>${pendiente(d?.banco?.startsWith('[') ? '' : d?.banco, d?.banco ?? '[Banco]')}</dd>
        <dt>CLABE</dt><dd class="clabe">${pendiente(clabe, d?.clabe_texto ?? '[CLABE]')}${clabe ? `<button type="button" class="copiar" id="copiar" aria-label="Copiar CLABE">${I.copiar(18)} Copiar</button>` : ''}</dd>
        <dt>Concepto</dt><dd>${esc(d?.concepto ?? 'Donativo SIMUB')}</dd></dl>
        <p class="tenue">${d?.recibo_deducible ? 'Emitimos recibo deducible de impuestos.' : 'Si necesitas comprobante, solicítalo:'} ${pendiente(d?.contacto_recibo?.startsWith('[') ? '' : d?.contacto_recibo, d?.contacto_recibo ?? '')}</p>
      </section>
      <section class="tarjeta"><h2 class="sec">Donativos en especie</h2><p class="tenue">Lo que más necesitamos ahora:</p>
        <ul class="necesidades">${i.necesidades.map((n) => `<li>${I.caja(18)}<span>${esc(n.articulo)}${n.cantidad ? ` <small>(${esc(n.cantidad)})</small>` : ''}</span>${n.urgente ? '<em class="pill p-rojo">Urgente</em>' : ''}</li>`).join('') || '<li class="tenue">Por ahora no hay necesidades registradas.</li>'}</ul>
        <p class="tenue">Puedes llevarlos a la estación: ${pendiente(e?.direccion?.startsWith('[') ? '' : e?.direccion, e?.direccion ?? '')}</p>
      </section>
      <section class="tarjeta"><h2 class="sec">Súmate como voluntario</h2><p>${pendiente(d?.voluntariado?.startsWith('[') ? '' : d?.voluntariado, d?.voluntariado ?? '')}</p>
        ${telEstacion() ? `<a class="boton claro" href="tel:${telEstacion()}">${I.mano(18)} Quiero ser voluntario</a>` : ''}</section>
      <section class="tarjeta"><h2 class="sec">Quiénes somos</h2><p>${esc(e?.quienes_somos ?? '')}</p>
        <p class="tenue">${esc(e?.nombre ?? '')} · ${pendiente(e?.telefono ? e.telefono : '', e?.telefono_texto ?? '[Teléfono]')}</p></section>
      <p class="credito oscuro"><img src="${BASE}geoug.png" alt=""><span>App desarrollada sin costo por <b>GEO UG Developers</b> · Universidad de Guanajuato</span></p>`;
    document.getElementById('copiar')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(clabe); aviso('CLABE copiada.'); } catch { aviso(clabe); }
    });
  }).catch(() => { $('contenido').innerHTML = '<p class="tenue">Sin conexión con el servidor.</p>'; });
}

// ---------------------------------------------------------------- rutas
function ir() {
  limpiar();
  const [ruta, arg] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const nuevo = location.hash.includes('?nuevo');
  window.scrollTo(0, 0);
  switch (ruta || 'inicio') {
    case 'reportar': return formulario(arg);
    case 'seguimiento': return seguimiento(arg, nuevo);
    case 'mis': return mis();
    case 'revision': return arg ? revisionEstado(arg) : revisionForm();
    case 'noticias': return noticias();
    case 'noticia': return noticia(arg);
    case 'apoya': return apoya();
    default: return inicio();
  }
}
window.addEventListener('hashchange', ir);
infoPublica().then((i) => { info = i; }).catch(() => {});
registrarServiceWorker();
ir();
