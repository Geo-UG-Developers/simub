-- SIMUB · Centro de mando, folio único de servicios, parte de servicio con el formato de SIMUB,
-- bitácora, estado de unidades, importación del histórico (Excel) y conteos para informes.
--
-- Un «servicio» es cada salida o actividad de la estación, venga de la app, del 911, de la radio,
-- de una llamada o sea de rutina (simulacro, capacitación, evento). Su folio es el consecutivo anual
-- que SIMUB ya usa en su Excel (1, 2, 3… cada año).

-- ------------------------------------------------------------ catálogo homologado (igual que su Excel)
create table catalogo_servicios (
  id      text primary key,
  grupo   text not null,
  nombre  text not null,
  color   text not null,          -- color de fila en la tabla mensual
  orden   int not null,
  activo  boolean not null default true
);
insert into catalogo_servicios (id, grupo, nombre, color, orden) values
 ('inc_estructural', 'Incendios', 'INCENDIO ESTRUCTURAL', '#F8CBAD', 10),
 ('inc_pastizal', 'Incendios', 'INCENDIO PASTIZAL', '#F8CBAD', 11),
 ('inc_vehicular', 'Incendios', 'INCENDIO VEHICULAR', '#F8CBAD', 12),
 ('inc_forestal', 'Incendios', 'INCENDIO FORESTAL', '#F8CBAD', 13),
 ('inc_baldio', 'Incendios', 'INCENDIO DE BALDÍO', '#F8CBAD', 14),
 ('inc_cables', 'Incendios', 'INCENDIO DE CABLES (ELÉCTRICO)', '#F8CBAD', 15),
 ('inc_llantas', 'Incendios', 'INCENDIO DE LLANTAS', '#F8CBAD', 16),
 ('inc_carrizos', 'Incendios', 'INCENDIO DE CARRIZOS', '#F8CBAD', 17),
 ('inc_cilindro', 'Incendios', 'INCENDIO DE CILINDRO DE GAS', '#F8CBAD', 18),
 ('inc_arbol', 'Incendios', 'INCENDIO DE ÁRBOL', '#F8CBAD', 19),
 ('inc_basura', 'Incendios', 'INCENDIO DE BASURA', '#F8CBAD', 20),
 ('acc_vehicular', 'Accidentes', 'ACCIDENTE VEHICULAR', '#BDD7EE', 30),
 ('acc_moto', 'Accidentes', 'ACCIDENTE DE MOTOCICLETA', '#BDD7EE', 31),
 ('acc_volcadura', 'Accidentes', 'ACCIDENTE VOLCADURA', '#BDD7EE', 32),
 ('res_acuatico', 'Rescates', 'RESCATE ACUÁTICO', '#FFE699', 40),
 ('res_angulo', 'Rescates', 'RESCATE ÁNGULO ELEVADO', '#FFE699', 41),
 ('res_vehicular', 'Rescates', 'RESCATE VEHICULAR', '#FFE699', 42),
 ('res_confinado', 'Rescates', 'RESCATE ESPACIO CONFINADO', '#FFE699', 43),
 ('res_k9', 'Rescates', 'RESCATE K9', '#FFE699', 44),
 ('pac_trauma', 'Pacientes', 'PACIENTE TRAUMA', '#C6E0B4', 50),
 ('pac_clinico', 'Pacientes', 'PACIENTE CLÍNICO', '#C6E0B4', 51),
 ('traslado', 'Pacientes', 'TRASLADO', '#C6E0B4', 52),
 ('cai_cables', 'Caídas', 'CAÍDA DE CABLES', '#D9D2E9', 60),
 ('cai_poste', 'Caídas', 'CAÍDA DE POSTE', '#D9D2E9', 61),
 ('cai_estructura', 'Caídas', 'CAÍDA DE ESTRUCTURA', '#D9D2E9', 62),
 ('cai_arbol', 'Caídas', 'CAÍDA DE ÁRBOL', '#D9D2E9', 63),
 ('inundacion', 'Caídas', 'INUNDACIÓN', '#D9D2E9', 64),
 ('evento', 'Servicios de rutina', 'EVENTO ESPECIAL', '#F4C2D7', 70),
 ('simulacro', 'Servicios de rutina', 'SIMULACRO', '#F4C2D7', 71),
 ('capacitacion', 'Servicios de rutina', 'CAPACITACIÓN', '#F4C2D7', 72),
 ('prevencion', 'Servicios de rutina', 'PREVENCIÓN', '#F4C2D7', 73),
 ('otros', 'Servicios de rutina', 'OTROS', '#F4C2D7', 74),
 ('fau_animal', 'Control de fauna', 'CONTROL ANIMAL', '#B4E5F0', 80),
 ('fau_enjambre', 'Control de fauna', 'ENJAMBRE', '#B4E5F0', 81),
 ('fau_reptil', 'Control de fauna', 'REPTIL', '#B4E5F0', 82),
 ('revision', 'Revisión de seguridad', 'REVISIÓN DE SEGURIDAD', '#A9D08E', 90),
 ('fuga_gas', 'Fuga de gas', 'FUGA DE GAS', '#FFD966', 91),
 ('falsa', 'Falsa alarma', 'FALSA ALARMA', '#FF8B8B', 99);

