// Acciones del panel que también tocan Telegram o los avisos:
// cambiar estado / deshacer (mismas reglas que el bot) y notificar cambios en revisiones.
import { chatDe, CORS, db, json, tg } from '../_shared/servicios.ts';
import { ES_CIERRE, escapar, fechaMx, type Estado } from '../_shared/mensajes.ts';
import { actualizarAlerta, avisarRevision, datosAlerta, enviarAlerta, pedirParte, primeraFoto } from '../_shared/alerta.ts';
import { enviarAvisos } from '../_shared/avisos.ts';
import { avisarServicio, enviarInterno, enviarOficial, pedirApoyo } from '../_shared/servicio_tg.ts';

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
  if (b.accion === 'servicio') {   // envía o actualiza el mensaje del folio en el grupo interno
    if (typeof b.servicio !== 'string') return json({ error: 'datos' }, 400);
    await avisarServicio(b.servicio);
    return json({ ok: true });
  }
  if (b.accion === 'interno') {   // resumen sin datos personales al grupo de comunicación interna
    if (typeof b.servicio !== 'string') return json({ error: 'datos' }, 400);
    return (await enviarInterno(b.servicio, actor)) ? json({ ok: true }) : json({ error: 'sin_grupo' }, 409);
  }
  if (b.accion === 'oficial') {   // mensaje privado a oficiales a cargo
    if (typeof b.servicio !== 'string' || !Array.isArray(b.oficiales) || !b.oficiales.length) return json({ error: 'datos' }, 400);
    return json({ ok: true, ...(await enviarOficial(b.servicio, b.oficiales.map(Number), actor)) });
  }
  if (b.accion === 'cuenta') {   // alta o cambio de cuenta del panel (Admin. Maestro o desarrollador)
    const { data: yo } = await db.from('miembros_panel').select('rol, superusuario').eq('user_id', u.id).maybeSingle();
    if (yo?.rol !== 'admin' && !yo?.superusuario) return json({ error: 'solo_admin' }, 403);
    const ROLES = ['admin', 'coordinador', 'guardia', 'campo'];
    if (!ROLES.includes(b.rol) || !String(b.nombre ?? '').trim()) return json({ error: 'datos' }, 400);
    let uid = b.user_id as string | undefined;
    if (!uid) {
      const email = String(b.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || String(b.password ?? '').length < 10) return json({ error: 'datos' }, 400);
      const { data: nu, error } = await db.auth.admin.createUser({ email, password: String(b.password), email_confirm: true });
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'ya_existe' : error.message }, 409);
      uid = nu.user!.id;
    } else if (b.password) {
      if (String(b.password).length < 10) return json({ error: 'datos' }, 400);
      const { error } = await db.auth.admin.updateUserById(uid, { password: String(b.password) });
      if (error) return json({ error: error.message }, 409);
    }
    const fila: Record<string, unknown> = { user_id: uid, rol: b.rol, nombre: String(b.nombre).trim(), cargo: b.cargo || null, unidad: b.unidad || null };
    fila.cambiar_clave = false;   // contraseñas fijas: solo el Admin. Maestro las asigna
    const { error: e2 } = await db.from('miembros_panel').upsert(fila);
    if (e2) return json({ error: e2.message }, 409);
    await db.from('auditoria').insert({ user_id: u.id, quien: actor, accion: b.user_id ? 'cuenta_cambiada' : 'cuenta_creada', tabla: 'miembros_panel', registro: uid,
      detalle: { nombre: b.nombre, rol: b.rol, contrasena_cambiada: Boolean(b.password) } });
    return json({ ok: true, user_id: uid });
  }
  if (b.accion === 'cuenta_borrar') {   // baja de una cuenta del panel (no la propia ni la del desarrollador)
    const { data: yo } = await db.from('miembros_panel').select('rol, superusuario').eq('user_id', u.id).maybeSingle();
    if (yo?.rol !== 'admin' && !yo?.superusuario) return json({ error: 'solo_admin' }, 403);
    if (typeof b.user_id !== 'string' || b.user_id === u.id) return json({ error: 'datos' }, 400);
    const { data: m } = await db.from('miembros_panel').select('nombre, rol, superusuario').eq('user_id', b.user_id).maybeSingle();
    if (m?.superusuario) return json({ error: 'protegida' }, 409);
    await db.from('miembros_panel').delete().eq('user_id', b.user_id);
    await db.auth.admin.deleteUser(b.user_id).catch(() => null);
    await db.from('auditoria').insert({ user_id: u.id, quien: actor, accion: 'cuenta_borrada', tabla: 'miembros_panel', registro: b.user_id, detalle: m ?? {} });
    return json({ ok: true });
  }
  if (b.accion === 'invitar') {   // invitación de un solo uso al grupo, por Telegram privado a los vinculados
    const { data: yo } = await db.from('miembros_panel').select('rol, superusuario').eq('user_id', u.id).maybeSingle();
    if (yo?.rol !== 'admin' && !yo?.superusuario) return json({ error: 'solo_admin' }, 403);
    if (!['alertas', 'interno'].includes(b.grupo) || !Array.isArray(b.personas) || !b.personas.length) return json({ error: 'datos' }, 400);
    const chat = await chatDe(b.grupo); if (!chat) return json({ error: 'sin_grupo' }, 409);
    const NOM: Record<string, string> = { alertas: 'Reportes de la app SIMUB', interno: 'Comunicación interna SIMUB' };
    const { data: ps } = await db.from('personal').select('id, nombre, nombre_corto, telefono, tg_chat_id').in('id', b.personas.map(Number));
    const res: { nombre: string; enlace: string | null; enviado: boolean; telefono: string | null }[] = [];
    for (const p of ps ?? []) {
      const nombre = p.nombre_corto ?? p.nombre;
      const r = await tg('createChatInviteLink', { chat_id: chat, name: nombre.slice(0, 32), member_limit: 1, expire_date: Math.floor(Date.now() / 1000) + 7 * 86400 });
      const enlace: string | null = r.ok ? r.result.invite_link : null;
      let enviado = false;
      if (enlace && p.tg_chat_id) {
        const m = await tg('sendMessage', { chat_id: p.tg_chat_id, text: `Te invitan al grupo «${NOM[b.grupo]}». El enlace es personal y sirve una sola vez (7 días):`,
          reply_markup: { inline_keyboard: [[{ text: 'Unirme al grupo', url: enlace }]] } });
        enviado = Boolean(m.ok);
      }
      res.push({ nombre, enlace, enviado, telefono: p.telefono });
    }
    await db.from('auditoria').insert({ user_id: u.id, quien: actor, accion: 'invitaciones_grupo', tabla: 'chats', registro: b.grupo, detalle: { personas: res.map((x) => x.nombre) } });
    if (res.length && res.every((x) => !x.enlace)) return json({ error: 'bot_sin_permiso' }, 409);
    return json({ ok: true, resultado: res });
  }
  if (b.accion === 'apoyo') {
    if (typeof b.servicio !== 'string' || !String(b.texto ?? '').trim()) return json({ error: 'datos' }, 400);
    const ok = await pedirApoyo(b.servicio, String(b.texto).slice(0, 500), actor);
    return ok ? json({ ok: true }) : json({ error: 'sin_grupo' }, 409);
  }
  if (b.accion === 'firms') {   // focos de calor NASA FIRMS (últimas 48 h) en el municipio
    const { data: k } = await db.from('config_privada').select('valor').eq('clave', 'firms').maybeSingle();
    const llave = k?.valor?.llave;
    if (!llave) return json({ error: 'sin_llave' }, 409);
    const fuentes = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'];
    const puntos: Record<string, string>[] = [];
    for (const f of fuentes) {
      try {
        const t = await (await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${llave}/${f}/-101.55,20.80,-101.05,21.30/2`, { signal: AbortSignal.timeout(12000) })).text();
        const [cab, ...filas] = t.trim().split('\n'); if (!cab?.includes('latitude')) continue;
        const cols = cab.split(',');
        for (const fl of filas) { const v = fl.split(','); puntos.push({ ...Object.fromEntries(cols.map((c, i) => [c, v[i]])), fuente: f }); }
      } catch { /* la fuente puede fallar; se usan las demás */ }
    }
    return json({ ok: true, puntos });
  }
  if (b.accion === 'limpiar') {   // antes de salir a producción: borra lo capturado en pruebas
    if (m.rol !== 'admin') return json({ error: 'solo_admin' }, 403);
    const { createClient } = await import('npm:@supabase/supabase-js@2.45.4');
    const comoUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
    const { data, error } = await comoUsuario.rpc('limpiar_datos_prueba');
    if (error) return json({ error: error.message }, 409);
    const fotos = (data.fotos ?? []) as string[];
    for (let i = 0; i < fotos.length; i += 100) await db.storage.from('fotos').remove(fotos.slice(i, i + 100));
    return json({ ok: true, reportes: data.reportes, revisiones: data.revisiones, fotos: fotos.length });
  }
  if (b.accion === 'reenviar') {   // reporte que llegó cuando el grupo aún no estaba vinculado
    const d = await datosAlerta(b.reporte);
    if (!d) return json({ error: 'no_existe' }, 404);
    await enviarAlerta(b.reporte, await primeraFoto(d.fotos?.[0]));
    const despues = await datosAlerta(b.reporte);
    return despues?.tg_message_id ? json({ ok: true }) : json({ error: 'sin_grupo' }, 409);
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
