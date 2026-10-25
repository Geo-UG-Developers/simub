-- SIMUB · Lógica: reportes, estados, deshacer, escalamiento, revisiones y avisos.

create or replace function cfg_max_reportes_hora() returns int language sql immutable as $$ select 5 $$;
create or replace function cfg_minutos_escalar() returns int language sql immutable as $$ select 10 $$;
create or replace function cfg_minutos_deshacer() returns int language sql immutable as $$ select 2 $$;

create or replace function orden_estado(e estado_reporte) returns int language sql immutable as $$
  select case e when 'enviado' then 0 when 'visto' then 1 when 'en_camino' then 2
                when 'atendiendo' then 3 when 'cerrado' then 4 when 'falso' then 4 end
$$;
create or replace function es_cierre(e estado_reporte) returns boolean language sql immutable as $$
  select e in ('cerrado', 'falso')
$$;

-- ------------------------------------------------------------ registrar (lo llama la función "reportar")
create or replace function registrar_reporte(
  p_autor uuid, p_tipo tipo_reporte, p_lat double precision, p_lon double precision,
  p_precision_m int default null, p_detalles jsonb default '{}', p_comentario text default null,
  p_referencia text default null, p_nombre text default null, p_telefono text default null,
  p_anonimo boolean default false, p_fotos text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v reportes%rowtype;
begin
  if (select count(*) from reportes where autor = p_autor and creado_en > now() - interval '1 hour')
     >= cfg_max_reportes_hora() then
    raise exception 'limite_reportes' using errcode = 'P0001';
  end if;
  insert into reportes (autor, tipo, lat, lon, precision_m, detalles, comentario, referencia, nombre, telefono, anonimo, fotos)
  values (p_autor, p_tipo, p_lat, p_lon, p_precision_m, coalesce(p_detalles, '{}'), nullif(trim(p_comentario), ''),
          nullif(trim(p_referencia), ''),
          case when p_anonimo then null else nullif(trim(p_nombre), '') end,
          nullif(trim(p_telefono), ''), coalesce(p_anonimo, false), coalesce(p_fotos, '{}'))
  returning * into v;
  insert into eventos (reporte_id, estado, canal) values (v.id, 'enviado', 'app');
  return jsonb_build_object('id', v.id, 'folio', v.folio, 'estado', v.estado, 'creado_en', v.creado_en);
end $$;
revoke execute on function registrar_reporte(uuid, tipo_reporte, double precision, double precision, int, jsonb, text, text, text, text, boolean, text[]) from public, anon, authenticated;

-- ------------------------------------------------------------ cambiar estado (Telegram y panel)
create or replace function cambiar_estado(p_reporte uuid, p_estado estado_reporte, p_actor text, p_canal canal_evento)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v reportes%rowtype;
begin
  select * into v from reportes where id = p_reporte for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if es_cierre(v.estado) then raise exception 'cerrado' using errcode = 'P0001'; end if;
  if p_estado = 'enviado' or (p_estado <> 'falso' and orden_estado(p_estado) <= orden_estado(v.estado)) then
    raise exception 'transicion_invalida' using errcode = 'P0001';
  end if;
  update reportes set estado = p_estado, actualizado_en = now() where id = p_reporte;
  insert into eventos (reporte_id, estado, actor, canal) values (p_reporte, p_estado, left(p_actor, 120), p_canal);
  return jsonb_build_object('estado', p_estado, 'anterior', v.estado);
end $$;
revoke execute on function cambiar_estado(uuid, estado_reporte, text, canal_evento) from public, anon, authenticated;

create or replace function deshacer_estado(p_reporte uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u eventos%rowtype; previo estado_reporte;
begin
  perform 1 from reportes where id = p_reporte for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  select * into u from eventos where reporte_id = p_reporte and estado <> 'enviado'
  order by creado_en desc, id desc limit 1;
  if not found then raise exception 'nada_que_deshacer' using errcode = 'P0001'; end if;
  if u.creado_en < now() - make_interval(mins => cfg_minutos_deshacer()) then
    raise exception 'tiempo_vencido' using errcode = 'P0001';
  end if;
  delete from eventos where id = u.id;
  select estado into previo from eventos where reporte_id = p_reporte order by creado_en desc, id desc limit 1;
  update reportes set estado = coalesce(previo, 'enviado'), actualizado_en = now() where id = p_reporte;
  return jsonb_build_object('deshecho', u.estado, 'estado', coalesce(previo, 'enviado'), 'por', left(p_actor, 120));
end $$;
revoke execute on function deshacer_estado(uuid, text) from public, anon, authenticated;

create or replace function puede_deshacer(p_reporte uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select e.creado_en > now() - make_interval(mins => cfg_minutos_deshacer())
                   from eventos e where e.reporte_id = p_reporte and e.estado <> 'enviado'
                   order by e.creado_en desc, e.id desc limit 1), false)
$$;
revoke execute on function puede_deshacer(uuid) from public, anon, authenticated;

-- Todo lo que el bot necesita para dibujar la alerta.
create or replace function datos_alerta(p_reporte uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', r.id, 'folio', r.folio, 'tipo', r.tipo, 'estado', r.estado, 'detalles', r.detalles,
    'comentario', r.comentario, 'referencia', r.referencia, 'lat', round(r.lat::numeric, 5), 'lon', round(r.lon::numeric, 5),
    'precision_m', r.precision_m, 'nombre', r.nombre, 'telefono', r.telefono, 'anonimo', r.anonimo,
    'fotos', to_jsonb(r.fotos), 'creado_en', r.creado_en, 'tg_chat_id', r.tg_chat_id, 'tg_message_id', r.tg_message_id,
    'tiene_parte', exists (select 1 from partes_servicio p where p.reporte_id = r.id),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('estado', e.estado, 'actor', e.actor, 'en', e.creado_en)
                           order by e.creado_en, e.id) from eventos e where e.reporte_id = r.id and e.estado <> 'enviado'), '[]'))
  from reportes r where r.id = p_reporte
