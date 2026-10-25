// Webhook del bot @SimubGtoBot.
//  · Grupo de alertas: botones de estado de cada reporte (cerrar pide admin + confirmación; deshacer 2 min).
//  · Grupo de comunicación: /noticia, /destacar, /ocultar, /necesidades (sin programar nada).
//  · Cualquier grupo: /id, /vincular CÓDIGO (solo administradores), /ayuda.
import { db, rolDeChat, secretoWebhook, tg, tgArchivo } from '../_shared/servicios.ts';
import {
  CATEGORIA, ES_CIERRE, ETIQUETA_ESTADO, ETIQUETA_TIPO, escapar, leerBoton, leerComando, tecladoConfirmar, type Estado,
} from '../_shared/mensajes.ts';
import { actualizarAlerta, datosAlerta, pedirParte } from '../_shared/alerta.ts';
import { enviarAvisos } from '../_shared/avisos.ts';

const AYUDA = [
  '<b>SIMUB · bot de la estación</b>',
  '',
  '<b>En el grupo de alertas</b> llegan los reportes de la app con botones: Visto, En camino, En el lugar, Cerrar.',
  'Cerrar o marcar falso lo hace un administrador del grupo y se puede deshacer 2 minutos.',
  '',
  '<b>En el grupo de comunicación:</b>',
  '/noticia · publicar una noticia en la app (paso a paso)',
  '/destacar · elegir la noticia principal',
  '/ocultar · quitar una noticia de la app',
  '/necesidades · actualizar la lista de donativos en especie',
  '/cancelar · cancelar lo que estés capturando',
  '',
  '/id · número de este chat',
  '/vincular CÓDIGO · conectar este grupo (solo administradores)',
].join('\n');

const ERRORES: Record<string, string> = {
  transicion_invalida: 'Ese estado ya se había marcado.',
  cerrado: 'Este reporte ya está cerrado.',
  nada_que_deshacer: 'No hay cambios que deshacer.',
  tiempo_vencido: 'Ya pasaron 2 minutos; ese cambio ya no se puede deshacer.',
};
const NOMBRE_ROL: Record<string, string> = { alertas: 'alertas de reportes', comunicacion: 'comunicación (noticias y donativos)', respaldo: 'respaldo' };

Deno.serve(async (req) => {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== await secretoWebhook()) return new Response('no autorizado', { status: 401 });
  const u = await req.json().catch(() => ({}));
  try {
    if (u.message) await mensaje(u.message);
    else if (u.callback_query) await boton(u.callback_query);
  } catch (e) { console.error('webhook', e); }
  return new Response('ok');
});

// deno-lint-ignore no-explicit-any
type Msg = any;
const nombreDe = (f: Msg) => [f.first_name, f.last_name ? `${f.last_name[0]}.` : ''].join(' ').trim();
async function esAdmin(chat: number, userId: number) {
  const m = await tg('getChatMember', { chat_id: chat, user_id: userId });
  return ['creator', 'administrator'].includes(m.result?.status);
}
const preguntar = (chat: number, text: string, responderA?: number) =>
  tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_to_message_id: responderA,
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Escribe aquí' } });

async function borrador(chat: number, user: number) {
  const { data } = await db.from('tg_borradores').select('*').eq('chat_id', chat).eq('user_id', user).maybeSingle();
  if (data && Date.now() - new Date(data.actualizado_en).getTime() > 30 * 60_000) { await soltar(chat, user); return null; }
  return data;
}
const guardar = (chat: number, user: number, tipo: string, paso: string, datos: unknown) =>
  db.from('tg_borradores').upsert({ chat_id: chat, user_id: user, tipo, paso, datos, actualizado_en: new Date().toISOString() });
const soltar = (chat: number, user: number) => db.from('tg_borradores').delete().eq('chat_id', chat).eq('user_id', user);

