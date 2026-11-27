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

-- 11. Límite por teléfono, conservación y limpieza
do $$ declare r jsonb; begin
  for i in 1..5 loop perform registrar_reporte(gen_random_uuid(), 'otra', 21, -101, null, '{}', null, null, null, '473-555-0101', false, '{}'); end loop;
  begin perform registrar_reporte(gen_random_uuid(), 'otra', 21, -101, null, '{}', null, null, null, '4735550101', false, '{}');
    raise exception 'FALLÓ: debía limitar por teléfono';
  exception when others then perform pg_temp.ok(sqlerrm = 'limite_reportes', 'límite por teléfono: ' || sqlerrm); end;
  perform pg_temp.ok(revisar_avalancha() = 0, 'sin avalancha con pocos reportes');
  update reportes set fotos = '{a.jpg}', creado_en = now() - interval '13 months' where tipo = 'fauna';
  r := aplicar_conservacion();
  perform pg_temp.ok(jsonb_array_length(r->'fotos') = 1, 'devuelve fotos viejas');
  perform pg_temp.ok((select nombre is null and telefono is null and cardinality(fotos) = 0 from reportes where tipo = 'fauna'), 'anonimiza a los 12 meses');
  insert into miembros_panel (user_id, rol, nombre, superusuario) values ('66666666-6666-4666-8666-666666666666', 'admin', 'Admin', true) on conflict do nothing;
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');
  begin perform limpiar_datos_prueba(); raise exception 'FALLÓ: guardia limpió datos';
  exception when others then perform pg_temp.ok(sqlerrm = 'sin_permiso', 'solo admin limpia: ' || sqlerrm); end;
  perform pg_temp.como('66666666-6666-4666-8666-666666666666');
  r := limpiar_datos_prueba();
  perform pg_temp.ok((select count(*) from reportes) = 0 and (select count(*) from revisiones) = 0, 'limpieza total');
  r := registrar_reporte(gen_random_uuid(), 'gas', 21, -101, null, '{}', null, null, null, null, false, '{}');
  perform pg_temp.ok(r->>'folio' like 'SIM-__-0001', 'folios reinician: ' || (r->>'folio'));
end $$;

