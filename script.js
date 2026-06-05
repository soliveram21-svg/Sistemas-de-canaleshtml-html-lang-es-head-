/* ═══════════════════════════════════════════════════════════════
   VISOR SIG — CANALES PLUVIALES CARTAGENA DE INDIAS
   script.js — v4 (Firebase Realtime DB + Links multimedia)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────
   FIREBASE — Realtime Database
   ───────────────────────────────────────────────────────────── */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase, ref, set, get, remove, onValue, off
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const firebaseConfig = {
  apiKey:            'AIzaSyAZWt1Lt0zw7NOPiBGeBtaAKD3XM_F1-1k',
  authDomain:        'canalesfluviales.firebaseapp.com',
  databaseURL:       'https://canalesfluviales-default-rtdb.firebaseio.com',
  projectId:         'canalesfluviales',
  storageBucket:     'canalesfluviales.firebasestorage.app',
  messagingSenderId: '778776793484',
  appId:             '1:778776793484:web:ebdf4a3b42c446f26dc6a9'
};

const fbApp = initializeApp(firebaseConfig);
const db    = getDatabase(fbApp);

/* ─── Helpers Firebase ─── */
function fbRef(path)          { return ref(db, path); }
function fbSet(path, value)   { return set(fbRef(path), value); }
function fbGet(path)          { return get(fbRef(path)).then(s => s.val()); }
function fbRemove(path)       { return remove(fbRef(path)); }

/* ─────────────────────────────────────────────────────────────
   CONSTANTES
   ───────────────────────────────────────────────────────────── */
const LOCALIDAD_NAMES = {
  1: 'Histórica y del Caribe Norte',
  2: 'De la Virgen y Turística',
  3: 'Industrial de la Bahía'
};

const ADMIN_CREDENTIALS = {
  user: 'admin',
  pass: 'valo2026'
};

/* ─────────────────────────────────────────────────────────────
   ESTADO GLOBAL
   ───────────────────────────────────────────────────────────── */
let canales         = [];
let filteredCanales = [];
let map             = null;
let markersLayer    = null;
let linesLayer      = null;
let activeMarker    = null;
let activeCanal     = null;
let editingId       = null;

let showPuntos  = true;
let showLineas  = true;
let isAdmin     = false;

let pickPointMode = false;
let drawMode      = false;
let drawCanal     = null;
let drawPoints    = [];
let drawPolyline  = null;
let drawMarkers   = [];

/* ─────────────────────────────────────────────────────────────
   PERSISTENCIA — Firebase Realtime Database
   Estructura: /canales/{id} = objeto canal (sin base64)
   Los links de multimedia van dentro del objeto canal:
     videos: [ url, url, ... ]
     plano: url | null
     ficha: url | null
     informe: url | null
     fotos: [ url, url, ... ]
   ───────────────────────────────────────────────────────────── */

/** Limpia un canal para guardar en Firebase (elimina nulls innecesarios) */
function cleanForDB(c) {
  return {
    id:             c.id,
    nombre:         c.nombre         || '',
    cuenca:         c.cuenca         || '—',
    localidad:      c.localidad      || 1,
    localidadNombre:c.localidadNombre|| '',
    barrio:         c.barrio         || '—',
    longitud:       c.longitud       || '—',
    inicio:         c.inicio         || '—',
    final:          c.final          || '—',
    seccion:        c.seccion        || '—',
    revestimiento:  c.revestimiento  || '—',
    disenios:       c.disenios       || 'No',
    estado:         c.estado         || 'Regular',
    riesgo:         c.riesgo         || '—',
    lat:            c.lat,
    lng:            c.lng,
    color:          c.color          || null,
    trazado:        c.trazado        || null,
    // Multimedia como links
    videos:  Array.isArray(c.videos) ? c.videos.filter(v => v && v.trim()) : [],
    plano:   c.plano   || null,
    ficha:   c.ficha   || null,
    informe: c.informe || null,
    fotos:   Array.isArray(c.fotos)  ? c.fotos.filter(f => f && f.trim())  : [],
  };
}

/** Guarda UN canal en Firebase */
async function saveCanal(canal) {
  const data = cleanForDB(canal);
  try {
    await fbSet(`canales/${canal.id}`, data);
    showSyncIndicator('✓ Guardado en Firebase', 'ok');
  } catch (e) {
    console.error('Error guardando en Firebase:', e);
    showSyncIndicator('✗ Error al guardar', 'error');
  }
}

/** Elimina un canal de Firebase */
async function removeCanal(id) {
  try {
    await fbRemove(`canales/${id}`);
    showSyncIndicator('✓ Canal eliminado de Firebase', 'ok');
  } catch (e) {
    console.error('Error eliminando canal:', e);
    showSyncIndicator('✗ Error al eliminar', 'error');
  }
}

/** Carga todos los canales desde Firebase (una sola vez al iniciar) */
async function loadCanalesFromFirebase() {
  try {
    const data = await fbGet('canales');
    if (!data) return [];
    // data es un objeto { id: canal, ... }
    return Object.values(data).map(c => ({
      ...c,
      videos: Array.isArray(c.videos) ? c.videos : [],
      fotos:  Array.isArray(c.fotos)  ? c.fotos  : [],
    }));
  } catch (e) {
    console.error('Error cargando desde Firebase:', e);
    showSyncIndicator('✗ Error al cargar datos', 'error');
    return [];
  }
}

/* ─────────────────────────────────────────────────────────────
   SYNC INDICATOR
   ───────────────────────────────────────────────────────────── */
let _syncIndicatorTimer = null;

function showSyncIndicator(msg, type) {
  let el = document.getElementById('sync-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-indicator';
    el.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px',
      'background:#0d1117', 'border:1px solid rgba(77,159,255,0.25)',
      'border-radius:8px', 'padding:7px 13px',
      'font-size:11px', "font-family:'Space Mono',monospace",
      'z-index:9998', 'transition:opacity 0.3s',
      'box-shadow:0 4px 16px rgba(0,0,0,0.4)'
    ].join(';');
    document.body.appendChild(el);
  }
  const color = type === 'ok' ? '#22c55e' : type === 'warn' ? '#f5a623' : '#ef4444';
  el.style.color        = color;
  el.style.borderColor  = color + '44';
  el.style.opacity      = '1';
  el.textContent        = msg;
  clearTimeout(_syncIndicatorTimer);
  _syncIndicatorTimer   = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}