// ------------------------------------------------------------------ mensajes
async function mensaje(m: Msg) {
  const chat: number = m.chat.id, user: number = m.from?.id;
  const responder = (text: string, extra: Record<string, unknown> = {}) =>
    tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', ...extra });
  const c = leerComando(m.text ?? m.caption);

  if (c?.comando === 'id') return responder(`El número de este chat es <code>${chat}</code>`);
  if (c && ['start', 'ayuda', 'help'].includes(c.comando)) return responder(AYUDA);
  if (c?.comando === 'vincular') {
    if (m.chat.type === 'private') return responder('Usa /vincular dentro del grupo que quieres conectar.');
    if (!(await esAdmin(chat, user))) return responder('Solo un administrador del grupo puede vincularlo.');
    if (!c.arg) return responder('Escribe el código: /vincular CÓDIGO');
    const { data, error } = await db.rpc('vincular_chat', { p_codigo: c.arg, p_chat_id: chat });
    if (error) return responder('Código no válido.');
    return responder(`Listo: este grupo queda como <b>${NOMBRE_ROL[data] ?? data}</b> de SIMUB.`);
  }
  if (c?.comando === 'cancelar') { await soltar(chat, user); return responder('Cancelado.'); }
  if (c?.comando === 'vigia') {
    if (m.chat.type !== 'private') return responder('Escríbeme /vigia en un chat privado.');
    const { data: v } = await db.from('config_privada').select('valor').eq('clave', 'vigia').maybeSingle();
    const actual = (v?.valor as { chat_id?: number } | null)?.chat_id;
    if (actual && actual !== chat) return responder('El vigía ya está asignado a otra persona.');
    if (actual === chat) { await db.from('config_privada').delete().eq('clave', 'vigia'); return responder('Listo: ya no te enviaré los avisos del vigía.'); }
    await db.from('config_privada').upsert({ clave: 'vigia', valor: { chat_id: chat } });
    return responder('Listo: te avisaré aquí si algo deja de funcionar, y cada lunes te mandaré «SIMUB funcionando».');
  }

  const rol = await rolDeChat(chat);
  const comunicacion = rol === 'comunicacion';
  if (c && ['noticia', 'destacar', 'ocultar', 'necesidades'].includes(c.comando) && !comunicacion) {
    return responder('Ese comando funciona en el grupo de comunicación de SIMUB.');
  }
  if (c?.comando === 'noticia') {
    await guardar(chat, user, 'noticia', 'categoria', { autor: nombreDe(m.from) });
    return responder('<b>Nueva noticia.</b> ¿De qué tipo es?', { reply_markup: { inline_keyboard: [
      Object.entries(CATEGORIA).map(([k, v]) => ({ text: v, callback_data: `n|cat|${k}` })),
      [{ text: 'Cancelar', callback_data: 'n|can' }]] } });
  }
  if (c?.comando === 'destacar' || c?.comando === 'ocultar') return listaNoticias(chat, c.comando === 'destacar' ? 'des' : 'ocu');
  if (c?.comando === 'necesidades') return listaNecesidades(chat);

  // Respuestas a preguntas del bot (borradores en curso).
  if (!comunicacion || !user) return;
  const b = await borrador(chat, user);
  if (!b) return;
  if (c?.comando === 'saltar' && b.tipo === 'noticia' && b.paso === 'foto') return vistaPrevia(chat, user, b.datos);
  if (c) return;
  const texto: string = (m.text ?? '').trim();

  if (b.tipo === 'noticia') {
    if (b.paso === 'titulo') {
      if (texto.length < 3 || texto.length > 140) return preguntar(chat, 'El título debe tener entre 3 y 140 letras. Escríbelo de nuevo:', m.message_id);
      await guardar(chat, user, 'noticia', 'texto', { ...b.datos, titulo: texto });
      return preguntar(chat, 'Ahora escribe el <b>texto</b> de la noticia (puede ser largo):', m.message_id);
    }
    if (b.paso === 'texto') {
      if (!texto) return preguntar(chat, 'Escribe el texto de la noticia:', m.message_id);
      await guardar(chat, user, 'noticia', 'foto', { ...b.datos, texto: texto.slice(0, 3000) });
      return preguntar(chat, 'Envía una <b>foto</b> respondiendo a este mensaje, o escribe /saltar para publicarla sin foto.', m.message_id);
    }
    if (b.paso === 'foto') {
      const foto = m.photo?.[m.photo.length - 1]?.file_id;
      if (!foto) return preguntar(chat, 'Envía una foto (o /saltar):', m.message_id);
      return vistaPrevia(chat, user, { ...b.datos, foto_id: foto });
    }
  }
  if (b.tipo === 'necesidad' && b.paso === 'agregar') {
    if (!texto) return;
    const urgente = texto.startsWith('!');
    const articulo = texto.replace(/^!\s*/, '').slice(0, 120);
    await db.from('necesidades').insert({ articulo, urgente, orden: 99 });
    await soltar(chat, user);
    await responder(`Agregado: <b>${escapar(articulo)}</b>${urgente ? ' (urgente)' : ''}.`);
    return listaNecesidades(chat);
  }
}

