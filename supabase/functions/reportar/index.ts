// Entrada de la app ciudadana (sesión anónima): reportes, información extra y revisiones.
import { CORS, db, json } from '../_shared/servicios.ts';
import { avisarRevision, enviarAlerta, responderAlerta } from '../_shared/alerta.ts';
import { escapar, fechaMx } from '../_shared/mensajes.ts';

const TIPOS = ['incendio', 'accidente', 'gas', 'fauna', 'infraestructura', 'otra'];
const MOTIVOS = ['gas', 'electrica', 'extintores', 'plan_pc', 'evento', 'otro'];
const MIME = ['image/jpeg', 'image/webp', 'image/png'];
const MAX_BYTES = 3 * 1024 * 1024;
const txt = (v: FormDataEntryValue | null, n = 500) => (v ? String(v).trim().slice(0, n) : null);

function limpiarDetalles(crudo: string | null): Record<string, unknown> {
  try {
    const d = JSON.parse(crudo ?? '{}');
    const resumen = Array.isArray(d.resumen) ? d.resumen.filter((x: unknown) => typeof x === 'string').slice(0, 10).map((x: string) => x.slice(0, 140)) : [];
    const valores = d.valores && typeof d.valores === 'object' ? d.valores : {};
    const s = JSON.stringify({ valores, resumen });
    return s.length < 4000 ? { valores, resumen } : { resumen };
  } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: s } = await db.auth.getUser(jwt);
  const usuario = s?.user;
  if (!usuario) return json({ error: 'sesion' }, 401);

  let f: FormData;
  try { f = await req.formData(); } catch { return json({ error: 'formato' }, 400); }
  const accion = String(f.get('accion') ?? 'reporte');

  if (accion === 'reporte') {
    const tipo = String(f.get('tipo') ?? '');
    const lat = Number(f.get('lat')), lon = Number(f.get('lon'));
    if (!TIPOS.includes(tipo) || !Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'datos' }, 400);
    const fotos = f.getAll('fotos').filter((x): x is File => x instanceof File).slice(0, 3);
    const rutas: string[] = [];
    for (const foto of fotos) {
      if (!MIME.includes(foto.type) || foto.size > MAX_BYTES) return json({ error: 'foto' }, 400);
      const ruta = `${usuario.id}/${crypto.randomUUID()}.${foto.type === 'image/png' ? 'png' : foto.type === 'image/webp' ? 'webp' : 'jpg'}`;
      const { error } = await db.storage.from('fotos').upload(ruta, foto, { contentType: foto.type });
      if (error) { console.error('subir foto', error.message); return json({ error: 'foto' }, 500); }
      rutas.push(ruta);
    }
    const { data: r, error } = await db.rpc('registrar_reporte', {
      p_autor: usuario.id, p_tipo: tipo, p_lat: lat, p_lon: lon,
      p_precision_m: f.get('precision') ? Math.round(Number(f.get('precision'))) : null,
      p_detalles: limpiarDetalles(txt(f.get('detalles'), 6000)), p_comentario: txt(f.get('comentario'), 1000),
      p_referencia: txt(f.get('referencia'), 200), p_nombre: txt(f.get('nombre'), 120), p_telefono: txt(f.get('telefono'), 30),
      p_anonimo: f.get('anonimo') === '1', p_fotos: rutas,
    });
    if (error) {
      const limite = error.message === 'limite_reportes';
      return json({ error: limite ? 'limite' : 'servidor' }, limite ? 429 : 500);
    }
    await enviarAlerta(r.id, fotos[0]);
    return json(r);
  }

  if (accion === 'agregar') {
    const id = String(f.get('reporte') ?? ''), texto = txt(f.get('texto'), 800);
    if (!texto) return json({ error: 'datos' }, 400);
    const { data: rep } = await db.from('reportes').select('id, folio').eq('id', id).eq('autor', usuario.id).maybeSingle();
    if (!rep) return json({ error: 'no_existe' }, 404);
    const { count } = await db.from('agregados').select('id', { count: 'exact', head: true }).eq('reporte_id', id);
    if ((count ?? 0) >= 10) return json({ error: 'limite' }, 429);
    await db.from('agregados').insert({ reporte_id: id, texto });
    await responderAlerta(id, `<b>Información agregada por quien reportó</b> (${escapar(rep.folio)}):\n«${escapar(texto)}»`);
    return json({ ok: true });
  }

  if (accion === 'revision') {
    const motivos = f.getAll('motivos').map(String).filter((m) => MOTIVOS.includes(m));
    const { data: r, error } = await db.rpc('solicitar_revision', {
      p_autor: usuario.id, p_motivos: motivos, p_inmueble: txt(f.get('inmueble'), 80), p_direccion: txt(f.get('direccion'), 300),
      p_horario: txt(f.get('horario'), 120), p_nombre: txt(f.get('nombre'), 120), p_telefono: txt(f.get('telefono'), 30),
      p_comentario: txt(f.get('comentario'), 800),
    });
    if (error) {
      const limite = error.message === 'limite_reportes';
      return json({ error: limite ? 'limite' : error.message === 'datos' ? 'datos' : 'servidor' }, limite ? 429 : 400);
    }
    await avisarRevision(r.id);
    return json(r);
  }

  if (accion === 'responder_revision') {
    const cliente = (await import('npm:@supabase/supabase-js@2.45.4')).createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
    const confirmar = f.get('confirmar') === '1';
    const { data: r, error } = await cliente.rpc('responder_revision', {
      p_revision: String(f.get('revision') ?? ''), p_confirmar: confirmar, p_nota: txt(f.get('nota'), 300),
    });
    if (error) return json({ error: error.message }, 409);
    await avisarRevision(r.id, confirmar
      ? `<b>${escapar(r.nombre)}</b> confirmó la visita del ${escapar(r.fecha ? fechaMx(r.fecha) : '')}.`
      : `<b>${escapar(r.nombre)}</b> pidió otra fecha${f.get('nota') ? `: «${escapar(String(f.get('nota')))}»` : ''}.`);
    return json({ ok: true, estado: r.estado });
  }
  return json({ error: 'accion' }, 400);
});