-- ------------------------------------------------------------ servicios (folio único)
create type estado_servicio as enum ('activo', 'cerrado', 'anulado');

create table servicios (
  id             uuid primary key default gen_random_uuid(),
  anio           int not null,
  folio          int not null check (folio > 0),
  estado         estado_servicio not null default 'activo',
  origen         text not null default 'captura' check (origen in ('captura', 'app', 'historico')),
  reporte_id     uuid unique references reportes(id) on delete set null,
  clasificacion  text not null references catalogo_servicios(id),
  especificacion text,
  falsa_alarma   boolean not null default false,
  fecha          date not null,
  h_reporte      timestamptz,
  h_despacho     timestamptz,
  h_llegada      timestamptz,
  h_disponible   timestamptz,
  h_base         timestamptz,
  km_salida      numeric,
  km_llegada     numeric,
  lugar          text,
  lat            double precision check (lat between -90 and 90),
  lon            double precision check (lon between -180 and 180),
  area_afectada  text,
  medio          text,                    -- 911, radio, teléfono de cabina, app, presencial…
  reportante     text,
  telefono       text,
  unidades       text[] not null default '{}',
  personal_num   int check (personal_num >= 0),
  tripulacion    jsonb not null default '[]',   -- [{unidad, maquinista, jefe, bomberos}]
  datos          jsonb not null default '{}',   -- gas: compania, kilos; folio_911; etc.
  vehiculos      jsonb not null default '[]',   -- [{placas, color, tipo, modelo, conductor, propietario}]
  apoyos         jsonb not null default '{}',   -- {"Cruz Roja": {"unidades": "...", "encargado": "..."}}
  personas       jsonb not null default '[]',   -- [{nombre, codigo, edad}]
  observaciones  text,
  jefe_servicio  text,
  radio_operador text,
  jefe_guardia   text,
  creado_por     uuid,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (anio, folio)
);
create index servicios_fecha_idx on servicios (fecha);
create index servicios_estado_idx on servicios (estado) where estado = 'activo';

create table bitacora (
  id          bigserial primary key,
  servicio_id uuid not null references servicios(id) on delete cascade,
  texto       text not null check (length(texto) between 1 and 1000),
  autor       text,
  en          timestamptz not null default clock_timestamp()
);
create index bitacora_servicio_idx on bitacora (servicio_id, en);

alter table unidades add column estado text not null default 'disponible'
  check (estado in ('disponible', 'en_servicio', 'fuera_servicio'));
alter table unidades add column servicio_id uuid references servicios(id) on delete set null;
alter table unidades add column nota text;
alter table unidades add column actualizado_en timestamptz not null default now();