$$;
revoke execute on function datos_alerta(uuid) from public, anon, authenticated;

create or replace function vincular_chat(p_codigo text, p_chat_id bigint) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_rol text;
begin
  select rol into v_rol from chats where codigo = upper(trim(p_codigo));
  if not found then raise exception 'codigo_invalido' using errcode = 'P0002'; end if;
  update chats set chat_id = null, vinculado_en = null where chat_id = p_chat_id and rol <> v_rol;
  update chats set chat_id = p_chat_id, vinculado_en = now() where rol = v_rol;
  return v_rol;
end $$;
revoke execute on function vincular_chat(text, bigint) from public, anon, authenticated;

-- Reportes que llevan 10 min sin que nadie toque "Visto". Se marcan para escalar una sola vez.
create or replace function escalar_pendientes() returns setof reportes
language sql security definer set search_path = public, extensions as $$
  update reportes set escalado_en = now()
  where estado = 'enviado' and escalado_en is null
    and creado_en < now() - make_interval(mins => cfg_minutos_escalar())
    and creado_en > now() - interval '1 day'
  returning *
$$;
revoke execute on function escalar_pendientes() from public, anon, authenticated;

-- ------------------------------------------------------------ lo que ve el ciudadano
-- Los cierres aparecen hasta que vence el plazo de deshacer (así un error corregido no le llega).
create or replace function mis_reportes() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with vis as (
    select e.* from eventos e join reportes r on r.id = e.reporte_id
    where r.autor = auth.uid()
      and not (es_cierre(e.estado) and e.creado_en > now() - make_interval(mins => cfg_minutos_deshacer()))
  )
  select coalesce(jsonb_agg(x order by x->>'creado_en' desc), '[]') from (
    select jsonb_build_object(
      'id', r.id, 'folio', r.folio, 'tipo', r.tipo, 'creado_en', r.creado_en, 'lat', r.lat, 'lon', r.lon,
      'estado', coalesce((select v.estado from vis v where v.reporte_id = r.id order by v.creado_en desc, v.id desc limit 1), 'enviado'),
      'eventos', coalesce((select jsonb_agg(jsonb_build_object('estado', v.estado, 'en', v.creado_en) order by v.creado_en, v.id)
                          from vis v where v.reporte_id = r.id), '[]'),
      'agregados', (select count(*) from agregados a where a.reporte_id = r.id)) x
    from reportes r where r.autor = auth.uid() order by r.creado_en desc limit 50) s
