// Conexiones del servidor: base de datos (service_role) y API de Telegram.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

export const PANEL_URL = 'https://geo-ug-developers.github.io/simub/panel.html';
const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const API = `https://api.telegram.org/bot${TOKEN}`;

// deno-lint-ignore no-explicit-any
export async function tg(metodo: string, cuerpo: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${API}/${metodo}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({ ok: false, description: `http ${r.status}` }));
  if (!j.ok) console.error(`telegram ${metodo}`, j.description);
  return j;
}

/** Envía una foto (bytes) con texto y botones. */
// deno-lint-ignore no-explicit-any
export async function tgFoto(chatId: number, foto: Blob, caption: string, teclado?: unknown, responderA?: number): Promise<any> {
  const f = new FormData();
  f.append('chat_id', String(chatId));
  f.append('photo', foto, 'foto.jpg');
  f.append('caption', caption);
  f.append('parse_mode', 'HTML');
  if (teclado) f.append('reply_markup', JSON.stringify(teclado));
  if (responderA) f.append('reply_to_message_id', String(responderA));
  const r = await fetch(`${API}/sendPhoto`, { method: 'POST', body: f });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) console.error('telegram sendPhoto', j.description);
  return j;
}

/** Descarga un archivo que alguien mandó al bot. */
export async function tgArchivo(fileId: string): Promise<Blob | null> {
  const r = await tg('getFile', { file_id: fileId });
  if (!r.ok) return null;
  const a = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${r.result.file_path}`);
  return a.ok ? await a.blob() : null;
}

/** Secreto del webhook derivado del token del bot. */
export async function secretoWebhook(): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`simub-webhook:${TOKEN}`));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

/** Chat de Telegram vinculado a un rol (alertas, comunicacion, respaldo). */
export async function chatDe(rol: string): Promise<number | null> {
  const { data } = await db.from('chats').select('chat_id').eq('rol', rol).maybeSingle();
  return data?.chat_id ?? null;
}
export async function rolDeChat(chatId: number): Promise<string | null> {
  const { data } = await db.from('chats').select('rol').eq('chat_id', chatId).maybeSingle();
  return data?.rol ?? null;
}

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
export const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });
