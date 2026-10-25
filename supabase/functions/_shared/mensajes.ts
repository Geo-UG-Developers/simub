// Textos y botones de Telegram. Funciones puras (sin red): se prueban sin servidor.

export type Estado = 'enviado' | 'visto' | 'en_camino' | 'atendiendo' | 'cerrado' | 'falso';

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  enviado: 'Nuevo · sin ver',
  visto: 'Visto por la estación',
  en_camino: 'Unidad en camino',
  atendiendo: 'Atendiendo en el lugar',
  cerrado: 'Cerrado',
  falso: 'Falso o duplicado',
};
const BOTON_ESTADO: Record<Estado, string> = {
  enviado: '', visto: 'Visto', en_camino: 'En camino', atendiendo: 'En el lugar', cerrado: 'Cerrar', falso: 'Falso / duplicado',
};

export const ETIQUETA_TIPO: Record<string, string> = {
  incendio: 'Incendio',
  accidente: 'Accidente',
  gas: 'Fuga de gas',
  fauna: 'Control de fauna',
  infraestructura: 'Caída de infraestructura',
  otra: 'Otra emergencia',
};

export const ETIQUETA_MOTIVO: Record<string, string> = {
  gas: 'Instalación de gas', electrica: 'Instalación eléctrica', extintores: 'Extintores',
  plan_pc: 'Plan de protección civil', evento: 'Evento o espectáculo', otro: 'Otro',
};

const ORDEN: Estado[] = ['enviado', 'visto', 'en_camino', 'atendiendo', 'cerrado'];
export const ES_CIERRE = (e: Estado) => e === 'cerrado' || e === 'falso';

export function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Boton = { text: string; callback_data?: string; url?: string };

/** Botones según el estado (solo hacia adelante) y, si aplica, "Deshacer". */
export function teclado(id: string, estado: Estado, deshacer = false) {
  const filas: Boton[][] = [];
  if (!ES_CIERRE(estado)) {
    const sig = ORDEN.slice(ORDEN.indexOf(estado) + 1).filter((e) => e !== 'cerrado');
    const b = (e: Estado) => ({ text: BOTON_ESTADO[e], callback_data: `e|${id}|${e}` });
    if (sig.length) filas.push(sig.map(b));
    filas.push([b('cerrado'), b('falso')]);
  }
  if (deshacer) filas.push([{ text: 'Deshacer último cambio', callback_data: `u|${id}` }]);
  return { inline_keyboard: filas };
}

export function tecladoConfirmar(id: string, estado: Estado) {
  return { inline_keyboard: [[
    { text: `Sí, ${estado === 'cerrado' ? 'cerrar' : 'marcar como falso'}`, callback_data: `c|${id}|${estado}` },
    { text: 'Cancelar', callback_data: `x|${id}` },
  ]] };
}

export type Accion =
  | { tipo: 'estado' | 'confirmar'; id: string; estado: Estado }
  | { tipo: 'deshacer' | 'cancelar'; id: string }
  | { tipo: 'noticia'; op: string; arg: string }
  | { tipo: 'necesidad'; op: string; arg: string };

export function leerBoton(data: string | undefined): Accion | null {
  if (!data) return null;
  const m = /^([ec])\|([0-9a-f-]{36})\|(visto|en_camino|atendiendo|cerrado|falso)$/.exec(data);
  if (m) return { tipo: m[1] === 'e' ? 'estado' : 'confirmar', id: m[2], estado: m[3] as Estado };
  const n = /^([ux])\|([0-9a-f-]{36})$/.exec(data);
  if (n) return { tipo: n[1] === 'u' ? 'deshacer' : 'cancelar', id: n[2] };
  const t = /^n\|(cat|pub|can|des|ocu)\|?([\w-]*)$/.exec(data);
  if (t) return { tipo: 'noticia', op: t[1], arg: t[2] };
  const q = /^q\|(u|d|a|ok)\|?(\d*)$/.exec(data);
  if (q) return { tipo: 'necesidad', op: q[1], arg: q[2] };
  return null;
}

