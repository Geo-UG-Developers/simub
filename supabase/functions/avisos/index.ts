// Llave pública para que el navegador se suscriba a los avisos.
import { llavesVapid } from '../_shared/avisos.ts';
import { CORS } from '../_shared/servicios.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const { publica } = await llavesVapid();
  return Response.json({ publicKey: publica }, { headers: { ...CORS, 'cache-control': 'public, max-age=3600' } });
});
