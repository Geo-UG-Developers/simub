-- SIMUB · Seguridad (RLS), funciones del panel, fotos y tarea de cada minuto.

alter table reportes enable row level security;
alter table eventos enable row level security;
alter table agregados enable row level security;
alter table revisiones enable row level security;
alter table eventos_revision enable row level security;
alter table unidades enable row level security;
alter table personal enable row level security;
alter table partes_servicio enable row level security;
alter table noticias enable row level security;
alter table necesidades enable row level security;
alter table config_publica enable row level security;
alter table config_privada enable row level security;
alter table chats enable row level security;
alter table tg_borradores enable row level security;
alter table dispositivos_push enable row level security;
alter table miembros_panel enable row level security;

-- El ciudadano no lee tablas directamente: solo funciones. Quitamos todo y damos lo justo.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create or replace function mi_rol() returns rol_panel
language sql stable security definer set search_path = public, extensions as $$
  select rol from miembros_panel where user_id = auth.uid()
$$;
grant execute on function mi_rol() to authenticated;

-- Catálogos y contenido: el personal los lee; el admin los edita desde el panel.
grant select, insert, update, delete on unidades, personal, noticias, necesidades, config_publica to authenticated;
grant usage on all sequences in schema public to authenticated;
do $$
declare t text;
begin
  foreach t in array array['unidades', 'personal', 'noticias', 'necesidades', 'config_publica'] loop
    execute format('create policy %1$s_leer on %1$s for select to authenticated using (mi_rol() is not null)', t);
    execute format('create policy %1$s_editar on %1$s for all to authenticated using (mi_rol() = ''admin'') with check (mi_rol() = ''admin'')', t);
  end loop;
end $$;
-- El coordinador también maneja noticias y necesidades.
create policy noticias_coord on noticias for all to authenticated using (mi_rol() = 'coordinador') with check (mi_rol() = 'coordinador');
create policy necesidades_coord on necesidades for all to authenticated using (mi_rol() = 'coordinador') with check (mi_rol() = 'coordinador');

-- ------------------------------------------------------------ panel: lectura
create or replace function panel_yo() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('rol', m.rol, 'nombre', coalesce(m.nombre, ''),
    'alertas_vinculado', exists (select 1 from chats where rol = 'alertas' and chat_id is not null))
  from miembros_panel m where m.user_id = auth.uid()
$$;

create or replace function panel_reportes(p_desde timestamptz default now() - interval '30 days') returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'folio', r.folio, 'tipo', r.tipo, 'estado', r.estado, 'lat', r.lat, 'lon', r.lon,
    'referencia', r.referencia, 'detalles', r.detalles, 'creado_en', r.creado_en, 'actualizado_en', r.actualizado_en,
    'escalado', r.escalado_en is not null, 'num_fotos', coalesce(array_length(r.fotos, 1), 0),
    'tiene_parte', exists (select 1 from partes_servicio p where p.reporte_id = r.id),
    'ultimo_actor', (select e.actor from eventos e where e.reporte_id = r.id and e.actor is not null order by e.creado_en desc limit 1),
    'min_a_visto', (select round(extract(epoch from min(e.creado_en) - r.creado_en) / 60)::int from eventos e where e.reporte_id = r.id and e.estado = 'visto'),
    'min_a_lugar', (select round(extract(epoch from min(e.creado_en) - r.creado_en) / 60)::int from eventos e where e.reporte_id = r.id and e.estado = 'atendiendo'),
    'min_a_cierre', (select round(extract(epoch from min(e.creado_en) - r.creado_en) / 60)::int from eventos e where e.reporte_id = r.id and e.estado = 'cerrado')
  ) order by (r.estado = 'enviado') desc, r.creado_en desc), '[]')
  from reportes r
  where mi_rol() is not null and (r.creado_en >= p_desde or r.estado not in ('cerrado', 'falso'))
$$;

create or replace function panel_detalle(p_reporte uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select datos_alerta(p_reporte) || jsonb_build_object(
    'puede_deshacer', puede_deshacer(p_reporte),
    'agregados', coalesce((select jsonb_agg(jsonb_build_object('texto', a.texto, 'en', a.creado_en) order by a.creado_en)
                           from agregados a where a.reporte_id = p_reporte), '[]'),
    'parte', (select to_jsonb(p) from partes_servicio p where p.reporte_id = p_reporte))
  where mi_rol() is not null
$$;

create or replace function panel_revisiones(p_desde timestamptz default now() - interval '60 days') returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(to_jsonb(v) - 'autor' - 'tg_chat_id' - 'tg_message_id'
    || jsonb_build_object('historial', (select jsonb_agg(jsonb_build_object('estado', e.estado, 'actor', e.actor, 'nota', e.nota, 'en', e.creado_en)
                                         order by e.creado_en) from eventos_revision e where e.revision_id = v.id))
    order by coalesce(v.fecha, v.creado_en)), '[]')
  from revisiones v
  where mi_rol() is not null and (v.creado_en >= p_desde or v.fecha >= p_desde or v.estado in ('solicitada', 'propuesta', 'confirmada'))