-- 12. Servicios: folio anual, unidades, bitácora, cierre, importación del histórico y conteos
do $$ declare a jsonb; b jsonb; r jsonb; m jsonb; c jsonb; uid_m4 int; begin
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');   -- guardia
  perform pg_temp.ok((select count(*) from unidades where nombre = 'U-08') = 1, 'unidades reales cargadas');
  perform pg_temp.ok((select valor->>'telefono' from config_publica where clave = 'estacion') = '4737346959', 'teléfono real');
  a := panel_guardar_servicio(null, '{"clasificacion":"inc_pastizal","fecha":"2026-03-02","lugar":"Col. Yerbabuena","medio":"911","unidades":["U-08","M-16"]}');
  b := panel_guardar_servicio(null, '{"clasificacion":"acc_moto","fecha":"2026-03-02","unidades":["U-04"]}');
  perform pg_temp.ok((b->>'folio')::int = (a->>'folio')::int + 1, 'folio consecutivo');
  perform pg_temp.ok((select estado from unidades where nombre = 'U-08') = 'en_servicio', 'unidad ocupada al asignarla');
  perform panel_bitacora((a->>'id')::uuid, null, 'llegada');
  perform pg_temp.ok((select h_llegada is not null from servicios where id = (a->>'id')::uuid), 'hito llegada guarda hora');
  perform panel_bitacora((a->>'id')::uuid, 'Se requiere apoyo de pipa', null);
  perform pg_temp.ok((select count(*) from bitacora where servicio_id = (a->>'id')::uuid) = 3, 'bitácora con autor');
  perform panel_guardar_servicio((a->>'id')::uuid, '{"clasificacion":"inc_pastizal","fecha":"2026-03-02","unidades":["U-08"],"apoyos":{"Cruz Roja":{"unidades":"CR-1"}}}');
  perform pg_temp.ok((select estado from unidades where nombre = 'M-16') = 'disponible', 'unidad liberada al quitarla');
  m := panel_mando();
  perform pg_temp.ok(jsonb_array_length(m->'servicios') = 2, 'mando: 2 activos');
  perform panel_cerrar_servicio((a->>'id')::uuid);
  perform pg_temp.ok((select estado from unidades where nombre = 'U-08') = 'disponible', 'cerrar libera unidades');
  begin perform panel_anular_servicio((b->>'id')::uuid, 'duplicado'); raise exception 'FALLÓ: guardia anuló';
  exception when others then perform pg_temp.ok(sqlerrm = 'solo_admin', 'solo admin anula: ' || sqlerrm); end;
  begin perform panel_importar_servicios('[]'); raise exception 'FALLÓ: guardia importó';
  exception when others then perform pg_temp.ok(sqlerrm = 'solo_admin', 'solo admin importa: ' || sqlerrm); end;
  perform pg_temp.como('66666666-6666-4666-8666-666666666666');   -- admin
  r := panel_importar_servicios('[{"anio":2026,"folio":1,"fecha":"2026-01-01","clasificacion":"inc_baldio","h_despacho":"2026-01-01T00:27:00-06:00","h_base":"2026-01-01T01:25:00-06:00","unidades":["U-08"],"personal_num":2},
     {"anio":2026,"folio":500,"fecha":"2026-03-02","clasificacion":"inc_pastizal","falsa_alarma":true},
     {"anio":2026,"folio":2,"fecha":"2026-01-01","clasificacion":"no_existe"}]');
  perform pg_temp.ok((r->>'importados')::int = 1 and (r->>'omitidos')::int = 2, 'importa sin pisar capturas: ' || r::text);
  r := panel_importar_servicios('[{"anio":2026,"folio":1,"fecha":"2026-01-01","clasificacion":"inc_pastizal"}]');
  perform pg_temp.ok((select clasificacion from servicios where anio = 2026 and folio = 1) = 'inc_pastizal', 're-importar actualiza');
  perform panel_anular_servicio((b->>'id')::uuid, 'duplicado');
  c := panel_conteos(2026);
  perform pg_temp.ok((select sum((x->>'n')::int) from jsonb_array_elements(c->'conteos') x) = 2, 'conteo excluye anulados: ' || c::text);
  perform pg_temp.ok((c->'apoyos'->>'Cruz Roja')::int = 1, 'conteo de apoyos');
  r := registrar_reporte(gen_random_uuid(), 'fauna', 21, -101, null, '{"valores":{"animal":"abejas"}}', null, 'kínder', null, null, false, '{}');
  a := panel_servicio_desde_reporte((r->>'id')::uuid);
  perform pg_temp.ok((select clasificacion from servicios where id = (a->>'id')::uuid) = 'fau_enjambre', 'servicio desde reporte clasifica');
  perform pg_temp.ok((panel_servicio_desde_reporte((r->>'id')::uuid))->>'id' = a->>'id', 'no duplica servicio del reporte');
  r := limpiar_datos_prueba();
  perform pg_temp.ok((select count(*) from servicios) = 1 and (select origen from servicios) = 'historico', 'limpieza conserva histórico');
end $$;