/* ─────────────────────────────────────────────────────────────
   INICIALIZACIÓN
   ───────────────────────────────────────────────────────────── */
async function initApp() {
  showSyncIndicator('⏳ Cargando datos...', 'warn');

  canales = await loadCanalesFromFirebase();
  filteredCanales = [...canales];

  initMap();
  initLegend();
  initFilters();
  initLayerToggles();
  initCRUD();
  initDrawTools();
  initAdminToggle();
  initLoginModal();
  initModalMultimedia();

  renderAll(canales, filteredCanales);
  applyAdminState();
}

/* ─────────────────────────────────────────────────────────────
   MAPA
   ───────────────────────────────────────────────────────────── */
function initMap() {
  map = L.map('map', {
    center: [10.3910, -75.4794],
    zoom: 12,
    minZoom: 10,
    maxZoom: 19,
    zoomControl: true,
    attributionControl: true
  });

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  });

  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
  );

  const hybridLabels = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, opacity: 0.6
  });

  const hybridGroup = L.layerGroup([satelliteLayer, hybridLabels]);

  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data: &copy; OpenStreetMap | Style: &copy; OpenTopoMap',
    maxZoom: 17
  });

  osmLayer.addTo(map);
  L.control.layers(
    { 'Calles (OSM)': osmLayer, 'Satélite': satelliteLayer, 'Híbrido': hybridGroup, 'Topográfico': topoLayer },
    null, { position: 'topright', collapsed: true }
  ).addTo(map);

  linesLayer   = L.layerGroup().addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (drawMode)      { addDrawPoint(e.latlng); return; }
    if (pickPointMode) { finishPickPoint(e.latlng); return; }
    if (activeMarker) {
      activeMarker.getElement()?.querySelector('.canal-marker')?.classList.remove('active');
      activeMarker = null;
    }
    activeCanal = null;
    closePanel();
  });

  map.on('dblclick', (e) => {
    if (drawMode) { e.originalEvent.stopPropagation(); finishDraw(); }
  });
}

/* ─────────────────────────────────────────────────────────────
   RENDER ALL
   ───────────────────────────────────────────────────────────── */
function renderAll(allData, visibleData) {
  markersLayer.clearLayers();
  linesLayer.clearLayers();

  allData.forEach(canal => {
    if (canal.trazado && canal.trazado.length >= 2) drawCanalLine(canal);
  });

  visibleData.forEach(canal => {
    createMarker(canal).addTo(markersLayer);
  });

  applyLayerVisibility();
  updateStats(allData, visibleData);
}

function drawCanalLine(canal) {
  const color = canal.color || getEstadoColor(canal.estado);
  const line = L.polyline(canal.trazado, {
    color, weight: 4, opacity: 0.75, smoothFactor: 1,
    lineCap: 'round', lineJoin: 'round'
  });

  line.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    markersLayer.eachLayer(marker => {
      if (marker._canal?.id === canal.id) selectMarker(marker, canal);
    });
  });

  line.bindTooltip(
    `<strong>${canal.nombre}</strong><br/><span style="color:#6b7c99;font-size:10px">${canal.trazado.length} puntos · ${canal.estado}</span>`,
    { className: 'canal-tooltip', direction: 'top', sticky: true }
  );

  line._canalId = canal.id;
  line.addTo(linesLayer);
}

/* ─────────────────────────────────────────────────────────────
   MARCADORES
   ───────────────────────────────────────────────────────────── */
function createMarker(canal) {
  const estadoClass = getEstadoClass(canal.estado);
  const customColor = canal.color || null;
  const colorStyle  = customColor ? `background:${customColor}!important;` : '';

  const icon = L.divIcon({
    className: '',
    html: `<div class="canal-marker ${estadoClass}" data-id="${canal.id}" style="${colorStyle}"></div>`,
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -36]
  });

  const marker = L.marker([canal.lat, canal.lng], { icon, draggable: isAdmin });

  marker.bindTooltip(
    `<strong>${canal.nombre}</strong><br/><span style="color:#6b7c99;font-size:10px">Canal #${canal.id} · ${canal.estado}</span>`,
    { className: 'canal-tooltip', direction: 'top', offset: [0, -8] }
  );

  marker.on('click', (e) => {
    if (drawMode) return;
    e.originalEvent.stopPropagation();
    selectMarker(marker, canal);
  });

  marker.on('dragend', async (e) => {
    const newLatLng = e.target.getLatLng();
    const idx = canales.findIndex(c => c.id === canal.id);
    if (idx !== -1) {
      canales[idx].lat = parseFloat(newLatLng.lat.toFixed(6));
      canales[idx].lng = parseFloat(newLatLng.lng.toFixed(6));
      canal.lat = canales[idx].lat;
      canal.lng = canales[idx].lng;
      await saveCanal(canales[idx]);
      if (activeCanal?.id === canal.id) {
        document.getElementById('p-coords').textContent =
          `${canal.lat.toFixed(5)}, ${canal.lng.toFixed(5)}`;
      }
      showToast(`Posición de ${canal.nombre} actualizada`, 'success');
    }
  });

  marker._canal = canal;
  return marker;
}

function selectMarker(marker, canal) {
  if (activeMarker && activeMarker !== marker) {
    activeMarker.getElement()?.querySelector('.canal-marker')?.classList.remove('active');
  }
  marker.getElement()?.querySelector('.canal-marker')?.classList.add('active');
  activeMarker = marker;
  activeCanal  = canal;
  map.panTo([canal.lat, canal.lng], { animate: true, duration: 0.5 });
  populatePanel(canal);
  openPanel();
}

/* ─────────────────────────────────────────────────────────────
   PANEL LATERAL
   ───────────────────────────────────────────────────────────── */
