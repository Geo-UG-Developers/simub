import assert from 'node:assert/strict';
import { leerBoton, leerComando, teclado, textoAlerta, textoRevision } from './mensajes.ts';

const ID = '0f8b6c1e-2a4d-4c5e-9f00-1234567890ab';

Deno.test('botones solo hacia adelante y cierre aparte', () => {
  const t = teclado(ID, 'en_camino');
  const datos = t.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(datos, [`e|${ID}|atendiendo`, `e|${ID}|cerrado`, `e|${ID}|falso`]);
  assert.equal(teclado(ID, 'cerrado').inline_keyboard.length, 0);
  assert.equal(teclado(ID, 'cerrado', true).inline_keyboard[0][0].callback_data, `u|${ID}`);
});

Deno.test('leer botones y comandos', () => {
  assert.deepEqual(leerBoton(`c|${ID}|cerrado`), { tipo: 'confirmar', id: ID, estado: 'cerrado' });
  assert.deepEqual(leerBoton('n|cat|evento'), { tipo: 'noticia', op: 'cat', arg: 'evento' });
  assert.deepEqual(leerBoton('q|u|12'), { tipo: 'necesidad', op: 'u', arg: '12' });
  assert.deepEqual(leerBoton('q|a'), { tipo: 'necesidad', op: 'a', arg: '' });
  assert.equal(leerBoton(`e|${ID}|enviado`), null);
  assert.equal(leerBoton('otra cosa'), null);
  assert.deepEqual(leerComando('/vincular@SimubGtoBot ab12'), { comando: 'vincular', arg: 'ab12' });
});

Deno.test('texto de alerta escapa HTML y respeta 1024', () => {
  const t = textoAlerta({ folio: 'SIM-26-0001', tipo: 'gas', estado: 'enviado', lat: 21, lon: -101,
    detalles: { resumen: ['Origen: <cilindro>'] }, comentario: 'x'.repeat(2000), nombre: 'Ana', telefono: '473 123' });
  assert.ok(t.includes('&lt;cilindro&gt;'));
  assert.ok(t.length <= 1024);
  assert.ok(t.startsWith('<b>NUEVO REPORTE</b>'));
});

Deno.test('texto de revisión', () => {
  const t = textoRevision({ folio: 'REV-26-0001', estado: 'solicitada', motivos: ['gas', 'extintores'], direccion: 'Calle 1',
    nombre: 'Luis', telefono: '473' });
  assert.ok(t.includes('Instalación de gas, Extintores'));
});