alter table catalogo_servicios enable row level security;
alter table servicios enable row level security;
alter table bitacora enable row level security;
revoke all on catalogo_servicios, servicios, bitacora from anon, authenticated;
grant select on catalogo_servicios to authenticated;
create policy catalogo_leer on catalogo_servicios for select to authenticated using (mi_rol() is not null);
-- servicios y bitácora: solo por funciones (quedan registrados autor y hora).

-- ------------------------------------------------------------ utilidades
create or replace function quien_soy() returns text
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select nullif(nombre, '') from miembros_panel where user_id = auth.uid()), 'estación')
$$;

create or replace function hoy_local() returns date language sql stable as $$
  select (now() at time zone 'America/Mexico_City')::date
$$;

-- Lee una hora del JSON: vacía → null.
create or replace function _ts(p jsonb, k text) returns timestamptz language sql immutable as $$
  select nullif(p->>k, '')::timestamptz
$$;

-- Clasificación sugerida a partir de un reporte de la app.
create or replace function clasificacion_de_reporte(p_tipo tipo_reporte, p_det jsonb) returns text
language sql immutable as $$
  select case p_tipo
    when 'incendio' then case p_det->'valores'->>'lugar' when 'pastizal' then 'inc_pastizal' when 'vehiculo' then 'inc_vehicular'
                                                         when 'basura' then 'inc_basura' else 'inc_estructural' end
    when 'accidente' then case p_det->'valores'->>'tipo_accidente' when 'volcadura' then 'acc_volcadura'
                                                                    when 'motocicleta' then 'acc_moto' when 'atrapado' then 'res_vehicular' else 'acc_vehicular' end
    when 'gas' then 'fuga_gas'
    when 'fauna' then case p_det->'valores'->>'animal' when 'abejas' then 'fau_enjambre' when 'serpiente' then 'fau_reptil' else 'fau_animal' end
    when 'infraestructura' then case p_det->'valores'->>'objeto' when 'arbol' then 'cai_arbol' when 'poste' then 'cai_cables' else 'cai_estructura' end
    else 'otros' end
$$;

