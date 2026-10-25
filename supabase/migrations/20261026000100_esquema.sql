-- SIMUB · Reporte de emergencias para Bomberos SIMUB Voluntarios, A.C.
-- Una sola estación: no hay ruteo por polígonos. Mismo enfoque que IGNIS:
-- el ciudadano entra anónimo; el personal entra al panel con correo.
create extension if not exists pgcrypto;

create type tipo_reporte as enum ('incendio', 'accidente', 'gas', 'fauna', 'infraestructura', 'otra');
-- Los estados solo avanzan (falso cierra en cualquier momento).
create type estado_reporte as enum ('enviado', 'visto', 'en_camino', 'atendiendo', 'cerrado', 'falso');
create type estado_revision as enum ('solicitada', 'propuesta', 'confirmada', 'realizada', 'cancelada');
create type canal_evento as enum ('telegram', 'panel', 'app', 'sistema');
create type rol_panel as enum ('admin', 'coordinador', 'guardia');

create sequence folio_reporte;
create sequence folio_revision;

create or replace function nuevo_folio(prefijo text, n bigint) returns text language sql stable as $$
  select prefijo || '-' || to_char(now() at time zone 'America/Mexico_City', 'YY') || '-' || lpad(n::text, 4, '0')
$$;

-- ------------------------------------------------------------ reportes de emergencia
create table reportes (
  id            uuid primary key default gen_random_uuid(),
  folio         text not null unique default nuevo_folio('SIM', nextval('folio_reporte')),
  autor         uuid not null,                       -- sesión anónima del ciudadano
  tipo          tipo_reporte not null,
  estado        estado_reporte not null default 'enviado',
  detalles      jsonb not null default '{}',         -- respuestas del formulario según el tipo
  comentario    text,
  lat           double precision not null check (lat between -90 and 90),
  lon           double precision not null check (lon between -180 and 180),
  precision_m   int,
  referencia    text,                                -- "frente a la tienda", etc.
  nombre        text,
  telefono      text,
  anonimo       boolean not null default false,
  fotos         text[] not null default '{}',
  tg_chat_id    bigint,
  tg_message_id bigint,
  escalado_en   timestamptz,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index reportes_autor_idx on reportes (autor, creado_en desc);
create index reportes_estado_idx on reportes (estado, creado_en desc);

create table eventos (
  id          bigserial primary key,
  reporte_id  uuid not null references reportes(id) on delete cascade,
  estado      estado_reporte not null,
  actor       text,
  canal       canal_evento not null default 'sistema',
  creado_en   timestamptz not null default clock_timestamp(),
  avisado_en  timestamptz
);
create index eventos_reporte_idx on eventos (reporte_id, creado_en);

-- Información que el ciudadano agrega después ("Agregar información").
create table agregados (
  id          bigserial primary key,
  reporte_id  uuid not null references reportes(id) on delete cascade,
  texto       text not null,
  creado_en   timestamptz not null default now()
);

-- ------------------------------------------------------------ revisiones de seguridad (citas)
create table revisiones (
  id            uuid primary key default gen_random_uuid(),
  folio         text not null unique default nuevo_folio('REV', nextval('folio_revision')),
  autor         uuid not null,
  estado        estado_revision not null default 'solicitada',
  motivos       text[] not null,
  inmueble      text,
  direccion     text not null,
  horario_preferido text,
  nombre        text not null,
  telefono      text not null,
  comentario    text,
  fecha         timestamptz,              -- fecha propuesta / confirmada
  asignado      text,                     -- quién va
  nota_estacion text,
  checklist     jsonb,
  recomendaciones text,
  recordado_en  timestamptz,
  tg_chat_id    bigint,
  tg_message_id bigint,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index revisiones_fecha_idx on revisiones (fecha);

create table eventos_revision (
  id           bigserial primary key,
  revision_id  uuid not null references revisiones(id) on delete cascade,
  estado       estado_revision not null,
  actor        text,
  nota         text,
  creado_en    timestamptz not null default clock_timestamp(),
  avisado_en   timestamptz
);

-- ------------------------------------------------------------ parte de servicio
create table unidades (
  id      serial primary key,
  nombre  text not null unique,
  tipo    text,
  activa  boolean not null default true
);
create table personal (
  id      serial primary key,
  nombre  text not null unique,
  cargo   text,
  activo  boolean not null default true
);
create table partes_servicio (
  reporte_id     uuid primary key references reportes(id) on delete cascade,
  unidad         text,
  personal       text[] not null default '{}',
  hora_salida    timestamptz,
  hora_llegada   timestamptz,
  hora_retorno   timestamptz,
  acciones       text,
  agua_litros    int check (agua_litros >= 0),
  extintores     int check (extintores >= 0),
  lesionados     int check (lesionados >= 0),
  traslados      int check (traslados >= 0),
  danos          text,
  causa          text,
  autoridades    text,
  folio_911      text,
  observaciones  text,
  responsable    text,
  creado_por     uuid,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- ------------------------------------------------------------ noticias y donativos
create table noticias (
  id           uuid primary key default gen_random_uuid(),
  categoria    text not null check (categoria in ('evento', 'donacion', 'aviso')),
  titulo       text not null check (length(titulo) between 3 and 140),
  texto        text not null check (length(texto) <= 3000),
  foto         text,                     -- ruta en el bucket público "noticias"
  destacada    boolean not null default false,
  visible      boolean not null default true,
  autor        text,
  publicada_en timestamptz not null default now(),
  avisada_en   timestamptz
);
create table necesidades (
  id        serial primary key,
  articulo  text not null,
  urgente   boolean not null default false,
  cantidad  text,
  orden     int not null default 0,
  activa    boolean not null default true,
  actualizado_en timestamptz not null default now()
);

-- Datos que la estación muestra en la app (teléfono, cuenta bancaria...). Editables en el panel.
create table config_publica (clave text primary key, valor jsonb not null, actualizado_en timestamptz not null default now());
create table config_privada (clave text primary key, valor jsonb not null, creado_en timestamptz not null default now());

-- Grupos de Telegram: alertas (reportes), comunicacion (noticias), respaldo (escalamiento).
create table chats (
  rol          text primary key check (rol in ('alertas', 'comunicacion', 'respaldo')),
  chat_id      bigint unique,
  codigo       text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  vinculado_en timestamptz
);

-- Conversaciones a medias con el bot (/noticia, /necesidades).
create table tg_borradores (
  chat_id   bigint not null,
  user_id   bigint not null,
  tipo      text not null,
  paso      text not null,
  datos     jsonb not null default '{}',
  actualizado_en timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table dispositivos_push (
  token     text primary key,
  autor     uuid not null,
  creado_en timestamptz not null default now()
);

create table miembros_panel (
  user_id  uuid primary key,
  rol      rol_panel not null default 'guardia',
  nombre   text
);