function populatePanel(canal) {
  const estadoClass = getEstadoClass(canal.estado);

  document.getElementById('p-badge').textContent     = `CANAL #${canal.id}`;
  document.getElementById('p-name').textContent      = canal.nombre;
  document.getElementById('p-cuenca').textContent    = `Cuenca ${canal.cuenca}`;
  document.getElementById('p-localidad').textContent = `${canal.localidad} – ${canal.localidadNombre}`;
  document.getElementById('p-barrio').textContent    = canal.barrio || '—';
  document.getElementById('p-longitud').textContent  = canal.longitud || '—';
  document.getElementById('p-revestimiento').textContent = canal.revestimiento || '—';
  document.getElementById('p-seccion').textContent   = canal.seccion || '—';
  document.getElementById('p-tramo').textContent     = `${canal.inicio || '—'} → ${canal.final || '—'}`;
  document.getElementById('p-disenios').textContent  = canal.disenios || '—';
  document.getElementById('p-riesgo').textContent    = canal.riesgo || '—';
  document.getElementById('p-coords').textContent    = `${canal.lat?.toFixed(5)}, ${canal.lng?.toFixed(5)}`;

  const dot   = document.getElementById('p-estado-dot');
  const label = document.getElementById('p-estado-label');
  dot.className     = `estado-dot ${estadoClass}`;
  label.textContent = canal.estado;
  label.style.color = getEstadoColor(canal.estado);

  // Trazado
  const trazadoInfo     = document.getElementById('p-trazado-info');
  const deleteTrazadoBtn= document.getElementById('p-btn-delete-trazado');
  if (canal.trazado && canal.trazado.length >= 2) {
    trazadoInfo.textContent = `${canal.trazado.length} puntos registrados`;
    trazadoInfo.className   = 'trazado-info has-trazado';
    if (deleteTrazadoBtn) { deleteTrazadoBtn.style.display = 'inline-flex'; deleteTrazadoBtn.disabled = !isAdmin; }
  } else {
    trazadoInfo.textContent = 'Sin trazado registrado';
    trazadoInfo.className   = 'trazado-info';
    if (deleteTrazadoBtn) deleteTrazadoBtn.style.display = 'none';
  }

  // Color
  const colorInput = document.getElementById('p-color-input');
  if (colorInput) {
    colorInput.value    = canal.color || getEstadoColor(canal.estado);
    colorInput.disabled = !isAdmin;
  }

  // ─── Multimedia desde links ───
  const videos  = Array.isArray(canal.videos) ? canal.videos.filter(v => v) : [];
  const plano   = canal.plano   || null;
  const ficha   = canal.ficha   || null;
  const informe = canal.informe || null;
  const fotos   = Array.isArray(canal.fotos)  ? canal.fotos.filter(f => f)  : [];

  const videoBtn      = document.getElementById('p-btn-video');
  const extraVideosSec= document.getElementById('p-extra-videos-section');
  const planoBtn      = document.getElementById('p-btn-plano');
  const fichaBtn      = document.getElementById('p-btn-ficha');
  const informeBtn    = document.getElementById('p-btn-informe');
  const fotosSection  = document.getElementById('p-fotos-section');
  const fotosContainer= document.getElementById('p-fotos-container');

  // Videos
  if (videos.length > 0) {
    videoBtn.style.display = 'inline-flex';
    videoBtn.onclick = () => openLightbox('video', videos[0], `Video 1 — ${canal.nombre}`);
    // Videos extra
    if (extraVideosSec) {
      extraVideosSec.innerHTML = videos.slice(1).map((url, i) =>
        `<button class="media-btn media-btn--video" style="margin-top:4px;" onclick="openLightbox('video','${url.replace(/'/g,"\\'")}','Video ${i+2} — ${canal.nombre.replace(/'/g,"\\'")}')">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
           Video ${i+2}
         </button>`
      ).join('');
    }
  } else {
    videoBtn.style.display = 'none';
    if (extraVideosSec) extraVideosSec.innerHTML = '';
  }

  // Plano
  if (planoBtn) {
    if (plano) {
      planoBtn.style.display = 'inline-flex';
      planoBtn.onclick = () => openLightbox('pdf', plano, `Plano — ${canal.nombre}`);
    } else { planoBtn.style.display = 'none'; }
  }

  // Ficha
  if (fichaBtn) {
    if (ficha) {
      fichaBtn.style.display = 'inline-flex';
      fichaBtn.onclick = () => openLightbox('pdf', ficha, `Ficha Técnica — ${canal.nombre}`);
    } else { fichaBtn.style.display = 'none'; }
  }

  // Informe
  if (informeBtn) {
    if (informe) {
      informeBtn.style.display = 'inline-flex';
      informeBtn.onclick = () => openLightbox('pdf', informe, `Informe — ${canal.nombre}`);
    } else { informeBtn.style.display = 'none'; }
  }

  // Fotos
  if (fotosSection && fotosContainer) {
    if (fotos.length > 0) {
      fotosSection.style.display = 'block';
      fotosContainer.innerHTML = fotos.map((url, i) =>
        `<img src="${url}" class="panel__foto foto-thumb-link" alt="foto ${i+1}" data-index="${i}"
              style="cursor:pointer;" onerror="this.style.opacity='0.3';this.title='Link no válido'" />`
      ).join('');
      fotosContainer.querySelectorAll('.panel__foto').forEach((img, i) => {
        img.addEventListener('click', () => openLightboxGallery(fotos, i, canal.nombre));
      });
    } else {
      fotosSection.style.display = 'none';
      fotosContainer.innerHTML   = '';
    }
  }

  updatePanelButtons();
}

function openPanel()  { document.getElementById('panel').classList.add('open'); }
function closePanel() { document.getElementById('panel').classList.remove('open'); }

