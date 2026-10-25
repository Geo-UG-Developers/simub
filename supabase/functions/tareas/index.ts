// Cada minuto (pg_cron): escalamiento, avisos al ciudadano, recordatorios y noticias.
// Sin secreto: solo procesa lo que ya venció; llamarla de más no hace nada.
import { chatDe, db, tg, tgFoto } from '../_shared/servicios.ts';
import { datosAlerta, primeraFoto, responderAlerta } from '../_shared/alerta.ts';
import { avisarNoticias, enviarAvisos } from '../_shared/avisos.ts';
import { textoAlerta } from '../_shared/mensajes.ts';

Deno.serve(async () => {
  const r = { escalados: 0, avisos: 0, noticias: 0 };
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
  return Response.json(r);
});