-- Ocupa o libera unidades según la lista del servicio activo.
create or replace function _sincronizar_unidades(p_servicio uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s servicios%rowtype;
begin
  select * into s from servicios where id = p_servicio;
  update unidades set estado = 'disponible', servicio_id = null, actualizado_en = now()
   where servicio_id = p_servicio and (s.estado <> 'activo' or not (nombre = any (s.unidades)));
  if s.estado = 'activo' then
    update unidades set estado = 'en_servicio', servicio_id = p_servicio, actualizado_en = now()
     where nombre = any (s.unidades) and estado <> 'fuera_servicio' and servicio_id is distinct from p_servicio;
  end if;
end $$;

-- ------------------------------------------------------------ crear / guardar un servicio (parte)
create or replace function panel_guardar_servicio(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := p_id; v_anio int; v_folio int; v_fecha date; v_quien text := quien_soy(); v_nuevo boolean := p_id is null;
  v_cls text := coalesce(nullif(p->>'clasificacion', ''), 'otros');
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  if not exists (select 1 from catalogo_servicios where id = v_cls) then raise exception 'clasificacion_invalida' using errcode = '22023'; end if;
  v_fecha := coalesce(nullif(p->>'fecha', '')::date,
                      (_ts(p, 'h_reporte') at time zone 'America/Mexico_City')::date, hoy_local());
  if v_nuevo then
    v_anio := extract(year from v_fecha)::int;
    perform pg_advisory_xact_lock(7311, v_anio);
    select coalesce(max(folio), 0) + 1 into v_folio from servicios where anio = v_anio;
    insert into servicios (anio, folio, clasificacion, fecha, creado_por, h_reporte)
    values (v_anio, v_folio, v_cls, v_fecha, auth.uid(), coalesce(_ts(p, 'h_reporte'), now()))
    returning id into v_id;
  elsif not exists (select 1 from servicios where id = v_id) then
    raise exception 'no_existe' using errcode = 'P0002';
  elsif (select estado from servicios where id = v_id) = 'anulado' then
    raise exception 'anulado' using errcode = 'P0001';
  end if;

  update servicios set
    clasificacion = v_cls,
    especificacion = nullif(trim(p->>'especificacion'), ''),
    falsa_alarma = coalesce((p->>'falsa_alarma')::boolean, false),
    fecha = v_fecha,
    h_reporte = coalesce(_ts(p, 'h_reporte'), h_reporte),
    h_despacho = _ts(p, 'h_despacho'), h_llegada = _ts(p, 'h_llegada'),
    h_disponible = _ts(p, 'h_disponible'), h_base = _ts(p, 'h_base'),
    km_salida = nullif(p->>'km_salida', '')::numeric, km_llegada = nullif(p->>'km_llegada', '')::numeric,
    lugar = nullif(trim(p->>'lugar'), ''),
    lat = coalesce(nullif(p->>'lat', '')::float8, lat), lon = coalesce(nullif(p->>'lon', '')::float8, lon),
    area_afectada = nullif(trim(p->>'area_afectada'), ''),
    medio = nullif(trim(p->>'medio'), ''), reportante = nullif(trim(p->>'reportante'), ''), telefono = nullif(trim(p->>'telefono'), ''),
    unidades = coalesce(array(select distinct trim(x) from jsonb_array_elements_text(coalesce(p->'unidades', '[]')) x where trim(x) <> ''), '{}'),
    personal_num = nullif(p->>'personal_num', '')::int,
    tripulacion = coalesce(p->'tripulacion', '[]'), datos = coalesce(p->'datos', '{}'),
    vehiculos = coalesce(p->'vehiculos', '[]'), apoyos = coalesce(p->'apoyos', '{}'), personas = coalesce(p->'personas', '[]'),
    observaciones = nullif(trim(p->>'observaciones'), ''),
    jefe_servicio = nullif(trim(p->>'jefe_servicio'), ''), radio_operador = nullif(trim(p->>'radio_operador'), ''),
    jefe_guardia = nullif(trim(p->>'jefe_guardia'), ''),
    actualizado_en = now()
  where id = v_id;

  insert into bitacora (servicio_id, texto, autor)
  values (v_id, case when v_nuevo then 'Servicio abierto' || coalesce(' · ' || nullif(p->>'medio', ''), '') else 'Parte de servicio actualizado' end, v_quien);
  perform _sincronizar_unidades(v_id);
  select anio, folio into v_anio, v_folio from servicios where id = v_id;
  return jsonb_build_object('id', v_id, 'anio', v_anio, 'folio', v_folio);
end $$;

-- Abre (o devuelve) el servicio ligado a un reporte de la app.
create or replace function panel_servicio_desde_reporte(p_reporte uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r reportes%rowtype; v jsonb; v_id uuid;
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select id into v_id from servicios where reporte_id = p_reporte;
  if found then return jsonb_build_object('id', v_id); end if;
  select * into r from reportes where id = p_reporte;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  v := panel_guardar_servicio(null, jsonb_build_object(
    'clasificacion', clasificacion_de_reporte(r.tipo, r.detalles), 'h_reporte', r.creado_en,
    'especificacion', array_to_string(array(select jsonb_array_elements_text(coalesce(r.detalles->'resumen', '[]'))), ' · '),
    'lugar', r.referencia, 'lat', r.lat, 'lon', r.lon, 'medio', 'App SIMUB (' || r.folio || ')',
    'reportante', case when r.anonimo then 'Anónimo' else r.nombre end, 'telefono', r.telefono,
    'falsa_alarma', r.estado = 'falso'));
  update servicios set reporte_id = p_reporte, origen = 'app' where id = (v->>'id')::uuid;
  return v;
end $$;

-- ------------------------------------------------------------ bitácora e hitos de la cronología
create or replace function panel_bitacora(p_servicio uuid, p_texto text, p_hito text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_txt text := nullif(trim(p_texto), ''); s servicios%rowtype;
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select * into s from servicios where id = p_servicio for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if p_hito is not null then
    if p_hito not in ('despacho', 'llegada', 'disponible', 'base') then raise exception 'hito_invalido' using errcode = '22023'; end if;
    execute format('update servicios set h_%s = now(), actualizado_en = now() where id = $1', p_hito) using p_servicio;
    v_txt := coalesce(v_txt, case p_hito when 'despacho' then 'Despacho de unidad(es)' when 'llegada' then 'Llegada a la escena'
                                         when 'disponible' then 'Unidad disponible' else 'Llegada a la base' end);
  end if;
  if v_txt is null then raise exception 'texto_vacio' using errcode = '22023'; end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio, left(v_txt, 1000), quien_soy());
  return jsonb_build_object('ok', true);
end $$;

create or replace function panel_cerrar_servicio(p_servicio uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  update servicios set estado = 'cerrado', h_base = coalesce(h_base, now()), actualizado_en = now()
   where id = p_servicio and estado = 'activo';
  if not found then raise exception 'transicion_invalida' using errcode = 'P0001'; end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio, 'Servicio concluido · unidades en base', quien_soy());
  perform _sincronizar_unidades(p_servicio);
  return jsonb_build_object('ok', true);
end $$;

create or replace function panel_reabrir_servicio(p_servicio uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mi_rol() not in ('admin', 'coordinador') then raise exception 'sin_permiso' using errcode = '42501'; end if;
  update servicios set estado = 'activo', actualizado_en = now() where id = p_servicio and estado = 'cerrado';
  if not found then raise exception 'transicion_invalida' using errcode = 'P0001'; end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio, 'Servicio reabierto', quien_soy());
  perform _sincronizar_unidades(p_servicio);
  return jsonb_build_object('ok', true);
end $$;

-- Anular no borra: el folio queda registrado (rendición de cuentas) y no cuenta en los informes.
create or replace function panel_anular_servicio(p_servicio uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mi_rol() is distinct from 'admin' then raise exception 'solo_admin' using errcode = '42501'; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'texto_vacio' using errcode = '22023'; end if;
  update servicios set estado = 'anulado', actualizado_en = now() where id = p_servicio and estado <> 'anulado';
  if not found then raise exception 'transicion_invalida' using errcode = 'P0001'; end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio, 'Folio anulado: ' || trim(p_motivo), quien_soy());
  perform _sincronizar_unidades(p_servicio);
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------ unidades (estado en el tablero)
create or replace function panel_unidad(p_unidad int, p_estado text, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u unidades%rowtype;
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  if p_estado not in ('disponible', 'fuera_servicio') then raise exception 'estado_invalido' using errcode = '22023'; end if;
  select * into u from unidades where id = p_unidad for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if u.servicio_id is not null then
    insert into bitacora (servicio_id, texto, autor)
    values (u.servicio_id, u.nombre || case p_estado when 'disponible' then ' disponible' else ' fuera de servicio' end, quien_soy());
  end if;
  update unidades set estado = p_estado, servicio_id = null, nota = nullif(trim(p_nota), ''), actualizado_en = now() where id = p_unidad;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------ lecturas
create or replace function _servicio_json(s servicios) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select to_jsonb(s) - 'creado_por'
$$;

-- Centro de mando: servicios activos, unidades y reportes de la app sin servicio.
create or replace function panel_mando() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'servicios', coalesce((select jsonb_agg(_servicio_json(s) || jsonb_build_object('bitacora',
        coalesce((select jsonb_agg(jsonb_build_object('texto', b.texto, 'autor', b.autor, 'en', b.en) order by b.en desc)
                  from (select * from bitacora b where b.servicio_id = s.id order by b.en desc limit 4) b), '[]'))
        order by s.h_reporte nulls last, s.creado_en) from servicios s where s.estado = 'activo'), '[]'),
    'unidades', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre, 'tipo', u.tipo, 'estado', u.estado,
        'nota', u.nota, 'servicio_id', u.servicio_id, 'desde', u.actualizado_en,
        'folio', (select s.folio from servicios s where s.id = u.servicio_id)) order by u.nombre) from unidades u where u.activa), '[]'),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'folio', r.folio, 'tipo', r.tipo, 'estado', r.estado,
        'referencia', r.referencia, 'creado_en', r.creado_en, 'resumen', r.detalles->'resumen') order by r.creado_en)
        from reportes r where r.estado not in ('cerrado', 'falso') and not exists (select 1 from servicios s where s.reporte_id = r.id)), '[]'),
    'hoy', (select count(*) from servicios where fecha = hoy_local() and estado <> 'anulado'))
  where mi_rol() is not null
