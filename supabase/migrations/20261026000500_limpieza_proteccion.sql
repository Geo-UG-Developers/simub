-- SIMUB · Limpieza antes de salir a producción, conservación de datos y protección contra abuso.

-- Borra TODO lo capturado en pruebas (reportes, revisiones, partes) y el contenido de ejemplo.
-- Devuelve las rutas de fotos para que el servidor las borre del almacenamiento.
create or replace function limpiar_datos_prueba() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_fotos text[]; n_rep int; n_rev int;
begin
  if mi_rol() is distinct from 'admin' then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select coalesce(array_agg(f), '{}') into v_fotos from (select unnest(r.fotos) f from reportes r) x;
  select count(*) into n_rep from reportes;
  select count(*) into n_rev from revisiones;
  delete from reportes;            -- en cascada: eventos, agregados y partes de servicio
  delete from revisiones;          -- en cascada: eventos_revision
  delete from noticias where texto like '%[Ejemplo]%';
  delete from tg_borradores;
  perform setval('folio_reporte', 1, false);
  perform setval('folio_revision', 1, false);
  return jsonb_build_object('reportes', n_rep, 'revisiones', n_rev, 'fotos', to_jsonb(v_fotos));
end $$;
grant execute on function limpiar_datos_prueba() to authenticated;

-- Conservación (aviso de privacidad): fotos 6 meses; nombre, teléfono y dirección 12 meses.
create or replace function aplicar_conservacion() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_fotos text[];
begin
  select coalesce(array_agg(f), '{}') into v_fotos from (
    select unnest(r.fotos) f from reportes r where r.creado_en < now() - interval '6 months' and cardinality(r.fotos) > 0) x;
  update reportes set fotos = '{}' where creado_en < now() - interval '6 months' and cardinality(fotos) > 0;
  update reportes set nombre = null, telefono = null, comentario = null
    where creado_en < now() - interval '12 months' and (nombre is not null or telefono is not null or comentario is not null);
  update agregados set texto = '[eliminado]' where creado_en < now() - interval '12 months' and texto <> '[eliminado]';
  update revisiones set nombre = '[eliminado]', telefono = '[eliminado]', direccion = '[eliminado]', comentario = null
    where creado_en < now() - interval '12 months' and nombre <> '[eliminado]';
  return jsonb_build_object('fotos', to_jsonb(v_fotos));
end $$;
revoke execute on function aplicar_conservacion() from public, anon, authenticated;

-- Protección: además del límite por sesión, máximo 5 reportes por hora desde un mismo teléfono.
create or replace function limite_por_telefono() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.telefono is not null and length(regexp_replace(new.telefono, '\D', '', 'g')) >= 7 and
     (select count(*) from reportes where regexp_replace(telefono, '\D', '', 'g') = regexp_replace(new.telefono, '\D', '', 'g')
        and creado_en > now() - interval '1 hour') >= cfg_max_reportes_hora() then
    raise exception 'limite_reportes' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists reportes_limite_telefono on reportes;
create trigger reportes_limite_telefono before insert on reportes for each row execute function limite_por_telefono();

-- ¿Llegó una avalancha de reportes (posible abuso o una emergencia grande)? Avisa una vez cada 30 min.
create or replace function revisar_avalancha() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int; ultimo timestamptz;
begin
  select count(*) into n from reportes where creado_en > now() - interval '10 minutes';
  if n < 15 then return 0; end if;
  select (valor->>'en')::timestamptz into ultimo from config_privada where clave = 'avalancha';
  if ultimo is not null and ultimo > now() - interval '30 minutes' then return 0; end if;
  insert into config_privada (clave, valor) values ('avalancha', jsonb_build_object('en', now()))
  on conflict (clave) do update set valor = excluded.valor;
  return n;
end $$;
revoke execute on function revisar_avalancha() from public, anon, authenticated;