$$;
grant execute on function mis_reportes() to authenticated;

create or replace function mis_revisiones() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'folio', v.folio, 'estado', v.estado, 'motivos', v.motivos, 'direccion', v.direccion,
    'fecha', v.fecha, 'asignado', v.asignado, 'nota_estacion', v.nota_estacion, 'recomendaciones', v.recomendaciones,
    'creado_en', v.creado_en) order by v.creado_en desc), '[]')
  from revisiones v where v.autor = auth.uid()
$$;
grant execute on function mis_revisiones() to authenticated;

create or replace function registrar_push(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  insert into dispositivos_push (token, autor) values (p_token, auth.uid())
  on conflict (token) do update set autor = excluded.autor
$$;
grant execute on function registrar_push(text) to authenticated;

create or replace function quitar_suscripcion(p_token text) returns void
language sql security definer set search_path = public, extensions as $$ delete from dispositivos_push where token = p_token $$;
revoke execute on function quitar_suscripcion(text) from public, anon, authenticated;

-- Datos públicos para la app: estación, donativos, necesidades y noticias.
create or replace function info_publica() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'config', coalesce((select jsonb_object_agg(clave, valor) from config_publica), '{}'),
    'necesidades', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'articulo', articulo, 'urgente', urgente, 'cantidad', cantidad)
                             order by urgente desc, orden, id) from necesidades where activa), '[]'),
    'noticias', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'categoria', categoria, 'titulo', titulo, 'texto', texto,
                           'foto', foto, 'destacada', destacada, 'publicada_en', publicada_en) order by destacada desc, publicada_en desc)
                          from (select * from noticias where visible order by destacada desc, publicada_en desc limit 30) n), '[]'))
$$;
grant execute on function info_publica() to anon, authenticated;

-- ------------------------------------------------------------ revisiones de seguridad
create or replace function solicitar_revision(p_autor uuid, p_motivos text[], p_inmueble text, p_direccion text,
  p_horario text, p_nombre text, p_telefono text, p_comentario text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v revisiones%rowtype;
begin
  if (select count(*) from revisiones where autor = p_autor and creado_en > now() - interval '1 day') >= 3 then
    raise exception 'limite_reportes' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_motivos, 1), 0) = 0 or nullif(trim(p_direccion), '') is null
     or nullif(trim(p_nombre), '') is null or nullif(trim(p_telefono), '') is null then
    raise exception 'datos' using errcode = '22023';
  end if;
  insert into revisiones (autor, motivos, inmueble, direccion, horario_preferido, nombre, telefono, comentario)
  values (p_autor, p_motivos, p_inmueble, trim(p_direccion), p_horario, trim(p_nombre), trim(p_telefono), nullif(trim(p_comentario), ''))
  returning * into v;
  insert into eventos_revision (revision_id, estado, actor) values (v.id, 'solicitada', 'ciudadano');
  return jsonb_build_object('id', v.id, 'folio', v.folio, 'estado', v.estado);
end $$;
revoke execute on function solicitar_revision(uuid, text[], text, text, text, text, text, text) from public, anon, authenticated;