function updatePanelButtons() {
  const editBtn         = document.getElementById('p-btn-edit');
  const deleteBtn       = document.getElementById('p-btn-delete');
  const drawBtn         = document.getElementById('p-btn-draw');
  const deleteTrazadoBtn= document.getElementById('p-btn-delete-trazado');
  const colorInput      = document.getElementById('p-color-input');

  if (editBtn)          editBtn.disabled          = !isAdmin;
  if (deleteBtn)        deleteBtn.disabled        = !isAdmin;
  if (drawBtn)          drawBtn.disabled          = !isAdmin;
  if (colorInput)       colorInput.disabled       = !isAdmin;
}

document.getElementById('panel-close').addEventListener('click', () => {
  if (activeMarker) {
    activeMarker.getElement()?.querySelector('.canal-marker')?.classList.remove('active');
    activeMarker = null;
  }
  activeCanal = null;
  closePanel();
});

/* ─────────────────────────────────────────────────────────────
   FILTROS
   ───────────────────────────────────────────────────────────── */
function initFilters() {
  document.getElementById('filter-localidad').addEventListener('change', applyFilters);
  document.getElementById('filter-estado').addEventListener('change', applyFilters);
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('filter-localidad').value = '';
    document.getElementById('filter-estado').value    = '';
    applyFilters();
  });
}

function applyFilters() {
  const localidadVal = document.getElementById('filter-localidad').value;
  const estadoVal    = document.getElementById('filter-estado').value;

  filteredCanales = canales.filter(c => {
    const matchL = !localidadVal || c.localidad === parseInt(localidadVal);
    const matchE = !estadoVal    || c.estado === estadoVal;
    return matchL && matchE;
  });

  if (activeMarker) {
    const id = activeMarker._canal?.id;
    if (!filteredCanales.find(c => c.id === id)) {
      closePanel(); activeMarker = null; activeCanal = null;
    }
  }

  renderAll(canales, filteredCanales);
}

/* ─────────────────────────────────────────────────────────────
   LAYER TOGGLES
   ───────────────────────────────────────────────────────────── */
function initLayerToggles() {
  document.getElementById('toggle-puntos').addEventListener('click', () => {
    showPuntos = !showPuntos;
    document.getElementById('toggle-puntos').classList.toggle('active', showPuntos);
    applyLayerVisibility();
  });
  document.getElementById('toggle-lineas').addEventListener('click', () => {
    showLineas = !showLineas;
    document.getElementById('toggle-lineas').classList.toggle('active', showLineas);
    applyLayerVisibility();
  });
}

function applyLayerVisibility() {
  if (showPuntos) { if (!map.hasLayer(markersLayer)) map.addLayer(markersLayer); }
  else            { if (map.hasLayer(markersLayer))  map.removeLayer(markersLayer); }
  if (showLineas) { if (!map.hasLayer(linesLayer))   map.addLayer(linesLayer); }
  else            { if (map.hasLayer(linesLayer))    map.removeLayer(linesLayer); }
}

/* ─────────────────────────────────────────────────────────────
   CRUD — MODAL
   ───────────────────────────────────────────────────────────── */
function initCRUD() {
  document.getElementById('btn-add-canal').addEventListener('click', () => {
    if (!isAdmin) { showToast('🔒 Modo solo lectura. Active el modo admin para continuar.', 'warn'); return; }
    startPickPointMode();
  });

  document.getElementById('p-btn-edit').addEventListener('click', () => {
    if (!isAdmin) { showToast('🔒 Modo solo lectura. Active el modo admin para continuar.', 'warn'); return; }
    if (activeCanal) openModal(activeCanal);
  });

  document.getElementById('p-btn-draw').addEventListener('click', () => {
    if (!isAdmin) { showToast('🔒 Modo solo lectura. Active el modo admin para continuar.', 'warn'); return; }
    if (activeCanal) startDrawMode(activeCanal);
  });

  document.getElementById('p-btn-delete').addEventListener('click', () => {
    if (!isAdmin) { showToast('🔒 Modo solo lectura. Active el modo admin para continuar.', 'warn'); return; }
    if (activeCanal) openConfirmDelete(activeCanal);
  });

  document.getElementById('p-btn-delete-trazado').addEventListener('click', async () => {
    if (!isAdmin || !activeCanal) return;
    const idx = canales.findIndex(c => c.id === activeCanal.id);
    if (idx !== -1) {
      canales[idx].trazado = null;
      activeCanal.trazado  = null;
      await saveCanal(canales[idx]);
      applyFilters();
      populatePanel(activeCanal);
      showToast(`Trazado de ${activeCanal.nombre} eliminado`, 'info');
    }
  });

  document.getElementById('p-color-input').addEventListener('input', async (e) => {
    if (!isAdmin || !activeCanal) return;
    const idx = canales.findIndex(c => c.id === activeCanal.id);
    if (idx !== -1) {
      canales[idx].color  = e.target.value;
      activeCanal.color   = e.target.value;
      await saveCanal(canales[idx]);
      applyFilters();
      setTimeout(() => {
        markersLayer.eachLayer(marker => {
          if (marker._canal?.id === activeCanal.id) activeMarker = marker;
        });
      }, 50);
    }
  });

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  document.getElementById('modal-save').addEventListener('click', saveModal);

  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-overlay').classList.remove('open');
  });
  document.getElementById('confirm-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('confirm-overlay'))
      document.getElementById('confirm-overlay').classList.remove('open');
  });
}

/* ─── Modal multimedia — links dinámicos ─── */
function initModalMultimedia() {
  document.getElementById('btn-add-video').addEventListener('click', () => addLinkRow('videos-group', 'URL del video'));
  document.getElementById('btn-add-foto').addEventListener('click',  () => addLinkRow('fotos-group',  'URL de la foto'));
}

function addLinkRow(groupId, placeholder, value = '') {
  const group = document.getElementById(groupId);
  const row   = document.createElement('div');
  row.className = 'link-row';
  row.innerHTML = `
    <input class="modal__input" type="url" placeholder="${placeholder}" value="${value}" />
    <button class="link-remove-btn" title="Quitar">✕</button>
  `;
  row.querySelector('.link-remove-btn').addEventListener('click', () => row.remove());
  group.appendChild(row);
}

