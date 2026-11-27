// Cada minuto (pg_cron): escalamiento, avisos al ciudadano, recordatorios y noticias.
// Sin secreto: solo procesa lo que ya venció; llamarla de más no hace nada.
import { chatDe, db, PANEL_URL, tg, tgFoto } from '../_shared/servicios.ts';
import { datosAlerta, primeraFoto, responderAlerta } from '../_shared/alerta.ts';
import { avisarNoticias, enviarAvisos } from '../_shared/avisos.ts';
import { textoAlerta } from '../_shared/mensajes.ts';
import { resumenTurno } from '../_shared/servicio_tg.ts';

Deno.serve(async () => {
  const r = { escalados: 0, avisos: 0, noticias: 0, voluntarios: 0, resumen: false };
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
  try { r.resumen = await resumenTurno(); } catch (e) { console.error('resumen turno', e); }
  // Eventos sensibles del control interno: aviso privado a los Admin. Maestro vinculados al bot.
  try {
    const { data: ev } = await db.rpc('auditoria_por_avisar');
    const lista = (ev ?? []) as { quien: string | null; accion: string; registro: string | null; en: string }[];
    if (lista.length) {
      const { data: admins } = await db.rpc('admins_telegram');
      const TXT: Record<string, string> = { respaldo_descargado: 'descargó la copia completa del año', cuenta_borrada: 'borró una cuenta del panel',
        cuenta_cambiada: 'cambió una cuenta (rol o contraseña)', auditoria_borrada: 'borró registros del control interno', persona_borrada: 'borró a una persona del personal',
        edicion_autorizada: 'autorizó corregir un parte cerrado', acceso_desbloqueado: 'desbloqueó una cuenta' };
      const texto = '🔐 <b>Control interno SIMUB</b>\n' + lista.slice(0, 15).map((x) =>
        `• ${new Date(x.en).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${(x.quien ?? 'sistema').replace(/[<>&]/g, '')} ${TXT[x.accion] ?? x.accion}`).join('\n');
      for (const chat of (admins as number[] | null) ?? []) await tg('sendMessage', { chat_id: chat, text: texto, parse_mode: 'HTML' });
    }
  } catch (e) { console.error('avisos de control interno', e); }
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
