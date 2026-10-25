-- Pruebas de SIMUB. Cada bloque falla con un mensaje claro si algo no cumple.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALLÓ: %', msg; end if; end $$;
create or replace function pg_temp.como(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid::text, false)
$$;

-- 1. Registrar reporte y folio
do $$ declare r jsonb; begin
  r := registrar_reporte('11111111-1111-4111-8111-111111111111', 'incendio', 21.01, -101.25, 10,
        '{"lugar":"casa","personas_dentro":"no"}', 'humo negro', 'junto a la tienda', 'Ana', '4731234567', false, '{}');
  perform pg_temp.ok(r->>'folio' like 'SIM-__-0001', 'folio con formato SIM-AA-0001: ' || (r->>'folio'));
  perform pg_temp.ok((select count(*) from eventos where reporte_id = (r->>'id')::uuid) = 1, 'evento inicial');
end $$;

-- 2. Anónimo no guarda nombre
do $$ declare r jsonb; begin
  r := registrar_reporte('11111111-1111-4111-8111-111111111111', 'fauna', 21.0, -101.2, null, '{}', null, null, 'Pepe', '4731', true, '{}');
  perform pg_temp.ok((select nombre from reportes where id = (r->>'id')::uuid) is null, 'anónimo sin nombre');
end $$;

-- 3. Límite de reportes por hora
do $$ begin
  for i in 1..3 loop perform registrar_reporte('11111111-1111-4111-8111-111111111111', 'otra', 21, -101, null, '{}', null, null, null, null, false, '{}'); end loop;
  begin
    perform registrar_reporte('11111111-1111-4111-8111-111111111111', 'otra', 21, -101, null, '{}', null, null, null, null, false, '{}');
    raise exception 'FALLÓ: debía rechazar el sexto reporte';
  exception when others then perform pg_temp.ok(sqlerrm = 'limite_reportes', 'mensaje de límite: ' || sqlerrm); end;
end $$;

-- 4. Estados solo avanzan; falso cierra; cerrado no cambia
do $$ declare rid uuid := (select id from reportes where tipo = 'incendio'); begin
  perform cambiar_estado(rid, 'en_camino', 'Juan', 'telegram');
  begin perform cambiar_estado(rid, 'visto', 'Juan', 'telegram'); raise exception 'FALLÓ: retroceso permitido';
  exception when others then perform pg_temp.ok(sqlerrm = 'transicion_invalida', 'no retrocede: ' || sqlerrm); end;
  perform cambiar_estado(rid, 'cerrado', 'Jefe', 'telegram');
  begin perform cambiar_estado(rid, 'falso', 'Jefe', 'telegram'); raise exception 'FALLÓ: cambió un cerrado';
  exception when others then perform pg_temp.ok(sqlerrm = 'cerrado', 'cerrado es final: ' || sqlerrm); end;
end $$;

-- 5. Deshacer dentro de 2 minutos y vencido
do $$ declare rid uuid := (select id from reportes where tipo = 'incendio'); d jsonb; begin
  d := deshacer_estado(rid, 'Jefe');
  perform pg_temp.ok(d->>'deshecho' = 'cerrado' and d->>'estado' = 'en_camino', 'deshace el cierre');
  update eventos set creado_en = now() - interval '5 minutes' where reporte_id = rid;
  begin perform deshacer_estado(rid, 'Jefe'); raise exception 'FALLÓ: deshizo fuera de tiempo';
  exception when others then perform pg_temp.ok(sqlerrm = 'tiempo_vencido', 'plazo vencido: ' || sqlerrm); end;
end $$;

-- 6. El ciudadano no ve el cierre durante el plazo de deshacer
do $$ declare rid uuid := (select id from reportes where tipo = 'incendio'); m jsonb; begin
  perform cambiar_estado(rid, 'cerrado', 'Jefe', 'panel');
  perform pg_temp.como('11111111-1111-4111-8111-111111111111');
  m := mis_reportes();
  perform pg_temp.ok((select x->>'estado' from jsonb_array_elements(m) x where x->>'id' = rid::text) = 'en_camino', 'cierre oculto 2 min');
  perform pg_temp.ok((select count(*) from avisos_pendientes() where ref = rid) = 0, 'no avisa cierre antes de 2 min');
  update eventos set creado_en = creado_en - interval '3 minutes' where reporte_id = rid and estado = 'cerrado';
  m := mis_reportes();
  perform pg_temp.ok((select x->>'estado' from jsonb_array_elements(m) x where x->>'id' = rid::text) = 'cerrado', 'cierre visible después');
  perform pg_temp.ok((select count(*) from avisos_pendientes() where ref = rid and estado = 'cerrado') = 1, 'avisa cierre después');
  perform pg_temp.como('22222222-2222-4222-8222-222222222222');
  perform pg_temp.ok(jsonb_array_length(mis_reportes()) = 0, 'otro ciudadano no ve reportes ajenos');