function getLinksFromGroup(groupId) {
  return [...document.querySelectorAll(`#${groupId} .link-row input`)]
    .map(i => i.value.trim())
    .filter(v => v.length > 0);
}

function clearLinkGroup(groupId) {
  document.getElementById(groupId).innerHTML = '';
}

function openModal(canal, presetLat, presetLng) {
  if (!isAdmin) return;
  editingId   = canal ? canal.id : null;
  const isEdit= canal !== null;

  document.getElementById('modal-title').textContent  = isEdit ? `Editar — ${canal.nombre}` : 'Nuevo Canal';
  document.getElementById('modal-error').textContent  = '';

  const fields = ['id','nombre','cuenca','localidad','barrio','longitud','inicio','final',
                  'seccion','revestimiento','disenios','riesgo','estado','lat','lng'];

  fields.forEach(k => {
    const el = document.getElementById(`f-${k}`);
    if (!el) return;
    el.value = '';
    el.classList.remove('error');
  });

  // Limpiar grupos de links
  clearLinkGroup('videos-group');
  clearLinkGroup('fotos-group');
  document.getElementById('f-plano').value   = '';
  document.getElementById('f-ficha').value   = '';
  document.getElementById('f-informe').value = '';

  if (isEdit) {
    document.getElementById('f-id').value           = canal.id;
    document.getElementById('f-id').disabled        = true;
    document.getElementById('f-nombre').value       = canal.nombre       || '';
    document.getElementById('f-cuenca').value       = canal.cuenca       || '';
    document.getElementById('f-localidad').value    = canal.localidad    || '';
    document.getElementById('f-barrio').value       = canal.barrio       || '';
    document.getElementById('f-longitud').value     = canal.longitud     || '';
    document.getElementById('f-inicio').value       = canal.inicio       || '';
    document.getElementById('f-final').value        = canal.final        || '';
    document.getElementById('f-seccion').value      = canal.seccion      || '';
    document.getElementById('f-revestimiento').value= canal.revestimiento|| '';
    document.getElementById('f-disenios').value     = canal.disenios     || 'No';
    document.getElementById('f-riesgo').value       = canal.riesgo       || '';
    document.getElementById('f-estado').value       = canal.estado       || '';
    document.getElementById('f-lat').value          = canal.lat          || '';
    document.getElementById('f-lng').value          = canal.lng          || '';

    // Rellenar multimedia
    (canal.videos || []).forEach(url => addLinkRow('videos-group', 'URL del video', url));
    document.getElementById('f-plano').value   = canal.plano   || '';
    document.getElementById('f-ficha').value   = canal.ficha   || '';
    document.getElementById('f-informe').value = canal.informe || '';
    (canal.fotos || []).forEach(url  => addLinkRow('fotos-group',  'URL de la foto', url));
  } else {
    document.getElementById('f-id').disabled   = false;
    document.getElementById('f-disenios').value = 'No';
    if (presetLat !== undefined && presetLng !== undefined) {
      document.getElementById('f-lat').value = presetLat.toFixed(6);
      document.getElementById('f-lng').value = presetLng.toFixed(6);
      showToast('📍 Coordenadas capturadas del mapa', 'success');
    }
    // Un input vacío por defecto en videos y fotos
    addLinkRow('videos-group', 'URL del video');
    addLinkRow('fotos-group',  'URL de la foto');
  }

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
}

async function saveModal() {
  const err = document.getElementById('modal-error');
  err.textContent = '';

  const id        = parseInt(document.getElementById('f-id').value);
  const nombre    = document.getElementById('f-nombre').value.trim();
  const localidad = parseInt(document.getElementById('f-localidad').value);
  const estado    = document.getElementById('f-estado').value;
  const lat       = parseFloat(document.getElementById('f-lat').value);
  const lng       = parseFloat(document.getElementById('f-lng').value);

  let hasError = false;
  if (!id || isNaN(id))    { markError('f-id');        hasError = true; }
  if (!nombre)             { markError('f-nombre');     hasError = true; }
  if (!localidad)          { markError('f-localidad');  hasError = true; }
  if (!estado)             { markError('f-estado');     hasError = true; }
  if (isNaN(lat))          { markError('f-lat');        hasError = true; }
  if (isNaN(lng))          { markError('f-lng');        hasError = true; }
  if (hasError) { err.textContent = 'Completa los campos obligatorios (*)'; return; }

  if (editingId === null && canales.find(c => c.id === id)) {
    markError('f-id');
    err.textContent = `Ya existe un canal con ID ${id}`;
    return;
  }

  const localidadNombre = LOCALIDAD_NAMES[localidad] || '';

  // Recoger links multimedia
  const videos  = getLinksFromGroup('videos-group');
  const fotos   = getLinksFromGroup('fotos-group');
  const plano   = document.getElementById('f-plano').value.trim()   || null;
  const ficha   = document.getElementById('f-ficha').value.trim()   || null;
  const informe = document.getElementById('f-informe').value.trim() || null;

  const canalData = {
    id,
    nombre,
    cuenca:          document.getElementById('f-cuenca').value.trim()        || '—',
    localidad,
    localidadNombre,
    barrio:          document.getElementById('f-barrio').value.trim()        || '—',
    longitud:        document.getElementById('f-longitud').value.trim()      || '—',
    inicio:          document.getElementById('f-inicio').value.trim()        || '—',
    final:           document.getElementById('f-final').value.trim()         || '—',
    seccion:         document.getElementById('f-seccion').value              || '—',
    revestimiento:   document.getElementById('f-revestimiento').value        || '—',
    disenios:        document.getElementById('f-disenios').value             || 'No',
    riesgo:          document.getElementById('f-riesgo').value               || '—',
    estado,
    lat, lng,
    trazado: null,
    color:   null,
    videos,
    plano,
    ficha,
    informe,
    fotos,
  };

  if (editingId !== null) {
    const existing   = canales.find(c => c.id === editingId);
    canalData.trazado= existing?.trazado || null;
    canalData.color  = existing?.color   || null;
    const idx        = canales.findIndex(c => c.id === editingId);
    canales[idx]     = canalData;
    showToast(`Canal ${nombre} actualizado`, 'success');
  } else {
    canales.push(canalData);
    showToast(`Canal ${nombre} añadido`, 'success');
  }

  await saveCanal(canalData);
  closeModal();
  applyFilters();

  if (editingId !== null && activeCanal?.id === editingId) {
    activeCanal = canalData;
    populatePanel(canalData);
  }
}

