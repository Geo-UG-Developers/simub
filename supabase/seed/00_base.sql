-- Datos base. Los valores entre [corchetes] se reemplazan cuando SIMUB entregue su formulario.
insert into chats (rol) values ('alertas'), ('comunicacion'), ('respaldo') on conflict do nothing;

insert into config_publica (clave, valor) values
 ('estacion', '{"nombre": "Bomberos SIMUB Voluntarios, A.C.", "telefono": "", "telefono_texto": "[Teléfono de la estación]",
   "direccion": "[Dirección de la estación]", "horario": "24 horas", "correo": "", "redes": {},
   "quienes_somos": "Somos una corporación de bomberos voluntarios al servicio de Guanajuato capital. [Texto pendiente de SIMUB]"}'),
 ('donativos', '{"titular": "[Titular de la cuenta]", "banco": "[Banco]", "clabe": "", "clabe_texto": "[CLABE de 18 dígitos]",
   "concepto": "Donativo SIMUB", "enlace_pago": "", "montos": [100, 200, 500], "recibo_deducible": false,
   "contacto_recibo": "[Correo o WhatsApp]", "voluntariado": "[Requisitos para sumarse como voluntario: pendiente de SIMUB]"}'),
 ('revisiones', '{"dias": "Lunes a viernes", "horario": "9:00 a 17:00", "costo": "[Gratis o donativo sugerido]", "anticipacion_dias": 3}')
on conflict (clave) do nothing;
