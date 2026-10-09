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

async function getWorksheets(token, driveId, itemId) {
  const r = await fetch(
    `${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return [];
  const { value = [] } = await r.json();
  return value.map(ws => ws.name);
}

// YYYY-MM-DD → serial Excel
function dateToExcel(dateStr) {
  return Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000) + 25569;
}

// Valor de celda Fecha → serial Excel (acepta número o texto dd/mm/yyyy | yyyy-mm-dd)
function cellToSerial(v) {
  if (typeof v === 'number') return Math.floor(v);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return dateToExcel(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dateToExcel(`${m[1]}-${m[2]}-${m[3]}`);
  return null;
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

  const { usuario, pss, tipo, desde, hasta } = body;
  if (!usuario || !pss) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Credenciales requeridas.' }) };
  if (!['camiones', 'estercolero'].includes(tipo))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Tipo inválido.' }) };
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoRe.test(desde || '') || !isoRe.test(hasta || ''))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Fechas desde/hasta inválidas.' }) };
  if (desde > hasta)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'La fecha desde no puede ser mayor a la fecha hasta.' }) };

  try {
    const token   = await getToken();
    const driveId = BD_DRIVE_ID;
    const itemId  = BD_ITEM_ID;

    const user = await validateUser(token, driveId, itemId, usuario, pss);
    if (!user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Credenciales incorrectas.' }) };
    if (tipo === 'camiones'    && !user.permCamiones) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Sin permiso para camiones.' }) };
    if (tipo === 'estercolero' && !user.permEstercol) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Sin permiso para estercolero.' }) };

    // La hoja se resuelve siempre desde el usuario validado: cada uno ve solo lo suyo
    const wsNames = await getWorksheets(token, driveId, itemId);
    const target  = tipo === 'camiones' ? user.proveedor.toUpperCase() : user.proveedor.toUpperCase() + ' ESTERCOLERO';
    const sheetName = wsNames.find(n => n.trim().toUpperCase() === target);
    if (!sheetName) throw new Error(`Hoja no encontrada para ${user.proveedor} (${tipo})`);

    const rows = await readSheet(token, driveId, itemId, sheetName);

    // Ubicar la fila de encabezados buscando la celda "Fecha"
    let hdrIdx = -1, fechaCol = -1;
    for (let i = 0; i < Math.min(rows.length, 10) && hdrIdx < 0; i++) {
      const c = rows[i].findIndex(v => String(v ?? '').trim().toLowerCase() === 'fecha');
      if (c >= 0) { hdrIdx = i; fechaCol = c; }
    }
    if (hdrIdx < 0) throw new Error(`No se encontraron encabezados en la hoja ${sheetName}`);

    // Columnas = las que tienen encabezado (en estercolero no se muestran Cap tanque ni cantidad m3)
    const ocultas = tipo === 'estercolero' ? /^(cap\.? tanque|cantidad m3)$/i : null;
    const cols    = [];
    rows[hdrIdx].forEach((v, c) => {
      const h = String(v ?? '').trim();
      if (h && !(ocultas && ocultas.test(h))) cols.push({ c, h });
    });
    const headers = cols.map(x => x.h);

    const dMin = dateToExcel(desde);
    const dMax = dateToExcel(hasta);
    const data = [];
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const serial = cellToSerial(rows[i][fechaCol]);
      if (serial == null || serial < dMin || serial > dMax) continue;
      data.push({ fecha: serial, values: cols.map(x => rows[i][x.c] ?? '') });
    }
    data.sort((a, b) => a.fecha - b.fecha);

    return {
      statusCode: 200,
      headers:    CORS,
      body:       JSON.stringify({
        ok: true,
        sheet: sheetName.trim(),
        headers,
        fechaIdx: cols.findIndex(x => x.c === fechaCol),
        rows: data.map(d => d.values),
      }),
    };

  } catch (err) {
    console.error('[datos]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Error del servidor: ' + err.message }) };
  }
};