export function leerComando(texto: string | undefined): { comando: string; arg: string } | null {
  if (!texto) return null;
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(texto.trim());
  return m ? { comando: m[1].toLowerCase(), arg: (m[2] ?? '').trim() } : null;
}

const TZ = 'America/Mexico_City';
export const horaMx = (f: Date | string) =>
  new Date(f).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const fechaMx = (f: Date | string) =>
  new Date(f).toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ });

export interface DatosAlerta {
  folio: string; tipo: string; estado: Estado; lat: number; lon: number; precision_m?: number | null;
  detalles?: { resumen?: string[] }; comentario?: string | null; referencia?: string | null;
  nombre?: string | null; telefono?: string | null; anonimo?: boolean; creado_en?: string;
  historial?: { estado: Estado; actor: string | null; en: string }[];
}

/** Texto de la alerta (HTML de Telegram; máx. 1024 caracteres en fotos). */
export function textoAlerta(d: DatosAlerta): string {
  const l: string[] = [
    d.estado === 'enviado' ? '<b>NUEVO REPORTE</b>' : `<b>${ETIQUETA_ESTADO[d.estado]}</b>`,
    `<b>${escapar(ETIQUETA_TIPO[d.tipo] ?? d.tipo)}</b> · folio ${escapar(d.folio)}${d.creado_en ? ` · ${horaMx(d.creado_en)}` : ''}`,
  ];
  for (const r of (d.detalles?.resumen ?? []).slice(0, 8)) l.push(`· ${escapar(r)}`);
  if (d.referencia) l.push(`Referencia: ${escapar(d.referencia)}`);
  if (d.comentario) l.push(`«${escapar(d.comentario.slice(0, 220))}»`);
  const quien = d.anonimo ? 'Anónimo' : (d.nombre ? escapar(d.nombre) : 'Sin nombre');
  l.push(`Reporta: ${quien}${d.telefono ? ` · <a href="tel:${encodeURIComponent(d.telefono)}">${escapar(d.telefono)}</a>` : ''}`);
  l.push(`<a href="https://www.google.com/maps/dir/?api=1&amp;destination=${d.lat},${d.lon}">Abrir ruta en Google Maps</a>` +
    (d.precision_m ? ` (±${d.precision_m} m)` : ''));
  for (const h of d.historial ?? []) {
    l.push(`· ${ETIQUETA_ESTADO[h.estado]}${h.actor ? ` por ${escapar(h.actor)}` : ''} · ${horaMx(h.en)}`);
  }
  return l.join('\n').slice(0, 1024);
}

export interface DatosRevision {
  folio: string; estado: string; motivos: string[]; inmueble?: string | null; direccion: string;
  horario_preferido?: string | null; nombre: string; telefono: string; comentario?: string | null;
  fecha?: string | null; asignado?: string | null;
}
export function textoRevision(v: DatosRevision): string {
  const l = [
    v.estado === 'solicitada' ? '<b>SOLICITUD DE REVISIÓN</b> (no es emergencia)' : `<b>Revisión · ${escapar(v.estado)}</b>`,
    `Folio ${escapar(v.folio)}`,
    `Motivo: ${escapar(v.motivos.map((m) => ETIQUETA_MOTIVO[m] ?? m).join(', '))}`,
  ];
  if (v.inmueble) l.push(`Inmueble: ${escapar(v.inmueble)}`);
  l.push(`Dirección: ${escapar(v.direccion)}`);
  if (v.horario_preferido) l.push(`Horario preferido: ${escapar(v.horario_preferido)}`);
  l.push(`Contacto: ${escapar(v.nombre)} · <a href="tel:${encodeURIComponent(v.telefono)}">${escapar(v.telefono)}</a>`);
  if (v.comentario) l.push(`«${escapar(v.comentario.slice(0, 200))}»`);
  if (v.fecha) l.push(`Fecha: ${escapar(fechaMx(v.fecha))}${v.asignado ? ` · va ${escapar(v.asignado)}` : ''}`);
  return l.join('\n');
}

export const CATEGORIA: Record<string, string> = { evento: 'Evento', donacion: 'Donación', aviso: 'Aviso' };