$$;

create or replace function panel_servicio(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select _servicio_json(s) || jsonb_build_object(
    'bitacora', coalesce((select jsonb_agg(jsonb_build_object('texto', b.texto, 'autor', b.autor, 'en', b.en) order by b.en)
                          from bitacora b where b.servicio_id = s.id), '[]'),
    'reporte_folio', (select r.folio from reportes r where r.id = s.reporte_id))
  from servicios s where s.id = p_id and mi_rol() is not null
$$;

-- Lista para la bitácora mensual, informes y exportación (sin datos personales de terceros).
create or replace function panel_servicios(p_desde date, p_hasta date) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'anio', s.anio, 'folio', s.folio, 'estado', s.estado, 'origen', s.origen,
    'clasificacion', s.clasificacion, 'especificacion', s.especificacion, 'falsa_alarma', s.falsa_alarma, 'fecha', s.fecha,
    'h_reporte', s.h_reporte, 'h_despacho', s.h_despacho, 'h_llegada', s.h_llegada, 'h_base', s.h_base,
    'lugar', s.lugar, 'lat', s.lat, 'lon', s.lon, 'area_afectada', s.area_afectada, 'medio', s.medio,
    'unidades', s.unidades, 'personal_num', s.personal_num, 'apoyos', s.apoyos, 'con_parte', s.jefe_servicio is not null)
    order by s.anio, s.folio), '[]')
  from servicios s
  where mi_rol() is not null and s.fecha >= p_desde and s.fecha < p_hasta
