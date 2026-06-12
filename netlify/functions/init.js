'use strict';

const GRAPH    = 'https://graph.microsoft.com/v1.0';
const CORS     = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// ── Rate limiting ─────────────────────────────────────────────────────────────
const rateMap = new Map();
function checkRate(ip) {
  const now   = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.t > 15 * 60 * 1000) { rateMap.set(ip, { t: now, n: 1 }); return false; }
  entry.n++;
  return entry.n > 10;
}

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
  if (!d.access_token) throw new Error('Auth error: ' + (d.error_description || JSON.stringify(d)));
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

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Método no permitido' }) };

  const ip = ((event.headers['x-forwarded-for'] || '').split(',')[0].trim()) || 'unknown';
  if (checkRate(ip)) return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'Demasiados intentos. Esperá 15 minutos.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Cuerpo inválido.' }) }; }

  const { usuario, pss } = body;
  if (!usuario || !pss) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Usuario y contraseña requeridos.' }) };

  const { BD_DRIVE_ID, BD_ITEM_ID, GRAPH_CLIENT_SECRET } = process.env;
  if (!GRAPH_CLIENT_SECRET || !BD_DRIVE_ID || !BD_ITEM_ID)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Servidor no configurado.' }) };

  try {
    const token   = await getToken();
    const driveId = BD_DRIVE_ID;
    const itemId  = BD_ITEM_ID;

    // ── 1. Validar credenciales ───────────────────────────────────────────────
    const usrRows = await readSheet(token, driveId, itemId, 'USUARIOS');
    // Row 0 = headers: usr | Pss | camion | estercolero
    // Row 1+ = data
    const usrRow = usrRows.slice(1).find(r =>
      String(r[0] ?? '').trim().toLowerCase() === String(usuario).trim().toLowerCase() &&
      String(r[1] ?? '').trim() === String(pss).trim()
    );
    if (!usrRow) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Usuario o contraseña incorrectos.' }) };

    const proveedor     = String(usrRow[0]).trim();
    const permCamiones  = String(usrRow[2] ?? '').trim().toLowerCase() === 'si';
    const permEstercol  = String(usrRow[3] ?? '').trim().toLowerCase() === 'si';

    // ── 2. Buscar nombres exactos de hojas ────────────────────────────────────
    const wsNames = await getWorksheets(token, driveId, itemId);
    const sheetCamiones   = wsNames.find(n => n.trim().toUpperCase() === proveedor.toUpperCase()) || null;
    const sheetEstercolero = wsNames.find(n => n.trim().toUpperCase() === proveedor.toUpperCase() + ' ESTERCOLERO') || null;

    // ── 3. Leer Lista Desplegables ────────────────────────────────────────────
    const ldRows = await readSheet(token, driveId, itemId, 'Lista Desplegables');
    // Row 0 = section headers (INFORMACION CAMIONES / INFORMACION ESTERCOLERO)
    // Row 1 = column headers
    // Row 2+ = data
    // Cols 0-indexed:
    //   0: Localidad (cam), 1: Campo (cam), 3: Proveedor, 4: Patentes
    //   9: Localidad (est), 10: Campos de Lote (campo est), 11: Lote

    const camByLocalidad    = {};   // { localidad: [campo, ...] }
    const patByProveedor    = {};   // { proveedor: [patente, ...] }
    const estByLocalidad    = {};   // { localidad: [campo, ...] }
    const lotByLocCampo     = {};   // { 'loc|campo': [lote, ...] }

    for (let i = 2; i < ldRows.length; i++) {
      const r = ldRows[i];

      // Camiones Localidad → Campo
      const camLoc   = String(r[0] ?? '').trim();
      const camCampo = String(r[1] ?? '').trim();
      if (camLoc && camCampo) {
        if (!camByLocalidad[camLoc]) camByLocalidad[camLoc] = [];
        if (!camByLocalidad[camLoc].includes(camCampo)) camByLocalidad[camLoc].push(camCampo);
      }

      // Patentes por Proveedor
      const prov    = String(r[3] ?? '').trim();
      const patente = String(r[4] ?? '').trim();
      if (prov && patente) {
        if (!patByProveedor[prov]) patByProveedor[prov] = [];
        if (!patByProveedor[prov].includes(patente)) patByProveedor[prov].push(patente);
      }

      // Estercolero Localidad → Campo → Lote
      const estLoc   = String(r[9]  ?? '').trim();
      const estCampo = String(r[10] ?? '').trim();
      const lote     = String(r[11] ?? '').trim();
      if (estLoc && estCampo) {
        if (!estByLocalidad[estLoc]) estByLocalidad[estLoc] = [];
        if (!estByLocalidad[estLoc].includes(estCampo)) estByLocalidad[estLoc].push(estCampo);

        if (lote) {
          const key = `${estLoc}|${estCampo}`;
          if (!lotByLocCampo[key]) lotByLocCampo[key] = [];
          if (!lotByLocCampo[key].includes(lote)) lotByLocCampo[key].push(lote);
        }
      }
    }

    return {
      statusCode: 200,
      headers:    CORS,
      body:       JSON.stringify({
        ok: true,
        user: {
          usr:            proveedor,
          permCamiones,
          permEstercol,
          sheetCamiones,
          sheetEstercolero,
        },
        dropdowns: {
          camByLocalidad,
          patByProveedor,
          estByLocalidad,
          lotByLocCampo,
        },
      }),
    };

  } catch (err) {
    console.error('[init]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Error del servidor: ' + err.message }) };
  }
};