-- 13. Permisos de cabina, firma con candado, sesiones/turnos, auditoría, respaldo y voluntariado
do $$ declare a jsonb; s1 bigint; s2 bigint; c jsonb; r jsonb; begin
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');   -- cabina (guardia)
  a := panel_guardar_servicio(null, '{"clasificacion":"fuga_gas","colonia":"Marfil","lugar":"Calle 1","medio":"911","datos":{"folio_911":"G-77"}}');
  perform pg_temp.ok((select capturo from servicios where id = (a->>'id')::uuid) = 'Guardia', 'registra quién capturó');
  perform pg_temp.ok((select texto from bitacora where servicio_id = (a->>'id')::uuid order by id limit 1) like '%folio 911 G-77%', 'bitácora con folio 911');
  perform panel_firmar((a->>'id')::uuid, 'jefe_servicio', 'Ana López', 'data:image/png;base64,AAAA', 'abc');
  perform pg_temp.ok((select bloqueado and jefe_servicio = 'Ana López' from servicios where id = (a->>'id')::uuid), 'firma del jefe bloquea');
  begin perform panel_guardar_servicio((a->>'id')::uuid, '{"clasificacion":"fuga_gas"}'); raise exception 'FALLÓ: cabina editó un parte firmado';
  exception when others then perform pg_temp.ok(sqlerrm = 'bloqueado', 'cabina no edita firmado: ' || sqlerrm); end;
  begin perform panel_reabrir_servicio((a->>'id')::uuid); raise exception 'FALLÓ: cabina reabrió';
  exception when others then perform pg_temp.ok(sqlerrm in ('solo_admin', 'transicion_invalida'), 'cabina no reabre: ' || sqlerrm); end;
  -- (las tablas de ajustes las protege RLS en Supabase: solo admin las edita)
  perform pg_temp.ok(exists (select 1 from pg_policies where tablename = 'unidades' and policyname = 'unidades_editar'), 'regla de edición de unidades');
  begin perform panel_control(now() - interval '1 day', now() + interval '1 day'); raise exception 'FALLÓ: cabina vio control';
  exception when others then perform pg_temp.ok(sqlerrm = 'sin_permiso', 'control solo admin'); end;
  s1 := panel_sesion_iniciar('Cabina PC', null);
  perform pg_temp.ok((panel_latido(s1))->>'activa' = 'true', 'latido');
  perform panel_sesion_cerrar(s1, 'cambio_turno');
  r := panel_respaldo(extract(year from now())::int);
  perform pg_temp.ok(jsonb_array_length(r->'servicios') >= 1, 'respaldo con servicios');
  perform pg_temp.como('66666666-6666-4666-8666-666666666666');   -- admin
  s2 := panel_sesion_iniciar('Cabina PC', s1);
  perform pg_temp.ok((select turno_de from sesiones where id = s2) = 'Guardia', 'cambio de turno anotado');
  perform panel_guardar_servicio((a->>'id')::uuid, '{"clasificacion":"fuga_gas","colonia":"Marfil"}');
  update unidades set tipo = 'Motobomba 2' where nombre = 'M-01';
  c := panel_control(now() - interval '1 day', now() + interval '1 day');
  perform pg_temp.ok(jsonb_array_length(c->'sesiones') = 2, 'sesiones listadas');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(c->'auditoria') x where x->>'accion' = 'servicio_corregido'), 'corrección auditada');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(c->'auditoria') x where x->>'accion' = 'update' and x->>'tabla' = 'unidades'), 'ajuste auditado');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(c->'auditoria') x where x->>'accion' = 'cambio_turno'), 'turno auditado');
  perform pg_temp.ok(jsonb_array_length((c->'sesiones'->1)->'folios') >= 1 or jsonb_array_length((c->'sesiones'->0)->'folios') >= 1, 'folios por sesión');
  perform pg_temp.ok((panel_auditoria_borrar(array[(select min(id) from auditoria)]))->>'borradas' = '1', 'super borra auditoría');
  update miembros_panel set superusuario = false where user_id = '66666666-6666-4666-8666-666666666666';
  begin perform panel_auditoria_borrar(array[1::bigint]); raise exception 'FALLÓ: admin borró auditoría';
  exception when others then perform pg_temp.ok(sqlerrm = 'sin_permiso', 'solo super borra auditoría'); end;
  begin perform limpiar_datos_prueba(); raise exception 'FALLÓ: admin borró datos';
  exception when others then perform pg_temp.ok(sqlerrm = 'sin_permiso', 'solo super prepara producción'); end;
  perform pg_temp.como('11111111-1111-4111-8111-111111111111');
  r := registrar_voluntario('{"nombre":"Juan Pérez","edad":20,"telefono":"4731234567","correo":"j@x.mx","disponibilidad":["fines"]}');
  perform pg_temp.ok((select count(*) from voluntarios) = 1, 'voluntario registrado');
  begin perform registrar_voluntario('{"nombre":"Niño","edad":16,"telefono":"4731234567"}'); raise exception 'FALLÓ: menor de edad';
  exception when others then perform pg_temp.ok(sqlerrm like '%violates check%', 'mayor de 18'); end;
end $$;

