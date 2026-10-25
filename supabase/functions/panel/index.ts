// Acciones del panel que también tocan Telegram o los avisos:
// cambiar estado / deshacer (mismas reglas que el bot) y notificar cambios en revisiones.
import { CORS, db, json } from '../_shared/servicios.ts';
import { ES_CIERRE, escapar, fechaMx, type Estado } from '../_shared/mensajes.ts';
import { actualizarAlerta, avisarRevision, pedirParte } from '../_shared/alerta.ts';
import { enviarAvisos } from '../_shared/avisos.ts';

const ESTADOS: Estado[] = ['visto', 'en_camino', 'atendiendo', 'cerrado', 'falso'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: s } = await db.auth.getUser(jwt);
  const u = s?.user;
  if (!u || u.is_anonymous) return json({ error: 'sesion' }, 401);
  const { data: m } = await db.from('miembros_panel').select('rol, nombre').eq('user_id', u.id).maybeSingle();
  if (!m) return json({ error: 'sin_permiso' }, 403);
  const b = await req.json().catch(() => ({}));
  const actor = m.nombre || u.email || 'panel';

  if (b.accion === 'estado') {
    if (!ESTADOS.includes(b.estado)) return json({ error: 'datos' }, 400);
    if (ES_CIERRE(b.estado) && m.rol !== 'admin') return json({ error: 'solo_admin' }, 403);
    const { error } = await db.rpc('cambiar_estado', { p_reporte: b.reporte, p_estado: b.estado, p_actor: actor, p_canal: 'panel' });
    if (error) return json({ error: error.message }, 409);
    await actualizarAlerta(b.reporte);
    await pedirParte(b.reporte, b.estado);
    await enviarAvisos();
    return json({ ok: true });
  }
  if (b.accion === 'deshacer') {
    const { data: rep } = await db.from('reportes').select('estado').eq('id', b.reporte).maybeSingle();
    if (rep && ES_CIERRE(rep.estado) && m.rol !== 'admin') return json({ error: 'solo_admin' }, 403);
    const { error } = await db.rpc('deshacer_estado', { p_reporte: b.reporte, p_actor: actor });
    if (error) return json({ error: error.message }, 409);
    await actualizarAlerta(b.reporte);
    return json({ ok: true });
  }
  if (b.accion === 'revision') {   // el panel ya guardó el cambio con su RPC; aquí solo avisamos
    const { data: v } = await db.from('revisiones').select('estado, fecha, asignado').eq('id', b.revision).maybeSingle();
    if (!v) return json({ error: 'no_existe' }, 404);
    const nota = v.estado === 'propuesta' ? `Fecha propuesta por ${escapar(actor)}: <b>${escapar(fechaMx(v.fecha))}</b>${v.asignado ? ` · va ${escapar(v.asignado)}` : ''}. Esperando confirmación.`
      : v.estado === 'realizada' ? `Revisión realizada (registró ${escapar(actor)}).`
      : v.estado === 'cancelada' ? `Revisión cancelada por ${escapar(actor)}.` : undefined;
    await avisarRevision(b.revision, nota);
    await enviarAvisos();
    return json({ ok: true });
  }
  return json({ error: 'accion' }, 400);
});
