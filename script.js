'use strict';

// ── Estado de la sesión ───────────────────────────────────────────────────────
let session = {
  usuario:  '',
  pss:      '',
  user:     null,   // { usr, permCamiones, permEstercol, sheetCamiones, sheetEstercolero, captanque }
  dropdowns: null,  // { camByLocalidad, patByProveedor, estByLocalidad, lotByLocCampo }
  campana:  '',     // valor de Lista Desplegables P3
  tipoActivo: null, // 'camiones' | 'estercolero'
};

// ── Pantallas ─────────────────────────────────────────────────────────────────
const screens = {
  login:       document.getElementById('screenLogin'),
  tipo:        document.getElementById('screenTipo'),
  camiones:    document.getElementById('screenCamiones'),
  estercolero: document.getElementById('screenEstercolero'),
  confirmacion: document.getElementById('screenConfirmacion'),
  verDatos:    document.getElementById('screenVerDatos'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');

  // Solapas: ocultas en login; "Ver datos" activa solo en su pantalla
  document.getElementById('tabsNav').classList.toggle('hidden', name === 'login');
  document.getElementById('tabCargar').classList.toggle('active', name !== 'verDatos');
  document.getElementById('tabVerDatos').classList.toggle('active', name === 'verDatos');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Mensaje helper ────────────────────────────────────────────────────────────
function showMsg(el, type, text) {
  el.className = 'msg ' + type;
  el.textContent = text;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideMsg(el) { el.classList.add('hidden'); }

// ── Fecha helper ──────────────────────────────────────────────────────────────
// Devuelve la fecha local (YYYY-MM-DD) corrida `offsetDays` días respecto a hoy.
function fechaLocalISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// Aplica el rango permitido a un input de fecha: desde hace 1 semana hasta hoy.
function aplicarRangoFecha(inputEl) {
  inputEl.min = fechaLocalISO(-7);
  inputEl.max = fechaLocalISO(0);
}

// Valida que la fecha esté dentro del rango permitido (no futuro, hasta 1 semana atrás).
// Devuelve null si es válida, o un mensaje de error.
function validarRangoFecha(fecha) {
  const hoy   = fechaLocalISO(0);
  const limite = fechaLocalISO(-7);
  if (fecha > hoy)    return 'No se pueden registrar viajes con fecha futura.';
  if (fecha < limite) return 'Solo se pueden registrar viajes de hasta 1 semana atrás.';
  return null;
}

// ── Dropdown helper ───────────────────────────────────────────────────────────
function fillSelect(selectEl, options, placeholder) {
  selectEl.innerHTML = `<option value="">${placeholder}</option>`;
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    selectEl.appendChild(o);
  });
  selectEl.disabled = options.length === 0;
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
document.getElementById('btnLogin').addEventListener('click', doLogin);
document.getElementById('inputPss').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const btn    = document.getElementById('btnLogin');
  const msgEl  = document.getElementById('msgLogin');
  const usuario = document.getElementById('inputUsuario').value.trim();
  const pss     = document.getElementById('inputPss').value.trim();

  hideMsg(msgEl);
  if (!usuario || !pss) { showMsg(msgEl, 'error', 'Ingresá usuario y contraseña.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Verificando...';

  try {
    const resp = await fetch('/.netlify/functions/init', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ usuario, pss }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      showMsg(msgEl, 'error', data.error || 'Error al iniciar sesión.');
      return;
    }

    // Guardar sesión
    session.usuario   = usuario;
    session.pss       = pss;
    session.user      = data.user;
    session.dropdowns = data.dropdowns;
    session.campana   = data.campana || '';

    // Actualizar header
    document.getElementById('headerBadge').textContent = data.user.usr;

    postLogin();
  } catch (err) {
    showMsg(msgEl, 'error', 'Error de conexión: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Ingresar';
  }
}

function postLogin() {
  const { permCamiones, permEstercol } = session.user;

  if (permCamiones && permEstercol) {
    // Mostrar selección de tipo
    showScreen('tipo');
  } else if (permCamiones) {
    goToCamiones();
  } else if (permEstercol) {
    goToEstercolero();
  } else {
    document.getElementById('msgLogin').className = 'msg error';
    document.getElementById('msgLogin').textContent = 'Tu usuario no tiene permisos asignados. Contactá al administrador.';
    document.getElementById('msgLogin').classList.remove('hidden');
  }
}

// ── SELECCIÓN DE TIPO ─────────────────────────────────────────────────────────
document.querySelectorAll('input[name="tipo"]').forEach(radio => {
  radio.addEventListener('change', function () {
    if (this.value === 'camiones')    goToCamiones();
    if (this.value === 'estercolero') goToEstercolero();
  });
});

// ── FORMULARIO CAMIONES ───────────────────────────────────────────────────────
function goToCamiones() {
  session.tipoActivo = 'camiones';
  initFormCamiones();
  showScreen('camiones');
}

function initFormCamiones() {
  const { camByLocalidad, patByProveedor } = session.dropdowns;
  const { usr } = session.user;

  // Patentes del proveedor
  const patentes = patByProveedor[usr] || [];
  fillSelect(document.getElementById('cam_patente'), patentes, '— Seleccioná patente —');

  // Localidades
  const localidades = Object.keys(camByLocalidad).sort();
  fillSelect(document.getElementById('cam_localidad'), localidades, '— Seleccioná localidad —');

  // Reset campo
  fillSelect(document.getElementById('cam_campo'), [], '— Primero elegí localidad —');
  document.getElementById('cam_campo').disabled = true;

  // Fecha de hoy + rango permitido (hasta 1 semana atrás, sin futuro)
  const camFecha = document.getElementById('cam_fecha');
  aplicarRangoFecha(camFecha);
  camFecha.value = fechaLocalISO(0);

  // Reset otros campos
  document.getElementById('cam_remito').value = '';
  document.getElementById('cam_bruto').value  = '';
  document.getElementById('cam_tara').value   = '';
  document.getElementById('cam_neto').value   = '';
  hideMsg(document.getElementById('msgCamiones'));
}

// Cascada Localidad → Campo (camiones)
document.getElementById('cam_localidad').addEventListener('change', function () {
  const campos = session.dropdowns.camByLocalidad[this.value] || [];
  const campoSel = document.getElementById('cam_campo');
  fillSelect(campoSel, campos, campos.length ? '— Seleccioná campo —' : '— Sin campos disponibles —');
  campoSel.disabled = campos.length === 0;
});

// Auto-cálculo Neto
['cam_bruto', 'cam_tara'].forEach(id => {
  document.getElementById(id).addEventListener('input', calcNeto);
});
function calcNeto() {
  const bruto = Number(document.getElementById('cam_bruto').value) || 0;
  const tara  = Number(document.getElementById('cam_tara').value)  || 0;
  document.getElementById('cam_neto').value = bruto - tara;
}

// Máscara remito: 0000-00000000
(function () {
  const input = document.getElementById('cam_remito');

  input.addEventListener('input', () => {
    const raw  = input.value;
    const hIdx = raw.indexOf('-');
    if (hIdx >= 0) {
      // Hay guion: el lado izquierdo ya está definido → completarlo con ceros a 4.
      const left  = raw.slice(0, hIdx).replace(/\D/g, '').slice(0, 4);
      const right = raw.slice(hIdx + 1).replace(/\D/g, '').slice(0, 8);
      input.value = left.padStart(4, '0') + '-' + right;
    } else {
      // Sin guion todavía — auto-insertar tras el 4° dígito
      const digits = raw.replace(/\D/g, '').slice(0, 12);
      input.value  = digits.length > 4
        ? digits.slice(0, 4) + '-' + digits.slice(4)
        : digits;
    }
  });

  input.addEventListener('blur', () => {
    const raw  = input.value;
    const hIdx = raw.indexOf('-');
    const left  = (hIdx >= 0 ? raw.slice(0, hIdx) : raw).replace(/\D/g, '');
    const right = (hIdx >= 0 ? raw.slice(hIdx + 1) : '').replace(/\D/g, '');
    if (!left && !right) return;
    input.value = left.slice(0, 4).padStart(4, '0') + '-' + right.slice(0, 8).padStart(8, '0');
  });
})();

// Submit camiones
document.getElementById('btnSubmitCamiones').addEventListener('click', submitCamiones);

async function submitCamiones() {
  const btn   = document.getElementById('btnSubmitCamiones');
  const msgEl = document.getElementById('msgCamiones');
  hideMsg(msgEl);

  const fecha     = document.getElementById('cam_fecha').value;
  const localidad = document.getElementById('cam_localidad').value;
  const campo     = document.getElementById('cam_campo').value;
  const patente   = document.getElementById('cam_patente').value;
  const bruto     = document.getElementById('cam_bruto').value;
  const tara      = document.getElementById('cam_tara').value;

  const remito = document.getElementById('cam_remito').value.trim();

  if (!fecha)     { showMsg(msgEl, 'error', 'La fecha es obligatoria.'); return; }
  const errFecha = validarRangoFecha(fecha);
  if (errFecha)   { showMsg(msgEl, 'error', errFecha); return; }
  if (!localidad) { showMsg(msgEl, 'error', 'Seleccioná una localidad.'); return; }
  if (!campo)     { showMsg(msgEl, 'error', 'Seleccioná un campo.'); return; }
  if (!patente)   { showMsg(msgEl, 'error', 'Seleccioná la patente.'); return; }
  if (remito && !/^\d{4}-\d{8}$/.test(remito)) { showMsg(msgEl, 'error', 'El remito debe tener el formato 0000-00000000.'); return; }
  if (!bruto)     { showMsg(msgEl, 'error', 'Ingresá el peso bruto.'); return; }
  if (!tara)      { showMsg(msgEl, 'error', 'Ingresá la tara.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';

  try {
    const resp = await fetch('/.netlify/functions/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        usuario:  session.usuario,
        pss:      session.pss,
        tipo:     'camiones',
        fecha,
        localidad,
        campo,
        patente,
        remito,
        bruto:    Number(bruto),
        tara:     Number(tara),
        neto:     Number(bruto) - Number(tara),
      }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      showMsg(msgEl, 'error', data.error || 'Error al guardar.');
      return;
    }

    showScreen('confirmacion');
  } catch (err) {
    showMsg(msgEl, 'error', 'Error de conexión: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Registrar viaje';
  }
}

// Volver desde camiones
document.getElementById('btnVolverCamiones').addEventListener('click', () => {
  if (session.user.permCamiones && session.user.permEstercol) {
    document.querySelectorAll('input[name="tipo"]').forEach(r => { r.checked = false; });
    showScreen('tipo');
  } else {
    showScreen('login');
  }
});

// ── FORMULARIO ESTERCOLERO ────────────────────────────────────────────────────
function goToEstercolero() {
  session.tipoActivo = 'estercolero';
  initFormEstercolero();
  showScreen('estercolero');
}

function initFormEstercolero() {
  const { estByLocalidad } = session.dropdowns;

  const localidades = Object.keys(estByLocalidad).sort();
  fillSelect(document.getElementById('est_localidad'), localidades, '— Seleccioná localidad —');

  fillSelect(document.getElementById('est_campo'), [], '— Primero elegí localidad —');
  document.getElementById('est_campo').disabled = true;

  fillSelect(document.getElementById('est_lote'), [], '— Primero elegí campo —');
  document.getElementById('est_lote').disabled = true;

  const estFecha = document.getElementById('est_fecha');
  aplicarRangoFecha(estFecha);
  estFecha.value = fechaLocalISO(0);

  document.getElementById('est_nviajes').value   = '';
  document.getElementById('est_captanque').value = session.user.captanque || '';
  document.getElementById('est_campana').value   = session.campana;
  calcM3();
  hideMsg(document.getElementById('msgEstercolero'));
}

// Cascada Localidad → Campo (estercolero)
document.getElementById('est_localidad').addEventListener('change', function () {
  const campos = session.dropdowns.estByLocalidad[this.value] || [];
  const campoSel = document.getElementById('est_campo');
  fillSelect(campoSel, campos, campos.length ? '— Seleccioná campo —' : '— Sin campos disponibles —');
  campoSel.disabled = campos.length === 0;

  // Reset lote
  const loteSel = document.getElementById('est_lote');
  fillSelect(loteSel, [], '— Primero elegí campo —');
  loteSel.disabled = true;
});

// Cascada Campo → Lote (estercolero)
document.getElementById('est_campo').addEventListener('change', function () {
  const loc    = document.getElementById('est_localidad').value;
  const lotes  = session.dropdowns.lotByLocCampo[`${loc}|${this.value}`] || [];
  const loteSel = document.getElementById('est_lote');
  fillSelect(loteSel, lotes, lotes.length ? '— Seleccioná lote —' : '— Sin lotes disponibles —');
  loteSel.disabled = lotes.length === 0;
});

// Auto-cálculo cantidad m³ (captanque es readonly, solo dispara nviajes)
document.getElementById('est_nviajes').addEventListener('input', calcM3);
function calcM3() {
  const nv = Number(document.getElementById('est_nviajes').value)   || 0;
  const ct = Number(document.getElementById('est_captanque').value) || 0;
  document.getElementById('est_cantm3').value = nv * ct;
}

// Submit estercolero
document.getElementById('btnSubmitEstercolero').addEventListener('click', submitEstercolero);

async function submitEstercolero() {
  const btn   = document.getElementById('btnSubmitEstercolero');
  const msgEl = document.getElementById('msgEstercolero');
  hideMsg(msgEl);

  const fecha     = document.getElementById('est_fecha').value;
  const localidad = document.getElementById('est_localidad').value;
  const campo     = document.getElementById('est_campo').value;
  const lote      = document.getElementById('est_lote').value;
  const nviajes   = document.getElementById('est_nviajes').value;
  const captanque = document.getElementById('est_captanque').value;

  if (!fecha)     { showMsg(msgEl, 'error', 'La fecha es obligatoria.'); return; }
  const errFecha = validarRangoFecha(fecha);
  if (errFecha)   { showMsg(msgEl, 'error', errFecha); return; }
  if (!localidad) { showMsg(msgEl, 'error', 'Seleccioná una localidad.'); return; }
  if (!campo)     { showMsg(msgEl, 'error', 'Seleccioná un campo.'); return; }
  if (!lote)      { showMsg(msgEl, 'error', 'Seleccioná el lote.'); return; }
  if (!nviajes)   { showMsg(msgEl, 'error', 'Ingresá el número de viajes.'); return; }
  if (!captanque) { showMsg(msgEl, 'error', 'Ingresá la capacidad del tanque.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';

  try {
    const resp = await fetch('/.netlify/functions/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        usuario:   session.usuario,
        pss:       session.pss,
        tipo:      'estercolero',
        fecha,
        localidad,
        campo,
        lote,
        nviajes:   Number(nviajes),
        captanque: Number(captanque),
        cantm3:    Number(nviajes) * Number(captanque),
        campana:   document.getElementById('est_campana').value.trim(),
      }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      showMsg(msgEl, 'error', data.error || 'Error al guardar.');
      return;
    }

    showScreen('confirmacion');
  } catch (err) {
    showMsg(msgEl, 'error', 'Error de conexión: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Registrar viaje';
  }
}

// Volver desde estercolero
document.getElementById('btnVolverEstercolero').addEventListener('click', () => {
  if (session.user.permCamiones && session.user.permEstercol) {
    document.querySelectorAll('input[name="tipo"]').forEach(r => { r.checked = false; });
    showScreen('tipo');
  } else {
    showScreen('login');
  }
});

// ── CONFIRMACIÓN ──────────────────────────────────────────────────────────────
document.getElementById('btnNuevaCarga').addEventListener('click', () => {
  const { permCamiones, permEstercol } = session.user;
  if (permCamiones && permEstercol) {
    document.querySelectorAll('input[name="tipo"]').forEach(r => { r.checked = false; });
    showScreen('tipo');
  } else if (permCamiones) {
    goToCamiones();
  } else {
    goToEstercolero();
  }
});

// ── SOLAPAS ───────────────────────────────────────────────────────────────────
document.getElementById('tabCargar').addEventListener('click', () => {
  if (!screens.verDatos.classList.contains('hidden')) {
    document.querySelectorAll('input[name="tipo"]').forEach(r => { r.checked = false; });
    postLogin();
  }
});
document.getElementById('tabVerDatos').addEventListener('click', goToVerDatos);

// ── VER DATOS ─────────────────────────────────────────────────────────────────
let verDatosIniciado = false;

function goToVerDatos() {
  const { permCamiones, permEstercol } = session.user;
  const tipoSel = document.getElementById('ver_tipo');

  if (!verDatosIniciado) {
    // Por defecto: desde el 1° del mes actual hasta hoy
    const hoy = fechaLocalISO(0);
    document.getElementById('ver_desde').value = hoy.slice(0, 8) + '01';
    document.getElementById('ver_hasta').value = hoy;
    tipoSel.value = permCamiones ? 'camiones' : 'estercolero';
    verDatosIniciado = true;
  }

  // Selector de tipo solo si tiene ambos permisos
  document.getElementById('verTipoWrap').classList.toggle('hidden', !(permCamiones && permEstercol));

  showScreen('verDatos');
  buscarDatos();
}

document.getElementById('btnBuscarDatos').addEventListener('click', buscarDatos);
document.getElementById('ver_tipo').addEventListener('change', buscarDatos);

// Serial Excel → dd/mm/yyyy
function excelToFecha(v) {
  if (typeof v !== 'number') return String(v ?? '');
  const d = new Date((Math.floor(v) - 25569) * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

// Columnas numéricas que se suman en el pie de la tabla
const COLS_TOTAL = /^(bruto|tara|neto|n.? ?viajes|cantidad m3)$/i;

async function buscarDatos() {
  const btn    = document.getElementById('btnBuscarDatos');
  const msgEl  = document.getElementById('msgVerDatos');
  const resEl  = document.getElementById('verResultado');
  const desde  = document.getElementById('ver_desde').value;
  const hasta  = document.getElementById('ver_hasta').value;
  const { permCamiones, permEstercol } = session.user;
  const tipo   = (permCamiones && permEstercol)
    ? document.getElementById('ver_tipo').value
    : (permCamiones ? 'camiones' : 'estercolero');

  hideMsg(msgEl);
  if (!desde || !hasta) { showMsg(msgEl, 'error', 'Completá las fechas desde y hasta.'); return; }
  if (desde > hasta)    { showMsg(msgEl, 'error', 'La fecha desde no puede ser mayor a la fecha hasta.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Buscando...';

  try {
    const resp = await fetch('/.netlify/functions/datos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ usuario: session.usuario, pss: session.pss, tipo, desde, hasta }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      resEl.classList.add('hidden');
      showMsg(msgEl, 'error', data.error || 'Error al consultar los datos.');
      return;
    }

    ultimaConsulta = { ...data, tipo, desde, hasta };
    renderTabla(data);
  } catch (err) {
    resEl.classList.add('hidden');
    showMsg(msgEl, 'error', 'Error de conexión: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Buscar';
  }
}

function renderTabla({ headers, rows, fechaIdx }) {
  const tabla = document.getElementById('tablaDatos');
  const thead = tabla.querySelector('thead');
  const tbody = tabla.querySelector('tbody');
  const tfoot = tabla.querySelector('tfoot');
  const resEl = document.getElementById('verResultado');

  thead.innerHTML = tbody.innerHTML = tfoot.innerHTML = '';

  if (!rows.length) {
    resEl.classList.add('hidden');
    showMsg(document.getElementById('msgVerDatos'), 'info', 'No hay viajes cargados en el rango seleccionado.');
    return;
  }

  const fmtNum = n => Number(n).toLocaleString('es-AR');
  const sumCols = headers.map(h => COLS_TOTAL.test(h.trim()));
  const totals  = headers.map(() => 0);

  const trh = document.createElement('tr');
  headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh);

  rows.forEach(r => {
    const tr = document.createElement('tr');
    r.forEach((v, i) => {
      const td = document.createElement('td');
      if (i === fechaIdx) {
        td.textContent = excelToFecha(v);
      } else if (sumCols[i]) {
        totals[i] += Number(v) || 0;
        td.textContent = v === '' ? '' : fmtNum(v);
        td.className = 'num';
      } else {
        td.textContent = v;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  const trf = document.createElement('tr');
  headers.forEach((_, i) => {
    const td = document.createElement('td');
    if (i === 0) td.textContent = 'Total';
    else if (sumCols[i]) { td.textContent = fmtNum(totals[i]); td.className = 'num'; }
    trf.appendChild(td);
  });
  tfoot.appendChild(trf);

  document.getElementById('verResumen').textContent =
    `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'} encontrados`;
  resEl.classList.remove('hidden');
}

// ── Descargar Excel ───────────────────────────────────────────────────────────
let ultimaConsulta = null;   // { headers, rows, fechaIdx, tipo, desde, hasta }

// Carga SheetJS bajo demanda (solo la primera vez que se descarga)
function cargarSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar el generador de Excel.'));
    document.head.appendChild(s);
  });
}

document.getElementById('btnDescargarExcel').addEventListener('click', descargarExcel);

async function descargarExcel() {
  const btn   = document.getElementById('btnDescargarExcel');
  const msgEl = document.getElementById('msgVerDatos');
  if (!ultimaConsulta || !ultimaConsulta.rows.length) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generando...';

  try {
    await cargarSheetJS();
    const { headers, rows, fechaIdx, tipo, desde, hasta } = ultimaConsulta;
    const sumCols = headers.map(h => COLS_TOTAL.test(h.trim()));
    const totals  = headers.map(() => 0);

    // Columnas sumables como número
    const body = rows.map(r => r.map((v, i) => {
      if (sumCols[i]) { totals[i] += Number(v) || 0; return v === '' ? '' : Number(v); }
      return v;
    }));
    const pie = headers.map((_, i) => i === 0 ? 'Total' : (sumCols[i] ? totals[i] : ''));

    const ws = XLSX.utils.aoa_to_sheet([headers, ...body, pie]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }));

    // Fecha: se deja el serial de Excel con formato de fecha (evita corrimientos por zona horaria)
    body.forEach((r, i) => {
      const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: fechaIdx })];
      if (cell && cell.t === 'n') cell.z = 'dd/mm/yyyy';
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tipo === 'camiones' ? 'Camiones' : 'Estercolero');
    XLSX.writeFile(wb, `Digestato_${session.user.usr}_${tipo}_${desde}_a_${hasta}.xlsx`);
  } catch (err) {
    showMsg(msgEl, 'error', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⬇ Descargar Excel';
  }
}
