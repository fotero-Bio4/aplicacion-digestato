'use strict';

// ── Estado de la sesión ───────────────────────────────────────────────────────
let session = {
  usuario:  '',
  pss:      '',
  user:     null,   // { usr, permCamiones, permEstercol, sheetCamiones, sheetEstercolero }
  dropdowns: null,  // { camByLocalidad, patByProveedor, estByLocalidad, lotByLocCampo }
  tipoActivo: null, // 'camiones' | 'estercolero'
};

// ── Pantallas ─────────────────────────────────────────────────────────────────
const screens = {
  login:       document.getElementById('screenLogin'),
  tipo:        document.getElementById('screenTipo'),
  camiones:    document.getElementById('screenCamiones'),
  estercolero: document.getElementById('screenEstercolero'),
  confirmacion: document.getElementById('screenConfirmacion'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
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

  // Fecha de hoy
  const hoy = new Date().toISOString().slice(0, 10);
  document.getElementById('cam_fecha').value = hoy;

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

  if (!fecha)     { showMsg(msgEl, 'error', 'La fecha es obligatoria.'); return; }
  if (!localidad) { showMsg(msgEl, 'error', 'Seleccioná una localidad.'); return; }
  if (!campo)     { showMsg(msgEl, 'error', 'Seleccioná un campo.'); return; }
  if (!patente)   { showMsg(msgEl, 'error', 'Seleccioná la patente.'); return; }
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
        remito:   document.getElementById('cam_remito').value.trim(),
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

  const hoy = new Date().toISOString().slice(0, 10);
  document.getElementById('est_fecha').value = hoy;

  document.getElementById('est_nviajes').value    = '';
  document.getElementById('est_captanque').value  = '';
  document.getElementById('est_cantm3').value     = '';
  document.getElementById('est_campana').value    = '';
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

// Auto-cálculo cantidad m³
['est_nviajes', 'est_captanque'].forEach(id => {
  document.getElementById(id).addEventListener('input', calcM3);
});
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
