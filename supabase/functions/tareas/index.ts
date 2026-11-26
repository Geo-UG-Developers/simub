// Cada minuto (pg_cron): escalamiento, avisos al ciudadano, recordatorios y noticias.
// Sin secreto: solo procesa lo que ya venció; llamarla de más no hace nada.
import { chatDe, db, PANEL_URL, tg, tgFoto } from '../_shared/servicios.ts';
import { datosAlerta, primeraFoto, responderAlerta } from '../_shared/alerta.ts';
import { avisarNoticias, enviarAvisos } from '../_shared/avisos.ts';
import { textoAlerta } from '../_shared/mensajes.ts';

Deno.serve(async () => {
  const r = { escalados: 0, avisos: 0, noticias: 0, voluntarios: 0 };
  try {
    const { data, error } = await db.rpc('escalar_pendientes');
    if (error) throw error;
    const respaldo = await chatDe('respaldo');
    for (const rep of (data ?? []) as { id: string; folio: string; fotos: string[] }[]) {
      await responderAlerta(rep.id, `<b>Sin respuesta.</b> El reporte ${rep.folio} lleva más de 10 minutos sin que nadie toque «Visto».` +
        (respaldo ? '\nSe avisó al grupo de respaldo.' : ''));
      if (respaldo) {
        const d = await datosAlerta(rep.id);
        if (d) {
          const txt = `<b>RESPALDO · sin respuesta de la estación en 10 min</b>\n${textoAlerta(d)}`.slice(0, 1024);
          const foto = await primeraFoto(rep.fotos?.[0]);
          if (foto) await tgFoto(respaldo, foto, txt);
          else await tg('sendMessage', { chat_id: respaldo, text: txt, parse_mode: 'HTML', disable_web_page_preview: true });
        }
      }
      r.escalados++;
    }
  } catch (e) { console.error('escalamiento', e); }
  try { r.avisos = await enviarAvisos(); } catch (e) { console.error('avisos', e); }
  try { r.noticias = await avisarNoticias(); } catch (e) { console.error('noticias', e); }
  // Solicitudes de voluntariado: aviso breve al grupo de comunicación (sin teléfono ni correo).
  try {
    const { data } = await db.rpc('voluntarios_por_avisar');
    const chat = (data ?? []).length ? (await chatDe('comunicacion')) ?? (await chatDe('alertas')) : null;
    for (const v of (data ?? []) as { id: string; nombre: string; edad: number; disponibilidad: string[] }[]) {
      const ini = v.nombre.trim().split(/\s+/); const corto = ini[0] + (ini[1] ? ` ${ini[1][0]}.` : '');
      if (chat) await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true,
        text: `<b>Nueva solicitud de voluntariado</b>\n${corto.replace(/[<>&]/g, '')} · ${v.edad} años${v.disponibilidad?.length ? ` · ${v.disponibilidad.join(', ')}` : ''}\nDatos de contacto en el panel: ${PANEL_URL}#voluntarios` });
      await db.from('voluntarios').update({ avisado_en: new Date().toISOString() }).eq('id', v.id);
      r.voluntarios++;
    }
  } catch (e) { console.error('voluntarios', e); }
  return Response.json(r);
});
