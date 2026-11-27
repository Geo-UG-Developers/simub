// Grupo de comunicación interna: un mensaje por servicio (folio) que se va actualizando,
// con botón «Voy» para que cada bombero confirme que acude. Resumen al cambio de turno.
import { chatDe, db, PANEL_URL, tg } from './servicios.ts';
import { escapar } from './mensajes.ts';

// deno-lint-ignore no-explicit-any
type D = Record<string, any>;
const hm = (f?: string | null) => f ? new Date(f).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const fechaHora = (f?: string | null) => f ? new Date(f).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const TURNO: Record<string, string> = { dia: 'Día', noche: 'Noche' };

/** Liga de Google Maps: coordenadas si las hay; si no, búsqueda por dirección. */
export function ligaMaps(d: D): string {
  const q = d.lat != null && d.lon != null ? `${d.lat},${d.lon}`
    : [d.lugar, d.colonia, 'Guanajuato, Gto.'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Regla 30-30-30 con el peor momento del día (Open-Meteo, sin llave). */
export async function riesgoIncendio(): Promise<string | null> {
  try {
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=21.019&longitude=-101.257&current=temperature_2m,relative_humidity_2m,wind_speed_10m'
      + '&daily=temperature_2m_max,relative_humidity_2m_min,wind_speed_10m_max&timezone=America%2FMexico_City&forecast_days=1';
    const j = await (await fetch(u, { signal: AbortSignal.timeout(4000) })).json();
    const t = Math.max(j.current.temperature_2m, j.daily.temperature_2m_max[0]), h = Math.min(j.current.relative_humidity_2m, j.daily.relative_humidity_2m_min[0]);
    const v = Math.max(j.current.wind_speed_10m, j.daily.wind_speed_10m_max[0]);
    const n = [t > 30, h < 30, v > 30].filter(Boolean).length;
    return `${['BAJO', 'MODERADO', 'ALTO', 'MUY ALTO'][n]} ${n}/3 (${Math.round(t)} °C · ${Math.round(h)} % · ${Math.round(v)} km/h)`;
  } catch { return null; }
}

export function textoServicio(d: D, riesgo?: string | null, sensible = false): string {
  const folio = `${d.anio}-${String(d.folio).padStart(4, '0')}`;
  const l: string[] = [];
  l.push(`<b>${d.estado === 'cerrado' ? 'CONCLUIDO' : d.estado === 'anulado' ? 'ANULADO' : 'SERVICIO'} ${folio}</b> · <b>${escapar(d.falsa_alarma ? `FALSA ALARMA (${d.clase})` : d.clase)}</b>`);
  if (d.especificacion) l.push(escapar(d.especificacion));
  l.push(`Turno: ${TURNO[d.turno] ?? '—'} · ${fechaHora(d.h_reporte ?? d.creado_en)}`);
  l.push(`Lugar: ${escapar([d.colonia, d.lugar].filter(Boolean).join(', ') || 'sin dirección')}`);
  l.push(`<a href="${escapar(ligaMaps(d))}">Abrir ubicación en Google Maps</a>`);
  if (sensible && (d.reportante || d.telefono)) l.push(`Reporta: ${escapar(d.reportante ?? 'sin nombre')}${d.telefono ? ` · ${escapar(d.telefono)}` : ''}`);
  l.push(`Medio: ${escapar(String(d.medio ?? '—').replace(/\(SIM-[^)]*\)/, ''))}${sensible && d.datos?.folio_911 ? ` (folio 911 ${escapar(d.datos.folio_911)})` : ''}`);
  l.push(`Unidades: ${escapar((d.unidades ?? []).join(', ') || 'por asignar')}${d.jefe_guardia ? ` · jefe de guardia: ${escapar(d.jefe_guardia)}` : ''}`);
  if (riesgo) l.push(`Riesgo de incendio (30-30-30): <b>${escapar(riesgo)}</b>`);
  const crono = [['Despacho', d.h_despacho], ['Escena', d.h_llegada], ['Disponible', d.h_disponible], ['Base', d.h_base]].filter(([, h]) => h).map(([t, h]) => `${t} ${hm(h)}`);
  if (crono.length) l.push(`⏱ ${crono.join(' → ')}`);
  if ((d.voy ?? []).length) l.push(`Van: ${escapar(d.voy.join(', '))}`);
  if (d.ultima && d.estado === 'activo') l.push(`Última nota: ${escapar(String(d.ultima).slice(0, 160))}`);
  if (d.estado === 'cerrado') {
    const m = d.h_despacho && d.h_base ? Math.round((+new Date(d.h_base) - +new Date(d.h_despacho)) / 60000) : null;
    if (m != null && m >= 0) l.push(`Duración: ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`);
    if (!d.jefe_servicio) l.push('<b>Falta llenar el parte de servicio.</b>');
  }
  return l.join('\n').slice(0, 4000);
}

export const tecladoServicio = (d: D) => ({
  inline_keyboard: [[...(d.estado === 'activo' ? [{ text: 'Voy', callback_data: `v|${d.id}` }] : []), { text: 'Abrir parte', url: `${PANEL_URL}#servicio/${d.id}` }]],
});

async function datos(id: string): Promise<D | null> {
  const { data, error } = await db.rpc('datos_servicio_tg', { p_id: id });
  return error || !data || data.origen === 'historico' ? null : data;
}
const esForestal = (d: D) => ['inc_pastizal', 'inc_forestal', 'inc_baldio', 'inc_carrizos', 'inc_arbol'].includes(d.clasificacion);

/** Actualiza (si ya se envió) el mensaje del servicio en el grupo de comunicación interna. Sin datos personales. */
export async function avisarServicio(id: string) {
  const d = await datos(id); if (!d?.tg_message_id) return;
  await tg('editMessageText', { chat_id: d.tg_chat_id, message_id: d.tg_message_id, text: textoServicio(d, null, false), parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: tecladoServicio(d) });
}

/** «Enviar a comunicación interna»: resumen y folio SIN nombre ni teléfono de quien reporta. */
export async function enviarInterno(id: string, actor: string): Promise<boolean> {
  const d = await datos(id); const chat = await chatDe('interno');
  if (!d || !chat) return false;
  const riesgo = esForestal(d) && d.estado === 'activo' ? await riesgoIncendio() : null;
  const r = await tg('sendMessage', { chat_id: chat, text: textoServicio(d, riesgo, false), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: tecladoServicio(d) });
  if (!r.ok) return false;
  await db.from('servicios').update({ tg_chat_id: chat, tg_message_id: r.result.message_id }).eq('id', id);
  await db.from('envios').insert({ servicio_id: id, destino: 'interno', por: actor });
  await db.from('bitacora').insert({ servicio_id: id, texto: 'Enviado al grupo de comunicación interna', autor: actor });
  return true;
}

/** «Enviar a oficial»: mensaje privado con todo (incluye nombre y teléfono de quien reporta). */
export async function enviarOficial(id: string, oficiales: number[], actor: string): Promise<{ enviados: string[]; sin_telegram: string[] }> {
  const d = await datos(id); const res = { enviados: [] as string[], sin_telegram: [] as string[] };
  if (!d) return res;
  const { data: ps } = await db.from('personal').select('id, nombre, nombre_corto, tg_chat_id').in('id', oficiales);
  const riesgo = esForestal(d) && d.estado === 'activo' ? await riesgoIncendio() : null;
  for (const p of ps ?? []) {
    const nombre = p.nombre_corto ?? p.nombre;
    if (!p.tg_chat_id) { res.sin_telegram.push(nombre); continue; }
    const r = await tg('sendMessage', { chat_id: p.tg_chat_id, parse_mode: 'HTML', disable_web_page_preview: true,
      text: `<b>Servicio asignado por cabina</b>\n${textoServicio(d, riesgo, true)}`,
      reply_markup: { inline_keyboard: [
        [{ text: 'Abrir ubicación en Google Maps', url: ligaMaps(d) }],
        [{ text: 'Llenar el parte de este folio', url: `${PANEL_URL}#campo/${d.id}` }],
        [{ text: 'Voy', callback_data: `v|${d.id}` }, { text: 'Quitarme del mapa', callback_data: 'u|off' }]] } });
    if (!r.ok) { res.sin_telegram.push(nombre); continue; }
    await tg('sendMessage', { chat_id: p.tg_chat_id, parse_mode: 'HTML',
      text: 'Para que cabina te vea en el mapa: toca 📎 › <b>Ubicación</b> › <b>Compartir ubicación en tiempo real</b>. Para dejar de compartir, toca «Detener».',
      reply_markup: { keyboard: [[{ text: '📍 Enviar mi ubicación ahora', request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
    await db.from('envios').insert({ servicio_id: id, destino: 'oficial', personal_id: p.id, nombre, por: actor });
    res.enviados.push(nombre);
  }
  if (res.enviados.length) await db.from('bitacora').insert({ servicio_id: id, texto: `Enviado por Telegram a: ${res.enviados.join(', ')}`, autor: actor });
  return res;
}

/** Ubicación de un oficial (mensaje de ubicación o ubicación en tiempo real en su chat privado con el bot). */
export async function ubicacionOficial(chat: number, lat: number, lon: number, precision?: number) {
  const { data: p } = await db.from('personal').select('id, nombre, nombre_corto').eq('tg_chat_id', chat).maybeSingle();
  if (!p) return false;
  const { data: e } = await db.from('envios').select('servicio_id').eq('personal_id', p.id).eq('destino', 'oficial').order('en', { ascending: false }).limit(1).maybeSingle();
  await db.from('posiciones').upsert({ unidad: `Of. ${p.nombre_corto ?? p.nombre}`, tipo: 'oficial', lat, lon, precision_m: precision ? Math.round(precision) : null,
    servicio_id: e?.servicio_id ?? null, autor: p.nombre, en: new Date().toISOString() });
  await db.from('personal').update({ comparte_ubicacion: true }).eq('id', p.id);
  return true;
}

/** Solicitud de apoyo: alerta en el grupo interno, como respuesta al mensaje del servicio. */
export async function pedirApoyo(id: string, texto: string, actor: string) {
  const { data: d } = await db.rpc('datos_servicio_tg', { p_id: id });
  const chat = d?.tg_chat_id ?? await chatDe('interno');
  if (!d || !chat) return false;
  const r = await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_to_message_id: d.tg_message_id ?? undefined, disable_web_page_preview: true,
    text: `<b>SOLICITUD DE APOYO</b> · servicio ${d.anio}-${String(d.folio).padStart(4, '0')} (${escapar(d.clase)})\n${escapar(texto)}\n` +
      `Lugar: ${escapar([d.colonia, d.lugar].filter(Boolean).join(', '))} · <a href="${escapar(ligaMaps(d))}">mapa</a>\nPide: ${escapar(actor)}` });
  await db.from('bitacora').insert({ servicio_id: id, texto: `Solicitud de apoyo: ${texto}`.slice(0, 1000), autor: actor });
  return Boolean(r.ok);
}

/** Resumen del turno que termina (lo llama la tarea de cada minuto a las 08:00 y 20:00). */
export async function resumenTurno(): Promise<boolean> {
  const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const hh = ahora.getHours(), mm = ahora.getMinutes();
  if (!((hh === 8 || hh === 20) && mm < 10)) return false;
  // turno que termina: a las 08:00 la noche anterior; a las 20:00 el día de hoy
  const fecha = new Date(ahora); if (hh === 8) fecha.setDate(fecha.getDate() - 1);
  const f = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  const turno = hh === 8 ? 'noche' : 'dia', clave = `${f}-${turno}`;
  const { data: ya } = await db.from('config_privada').select('valor').eq('clave', 'resumen_turno').maybeSingle();
  if (ya?.valor?.ultimo === clave) return false;
  await db.from('config_privada').upsert({ clave: 'resumen_turno', valor: { ultimo: clave } });
  const chat = await chatDe('interno'); if (!chat) return false;
  const { data: r } = await db.rpc('resumen_turno', { p_fecha: f, p_turno: turno });
  if (!r) return false;
  const tipos = Object.entries(r.por_tipo ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, n]) => `· ${escapar(k)}: ${n}`);
  await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: [
    `<b>ENTREGA DE GUARDIA · turno de ${TURNO[turno].toLowerCase()} ${f.split('-').reverse().join('/')}</b>`,
    r.jefe ? `Jefe de guardia: ${escapar(r.jefe)}` : 'Jefe de guardia: sin registrar',
    `Servicios del turno: <b>${r.total}</b>`, ...tipos,
    `Servicios aún activos: ${r.activos}`,
    r.sin_parte ? `<b>Sin parte de servicio: ${r.sin_parte}</b>` : 'Todos los partes del turno están llenos.',
    (r.fuera_servicio ?? []).length ? `Unidades fuera de servicio: ${escapar(r.fuera_servicio.join(', '))}` : 'Todas las unidades disponibles.',
  ].join('\n') });
  return true;
}
