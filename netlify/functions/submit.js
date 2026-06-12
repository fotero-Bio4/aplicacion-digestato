'use strict';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const CORS  = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// ── Graph helpers ─────────────────────────────────────────────────────────────
async function getToken() {
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET } = process.env;
  const r = await fetch(
    `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type: 'client_credentials', client_id: GRAPH_CLIENT_ID,
        client_secret: GRAPH_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default',
      }),
    }
  );
  const d = await r.json();
  if (!d.access_token) throw new Error('Auth: ' + (d.error_description || JSON.stringify(d)));
  return d.access_token;
}

async function readSheet(token, driveId, itemId, sheet) {
  const enc = encodeURIComponent(sheet);
  const r   = await fetch(
    `${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets/${enc}/usedRange(valuesOnly=true)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return [];
  const { values = [] } = await r.json();
  return values;
}

async function readSheetWithFormulas(token, driveId, itemId, sheet) {
  const enc = encodeURIComponent(sheet);
  const r   = await fetch(
    `${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets/${enc}/usedRange`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return { values: [], formulas: [] };
  const d = await r.json();
  return { values: d.values || [], formulas: d.formulas || [] };
}

async function getWorksheets(token, driveId, itemId) {
  const r = await fetch(
    `${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return [];
  const { value = [] } = await r.json();
  return value.map(ws => ws.name);
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Convierte fecha YYYY-MM-DD a serial Excel (base: 25569 = días entre 1900-01-01 y 1970-01-01)
function dateToExcel(dateStr) {
  return Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000) + 25569;
}

// Calcula el Mes en formato numérico: mes*10000 + año (ej: junio 2026 → 62026)
function calcMes(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return (d.getUTCMonth() + 1) * 10000 + d.getUTCFullYear();
}

async function patchRange(token, driveId, itemId, sheet, addr, rowValues) {
  const enc = encodeURIComponent(sheet);
  const r   = await fetch(
    `${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets/${enc}/range(address='${addr}')`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values: [rowValues] }),
    }
  );
  if (!r.ok) throw new Error(`Patch ${addr}: ${r.status} ${await r.text()}`);
}

// Dada la lista de rows leída, calcula el número Excel (1-indexed) de la siguiente fila libre
function nextRowFromRows(rows, keyColIdx = 0) {
  let lastDataRow = 1; // fila de headers = Excel row 1
  for (let i = 1; i < rows.length; i++) {
    const val = rows[i][keyColIdx];
    if (val !== null && val !== undefined && val !== '' && val !== 0) {
      lastDataRow = i + 1; // i es 0-indexed; Excel row = i+1
    }
  }
  return lastDataRow + 1;
}

// ── Validar login ─────────────────────────────────────────────────────────────
async function validateUser(token, driveId, itemId, usuario, pss) {
  const rows = await readSheet(token, driveId, itemId, 'USUARIOS');
  const row  = rows.slice(1).find(r =>
    String(r[0] ?? '').trim().toLowerCase() === String(usuario).trim().toLowerCase() &&
    String(r[1] ?? '').trim() === String(pss).trim()
  );
  if (!row) return null;
  return {
    proveedor:    String(row[0]).trim(),
    permCamiones: String(row[2] ?? '').trim().toLowerCase() === 'si',
    permEstercol: String(row[3] ?? '').trim().toLowerCase() === 'si',
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Método no permitido' }) };

  const { BD_DRIVE_ID, BD_ITEM_ID, GRAPH_CLIENT_SECRET } = process.env;
  if (!GRAPH_CLIENT_SECRET || !BD_DRIVE_ID || !BD_ITEM_ID)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Servidor no configurado.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Cuerpo inválido.' }) }; }

  const { usuario, pss, tipo } = body;
  if (!usuario || !pss)          return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Credenciales requeridas.' }) };
  if (!['camiones', 'estercolero'].includes(tipo))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Tipo inválido.' }) };

  try {
    const token   = await getToken();
    const driveId = BD_DRIVE_ID;
    const itemId  = BD_ITEM_ID;

    // Re-validar credenciales
    const user = await validateUser(token, driveId, itemId, usuario, pss);
    if (!user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Credenciales incorrectas.' }) };
    if (tipo === 'camiones'    && !user.permCamiones) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Sin permiso para camiones.' }) };
    if (tipo === 'estercolero' && !user.permEstercol) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Sin permiso para estercolero.' }) };

    // Encontrar hoja exacta
    const wsNames = await getWorksheets(token, driveId, itemId);
    let sheetName;
    if (tipo === 'camiones') {
      sheetName = wsNames.find(n => n.trim().toUpperCase() === user.proveedor.toUpperCase());
    } else {
      sheetName = wsNames.find(n => n.trim().toUpperCase() === user.proveedor.toUpperCase() + ' ESTERCOLERO');
    }
    if (!sheetName) throw new Error(`Hoja no encontrada para ${user.proveedor} (${tipo})`);

    const { fecha, localidad, campo } = body;
    if (!fecha)     return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'La fecha es obligatoria.' }) };
    if (!localidad) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'La localidad es obligatoria.' }) };
    if (!campo)     return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'El campo es obligatorio.' }) };

    const mes       = calcMes(fecha);
    const excelFecha = dateToExcel(fecha);

    if (tipo === 'camiones') {
      // Campos: Mes(0) Fecha(1) Localidad(2) Campo(3) RemitN(4) Patente(5) Bruto(6) Tara(7) Neto(8)
      const { remito, patente, bruto, tara } = body;
      const brutoNum = Number(bruto) || 0;
      const taraNum  = Number(tara)  || 0;
      const neto     = brutoNum - taraNum;

      if (!patente) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'La patente es obligatoria.' }) };

      // Leer headers para conocer el ancho de la fila
      const rows    = await readSheet(token, driveId, itemId, sheetName);
      const nCols   = (rows[0] || []).length;
      const nextRow = nextRowFromRows(rows, 0);

      const rowData = Array(nCols).fill('');
      rowData[0] = mes;
      rowData[1] = excelFecha;
      rowData[2] = localidad;
      rowData[3] = campo;
      rowData[4] = remito || '';
      rowData[5] = patente;
      rowData[6] = brutoNum;
      rowData[7] = taraNum;
      rowData[8] = neto;

      const addr = `A${nextRow}:${colLetter(nCols)}${nextRow}`;

      // Leer fila destino para preservar fórmulas existentes
      const { formulas } = await readSheetWithFormulas(token, driveId, itemId, sheetName);
      if (formulas[nextRow - 1]) {
        for (let c = 0; c < nCols; c++) {
          const f = formulas[nextRow - 1][c];
          if (typeof f === 'string' && f.startsWith('=') && rowData[c] === '') rowData[c] = f;
        }
      }

      await patchRange(token, driveId, itemId, sheetName, addr, rowData);

    } else {
      // Estercolero: Mes(0) Fecha(1) Localidad(2) Campo(3) Lote(4) Nviajes(5) CapTanque(6) CantM3(7) Campaña(8)
      const { lote, nviajes, captanque, campana } = body;
      const nv  = Number(nviajes)   || 0;
      const ct  = Number(captanque) || 0;
      const cm3 = nv * ct;

      if (!lote) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'El lote es obligatorio.' }) };

      const rows    = await readSheet(token, driveId, itemId, sheetName);
      const nCols   = (rows[0] || []).length;
      const nextRow = nextRowFromRows(rows, 0);

      const rowData = Array(nCols).fill('');
      rowData[0] = mes;
      rowData[1] = excelFecha;
      rowData[2] = localidad;
      rowData[3] = campo;
      rowData[4] = lote;
      rowData[5] = nv;
      rowData[6] = ct;
      rowData[7] = cm3;
      rowData[8] = campana || '';

      const addr = `A${nextRow}:${colLetter(nCols)}${nextRow}`;

      const { formulas } = await readSheetWithFormulas(token, driveId, itemId, sheetName);
      if (formulas[nextRow - 1]) {
        for (let c = 0; c < nCols; c++) {
          const f = formulas[nextRow - 1][c];
          if (typeof f === 'string' && f.startsWith('=') && rowData[c] === '') rowData[c] = f;
        }
      }

      await patchRange(token, driveId, itemId, sheetName, addr, rowData);
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('[submit]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Error del servidor: ' + err.message }) };
  }
};
