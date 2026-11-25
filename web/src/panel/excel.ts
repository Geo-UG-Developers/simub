// Leer y escribir Excel (.xlsx / .xlsm) sin librerías pesadas: un .xlsx es un ZIP con XML.
// Lectura: devuelve las hojas como filas de valores crudos (número, texto o null).
// Escritura: hojas simples con encabezado en negritas y anchos de columna.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type Celda = string | number | null;
export interface Hoja { nombre: string; filas: Celda[][] }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const desxml = (t: string) => t.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);
const atr = (tag: string, nombre: string) => tag.match(new RegExp(`\\b${nombre}="([^"]*)"`))?.[1];

function columna(ref: string) {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export function leerExcel(datos: Uint8Array): Hoja[] {
  const zip = unzipSync(datos, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  const txt = (r: string) => (zip[r] ? strFromU8(zip[r]) : '');
  const compartidas = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => desxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rels = Object.fromEntries([...txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => [atr(m[0], 'Id'), atr(m[0], 'Target')]));
  const hojas: Hoja[] = [];
  for (const m of txt('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = desxml(atr(m[0], 'name') ?? '');
    const destino = rels[atr(m[0], 'r:id') ?? ''];
    if (!destino) continue;
    const ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`;
    const xml = txt(ruta);
    const filas: Celda[][] = [];
    for (const f of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const num = Number(atr(f[1] ?? f[3] ?? '', 'r')) - 1;
      const fila: Celda[] = [];
      for (const c of (f[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = atr(c[1], 'r'); const tipo = atr(c[1], 't'); const cuerpo = c[2] ?? '';
        const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val: Celda = null;
        if (tipo === 's' && v != null) val = compartidas[Number(v)] ?? null;
        else if (tipo === 'inlineStr') val = desxml([...cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (tipo === 'str' && v != null) val = desxml(v);
        else if (tipo === 'b' && v != null) val = v === '1' ? 1 : 0;
        else if (tipo === 'e') val = null;
        else if (v != null) val = Number(v);
        fila[ref ? columna(ref) : fila.length] = val;
      }
      filas[Number.isFinite(num) && num >= 0 ? num : filas.length] = Array.from(fila, (x) => x ?? null);
    }
    hojas.push({ nombre, filas: Array.from(filas, (x) => x ?? []) });
  }
  return hojas;
}

// ---------------------------------------------------------------- escritura
const xmlEsc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  // quita caracteres de control que Excel rechaza
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const letra = (i: number) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

export function escribirExcel(hojas: { nombre: string; filas: Celda[][]; anchos?: number[] }[]): Blob {
  const archivos: Record<string, Uint8Array> = {};
  const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    '</Types>'].join('');
  archivos['[Content_Types].xml'] = strToU8(ct);
  archivos['_rels/.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  archivos['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
    hojas.map((h, i) => `<sheet name="${xmlEsc(h.nombre.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  archivos['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
    hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
  }<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  archivos['xl/styles.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2DCDB"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>');
  hojas.forEach((h, i) => {
    const cols = h.anchos?.length ? `<cols>${h.anchos.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const filas = h.filas.map((f, r) => `<row r="${r + 1}">${f.map((v, c) => {
      if (v == null || v === '') return '';
      const ref = `${letra(c)}${r + 1}`, s = r === 0 ? ' s="1"' : '';
      return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>`
        : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
    }).join('')}</row>`).join('');
    archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${filas}</sheetData></worksheet>`);
  });
  return new Blob([zipSync(archivos, { level: 6 })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function descargar(blob: Blob, nombre: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