$$;

-- Conteo por clasificación y mes (falsas alarmas cuentan como FALSA ALARMA, como en su Excel).
create or replace function panel_conteos(p_anio int) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'conteos', coalesce((select jsonb_agg(jsonb_build_object('c', c, 'mes', mes, 'n', n)) from (
      select case when falsa_alarma then 'falsa' else clasificacion end c, extract(month from fecha)::int mes, count(*) n
      from servicios where anio = p_anio and estado <> 'anulado' group by 1, 2) x), '[]'),
    'apoyos', coalesce((select jsonb_object_agg(k, n) from (
      select k, count(*) n from servicios s, jsonb_object_keys(s.apoyos) k
      where s.anio = p_anio and s.estado <> 'anulado' group by k) y), '{}'),
    'minutos_promedio', (select round(avg(extract(epoch from h_base - h_despacho) / 60)) from servicios
                         where anio = p_anio and estado <> 'anulado' and h_base > h_despacho and h_base - h_despacho < interval '24 hours'))
  where mi_rol() is not null
$$;

-- ------------------------------------------------------------ importar histórico (Excel de SIMUB)
-- Recibe filas ya interpretadas por el panel. Vuelve a importar sin duplicar (año + folio);
-- nunca sobrescribe servicios capturados en la app.
create or replace function panel_importar_servicios(p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f jsonb; n_ok int := 0; n_omit int := 0;
begin
  if mi_rol() is distinct from 'admin' then raise exception 'solo_admin' using errcode = '42501'; end if;
  if jsonb_array_length(p_filas) > 1000 then raise exception 'demasiadas_filas' using errcode = '22023'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    if (f->>'anio') is null or (f->>'folio') is null or (f->>'fecha') is null
       or not exists (select 1 from catalogo_servicios where id = f->>'clasificacion') then
      n_omit := n_omit + 1; continue;
    end if;
    insert into servicios as s (anio, folio, estado, origen, clasificacion, especificacion, falsa_alarma, fecha,
      h_despacho, h_base, lugar, area_afectada, unidades, personal_num, creado_por, h_reporte)
    values ((f->>'anio')::int, (f->>'folio')::int, 'cerrado', 'historico', f->>'clasificacion', nullif(f->>'especificacion', ''),
      coalesce((f->>'falsa_alarma')::boolean, false), (f->>'fecha')::date, _ts(f, 'h_despacho'), _ts(f, 'h_base'),
      nullif(f->>'lugar', ''), nullif(f->>'area_afectada', ''),
      coalesce(array(select jsonb_array_elements_text(coalesce(f->'unidades', '[]'))), '{}'),
      nullif(f->>'personal_num', '')::int, auth.uid(), _ts(f, 'h_despacho'))
    on conflict (anio, folio) do update set clasificacion = excluded.clasificacion, especificacion = excluded.especificacion,
      falsa_alarma = excluded.falsa_alarma, fecha = excluded.fecha, h_despacho = excluded.h_despacho, h_base = excluded.h_base,
      h_reporte = excluded.h_reporte, lugar = excluded.lugar, area_afectada = excluded.area_afectada, unidades = excluded.unidades,
      personal_num = excluded.personal_num, actualizado_en = now()
    where s.origen = 'historico';
    if found then n_ok := n_ok + 1; else n_omit := n_omit + 1; end if;
  end loop;
  return jsonb_build_object('importados', n_ok, 'omitidos', n_omit);
end $$;

grant execute on function panel_guardar_servicio(uuid, jsonb), panel_servicio_desde_reporte(uuid), panel_bitacora(uuid, text, text),
  panel_cerrar_servicio(uuid), panel_reabrir_servicio(uuid), panel_anular_servicio(uuid, text), panel_unidad(int, text, text),
  panel_mando(), panel_servicio(uuid), panel_servicios(date, date), panel_conteos(int), panel_importar_servicios(jsonb) to authenticated;
revoke execute on function _sincronizar_unidades(uuid), _servicio_json(servicios), quien_soy() from public, anon;

-- ------------------------------------------------------------ reportes: «tiene parte» también vía servicio
create or replace function panel_reportes(p_desde timestamptz default now() - interval '30 days') returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'folio', r.folio, 'tipo', r.tipo, 'estado', r.estado, 'lat', r.lat, 'lon', r.lon,
    'referencia', r.referencia, 'detalles', r.detalles, 'creado_en', r.creado_en, 'actualizado_en', r.actualizado_en,
    'escalado', r.escalado_en is not null, 'num_fotos', coalesce(array_length(r.fotos, 1), 0),
    'servicio_id', (select s.id from servicios s where s.reporte_id = r.id),
    'tiene_parte', exists (select 1 from partes_servicio p where p.reporte_id = r.id)
                   or exists (select 1 from servicios s where s.reporte_id = r.id and s.jefe_servicio is not null),
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
    'parte', (select to_jsonb(p) from partes_servicio p where p.reporte_id = p_reporte),
    'servicio_id', (select s.id from servicios s where s.reporte_id = p_reporte))
  where mi_rol() is not null
$$;

-- ------------------------------------------------------------ limpieza de pruebas: también servicios capturados
create or replace function limpiar_datos_prueba() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_fotos text[]; n_rep int; n_rev int; n_srv int;
begin
  if mi_rol() is distinct from 'admin' then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select coalesce(array_agg(f), '{}') into v_fotos from (select unnest(r.fotos) f from reportes r) x;
  select count(*) into n_rep from reportes;
  select count(*) into n_rev from revisiones;
  select count(*) into n_srv from servicios where origen <> 'historico';
  update unidades set estado = 'disponible', servicio_id = null, nota = null, actualizado_en = now();
  delete from servicios where origen <> 'historico';   -- el histórico importado del Excel se conserva
  delete from reportes;
  delete from revisiones;
  delete from noticias where texto like '%[Ejemplo]%';
  delete from tg_borradores;
  perform setval('folio_reporte', 1, false);
  perform setval('folio_revision', 1, false);
  return jsonb_build_object('reportes', n_rep, 'revisiones', n_rev, 'servicios', n_srv, 'fotos', to_jsonb(v_fotos));
end $$;