function markError(id) {
  document.getElementById(id)?.classList.add('error');
}

function openConfirmDelete(canal) {
  if (!isAdmin) return;
  document.getElementById('confirm-text').textContent =
    `¿Eliminar "${canal.nombre}" (Canal #${canal.id})? Esta acción no se puede deshacer.`;

  const btn    = document.getElementById('confirm-ok');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', () => {
    deleteCanal(canal.id);
    document.getElementById('confirm-overlay').classList.remove('open');
  });

  document.getElementById('confirm-overlay').classList.add('open');
}

async function deleteCanal(id) {
  if (!isAdmin) return;
  const canal = canales.find(c => c.id === id);
  canales     = canales.filter(c => c.id !== id);
  await removeCanal(id);
  closePanel();
  activeMarker = null;
  activeCanal  = null;
  applyFilters();
  showToast(`Canal ${canal?.nombre} eliminado`, 'info');
}

/* ─────────────────────────────────────────────────────────────
   PICK POINT MODE
   ───────────────────────────────────────────────────────────── */
function startPickPointMode() {
  if (!isAdmin) return;
  pickPointMode = true;
  document.body.classList.add('pick-point-mode');
  showToast('📍 Haz clic en el mapa para ubicar el nuevo canal', 'info');

  let banner = document.getElementById('pick-point-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'pick-point-banner';
    banner.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:#1a2035; color:#e2e8f0; border:1px solid #4d9fff;
      border-radius:10px; padding:12px 20px; font-size:13px;
      z-index:9999; display:flex; align-items:center; gap:10px;
      box-shadow:0 4px 20px rgba(0,0,0,0.5);
    `;
    banner.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4d9fff" stroke-width="2">
        <circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 12 8 12s8-6.6 8-12a8 8 0 0 0-8-8z"/>
      </svg>
      <span>Haz clic en el mapa para ubicar el nuevo canal</span>
      <button onclick="cancelPickPointMode()" style="
        background:transparent; border:1px solid #4d6380; color:#94a3b8;
        border-radius:6px; padding:3px 10px; cursor:pointer; font-size:12px; margin-left:8px;
      ">Cancelar</button>
    `;
    document.body.appendChild(banner);
  }
  banner.style.display = 'flex';
}

function finishPickPoint(latlng) {
  if (!pickPointMode) return;
  pickPointMode = false;
  document.body.classList.remove('pick-point-mode');
  const banner = document.getElementById('pick-point-banner');
  if (banner) banner.style.display = 'none';
  openModal(null, latlng.lat, latlng.lng);
}

window.cancelPickPointMode = function () {
  pickPointMode = false;
  document.body.classList.remove('pick-point-mode');
  const banner = document.getElementById('pick-point-banner');
  if (banner) banner.style.display = 'none';
  showToast('Selección de punto cancelada', 'info');
};

/* ─────────────────────────────────────────────────────────────
   DRAW MODE
   ───────────────────────────────────────────────────────────── */
function initDrawTools() {
  document.getElementById('draw-undo').addEventListener('click', undoDrawPoint);
  document.getElementById('draw-cancel').addEventListener('click', cancelDrawMode);
  document.getElementById('draw-save').addEventListener('click', saveDrawTrazado);
}

function startDrawMode(canal) {
  if (!isAdmin) { showToast('🔒 Modo solo lectura. Active el modo admin para continuar.', 'warn'); return; }
  drawCanal  = canal;
  drawPoints = canal.trazado ? [...canal.trazado] : [];
  drawMode   = true;

  document.body.classList.add('draw-mode');
  document.getElementById('draw-canal-name').textContent = canal.nombre;
  document.getElementById('draw-toolbar').classList.add('visible');

  if (drawPoints.length > 0) {
    refreshDrawLayer();
    document.getElementById('draw-instructions').textContent =
      'Canal tiene trazado existente. Puedes seguir añadiendo puntos o guardar.';
  }

  updateDrawUI();
  closePanel();
  showToast('Modo dibujo activo — clic en el mapa para marcar puntos', 'info');
}

function addDrawPoint(latlng) {
  drawPoints.push([latlng.lat, latlng.lng]);
  refreshDrawLayer();
  updateDrawUI();
}

function undoDrawPoint() {
  if (drawPoints.length === 0) return;
  drawPoints.pop();
  refreshDrawLayer();
  updateDrawUI();
}

function refreshDrawLayer() {
  if (drawPolyline) { map.removeLayer(drawPolyline); drawPolyline = null; }
  drawMarkers.forEach(m => map.removeLayer(m));
  drawMarkers = [];

  if (drawPoints.length === 0) return;

  const color = drawCanal.color || getEstadoColor(drawCanal.estado);

  if (drawPoints.length >= 2) {
    drawPolyline = L.polyline(drawPoints, {
      color, weight: 4, opacity: 0.8, dashArray: '8 6', lineCap: 'round'
    }).addTo(map);
  }

  drawPoints.forEach((pt, i) => {
    const isFirst = i === 0;
    const isLast  = i === drawPoints.length - 1;
    const marker  = L.circleMarker(pt, {
      radius: (isFirst || isLast) ? 9 : 6,
      color,
      fillColor: isFirst ? '#00c9a7' : (isLast ? color : '#ffffff'),
      fillOpacity: (isFirst || isLast) ? 1 : 0.7,
      weight: 2
    }).addTo(map);
    drawMarkers.push(marker);
  });
}