$$;

grant execute on function panel_yo(), panel_reportes(timestamptz), panel_detalle(uuid), panel_revisiones(timestamptz) to authenticated;

-- ------------------------------------------------------------ panel: revisiones
create or replace function panel_proponer_fecha(p_revision uuid, p_fecha timestamptz, p_asignado text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v revisiones%rowtype; quien text := coalesce((select nombre from miembros_panel where user_id = auth.uid()), 'estación');
begin
  if mi_rol() not in ('admin', 'coordinador') then raise exception 'sin_permiso' using errcode = '42501'; end if;
  if p_fecha < now() then raise exception 'fecha_pasada' using errcode = '22023'; end if;
  select * into v from revisiones where id = p_revision for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if v.estado in ('realizada', 'cancelada') then raise exception 'transicion_invalida' using errcode = 'P0001'; end if;
  update revisiones set estado = 'propuesta', fecha = p_fecha, asignado = nullif(trim(p_asignado), ''),
    nota_estacion = nullif(trim(p_nota), ''), recordado_en = null, actualizado_en = now() where id = p_revision;
  insert into eventos_revision (revision_id, estado, actor, nota) values (p_revision, 'propuesta', quien, p_nota);
  return jsonb_build_object('ok', true);
end $$;

create or replace function panel_cerrar_revision(p_revision uuid, p_realizada boolean, p_checklist jsonb default null,
  p_recomendaciones text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v revisiones%rowtype; quien text := coalesce((select nombre from miembros_panel where user_id = auth.uid()), 'estación');
begin
  if mi_rol() not in ('admin', 'coordinador') then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select * into v from revisiones where id = p_revision for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if v.estado in ('realizada', 'cancelada') then raise exception 'transicion_invalida' using errcode = 'P0001'; end if;
  update revisiones set estado = case when p_realizada then 'realizada' else 'cancelada' end::estado_revision,
    checklist = p_checklist, recomendaciones = nullif(trim(p_recomendaciones), ''), actualizado_en = now() where id = p_revision;
  insert into eventos_revision (revision_id, estado, actor, nota)
  values (p_revision, case when p_realizada then 'realizada' else 'cancelada' end::estado_revision, quien, p_recomendaciones);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function panel_proponer_fecha(uuid, timestamptz, text, text), panel_cerrar_revision(uuid, boolean, jsonb, text) to authenticated;

-- ------------------------------------------------------------ panel: parte de servicio
create or replace function panel_guardar_parte(p_reporte uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  if not exists (select 1 from reportes where id = p_reporte) then raise exception 'no_existe' using errcode = 'P0002'; end if;
  insert into partes_servicio as ps (reporte_id, unidad, personal, hora_salida, hora_llegada, hora_retorno, acciones, agua_litros,
    extintores, lesionados, traslados, danos, causa, autoridades, folio_911, observaciones, responsable, creado_por)
  values (p_reporte, p->>'unidad', coalesce(array(select jsonb_array_elements_text(p->'personal')), '{}'),
    nullif(p->>'hora_salida', '')::timestamptz, nullif(p->>'hora_llegada', '')::timestamptz, nullif(p->>'hora_retorno', '')::timestamptz,
    p->>'acciones', nullif(p->>'agua_litros', '')::int, nullif(p->>'extintores', '')::int, nullif(p->>'lesionados', '')::int,
    nullif(p->>'traslados', '')::int, p->>'danos', p->>'causa', p->>'autoridades', p->>'folio_911', p->>'observaciones',
    p->>'responsable', auth.uid())
  on conflict (reporte_id) do update set unidad = excluded.unidad, personal = excluded.personal, hora_salida = excluded.hora_salida,
    hora_llegada = excluded.hora_llegada, hora_retorno = excluded.hora_retorno, acciones = excluded.acciones,
    agua_litros = excluded.agua_litros, extintores = excluded.extintores, lesionados = excluded.lesionados,
    traslados = excluded.traslados, danos = excluded.danos, causa = excluded.causa, autoridades = excluded.autoridades,
    folio_911 = excluded.folio_911, observaciones = excluded.observaciones, responsable = excluded.responsable, actualizado_en = now();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function panel_guardar_parte(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ panel: informe del periodo
create or replace function panel_informe(p_desde timestamptz, p_hasta timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with r as (select * from reportes where creado_en >= p_desde and creado_en < p_hasta),
  t as (
    select r.id,
      (select extract(epoch from min(e.creado_en) - r.creado_en) / 60 from eventos e where e.reporte_id = r.id and e.estado = 'visto') a_visto,
      (select extract(epoch from min(e.creado_en) - r.creado_en) / 60 from eventos e where e.reporte_id = r.id and e.estado = 'atendiendo') a_lugar
    from r)
  select jsonb_build_object(
    'total', (select count(*) from r),
    'falsos', (select count(*) from r where estado = 'falso'),
    'abiertos', (select count(*) from r where estado not in ('cerrado', 'falso')),
    'por_tipo', coalesce((select jsonb_object_agg(tipo, n) from (select tipo, count(*) n from r group by tipo) x), '{}'),
    'por_hora', coalesce((select jsonb_object_agg(h, n) from (select extract(hour from creado_en at time zone 'America/Mexico_City')::int h, count(*) n from r group by 1) x), '{}'),
    'por_dia', coalesce((select jsonb_object_agg(d, n) from (select extract(isodow from creado_en at time zone 'America/Mexico_City')::int d, count(*) n from r group by 1) x), '{}'),
    'por_semana', coalesce((select jsonb_agg(jsonb_build_object('semana', s, 'total', n) order by s) from
                   (select to_char(date_trunc('week', creado_en at time zone 'America/Mexico_City'), 'YYYY-MM-DD') s, count(*) n from r group by 1) x), '[]'),
    'mediana_min_visto', (select round((percentile_cont(0.5) within group (order by a_visto))::numeric, 1) from t where a_visto is not null),
    'mediana_min_lugar', (select round((percentile_cont(0.5) within group (order by a_lugar))::numeric, 1) from t where a_lugar is not null),
    'partes', (select count(*) from partes_servicio p join r on r.id = p.reporte_id),
    'sin_parte', (select count(*) from r where estado = 'cerrado' and not exists (select 1 from partes_servicio p where p.reporte_id = r.id)),
    'agua_litros', (select coalesce(sum(agua_litros), 0) from partes_servicio p join r on r.id = p.reporte_id),
    'extintores', (select coalesce(sum(extintores), 0) from partes_servicio p join r on r.id = p.reporte_id),
    'lesionados', (select coalesce(sum(lesionados), 0) from partes_servicio p join r on r.id = p.reporte_id),
    'traslados', (select coalesce(sum(traslados), 0) from partes_servicio p join r on r.id = p.reporte_id),
    'por_unidad', coalesce((select jsonb_object_agg(coalesce(unidad, 'Sin unidad'), n) from (select p.unidad, count(*) n from partes_servicio p join r on r.id = p.reporte_id group by 1) x), '{}'),
    'revisiones', jsonb_build_object(
      'solicitadas', (select count(*) from revisiones where creado_en >= p_desde and creado_en < p_hasta),
      'realizadas', (select count(*) from revisiones where estado = 'realizada' and fecha >= p_desde and fecha < p_hasta)),
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('folio', r.folio, 'tipo', r.tipo, 'estado', r.estado, 'creado_en', r.creado_en,
                  'referencia', r.referencia, 'unidad', p.unidad, 'personal', p.personal, 'acciones', p.acciones, 'lat', r.lat, 'lon', r.lon)
                  order by r.creado_en) from r left join partes_servicio p on p.reporte_id = r.id), '[]'))
  where mi_rol() is not null
$$;
grant execute on function panel_informe(timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------------ fotos (privadas) y noticias (públicas)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fotos', 'fotos', false, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
    on conflict (id) do nothing;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('noticias', 'noticias', true, 5242880, array['image/jpeg', 'image/webp', 'image/png'])
    on conflict (id) do nothing;
    execute 'drop policy if exists panel_fotos on storage.objects';
    execute $p$ create policy panel_fotos on storage.objects for select to authenticated
      using (bucket_id = 'fotos' and public.mi_rol() is not null) $p$;
    execute 'drop policy if exists noticias_panel on storage.objects';
    execute $p$ create policy noticias_panel on storage.objects for all to authenticated
      using (bucket_id = 'noticias' and public.mi_rol() in ('admin', 'coordinador'))
      with check (bucket_id = 'noticias' and public.mi_rol() in ('admin', 'coordinador')) $p$;
  end if;
end $$;

-- ------------------------------------------------------------ tarea de cada minuto (solo en Supabase)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    if exists (select 1 from cron.job where jobname = 'simub-tareas') then perform cron.unschedule('simub-tareas'); end if;
    perform cron.schedule('simub-tareas', '* * * * *', $cron$
      select net.http_post(url := 'https://mgvlvqhnnfhaytjkrtqj.supabase.co/functions/v1/tareas',
        headers := '{"content-type": "application/json"}'::jsonb, body := '{}'::jsonb)
    $cron$);
  end if;
end $$;