async function vistaPrevia(chat: number, user: number, datos: Record<string, string>) {
  await guardar(chat, user, 'noticia', 'confirmar', datos);
  const texto = `<b>Vista previa · ${CATEGORIA[datos.categoria] ?? ''}</b>\n\n<b>${escapar(datos.titulo)}</b>\n${escapar(datos.texto).slice(0, 700)}`;
  const teclado = { inline_keyboard: [[{ text: 'Publicar en la app', callback_data: 'n|pub' }, { text: 'Cancelar', callback_data: 'n|can' }]] };
  if (datos.foto_id) return tg('sendPhoto', { chat_id: chat, photo: datos.foto_id, caption: texto.slice(0, 1024), parse_mode: 'HTML', reply_markup: teclado });
  return tg('sendMessage', { chat_id: chat, text: texto, parse_mode: 'HTML', reply_markup: teclado });
}

async function listaNoticias(chat: number, op: 'des' | 'ocu') {
  const { data } = await db.from('noticias').select('id, titulo, destacada').eq('visible', true).order('publicada_en', { ascending: false }).limit(8);
  if (!data?.length) return tg('sendMessage', { chat_id: chat, text: 'No hay noticias publicadas.' });
  return tg('sendMessage', {
    chat_id: chat, parse_mode: 'HTML',
    text: op === 'des' ? '¿Cuál noticia va <b>destacada</b> (arriba, con foto grande)?' : '¿Cuál noticia quieres <b>quitar</b> de la app?',
    reply_markup: { inline_keyboard: data.map((n) => [{ text: `${n.destacada ? '★ ' : ''}${n.titulo}`.slice(0, 60), callback_data: `n|${op}|${n.id}` }]) },
  });
}

async function listaNecesidades(chat: number, editar?: number) {
  const { data } = await db.from('necesidades').select('id, articulo, urgente').eq('activa', true).order('urgente', { ascending: false }).order('orden').order('id');
  const filas = (data ?? []).map((x) => [
    { text: `${x.urgente ? '★ Urgente' : '☆ Normal'} · ${x.articulo}`.slice(0, 50), callback_data: `q|u|${x.id}` },
    { text: 'Quitar', callback_data: `q|d|${x.id}` },
  ]);
  filas.push([{ text: 'Agregar necesidad', callback_data: 'q|a' }, { text: 'Listo', callback_data: 'q|ok' }]);
  const text = '<b>Necesidades en especie</b> (se ven en «Apoya a SIMUB»).\nToca una para marcarla urgente o normal.';
  if (editar) return tg('editMessageText', { chat_id: chat, message_id: editar, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: filas } });
  return tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: filas } });
}

// ------------------------------------------------------------------ botones
// deno-lint-ignore no-explicit-any
async function boton(q: any) {
  const a = leerBoton(q.data);
  const contestar = (text: string, alerta = false) => tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alerta });
  if (!a) return contestar('Botón no reconocido.');
  const chat: number = q.message?.chat?.id;
  const rol = await rolDeChat(chat);
  const actor = nombreDe(q.from);

  if (a.tipo === 'noticia' || a.tipo === 'necesidad') {
    if (rol !== 'comunicacion') return contestar('Esto funciona en el grupo de comunicación.');
    return a.tipo === 'noticia' ? botonNoticia(q, a.op, a.arg, contestar) : botonNecesidad(q, a.op, a.arg, contestar);
  }
  if (rol !== 'alertas') return contestar('Este grupo no es el de alertas de SIMUB.');

  const soloAdmin = 'Solo un administrador del grupo (jefe de turno) puede cerrar un reporte.';
  const aplicar = async (estado: Estado) => {
    const { error } = await db.rpc('cambiar_estado', { p_reporte: a.id, p_estado: estado, p_actor: actor, p_canal: 'telegram' });
    if (error) return contestar(ERRORES[error.message] ?? 'No se pudo cambiar el estado.', true);
    await contestar(`Marcado: ${ETIQUETA_ESTADO[estado]}. Tienes 2 minutos para deshacerlo.`);
    await actualizarAlerta(a.id);
    await pedirParte(a.id, estado);
    await enviarAvisos();
  };

  switch (a.tipo) {
    case 'cancelar':
      await tg('deleteMessage', { chat_id: chat, message_id: q.message.message_id });
      return contestar('Cancelado. No se cambió nada.');
    case 'estado': {
      if (!ES_CIERRE(a.estado)) return aplicar(a.estado);
      if (!(await esAdmin(chat, q.from.id))) return contestar(soloAdmin, true);
      const d = await datosAlerta(a.id);
      await tg('sendMessage', {
        chat_id: chat, parse_mode: 'HTML', reply_to_message_id: q.message.message_id,
        text: `<b>${escapar(actor)}</b>, ¿confirmas ${a.estado === 'cerrado' ? '<b>CERRAR</b>' : 'marcar como <b>FALSO o DUPLICADO</b>'} este reporte?\n` +
          `${escapar(d ? `${ETIQUETA_TIPO[d.tipo] ?? d.tipo} · folio ${d.folio}` : '')}`,
        reply_markup: tecladoConfirmar(a.id, a.estado),
      });
      return contestar('Confirma en el mensaje de abajo.');
    }
    case 'confirmar':
      if (!(await esAdmin(chat, q.from.id))) return contestar(soloAdmin, true);
      await tg('deleteMessage', { chat_id: chat, message_id: q.message.message_id });
      return aplicar(a.estado);
    case 'deshacer': {
      const { data: rep } = await db.from('reportes').select('estado').eq('id', a.id).maybeSingle();
      if (rep && ES_CIERRE(rep.estado) && !(await esAdmin(chat, q.from.id))) return contestar(soloAdmin, true);
      const { data, error } = await db.rpc('deshacer_estado', { p_reporte: a.id, p_actor: actor });
      if (error) { await actualizarAlerta(a.id); return contestar(ERRORES[error.message] ?? 'No se pudo deshacer.', true); }
      await contestar(`Se deshizo «${ETIQUETA_ESTADO[data.deshecho as Estado]}». Estado: ${ETIQUETA_ESTADO[data.estado as Estado]}.`);
      return actualizarAlerta(a.id);
    }
  }
}