function updateDrawUI() {
  const n = drawPoints.length;
  document.getElementById('draw-pts').textContent   = `${n} punto${n !== 1 ? 's' : ''}`;
  document.getElementById('draw-save').disabled     = n < 2;

  if (n === 0) {
    document.getElementById('draw-instructions').textContent =
      'Haz clic en el mapa para marcar puntos del canal. Doble clic para finalizar.';
  } else if (n === 1) {
    document.getElementById('draw-instructions').textContent = 'Añade al menos un punto más para crear el trazado.';
  } else {
    document.getElementById('draw-instructions').textContent = `Trazado de ${n} puntos. Continúa añadiendo o guarda.`;
  }
}

function finishDraw() {
  if (drawPoints.length >= 2) saveDrawTrazado();
}

async function saveDrawTrazado() {
  if (!drawCanal || drawPoints.length < 2) return;

  const idx = canales.findIndex(c => c.id === drawCanal.id);
  if (idx !== -1) {
    canales[idx].trazado = [...drawPoints];
    await saveCanal(canales[idx]);
    showToast(`Trazado de ${drawCanal.nombre} guardado (${drawPoints.length} pts)`, 'success');
  }

  cleanupDrawMode();
  applyFilters();
}

function cancelDrawMode() { cleanupDrawMode(); showToast('Dibujo cancelado', 'info'); }

function cleanupDrawMode() {
  drawMode  = false;
  drawCanal = null;
  document.body.classList.remove('draw-mode');
  document.getElementById('draw-toolbar').classList.remove('visible');
  if (drawPolyline) { map.removeLayer(drawPolyline); drawPolyline = null; }
  drawMarkers.forEach(m => map.removeLayer(m));
  drawMarkers = [];
  drawPoints  = [];
  updateDrawUI();
}

/* ─────────────────────────────────────────────────────────────
   LEYENDA
   ───────────────────────────────────────────────────────────── */