-- 14. Turnos, guardia, campo, escena, inspecciones y alertas
do $$ declare a jsonb; b jsonb; c jsonb; e bigint; r jsonb; begin
  perform pg_temp.ok(turno_de('2026-11-27 07:59:00-06') = 'noche' and turno_de('2026-11-27 08:00:00-06') = 'dia' and turno_de('2026-11-27 20:00:00-06') = 'noche', 'turnos por hora');
  perform pg_temp.ok(fecha_turno('2026-11-28 03:00:00-06') = '2026-11-27', 'la madrugada pertenece a la noche anterior');
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');   -- cabina
  r := panel_guardia_guardar('Laura Méndez', array['Laura Méndez', 'Juan Pérez']);
  perform pg_temp.ok(r->>'jefe' = 'Laura Méndez', 'guardia del turno');
  a := panel_guardar_servicio(null, '{"clasificacion":"inc_pastizal","colonia":"Marfil","unidades":["U-04"]}');
  perform pg_temp.ok((select turno = turno_de(now()) and jefe_guardia = 'Laura Méndez' from servicios where id = (a->>'id')::uuid), 'servicio con turno y jefe de guardia');
  insert into miembros_panel (user_id, rol, nombre, unidad) values ('77777777-7777-4777-8777-777777777777', 'campo', 'Unidad U-04', 'U-04') on conflict do nothing;
  b := panel_guardar_servicio(null, '{"clasificacion":"acc_moto","unidades":["M-01"]}');
  perform pg_temp.como('77777777-7777-4777-8777-777777777777');   -- celular de la U-04
  c := panel_campo();
  perform pg_temp.ok(jsonb_array_length(c->'servicios') = 1 and c->'servicios'->0->>'id' = a->>'id', 'campo ve solo su unidad');
  perform panel_bitacora((a->>'id')::uuid, null, 'llegada', 21.01, -101.25);
  perform pg_temp.ok((select lat from bitacora where servicio_id = (a->>'id')::uuid and texto = 'Llegada a la escena') = 21.01, 'hito con GPS');
  perform panel_escena((a->>'id')::uuid, 'entra', 'Juan Pérez', 'Ataque');
  select id into e from en_escena where servicio_id = (a->>'id')::uuid;
  perform panel_escena((a->>'id')::uuid, 'aire', null, null, 45, e);
  perform pg_temp.ok((select aire_min = 45 and aire_inicio is not null from en_escena where id = e), 'tiempo de aire');
  perform panel_escena((a->>'id')::uuid, 'sale', null, null, null, e);
  perform panel_servicio_parcial((a->>'id')::uuid, '{"perimetro":{"type":"Polygon","coordinates":[]},"area_afectada":"2.3 ha","recursos":{"agua_litros":800}}');
  perform pg_temp.ok((select area_afectada = '2.3 ha' and (recursos->>'agua_litros')::int = 800 from servicios where id = (a->>'id')::uuid), 'datos de campo parciales');
  perform panel_posicion('U-04', 21.0, -101.2, 10, (a->>'id')::uuid);
  insert into inspecciones (unidad, checklist, fallas, critica) values ('M-02', '{"Frenos":"falla"}', '{Frenos}', true);
  perform pg_temp.ok((select estado from unidades where nombre = 'M-02') = 'fuera_servicio', 'falla crítica saca la unidad de servicio');
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');
  r := panel_alertas();
  perform pg_temp.ok(jsonb_array_length(r->'sin_inspeccion') >= 1, 'alerta de unidades sin inspección');
  r := panel_mando();
  perform pg_temp.ok(jsonb_array_length(r->'posiciones') = 1 and r->'guardia'->>'jefe' = 'Laura Méndez', 'mando con posiciones y guardia');
  r := resumen_turno(fecha_turno(now()), turno_de(now()));
  perform pg_temp.ok((r->>'total')::int >= 2, 'resumen del turno: ' || r::text);
  r := datos_servicio_tg((a->>'id')::uuid);
  perform pg_temp.ok(r->>'clase' = 'INCENDIO PASTIZAL', 'datos para Telegram');
end $$;