// deno-lint-ignore no-explicit-any
async function botonNoticia(q: any, op: string, arg: string, contestar: (t: string, a?: boolean) => Promise<unknown>) {
  const chat = q.message.chat.id, user = q.from.id;
  if (op === 'des' || op === 'ocu') {
    if (op === 'des') {
      await db.from('noticias').update({ destacada: false }).eq('destacada', true);
      await db.from('noticias').update({ destacada: true }).eq('id', arg);
    } else {
      await db.from('noticias').update({ visible: false, destacada: false }).eq('id', arg);
    }
    await tg('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    return contestar(op === 'des' ? 'Listo: ahora es la noticia destacada.' : 'Listo: se quitó de la app.');
  }
  const b = await borrador(chat, user);
  if (op === 'can') {
    await soltar(chat, user);
    await tg('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    return contestar('Cancelado.');
  }
  if (!b || b.tipo !== 'noticia') return contestar('Esta captura ya no está activa. Empieza con /noticia.', true);
  if (op === 'cat') {
    await guardar(chat, user, 'noticia', 'titulo', { ...b.datos, categoria: arg });
    await tg('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    await preguntar(chat, `Tipo: <b>${CATEGORIA[arg] ?? arg}</b>. Escribe el <b>título</b> de la noticia:`);
    return contestar('');
  }
  if (op === 'pub' && b.paso === 'confirmar') {
    const d = b.datos as Record<string, string>;
    let foto: string | null = null;
    if (d.foto_id) {
      const archivo = await tgArchivo(d.foto_id);
      if (archivo) {
        const ruta = `${crypto.randomUUID()}.jpg`;
        const { error } = await db.storage.from('noticias').upload(ruta, archivo, { contentType: 'image/jpeg' });
        if (!error) foto = ruta;
      }
    }
    const { error } = await db.from('noticias').insert({ categoria: d.categoria, titulo: d.titulo, texto: d.texto, foto, autor: d.autor });
    if (error) return contestar('No se pudo publicar. Intenta de nuevo.', true);
    await soltar(chat, user);
    await tg('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: `Publicada en la app: <b>${escapar(d.titulo)}</b>. Les llegará aviso a quienes lo tengan activado.` });
    return contestar('Publicada.');
  }
  return contestar('');
}

// deno-lint-ignore no-explicit-any
async function botonNecesidad(q: any, op: string, arg: string, contestar: (t: string, a?: boolean) => Promise<unknown>) {
  const chat = q.message.chat.id;
  if (op === 'ok') {
    await tg('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    return contestar('Lista guardada.');
  }
  if (op === 'a') {
    await guardar(chat, q.from.id, 'necesidad', 'agregar', {});
    await preguntar(chat, 'Escribe la necesidad. Empieza con <b>!</b> si es urgente (ej.: <code>!Guantes talla G</code>):');
    return contestar('');
  }
  const id = Number(arg);
  if (op === 'u') {
    const { data } = await db.from('necesidades').select('urgente').eq('id', id).maybeSingle();
    await db.from('necesidades').update({ urgente: !data?.urgente, actualizado_en: new Date().toISOString() }).eq('id', id);
  }
  if (op === 'd') await db.from('necesidades').update({ activa: false, actualizado_en: new Date().toISOString() }).eq('id', id);
  await listaNecesidades(chat, q.message.message_id);
  return contestar('Actualizado.');
}
