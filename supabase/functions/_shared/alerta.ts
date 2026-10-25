// Alertas en el grupo de Telegram de la estación.
import { chatDe, db, PANEL_URL, tg, tgFoto } from './servicios.ts';
import { ES_CIERRE, escapar, teclado, textoAlerta, textoRevision, type DatosAlerta, type Estado } from './mensajes.ts';

interface Datos extends DatosAlerta {
  id: string; fotos: string[]; tg_chat_id: number | null; tg_message_id: number | null; tiene_parte: boolean;
}

export async function datosAlerta(id: string): Promise<Datos | null> {
  const { data, error } = await db.rpc('datos_alerta', { p_reporte: id });
  if (error) { console.error('datos_alerta', error.message); return null; }
  return data as Datos;
}

export async function primeraFoto(ruta?: string): Promise<Blob | undefined> {
  if (!ruta) return undefined;
  const { data } = await db.storage.from('fotos').download(ruta);
  return data ?? undefined;
}

/** Envía la alerta al grupo de alertas (una sola vez). */
export async function enviarAlerta(id: string, foto?: Blob) {
  const d = await datosAlerta(id);
  if (!d || d.tg_message_id) return;
  const chat = await chatDe('alertas');
  if (!chat) { console.error('Sin grupo de alertas vinculado'); return; }
  const r = foto
    ? await tgFoto(chat, foto, textoAlerta(d), teclado(d.id, d.estado))
    : await tg('sendMessage', { chat_id: chat, text: textoAlerta(d), parse_mode: 'HTML', reply_markup: teclado(d.id, d.estado), disable_web_page_preview: true });
  if (r.ok) await db.from('reportes').update({ tg_chat_id: chat, tg_message_id: r.result.message_id }).eq('id', id);
}

/** Redibuja la alerta con el estado actual. */
export async function actualizarAlerta(id: string) {
  const d = await datosAlerta(id);
  if (!d?.tg_message_id) return;
  const { data: deshacer } = await db.rpc('puede_deshacer', { p_reporte: id });
  const base = { chat_id: d.tg_chat_id, message_id: d.tg_message_id, parse_mode: 'HTML', reply_markup: teclado(d.id, d.estado, Boolean(deshacer)) };
  const r = await tg('editMessageCaption', { ...base, caption: textoAlerta(d) });
  if (!r.ok && /no caption|there is no caption/i.test(r.description ?? '')) {
    await tg('editMessageText', { ...base, text: textoAlerta(d), disable_web_page_preview: true });
  }
}

/** Al cerrar: liga para llenar el parte de servicio. */
export async function pedirParte(id: string, estado: Estado) {
  if (estado !== 'cerrado') return;
  const d = await datosAlerta(id);
  if (!d?.tg_chat_id || d.tiene_parte) return;
  await tg('sendMessage', {
    chat_id: d.tg_chat_id, reply_to_message_id: d.tg_message_id, parse_mode: 'HTML',
    text: `Servicio <b>${escapar(d.folio)}</b> cerrado. Llena el parte de servicio (30 segundos):`,
    reply_markup: { inline_keyboard: [[{ text: 'Llenar parte de servicio', url: `${PANEL_URL}#parte/${id}` }]] },
  });
}

/** Mensaje de texto como respuesta a la alerta original (agregados, escalamiento). */
export async function responderAlerta(id: string, html: string) {
  const d = await datosAlerta(id);
  if (!d?.tg_chat_id) return;
  await tg('sendMessage', { chat_id: d.tg_chat_id, reply_to_message_id: d.tg_message_id, parse_mode: 'HTML', text: html });
}

/** Solicitud de revisión de seguridad (no urgente) o su actualización. */
export async function avisarRevision(revisionId: string, nota?: string) {
  const { data: v } = await db.from('revisiones').select('*').eq('id', revisionId).maybeSingle();
  if (!v) return;
  const chat = v.tg_chat_id ?? await chatDe('alertas');
  if (!chat) return;
  const botones = { inline_keyboard: [[{ text: v.estado === 'solicitada' ? 'Agendar en el panel' : 'Ver en el panel', url: `${PANEL_URL}#agenda/${v.id}` }]] };
  if (!v.tg_message_id) {
    const r = await tg('sendMessage', { chat_id: chat, text: textoRevision(v), parse_mode: 'HTML', reply_markup: botones, disable_notification: true });
    if (r.ok) await db.from('revisiones').update({ tg_chat_id: chat, tg_message_id: r.result.message_id }).eq('id', v.id);
    return;
  }
  await tg('editMessageText', { chat_id: chat, message_id: v.tg_message_id, text: textoRevision(v), parse_mode: 'HTML', reply_markup: botones });
  if (nota) await tg('sendMessage', { chat_id: chat, reply_to_message_id: v.tg_message_id, text: nota, parse_mode: 'HTML', disable_notification: true });
}

export { ES_CIERRE };