end $$;

-- 7. Escalamiento: solo reportes "enviado" de más de 10 min, una sola vez
do $$ declare n int; begin
  update reportes set creado_en = now() - interval '11 minutes' where tipo = 'fauna';
  select count(*) into n from escalar_pendientes();
  perform pg_temp.ok(n = 1, 'escala 1 reporte, escaló ' || n);
  select count(*) into n from escalar_pendientes();
  perform pg_temp.ok(n = 0, 'no escala dos veces');
end $$;

-- 8. Revisiones: solicitar, proponer (solo coordinador/admin), confirmar, recordatorio
do $$ declare r jsonb; v uuid; begin
  r := solicitar_revision('33333333-3333-4333-8333-333333333333', '{gas,extintores}', 'Casa', 'Calle Positos 10', 'mañanas', 'Luis', '4739999999', null);
  v := (r->>'id')::uuid;
  perform pg_temp.ok(r->>'folio' like 'REV-__-0001', 'folio de revisión');
  insert into miembros_panel values ('44444444-4444-4444-8444-444444444444', 'guardia', 'Guardia'),
                                    ('55555555-5555-4555-8555-555555555555', 'coordinador', 'Coord');
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');
  begin perform panel_proponer_fecha(v, now() + interval '1 day', 'Pedro'); raise exception 'FALLÓ: guardia propuso fecha';
  exception when others then perform pg_temp.ok(sqlerrm = 'sin_permiso', 'guardia no agenda: ' || sqlerrm); end;
  perform pg_temp.como('55555555-5555-4555-8555-555555555555');
  perform panel_proponer_fecha(v, now() + interval '20 hours', 'Pedro', 'Llevamos detector');
  perform pg_temp.ok((select count(*) from avisos_pendientes() where fuente = 'revision' and ref = v and estado = 'propuesta') = 1, 'avisa la fecha propuesta');
  perform pg_temp.como('33333333-3333-4333-8333-333333333333');
  r := responder_revision(v, true);
  perform pg_temp.ok((select estado from revisiones where id = v) = 'confirmada', 'ciudadano confirma');
  perform pg_temp.ok((select count(*) from avisos_pendientes() where fuente = 'recordatorio' and ref = v) = 1, 'recordatorio un día antes');
  perform pg_temp.ok(jsonb_array_length(mis_revisiones()) = 1, 've su revisión');
end $$;

-- 9. Parte de servicio: solo personal del panel
do $$ declare rid uuid := (select id from reportes where tipo = 'incendio'); begin
  perform pg_temp.como('22222222-2222-4222-8222-222222222222');
  begin perform panel_guardar_parte(rid, '{}'); raise exception 'FALLÓ: ciudadano guardó parte';
  exception when others then perform pg_temp.ok(sqlerrm = 'sin_permiso', 'ciudadano no guarda parte: ' || sqlerrm); end;
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');
  perform panel_guardar_parte(rid, '{"unidad":"Unidad 1","personal":["Ana","Luis"],"agua_litros":"800","hora_salida":"2026-10-26T10:00:00-06:00"}');
  perform panel_guardar_parte(rid, '{"unidad":"Unidad 2","personal":["Ana"],"agua_litros":"900"}');
  perform pg_temp.ok((select unidad from partes_servicio where reporte_id = rid) = 'Unidad 2', 'parte se actualiza');
  perform pg_temp.ok((panel_informe(now() - interval '1 day', now() + interval '1 day')->>'agua_litros')::int = 900, 'informe suma agua');
  perform pg_temp.ok(jsonb_array_length(panel_reportes()) >= 5, 'panel ve reportes');
end $$;

-- 10. Info pública y vínculo de chats
do $$ declare i jsonb; cod text; begin
  i := info_publica();
  perform pg_temp.ok(i->'config'->'estacion'->>'nombre' is not null, 'config pública');
  perform pg_temp.ok(jsonb_array_length(i->'necesidades') >= 1, 'necesidades');
  select codigo into cod from chats where rol = 'alertas';
  perform pg_temp.ok(vincular_chat(lower(cod), -100123) = 'alertas', 'vincula por código');
  perform pg_temp.ok((select chat_id from chats where rol = 'alertas') = -100123, 'chat guardado');
end $$;

\echo 'TODAS LAS PRUEBAS DE SIMUB PASARON'
