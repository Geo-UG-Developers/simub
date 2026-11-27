// Inicio de sesión del panel con límite de intentos: 5 contraseñas equivocadas → bloqueo de 30 minutos
// y se envía al correo del usuario el enlace para restablecer su contraseña.
import { CORS, db, json } from '../_shared/servicios.ts';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const PANEL = 'https://geo-ug-developers.github.io/simub/panel.html';

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
    // aviso por correo: el enlace de «restablecer contraseña» de Supabase (si la cuenta existe)
    await fetch(`${URL_SB}/auth/v1/recover?redirect_to=${encodeURIComponent(PANEL)}`, {
      method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => {});
    return json({ error: 'bloqueado', aviso: true }, 423);
  }
  return json({ error: 'credenciales', restantes: Math.max(0, 5 - Number(reg?.fallos ?? 0)) }, 401);
});
