// Revisión de salud (la llama el vigía de GitHub una vez al día).
// Hace una consulta real a la base (así Supabase no pausa el proyecto), revisa el bot
// y, si algo falla —o si es el reporte semanal—, avisa por Telegram a quien escribió /vigia al bot.
import { db, tg } from '../_shared/servicios.ts';

const APP = 'SIMUB';
Deno.serve(async (req) => {
  const semanal = new URL(req.url).searchParams.get('semanal') === '1';
  const problemas: string[] = [];
  let reportes = 0;
  const { count, error } = await db.from('reportes').select('id', { count: 'exact', head: true });
  if (error) problemas.push(`Base de datos: ${error.message}`); else reportes = count ?? 0;
  const w = await tg('getWebhookInfo', {});
  if (!w.ok) problemas.push('El bot de Telegram no responde (¿token?).');
  else {
    if (!w.result.url) problemas.push('El bot no tiene webhook configurado.');
    if (w.result.last_error_date && Date.now() / 1000 - w.result.last_error_date < 86400) problemas.push(`Error reciente del webhook: ${w.result.last_error_message}`);
    if (w.result.pending_update_count > 20) problemas.push(`Hay ${w.result.pending_update_count} mensajes del bot sin procesar.`);
  }
  const { data: chats } = await db.from('chats').select('rol, chat_id');
  if (!chats?.find((c) => c.rol === 'alertas')?.chat_id) problemas.push('El grupo de alertas no está vinculado.');
  const { data: v } = await db.from('config_privada').select('valor').eq('clave', 'vigia').maybeSingle();
  const destino = (v?.valor as { chat_id?: number } | null)?.chat_id;
  if (destino && (problemas.length || semanal)) {
    await tg('sendMessage', { chat_id: destino, parse_mode: 'HTML', text: problemas.length
      ? `<b>${APP} · revisar</b>\n${problemas.map((p) => `· ${p}`).join('\n')}`
      : `<b>${APP} funcionando</b> ✓\nBase de datos, bot y grupos en orden. ${reportes} reportes registrados en total.` });
  }
  return Response.json({ ok: problemas.length === 0, problemas, reportes }, { status: problemas.length ? 503 : 200 });
});