-- 15. Oficiales, envíos, accesos con límite, permisos de Admin. Maestro y autorización de correcciones
do $$ declare a jsonb; r jsonb; cod text; i int; v text; begin
  -- límite de intentos de acceso
  for i in 1..4 loop r := acceso_registrar('Prueba@Simub.mx', false); end loop;
  perform pg_temp.ok((r->>'fallos')::int = 4 and acceso_estado('prueba@simub.mx')->>'bloqueado_hasta' is null, '4 fallos aún no bloquean');
  r := acceso_registrar('prueba@simub.mx', false);
  perform pg_temp.ok((r->>'bloqueado')::boolean and acceso_estado('prueba@simub.mx')->>'bloqueado_hasta' is not null, 'el 5.º fallo bloquea');
  perform pg_temp.ok(exists (select 1 from auditoria where accion = 'acceso_bloqueado'), 'bloqueo en control interno');
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');   -- cabina
  begin perform panel_desbloquear_acceso('prueba@simub.mx'); perform pg_temp.ok(false, 'cabina no desbloquea'); exception when insufficient_privilege then null; end;
  perform pg_temp.ok(panel_conteos(2026) is null and panel_cuentas() = '[]'::jsonb, 'cabina no ve informes ni cuentas');
  perform pg_temp.como('66666666-6666-4666-8666-666666666666');   -- admin
  perform panel_desbloquear_acceso('prueba@simub.mx');
  perform pg_temp.ok(acceso_estado('prueba@simub.mx')->>'bloqueado_hasta' is null and (acceso_estado('prueba@simub.mx')->>'fallos')::int = 0, 'admin desbloquea');
  perform pg_temp.ok(panel_conteos(extract(year from now())::int) ? 'dias', 'informe con conteo por día');
  -- oficiales
  insert into personal (nombre, nombre_corto, comunicacion_interna, telefono) values ('Oficial de Prueba', 'O. Prueba', true, '4730000000') returning tg_codigo into cod;
  r := panel_oficiales();
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) x where x->>'nombre' = 'Oficial de Prueba' and x->>'enlace' like '%start=OF%'), 'lista de oficiales con enlace');
  v := vincular_oficial(lower(cod), 900001);
  perform pg_temp.ok(v = 'O. Prueba' and (select tg_chat_id from personal where nombre = 'Oficial de Prueba') = 900001, 'oficial vinculado al bot');
  a := panel_guardar_servicio(null, '{"clasificacion":"inc_pastizal","colonia":"Centro","reportante":"Ana","telefono":"4731112233"}');
  insert into envios (servicio_id, destino, personal_id, nombre, por) select (a->>'id')::uuid, 'oficial', id, 'O. Prueba', 'Admin' from personal where nombre = 'Oficial de Prueba';
  r := panel_mando();
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r->'servicios') x where x->>'id' = a->>'id' and x->'enviado_oficial' ? 'O. Prueba'
    and not (x->>'enviado_interno')::boolean), 'mando sabe a quién se envió');
  -- corrección de un parte cerrado: cabina necesita autorización
  perform panel_cerrar_servicio((a->>'id')::uuid);
  update servicios set h_base = now() - interval '2 hours' where id = (a->>'id')::uuid;
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');
  begin perform panel_guardar_servicio((a->>'id')::uuid, '{"observaciones":"cambio"}'); perform pg_temp.ok(false, 'cabina no corrige cerrado'); exception when insufficient_privilege then null; end;
  begin perform panel_autorizar((a->>'id')::uuid, '44444444-4444-4444-8444-444444444444'); perform pg_temp.ok(false, 'cabina no se autoriza sola'); exception when insufficient_privilege then null; end;
  perform pg_temp.como('66666666-6666-4666-8666-666666666666');
  r := panel_autorizar((a->>'id')::uuid, '44444444-4444-4444-8444-444444444444');
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');
  perform panel_guardar_servicio((a->>'id')::uuid, '{"observaciones":"corregido con autorización"}');
  perform pg_temp.ok((select observaciones from servicios where id = (a->>'id')::uuid) = 'corregido con autorización', 'cabina corrige con autorización');
  perform pg_temp.ok(exists (select 1 from auditoria where accion = 'edicion_autorizada'), 'autorización en control interno');
end $$;

-- 16. Ajustes: cambio de contraseña obligatorio, baja de personas y miembros de grupos
do $$ declare r jsonb; i int; begin
  update miembros_panel set cambiar_clave = true where user_id = '44444444-4444-4444-8444-444444444444';
  perform pg_temp.como('44444444-4444-4444-8444-444444444444');
  perform pg_temp.ok((panel_yo()->>'cambiar_clave')::boolean, 'debe cambiar contraseña');
  perform panel_clave_cambiada();
  perform pg_temp.ok(not (panel_yo()->>'cambiar_clave')::boolean, 'contraseña cambiada');
  select id into i from personal where nombre = 'Oficial de Prueba';
  begin perform panel_borrar_persona(i); perform pg_temp.ok(false, 'cabina no borra personal'); exception when insufficient_privilege then null; end;
  perform pg_temp.ok(panel_miembros_grupos() is null, 'cabina no ve miembros de grupos');
  perform pg_temp.como('66666666-6666-4666-8666-666666666666');
  r := panel_miembros_grupos();
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r->'interno') x where x->>'corto' = 'O. Prueba'), 'oficial en grupo interno');
  perform panel_borrar_persona(i);
  perform pg_temp.ok(not exists (select 1 from personal where id = i) and exists (select 1 from auditoria where accion = 'persona_borrada'), 'persona borrada y auditada');
end $$;

\echo 'TODAS LAS PRUEBAS DE SIMUB PASARON'