function initLegend() {
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div class="legend-title">Estado del canal</div>
      <div class="legend-item"><span class="legend-dot" style="background:#22c55e;box-shadow:0 0 4px #22c55e"></span><span class="legend-label">Bueno</span></div>
      <div class="legend-item"><span class="legend-dot" style="background:#f5a623;box-shadow:0 0 4px #f5a623"></span><span class="legend-label">Regular</span></div>
      <div class="legend-item"><span class="legend-dot" style="background:#ef4444;box-shadow:0 0 4px #ef4444"></span><span class="legend-label">Deficiente</span></div>
      <div class="legend-item"><span class="legend-dot" style="background:#dc2626;box-shadow:0 0 4px #dc2626"></span><span class="legend-label">Crítico</span></div>
      <div style="border-top:1px solid rgba(255,255,255,0.07);margin-top:8px;padding-top:8px;">
        <div class="legend-item"><span style="width:24px;height:3px;background:#4d9fff;display:inline-block;border-radius:2px;margin-right:7px"></span><span class="legend-label" style="font-size:10px">Trazado</span></div>
      </div>
    `;
    return div;
  };
  legend.addTo(map);
}

/* ─────────────────────────────────────────────────────────────
   ESTADÍSTICAS
   ───────────────────────────────────────────────────────────── */
function updateStats(allData, visibleData) {
  document.getElementById('stat-total').textContent   = allData.length;
  document.getElementById('stat-visible').textContent = visibleData.length;
  document.getElementById('stat-lineas').textContent  = allData.filter(c => c.trazado && c.trazado.length >= 2).length;

  let totalM = 0;
  allData.forEach(c => {
    const m = parseFloat((c.longitud || '').replace(/[^\d.]/g, ''));
    if (!isNaN(m)) totalM += m;
  });
  document.getElementById('stat-km').textContent = `${(totalM / 1000).toFixed(1)} km`;
}

/* ─────────────────────────────────────────────────────────────
   TOAST
   ───────────────────────────────────────────────────────────── */
let toastTimer = null;

function showToast(msg, type = 'info') {
  const el   = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer     = setTimeout(() => { el.classList.remove('show'); }, 3000);
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */
function getEstadoClass(estado) {
  const m = { 'Bueno': 'estado-bueno', 'Regular': 'estado-regular', 'Deficiente': 'estado-deficiente', 'Crítico': 'estado-critico' };
  return m[estado] || 'estado-regular';
}

function getEstadoColor(estado) {
  const m = { 'Bueno': '#22c55e', 'Regular': '#f5a623', 'Deficiente': '#ef4444', 'Crítico': '#dc2626' };
  return m[estado] || '#4d9fff';
}

/* ─────────────────────────────────────────────────────────────
   ADMIN MODE + LOGIN
   ───────────────────────────────────────────────────────────── */
function initAdminToggle() {
  document.getElementById('btn-readonly').addEventListener('click', () => {
    if (isAdmin) {
      isAdmin = false;
      applyAdminState();
      showToast('🔒 Modo solo lectura activado', 'info');
    } else {
      openLoginModal();
    }
  });
}

function initLoginModal() {
  document.getElementById('login-submit').addEventListener('click', handleLogin);
  document.getElementById('login-close').addEventListener('click', closeLoginModal);
  document.getElementById('login-cancel').addEventListener('click', closeLoginModal);
  document.getElementById('login-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('login-overlay')) closeLoginModal();
  });
  document.getElementById('login-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
}

function openLoginModal() {
  document.getElementById('login-user').value   = '';
  document.getElementById('login-pass').value   = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-overlay').classList.add('open');
  document.getElementById('login-user').focus();
}

function closeLoginModal() {
  document.getElementById('login-overlay').classList.remove('open');
}

function handleLogin() {
  const user    = document.getElementById('login-user').value.trim();
  const pass    = document.getElementById('login-pass').value.trim();
  const errorEl = document.getElementById('login-error');

  if (user === ADMIN_CREDENTIALS.user && pass === ADMIN_CREDENTIALS.pass) {
    isAdmin = true;
    applyAdminState();
    closeLoginModal();
    showToast('✓ Modo administrador activado — edición habilitada', 'success');
  } else {
    errorEl.textContent = 'Credenciales incorrectas';
  }
}

function applyAdminState() {
  const btn    = document.getElementById('btn-readonly');
  const addBtn = document.getElementById('btn-add-canal');

  if (isAdmin) {
    document.body.classList.add('admin-mode');
    document.body.classList.remove('readonly');
    btn.classList.add('active-admin');
    btn.title   = 'Modo admin activo — clic para desactivar';
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      Modo admin activo`;
    addBtn.disabled = false;
  } else {
    document.body.classList.remove('admin-mode');
    document.body.classList.add('readonly');
    btn.classList.remove('active-admin');
    btn.title   = 'Modo solo lectura — clic para activar edición';
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      Solo lectura`;
    addBtn.disabled = true;
  }

  markersLayer.eachLayer(m => {
    if (m.dragging) { isAdmin ? m.dragging.enable() : m.dragging.disable(); }
  });

  if (activeCanal) updatePanelButtons();
}

/* ─────────────────────────────────────────────────────────────
   LIGHTBOX VIEWER
   ───────────────────────────────────────────────────────────── */
let galleryData  = null;
let galleryIndex = 0;

window.openLightbox = function openLightbox(type, src, title) {
  const overlay = document.getElementById('lightbox-overlay');
  const body    = document.getElementById('lightbox-body');
  const titleEl = document.getElementById('lightbox-title');

  titleEl.textContent = title || 'Vista previa';
  body.innerHTML      = '';
  galleryData         = null;

  if (type === 'pdf') {
    // Intentar embed; si falla (CORS), abrir en nueva pestaña con botón
    body.innerHTML = `
      <embed src="${src}" type="application/pdf" class="lightbox-pdf" onerror="this.outerHTML='<div style=padding:20px;text-align:center;color:#8899aa><p style=margin-bottom:12px>No se puede previsualizar este PDF aquí.</p><a href=\\'${src}\\' target=\\'_blank\\' rel=\\'noopener\\' style=color:#4d9fff>Abrir en nueva pestaña →</a></div>'" />
      <div style="padding:8px;text-align:right">
        <a href="${src}" target="_blank" rel="noopener" style="font-size:11px;color:#4d9fff;text-decoration:none;">↗ Abrir en nueva pestaña</a>
      </div>`;
  } else if (type === 'video') {
    // Detectar YouTube/Vimeo → iframe; de lo contrario <video>
    if (/youtube\.com|youtu\.be/i.test(src)) {
      const yid = src.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1] || '';
      body.innerHTML = `<iframe width="100%" height="480" src="https://www.youtube.com/embed/${yid}" frameborder="0" allowfullscreen class="lightbox-video" style="height:calc(88vh - 90px);border-radius:6px;"></iframe>`;
    } else if (/vimeo\.com/i.test(src)) {
      const vid = src.match(/vimeo\.com\/(\d+)/)?.[1] || '';
      body.innerHTML = `<iframe width="100%" height="480" src="https://player.vimeo.com/video/${vid}" frameborder="0" allowfullscreen class="lightbox-video" style="height:calc(88vh - 90px);border-radius:6px;"></iframe>`;
    } else {
      body.innerHTML = `<video controls autoplay class="lightbox-video"><source src="${src}"></video>`;
    }
  } else if (type === 'image') {
    body.innerHTML = `<img src="${src}" class="lightbox-image" alt="${title}" onerror="this.outerHTML='<div style=color:#8899aa;padding:20px>No se pudo cargar la imagen. Verifica que el link sea público.</div>'" />`;
  }

  overlay.classList.add('open');
};

function openLightboxGallery(fotos, startIndex, canalNombre) {
  galleryData  = fotos;
  galleryIndex = startIndex;
  showGallerySlide(canalNombre);
  document.getElementById('lightbox-overlay').classList.add('open');
}

function showGallerySlide(canalNombre) {
  const body    = document.getElementById('lightbox-body');
  const titleEl = document.getElementById('lightbox-title');
  const total   = galleryData.length;
  titleEl.textContent = `Fotos — ${canalNombre || ''} (${galleryIndex + 1} / ${total})`;

  body.innerHTML = `
    <div class="lightbox-gallery">
      ${total > 1 ? `<button class="lightbox-nav lightbox-nav--prev" id="lb-prev" title="Anterior">&#8592;</button>` : ''}
      <img src="${galleryData[galleryIndex]}" class="lightbox-image" alt="foto ${galleryIndex + 1}"
           onerror="this.style.opacity='0.3';this.alt='Link de imagen no válido'" />
      ${total > 1 ? `<button class="lightbox-nav lightbox-nav--next" id="lb-next" title="Siguiente">&#8594;</button>` : ''}
    </div>
    ${total > 1 ? `<div class="lightbox-dots">${galleryData.map((_, i) =>
      `<span class="lb-dot${i === galleryIndex ? ' active' : ''}" data-i="${i}"></span>`
    ).join('')}</div>` : ''}
  `;

  body.querySelector('#lb-prev')?.addEventListener('click', () => {
    galleryIndex = (galleryIndex - 1 + total) % total;
    showGallerySlide(canalNombre);
  });
  body.querySelector('#lb-next')?.addEventListener('click', () => {
    galleryIndex = (galleryIndex + 1) % total;
    showGallerySlide(canalNombre);
  });
  body.querySelectorAll('.lb-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      galleryIndex = parseInt(dot.dataset.i);
      showGallerySlide(canalNombre);
    });
  });
}

function closeLightbox() {
  document.getElementById('lightbox-overlay').classList.remove('open');
  document.getElementById('lightbox-body').innerHTML = '';
  galleryData = null;
}

function initLightbox() {
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox-overlay')) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('lightbox-overlay');
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (galleryData && e.key === 'ArrowLeft') {
      galleryIndex = (galleryIndex - 1 + galleryData.length) % galleryData.length;
      showGallerySlide('');
    }
    if (galleryData && e.key === 'ArrowRight') {
      galleryIndex = (galleryIndex + 1) % galleryData.length;
      showGallerySlide('');
    }
  });
}

/* ─── ARRANCAR ─── */
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  initLightbox();
});
