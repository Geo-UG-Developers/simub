// Inicio de sesión del panel con límite de intentos: 5 contraseñas equivocadas → bloqueo de 30 minutos
// y se avisa por Telegram al Admin. Maestro (las contraseñas son fijas: no se manda enlace para cambiarla).
import { CORS, db, json, tg } from '../_shared/servicios.ts';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? '').trim().toLowerCase(), password = String(b.password ?? '');
  if (!email || !password || email.length > 200 || password.length > 200) return json({ error: 'datos' }, 400);
  const { data: e } = await db.rpc('acceso_estado', { p_email: email });
  if (e?.bloqueado_hasta) return json({ error: 'bloqueado', hasta: e.bloqueado_hasta }, 423);
  const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const s = await r.json().catch(() => ({}));
  if (r.ok && s.access_token) { await db.rpc('acceso_registrar', { p_email: email, p_ok: true }); return json({ ok: true, sesion: s }); }
  const { data: reg } = await db.rpc('acceso_registrar', { p_email: email, p_ok: false });
  if (reg?.bloqueado) {
    const { data: admins } = await db.rpc('admins_telegram');
    for (const chat of (admins as number[] | null) ?? []) {
      await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML',
        text: `⚠️ <b>Cuenta del panel bloqueada</b> 30 min por 5 contraseñas equivocadas: <code>${email.replace(/[<>&]/g, '')}</code>.\nSi no fue esa persona, cambia su contraseña en Ajustes › Cuentas.` }).catch(() => null);
    }
    return json({ error: 'bloqueado', aviso: true }, 423);
  }
  return json({ error: 'credenciales', restantes: Math.max(0, 5 - Number(reg?.fallos ?? 0)) }, 401);
});
