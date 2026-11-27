-- Auditoría de seguridad (nov. 2026):
-- 1) La copia completa del año solo la descarga el Admin. Maestro (o el desarrollador) y ya no incluye
--    los códigos del enlace del bot ni los números internos de Telegram del personal.
-- 2) Aviso por Telegram a los Admin. Maestro de eventos sensibles (copias descargadas, cuentas borradas,
--    contraseñas cambiadas, registros de auditoría borrados, bloqueos de acceso).
create or replace function panel_respaldo(p_anio int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not (es_admin() or es_super()) then raise exception 'solo_admin' using errcode = '42501'; end if;
  r := jsonb_build_object(
    'generado', now(), 'anio', p_anio, 'por', quien_soy(), 'version', 1,
    'servicios', coalesce((select jsonb_agg(to_jsonb(s) - 'creado_por' - 'tg_chat_id' - 'tg_message_id' order by s.folio) from servicios s where s.anio = p_anio), '[]'),
    'bitacora', coalesce((select jsonb_agg(jsonb_build_object('servicio', s.anio || '-' || s.folio, 'texto', b.texto, 'autor', b.autor, 'en', b.en) order by b.en)
                 from bitacora b join servicios s on s.id = b.servicio_id where s.anio = p_anio), '[]'),
    'revisiones', coalesce((select jsonb_agg(to_jsonb(v) - 'autor' - 'tg_chat_id' - 'tg_message_id' order by v.creado_en) from revisiones v
                 where extract(year from v.creado_en) = p_anio), '[]'),
    'reportes_app', coalesce((select jsonb_agg(jsonb_build_object('folio', x.folio, 'tipo', x.tipo, 'estado', x.estado, 'creado_en', x.creado_en,
                 'referencia', x.referencia, 'lat', x.lat, 'lon', x.lon, 'resumen', x.detalles->'resumen') order by x.creado_en)
                 from reportes x where extract(year from x.creado_en) = p_anio), '[]'),
    'unidades', coalesce((select jsonb_agg(to_jsonb(u) order by u.nombre) from unidades u), '[]'),
    'personal', coalesce((select jsonb_agg(to_jsonb(u) - 'tg_chat_id' - 'tg_codigo' order by u.nombre) from personal u), '[]'),
    'colonias', coalesce((select jsonb_agg(u.nombre order by u.nombre) from colonias u), '[]'),
    'catalogo', coalesce((select jsonb_agg(to_jsonb(c) order by c.orden) from catalogo_servicios c), '[]'));
  perform auditar('respaldo_descargado', 'servicios', p_anio::text, jsonb_build_object('servicios', jsonb_array_length(r->'servicios')));
  return r;
end $$;

-- Eventos sensibles aún no avisados (los lee la tarea de cada minuto con la llave del servidor).
create or replace function auditoria_por_avisar() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_ult bigint; r jsonb;
begin
  select coalesce((valor->>'id')::bigint, (select coalesce(max(id), 0) from auditoria)) into v_ult from config_privada where clave = 'aviso_auditoria';
  if v_ult is null then select coalesce(max(id), 0) into v_ult from auditoria; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'quien', quien, 'accion', accion, 'registro', registro, 'en', en) order by id), '[]') into r
  from auditoria where id > v_ult and accion in ('respaldo_descargado', 'cuenta_borrada', 'cuenta_cambiada', 'auditoria_borrada',
    'persona_borrada', 'edicion_autorizada', 'acceso_desbloqueado');
  insert into config_privada (clave, valor) values ('aviso_auditoria', jsonb_build_object('id', greatest(v_ult, coalesce((select max(id) from auditoria), 0))))
  on conflict (clave) do update set valor = excluded.valor;
  return r;
end $$;
revoke execute on function auditoria_por_avisar() from public, anon, authenticated;