-- El ciudadano confirma la fecha propuesta o pide otra.
create or replace function responder_revision(p_revision uuid, p_confirmar boolean, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v revisiones%rowtype;
begin
  select * into v from revisiones where id = p_revision and autor = auth.uid() for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if v.estado <> 'propuesta' then raise exception 'transicion_invalida' using errcode = 'P0001'; end if;
  if p_confirmar then
    update revisiones set estado = 'confirmada', actualizado_en = now() where id = v.id;
    insert into eventos_revision (revision_id, estado, actor, nota, avisado_en) values (v.id, 'confirmada', 'ciudadano', p_nota, now());
  else
    update revisiones set estado = 'solicitada', fecha = null, actualizado_en = now(),
      horario_preferido = coalesce(nullif(trim(p_nota), ''), horario_preferido) where id = v.id;
    insert into eventos_revision (revision_id, estado, actor, nota, avisado_en) values (v.id, 'solicitada', 'ciudadano', coalesce(p_nota, 'Pidió otra fecha'), now());
  end if;
  return jsonb_build_object('id', v.id, 'folio', v.folio, 'estado', case when p_confirmar then 'confirmada' else 'solicitada' end,
                            'tg_chat_id', v.tg_chat_id, 'tg_message_id', v.tg_message_id, 'fecha', v.fecha, 'nombre', v.nombre);
end $$;
grant execute on function responder_revision(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------ avisos al ciudadano (push)
-- Una fila por aviso pendiente: cambios de estado de reportes (los cierres esperan 2 min),
-- cambios de revisiones hechos por la estación y recordatorios del día anterior.
create or replace function avisos_pendientes() returns table (fuente text, id bigint, ref uuid, estado text, folio text,
  tipo text, fecha timestamptz, suscripciones jsonb)
language sql stable security definer set search_path = public, extensions as $$
  select 'reporte', e.id, r.id, e.estado::text, r.folio, r.tipo::text, null::timestamptz,
         coalesce((select jsonb_agg(d.token) from dispositivos_push d where d.autor = r.autor), '[]')
  from eventos e join reportes r on r.id = e.reporte_id
  where e.avisado_en is null and e.estado <> 'enviado' and e.creado_en > now() - interval '1 day'
    and (not es_cierre(e.estado) or e.creado_en < now() - make_interval(mins => cfg_minutos_deshacer()))
    and not exists (select 1 from eventos x where x.reporte_id = e.reporte_id and (x.creado_en, x.id) > (e.creado_en, e.id))
  union all
  select 'revision', e.id, v.id, e.estado::text, v.folio, null, v.fecha,
         coalesce((select jsonb_agg(d.token) from dispositivos_push d where d.autor = v.autor), '[]')
  from eventos_revision e join revisiones v on v.id = e.revision_id
  where e.avisado_en is null and e.estado in ('propuesta', 'realizada', 'cancelada') and e.creado_en > now() - interval '3 days'
  union all
  select 'recordatorio', 0, v.id, v.estado::text, v.folio, null, v.fecha,
         coalesce((select jsonb_agg(d.token) from dispositivos_push d where d.autor = v.autor), '[]')
  from revisiones v
  where v.estado = 'confirmada' and v.recordado_en is null and v.fecha between now() + interval '12 hours' and now() + interval '30 hours'
  limit 300
$$;
revoke execute on function avisos_pendientes() from public, anon, authenticated;

create or replace function marcar_avisados(p_reportes bigint[], p_revisiones bigint[], p_recordatorios uuid[]) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update eventos set avisado_en = now() where id = any(p_reportes) and avisado_en is null;
  update eventos_revision set avisado_en = now() where id = any(p_revisiones) and avisado_en is null;
  update revisiones set recordado_en = now() where id = any(p_recordatorios);
end $$;
revoke execute on function marcar_avisados(bigint[], bigint[], uuid[]) from public, anon, authenticated;

-- Noticias nuevas para avisar a todos los suscritos.
create or replace function noticias_por_avisar() returns jsonb
language sql security definer set search_path = public, extensions as $$
  with n as (
    update noticias set avisada_en = now()
    where avisada_en is null and visible and categoria in ('evento', 'donacion', 'aviso')
      and publicada_en > now() - interval '1 day'
    returning id, titulo, categoria)
  select jsonb_build_object('noticias', coalesce((select jsonb_agg(to_jsonb(n)) from n), '[]'),
                            'suscripciones', case when exists (select 1 from n)
                              then coalesce((select jsonb_agg(token) from dispositivos_push), '[]') else '[]' end)
$$;
revoke execute on function noticias_por_avisar() from public, anon, authenticated;
