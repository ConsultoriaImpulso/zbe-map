const ACCESS_FILE = "./access.csv";
const GEOJSON_FILE = "./zbe_master_22_current.geojson";
const COORDS_CANDIDATES = [
  "./mapa_zbe.csv",
  "./MAPA_ZBE.csv",
  "./mapa_zbe.CSV",
  "./MAPA_ZBE.CSV"
];

const CITY_22 = [
  "A Coruña","Alicante","Barcelona","Bilbao","Córdoba","Gijón","Granada",
  "Las Palmas de Gran Canaria","Madrid","Madrid - Distrito Centro","Madrid - Plaza Elíptica",
  "Málaga","Murcia","Palma (Mallorca)","Pamplona","San Sebastián","Sevilla",
  "Valencia","Valladolid","Vitoria-Gasteiz","Zaragoza","Vigo"
];

// DOM
const toast = document.getElementById("toast");
const vehGrid = document.getElementById("vehGrid");
const badgeRow = document.getElementById("badgeRow");
const weightRow = document.getElementById("weightRow");
const btnLight = document.getElementById("btnLight");
const btnHeavy = document.getElementById("btnHeavy");

const cityInput = document.getElementById("cityInput");
const suggestions = document.getElementById("suggestions");

const selectedCityBar = document.getElementById("selectedCityBar");
const selectedCityName = document.getElementById("selectedCityName");
const btnClearCity = document.getElementById("btnClearCity");

const selectedCityChip = document.getElementById("selectedCityChip");
const obsCity = document.getElementById("obsCity");
const obsBodyText = document.getElementById("obsBodyText");
const vigDot = document.getElementById("vigDot");
const vigText = document.getElementById("vigText");
const sourceText = document.getElementById("sourceText");

const btnOptions = document.getElementById("btnOptions");
const optionsBody = document.getElementById("optionsBody");
const btnReload = document.getElementById("btnReload");
const btnReset = document.getElementById("btnReset");
const lastUpdated = document.getElementById("lastUpdated");
const csvHint = document.getElementById("csvHint");

function showToast(msg, ms = 9000) {
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.style.display = "none";
  }, ms);
}

const CSV_URL = new URL("access.csv", window.location.href).href;
if (csvHint) csvHint.textContent = `CSV: ${CSV_URL}`;

// Utils
function canon(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function stripBom(s) {
  return (s || "").replace(/^\uFEFF/, "");
}

function splitLines(s) {
  return stripBom(s).trim().split(/\r?\n/).filter(Boolean);
}

function detectDelimiter(line) {
  const commas = (line.match(/,/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  return semis > commas ? ";" : ",";
}

function parseCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }

    if (!inQ && ch === delim) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = splitLines(text);
  if (!lines.length) return [];

  const first = lines[0].toLowerCase();
  const dataLines = first.startsWith("sep=") ? lines.slice(1) : lines;
  if (!dataLines.length) return [];

  const delim = detectDelimiter(dataLines[0]);
  return dataLines.map(line => parseCsvLine(line, delim));
}

function lower(s) {
  return String(s || "").trim().toLowerCase();
}

function norm(s) {
  return String(s || "").trim();
}

function findCol(header, names) {
  const h = header.map(lower);

  for (const n of names) {
    const idx = h.indexOf(lower(n));
    if (idx >= 0) return idx;
  }

  for (let i = 0; i < h.length; i++) {
    for (const n of names) {
      if (h[i].includes(lower(n))) return i;
    }
  }

  return -1;
}

function parseNumMaybe(value) {
  const t = String(value || "").trim();
  if (!t) return NaN;
  return parseFloat(t.replace(",", "."));
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatObservation(raw) {
  const text = String(raw || "");
  if (!text.trim()) return "";

  // Si ya viene con HTML básico, lo respetamos
  const looksLikeHtml = /<\/?(b|strong|br|p|ul|ol|li|em|i)\b/i.test(text);

  if (looksLikeHtml) {
    return text;
  }

  // Si no viene HTML, respetamos espacios y saltos con pre-wrap vía CSS
  return escapeHtml(text);
}

// Data
let idx = new Map();
let cities = new Map();
let badges = new Map();
let vehicles = new Map();
let cityCoords = new Map();

let zonesLayer = null;
let cityBounds = new Map();
let pinMarkers = new Map();
let pinsLayer = L.layerGroup();

const state = {
  baseVeh: "TURISMO",
  weight: "LIGHT",
  cVeh: "",
  cBadge: canon("SIN ETIQUETA"),
  cCity: ""
};

const VEH_MAP = {
  TURISMO: { LIGHT: "turismo", HEAVY: "turismo" },
  MOTO:    { LIGHT: "motocicleta", HEAVY: "motocicleta" },
  FURGON:  { LIGHT: "furgoneta", HEAVY: "furgoneta >3500 kg" },
  CAMION:  { LIGHT: "camión (servicios)", HEAVY: "camión >3500 kg (servicios)" },
  BUS:     { LIGHT: "autobús (servicios)", HEAVY: "autobús >3500 kg (servicios)" }
};

const BADGE_OPTIONS = [
  { label: "0", value: "0", cls: "badge-0", top: "DGT", mode: "round" },
  { label: "ECO", value: "ECO", cls: "badge-eco", top: "DGT", mode: "round" },
  { label: "C", value: "C", cls: "badge-c", top: "DGT", mode: "round" },
  { label: "B", value: "B", cls: "badge-b", top: "DGT", mode: "round" },
  { label: "SIN DISTINTIVO", value: "SIN ETIQUETA", cls: "badge-sin", top: "", mode: "text" }
];

// Map
const DEFAULT_VIEW = { center: [40.4168, -3.7038], zoom: 6 };
const map = L.map("map", { zoomControl: false }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
L.control.zoom({ position: "topright" }).addTo(map);

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap"
});
osm.on("tileerror", () => showToast("⚠️ No se pudieron cargar los tiles de OpenStreetMap.", 12000));
osm.addTo(map);

pinsLayer.addTo(map);

// Access helpers
function key(cCity, cBadge, cVeh) {
  return `${cCity}||${cBadge}||${cVeh}`;
}

function getRec(cCity) {
  if (!cCity) return null;
  return idx.get(key(cCity, state.cBadge, state.cVeh)) || null;
}

function normalizeAccessLabel(access) {
  const a = String(access || "").toUpperCase();
  if (a.includes("PROHIB")) return "PROHIBIDO";
  if (a.includes("COND")) return "CONDICIONADO";
  if (a.includes("LIBRE")) return "LIBRE";
  return access ? a : "SIN DATOS";
}

function accessToColor(access) {
  const a = String(access || "").toUpperCase();
  if (a.includes("PROHIB")) return "#ff4d4d";
  if (a.includes("COND")) return "#ff8a00";
  if (a.includes("LIBRE")) return "#00d26a";
  return "#9aa4b2";
}

function chipClass(access) {
  const a = String(access || "").toUpperCase();
  if (a.includes("PROHIB")) return "chip red";
  if (a.includes("COND")) return "chip orange";
  if (a.includes("LIBRE")) return "chip green";
  return "chip gray";
}

function setAccessChip(access) {
  if (!selectedCityChip) return;
  selectedCityChip.className = chipClass(access);
  selectedCityChip.textContent = normalizeAccessLabel(access);
}

function setLastUpdatedNow() {
  if (!lastUpdated) return;
  lastUpdated.textContent = "Última carga: " + new Date().toLocaleString("es-ES");
}

function setVigencia(valueRaw) {
  if (!vigDot || !vigText) return;

  const v = String(valueRaw || "").trim();
  const c = canon(v);

  if (!v) {
    vigDot.className = "vig-dot unknown";
    vigText.textContent = "Vigencia ZBE: —";
    return;
  }

  const isNo = c.includes("no") || c.includes("false") || c === "0" || c.includes("inact") || c.includes("caduc") || c.includes("no vigente");
  const isYes = c.includes("si") || c.includes("sí") || c.includes("true") || c === "1" || c.includes("vigent") || c.includes("activo") || c.includes("vigente");

  if (isNo && !isYes) {
    vigDot.className = "vig-dot no";
    vigText.textContent = "Vigencia ZBE: NO VIGENTE";
    return;
  }

  if (isYes) {
    vigDot.className = "vig-dot ok";
    vigText.textContent = "Vigencia ZBE: VIGENTE";
    return;
  }

  vigDot.className = "vig-dot unknown";
  vigText.textContent = "Vigencia ZBE: " + v.toUpperCase();
}

function cityDisplayName(cCanon) {
  return cities.get(cCanon) || CITY_22.find(x => canon(x) === cCanon) || cCanon;
}

function syncObsHeader() {
  if (!obsCity) return;
  const city = cities.get(state.cCity) || (state.cCity ? state.cCity : "");
  obsCity.textContent = city ? city.toUpperCase() : "—";
}

function showSelectedCityBar() {
  if (!selectedCityBar || !selectedCityName) return;

  if (!state.cCity) {
    selectedCityBar.style.display = "none";
    return;
  }

  selectedCityName.textContent = cityDisplayName(state.cCity);
  selectedCityBar.style.display = "block";
}

// GeoJSON helpers
function featureCityCanon(feature) {
  const p = feature?.properties || {};
  const candidates = [
    p.city, p.CIUDAD, p.Ciudad, p.municipio, p.MUNICIPIO, p.nombre, p.NAME, p.name
  ].filter(Boolean);

  if (candidates.length) return canon(candidates[0]);

  for (const k of Object.keys(p)) {
    const ck = canon(k);
    if ((ck.includes("ciud") || ck.includes("city") || ck.includes("municip")) && p[k]) {
      return canon(p[k]);
    }
  }

  for (const k of Object.keys(p)) {
    const ck = canon(k);
    if (ck.includes("name") && p[k]) return canon(p[k]);
  }

  return "";
}

function styleForFeature(feature) {
  const cCity = featureCityCanon(feature);
  const rec = getRec(cCity);
  const col = accessToColor(rec?.access || "");
  const selected = state.cCity && cCity === state.cCity;

  return {
    color: col,
    weight: selected ? 3.8 : 2.6,
    opacity: 0.95,
    dashArray: "0",
    fillColor: col,
    fillOpacity: selected ? 0.34 : 0.24
  };
}

function refreshZonesStyle() {
  if (!zonesLayer) return;
  zonesLayer.setStyle(styleForFeature);
}

function rebuildCityBounds() {
  cityBounds = new Map();
  if (!zonesLayer) return;

  zonesLayer.eachLayer((layer) => {
    const f = layer.feature;
    if (!f) return;

    const cCity = featureCityCanon(f);
    if (!cCity) return;

    if (typeof layer.getBounds !== "function") return;

    const b = layer.getBounds();
    if (!b || !b.isValid()) return;

    if (cityBounds.has(cCity)) {
      cityBounds.set(cCity, cityBounds.get(cCity).extend(b));
    } else {
      cityBounds.set(cCity, b);
    }
  });
}

// Zoom
function flyToBoundsSlow(bounds) {
  try {
    map.flyToBounds(bounds, { padding: [60, 60], duration: 2.0 });
  } catch {
    map.fitBounds(bounds, { padding: [60, 60] });
  }
}

function flyToPointSlow(lat, lng) {
  map.flyTo([lat, lng], 16, { duration: 2.0 });
}

function flyToDefaultSlow() {
  map.flyTo(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, { duration: 2.0 });
}

// Pins
function getCityLatLng(cCity) {
  if (cityBounds.has(cCity)) {
    const center = cityBounds.get(cCity).getCenter();
    return { lat: center.lat, lng: center.lng };
  }

  if (cityCoords.has(cCity)) {
    return cityCoords.get(cCity);
  }

  return null;
}

function pinSvg(color, selected = false) {
  const w = selected ? 22 : 18;
  const h = selected ? 34 : 28;
  const stroke = "rgba(255,255,255,0.95)";
  const strokeW = selected ? 1.8 : 1.6;

  return `
    <svg width="${w}" height="${h}" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C7.6 2 4 5.6 4 10c0 6.2 8 24 8 24s8-17.8 8-24c0-4.4-3.6-8-8-8z"
        fill="${color}" stroke="${stroke}" stroke-width="${strokeW}"/>
      <circle cx="12" cy="10.5" r="4.5" fill="${stroke}" opacity="0.95"/>
    </svg>
  `;
}

function makePinIcon(color, selected = false) {
  const w = selected ? 22 : 18;
  const h = selected ? 34 : 28;

  return L.divIcon({
    className: "pin-icon",
    html: pinSvg(color, selected),
    iconSize: [w, h],
    iconAnchor: [w / 2, h]
  });
}

function refreshPins() {
  for (const cCity of pinMarkers.keys()) {
    const marker = pinMarkers.get(cCity);
    const rec = getRec(cCity);
    const col = accessToColor(rec?.access || "");
    const selected = state.cCity && cCity === state.cCity;

    marker.setIcon(makePinIcon(col, selected));
    marker.setZIndexOffset(selected ? 1000 : 0);
  }
}

function buildPins() {
  pinsLayer.clearLayers();
  pinMarkers = new Map();

  const missing = [];

  for (const name of CITY_22) {
    const cCity = canon(name);
    const ll = getCityLatLng(cCity);

    if (!ll) {
      missing.push(name);
      continue;
    }

    const rec = getRec(cCity);
    const col = accessToColor(rec?.access || "");
    const selected = state.cCity && cCity === state.cCity;

    const marker = L.marker([ll.lat, ll.lng], {
      icon: makePinIcon(col, selected),
      keyboard: false
    });

    marker.on("click", () => {
      if (state.cCity === cCity) {
        clearSelectionAndZoomOut();
      } else {
        selectCity(cCity, { fromMap: true });
      }
    });

    marker.addTo(pinsLayer);
    pinMarkers.set(cCity, marker);
  }

  if (missing.length) {
    showToast("⚠️ Sin posición (ni polígono ni coordenadas) para: " + missing.join(", "), 14000);
  }
}

// Panel
function updateObservationPanel(cCity) {
  syncObsHeader();
  showSelectedCityBar();

  const r = getRec(cCity);
  setAccessChip(r?.access || "");

  if (obsBodyText) {
    obsBodyText.innerHTML = formatObservation(r?.obs || (r ? "" : "No hay fila en access.csv para esta combinación (ciudad + distintivo + vehículo)."));
  }

  setVigencia(r?.vig || "");

  if (sourceText) {
    sourceText.textContent = "";
  }
}

function clearObservationPanel() {
  if (obsCity) obsCity.textContent = "—";
  setAccessChip("");
  if (obsBodyText) obsBodyText.innerHTML = "Selecciona una ciudad para ver detalles.";
  setVigencia("");
  if (sourceText) sourceText.textContent = "";
  if (selectedCityBar) selectedCityBar.style.display = "none";
}

// Select
function selectCity(cCity, { fromMap = false } = {}) {
  if (state.cCity === cCity) {
    clearSelectionAndZoomOut();
    return;
  }

  state.cCity = cCity;

  updateObservationPanel(cCity);
  refreshZonesStyle();
  refreshPins();

  if (cityBounds.has(cCity)) {
    flyToBoundsSlow(cityBounds.get(cCity));
  } else if (cityCoords.has(cCity)) {
    const c = cityCoords.get(cCity);
    flyToPointSlow(c.lat, c.lng);
  } else {
    flyToDefaultSlow();
  }

  if (!fromMap) {
    cityInput.value = "";
    suggestions.style.display = "none";
  } else {
    if (suggestions.style.display !== "none") {
      renderSuggestions(cityInput.value || "");
    }
  }

  showSelectedCityBar();
  refreshPins();
}

function clearSelectionAndZoomOut() {
  state.cCity = "";
  clearObservationPanel();
  refreshZonesStyle();
  refreshPins();
  flyToDefaultSlow();
}

// Filters
function applyVehicleFromUI() {
  const mapped = VEH_MAP[state.baseVeh]?.[state.weight] || "turismo";
  state.cVeh = canon(mapped);

  if (vehicles.has(state.cVeh)) return;

  const want = state.cVeh;
  for (const [k] of vehicles.entries()) {
    if (k.includes(want) || want.includes(k)) {
      state.cVeh = k;
      return;
    }
  }
}

function normalizeBadgeToExisting() {
  if (badges.has(state.cBadge)) return;

  const want = state.cBadge;
  for (const [k] of badges.entries()) {
    if (k.includes(want) || want.includes(k)) {
      state.cBadge = k;
      return;
    }
  }

  const sin = Array.from(badges.entries()).find(([, o]) => String(o).toUpperCase() === "SIN ETIQUETA");
  state.cBadge = sin ? sin[0] : (Array.from(badges.keys())[0] || state.cBadge);
  updateActiveBadges();
}

function onFiltersChangedKeepCity() {
  applyVehicleFromUI();
  normalizeBadgeToExisting();
  refreshZonesStyle();
  refreshPins();

  if (suggestions.style.display !== "none") {
    renderSuggestions(cityInput.value || "");
  }

  if (state.cCity) {
    updateObservationPanel(state.cCity);
  }
}

// UI builders
function svgIcon(name) {
  const common = `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

  if (name === "car") {
    return `<svg class="veh-icon" viewBox="0 0 24 24"><path ${common} d="M3 13l2-6h14l2 6"/><path ${common} d="M5 13h14v6H5z"/><circle ${common} cx="7" cy="19" r="1"/><circle ${common} cx="17" cy="19" r="1"/></svg>`;
  }
  if (name === "moto") {
    return `<svg class="veh-icon" viewBox="0 0 24 24"><circle ${common} cx="6.5" cy="17.5" r="2.5"/><circle ${common} cx="17.5" cy="17.5" r="2.5"/><path ${common} d="M9 17.5l3-7h4l2 3"/><path ${common} d="M12 10.5l-2-2h-2"/></svg>`;
  }
  if (name === "van") {
    return `<svg class="veh-icon" viewBox="0 0 24 24"><path ${common} d="M3 16V8h12l3 4v4H3z"/><circle ${common} cx="7" cy="16" r="1.5"/><circle ${common} cx="17" cy="16" r="1.5"/></svg>`;
  }
  if (name === "truck") {
    return `<svg class="veh-icon" viewBox="0 0 24 24"><path ${common} d="M2 16V7h12v9H2z"/><path ${common} d="M14 10h5l3 3v3h-8z"/><circle ${common} cx="6" cy="16" r="1.5"/><circle ${common} cx="18" cy="16" r="1.5"/></svg>`;
  }
  if (name === "bus") {
    return `<svg class="veh-icon" viewBox="0 0 24 24"><path ${common} d="M5 3h14v14H5z"/><path ${common} d="M7 7h10"/><circle ${common} cx="8" cy="17" r="1.2"/><circle ${common} cx="16" cy="17" r="1.2"/></svg>`;
  }
  return "";
}

function buildVehicleButtons() {
  const items = [
    { key: "TURISMO", label: "TURISMO", icon: "car" },
    { key: "MOTO", label: "MOTO", icon: "moto" },
    { key: "FURGON", label: "FURGÓN", icon: "van" },
    { key: "CAMION", label: "CAMIÓN", icon: "truck" },
    { key: "BUS", label: "BUS", icon: "bus" }
  ];

  vehGrid.innerHTML = "";

  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "veh-btn" + (it.key === state.baseVeh ? " active" : "");
    b.setAttribute("data-veh", it.key);
    b.innerHTML = `${svgIcon(it.icon)}<div class="veh-label">${it.label}</div>`;

    b.addEventListener("click", () => {
      state.baseVeh = it.key;
      const needsWeight = ["FURGON","CAMION","BUS"].includes(state.baseVeh);
      weightRow.style.display = needsWeight ? "block" : "none";
      if (!needsWeight) state.weight = "LIGHT";
      setWeightButtons();
      updateActiveVeh();
      onFiltersChangedKeepCity();
    });

    vehGrid.appendChild(b);
  }

  updateActiveVeh();
  weightRow.style.display = ["FURGON","CAMION","BUS"].includes(state.baseVeh) ? "block" : "none";
}

function updateActiveVeh() {
  document.querySelectorAll(".veh-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-veh") === state.baseVeh);
  });
}

function setWeightButtons() {
  btnLight.classList.toggle("active", state.weight === "LIGHT");
  btnHeavy.classList.toggle("active", state.weight === "HEAVY");
}

function buildBadgeButtons() {
  badgeRow.innerHTML = "";

  for (const opt of BADGE_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `badge-btn ${opt.cls}` + (canon(opt.value) === state.cBadge ? " active" : "");
    b.setAttribute("data-badge", opt.value);

    if (opt.mode === "text") {
      b.innerHTML = `
        <div class="badge-inner">
          <span class="badge-main">${opt.label}</span>
        </div>
      `;
    } else {
      b.innerHTML = `
        <div class="badge-inner">
          <span class="badge-top">${opt.top}</span>
          <span class="badge-ring"></span>
          <span class="badge-main">${opt.label}</span>
        </div>
      `;
    }

    b.addEventListener("click", () => {
      state.cBadge = canon(opt.value);
      updateActiveBadges();
      onFiltersChangedKeepCity();
    });

    badgeRow.appendChild(b);
  }

  updateActiveBadges();
}

function updateActiveBadges() {
  document.querySelectorAll(".badge-btn").forEach(btn => {
    btn.classList.toggle("active", canon(btn.getAttribute("data-badge")) === state.cBadge);
  });
}

// Suggestions
function cityShortLabel(access) {
  const lab = normalizeAccessLabel(access);
  if (lab === "CONDICIONADO") return "COND";
  if (lab === "PROHIBIDO") return "PROH";
  if (lab === "LIBRE") return "LIBRE";
  return "—";
}

function renderSuggestions(query) {
  const q = canon(query || "");
  suggestions.innerHTML = "";

  const allCanon = CITY_22.map(canon);
  const filtered = allCanon.filter(c => !q || canon(cityDisplayName(c)).includes(q));

  for (const cCity of filtered) {
    const rec = getRec(cCity);
    const col = accessToColor(rec?.access || "");
    const name = cityDisplayName(cCity);
    const lab = cityShortLabel(rec?.access || "");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sugg-item";

    const left = document.createElement("div");
    left.className = "sugg-left";

    const dot = document.createElement("span");
    dot.className = "sugg-dot";
    dot.style.backgroundColor = col;
    dot.style.borderColor = col;

    const nm = document.createElement("span");
    nm.className = "sugg-name";
    nm.textContent = name;

    left.appendChild(dot);
    left.appendChild(nm);

    const right = document.createElement("span");
    right.className = "sugg-right";
    right.textContent = lab;

    btn.appendChild(left);
    btn.appendChild(right);

    btn.addEventListener("click", () => selectCity(cCity, { fromMap: false }));
    suggestions.appendChild(btn);
  }

  suggestions.style.display = filtered.length ? "block" : "none";
}

function closeSuggestionsSoon() {
  setTimeout(() => {
    suggestions.style.display = "none";
  }, 120);
}

// Loaders
async function loadGeojson() {
  const r = await fetch(GEOJSON_FILE, { cache: "no-store" });
  if (!r.ok) throw new Error("No pude cargar GeoJSON");

  const gj = await r.json();
  if (!gj?.features?.length) throw new Error("GeoJSON vacío");

  if (zonesLayer) map.removeLayer(zonesLayer);

  zonesLayer = L.geoJSON(gj, {
    style: styleForFeature,

    pointToLayer: (feature, latlng) => {
      const cCity = featureCityCanon(feature);
      if (cCity && !cityCoords.has(cCity)) {
        cityCoords.set(cCity, { lat: latlng.lat, lng: latlng.lng });
      }

      return L.circleMarker(latlng, {
        radius: 0,
        opacity: 0,
        fillOpacity: 0,
        interactive: false
      });
    },

    onEachFeature: (feature, layer) => {
      layer.on("click", () => {
        const cCity = featureCityCanon(feature);
        if (!cCity) return;

        if (state.cCity === cCity) {
          clearSelectionAndZoomOut();
        } else {
          selectCity(cCity, { fromMap: true });
        }
      });
    }
  }).addTo(map);

  rebuildCityBounds();
}

async function loadCoordsOptional() {
  for (const path of COORDS_CANDIDATES) {
    try {
      const r = await fetch(path, { cache: "no-store" });
      if (!r.ok) continue;

      const text = await r.text();
      const rows = parseCsv(text);
      if (rows.length < 2) return true;

      const header = rows[0];
      const iCity = findCol(header, ["city","ciudad","municipio"]);
      const iLat  = findCol(header, ["lat","latitud","latitude","y"]);
      const iLng  = findCol(header, ["lng","longitud","lon","longitude","x"]);
      const iCoord = findCol(header, ["coordenadas","coordenada","coord"]);

      if (iCity < 0) return true;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cityO = norm(row[iCity]);
        if (!cityO) continue;

        const cCity = canon(cityO);
        if (cityCoords.has(cCity)) continue;

        let lat = NaN;
        let lng = NaN;

        if (iLat >= 0 && iLng >= 0) {
          lat = parseNumMaybe(row[iLat]);
          lng = parseNumMaybe(row[iLng]);
        } else if (iCoord >= 0) {
          const val = String(row[iCoord] || "");
          const parts = val.split(/[ ,;]+/).filter(Boolean);
          if (parts.length >= 2) {
            lat = parseNumMaybe(parts[0]);
            lng = parseNumMaybe(parts[1]);
          }
        }

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          cityCoords.set(cCity, { lat, lng });
        }
      }

      return true;
    } catch {
      // sigue
    }
  }

  return false;
}

async function loadAccessCsv() {
  const r = await fetch(ACCESS_FILE, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puedo leer access.csv (HTTP ${r.status})`);

  const text = await r.text();
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("access.csv está vacío");

  const header = rows[0];

  const iCity = findCol(header, ["city","ciudad","municipio"]);
  const iBadge = findCol(header, ["badge","distintivo","distintivo ambiental","etiqueta"]);
  const iVeh = findCol(header, ["vehicle","tipo veh","vehiculo","vehículo"]);
  const iAccess = findCol(header, ["access","acceso"]);
  const iObs = findCol(header, ["observaciones","observacion","observación","nota","notas","obs"]);
  const iVig = findCol(header, ["estado zbe","vigencia","vigente","en vigor","activo","estado_zbe"]);
  const iLat = findCol(header, ["lat","latitud","latitude","y"]);
  const iLng = findCol(header, ["lng","longitud","lon","longitude","x"]);
  const iCoord = findCol(header, ["coordenadas","coordenada","coord"]);

  if (iCity < 0 || iBadge < 0 || iVeh < 0 || iAccess < 0) {
    throw new Error("No encuentro columnas mínimas en access.csv: CIUDAD, DISTINTIVO, TIPO VEHÍCULO, ACCESO");
  }

  idx = new Map();
  cities = new Map();
  badges = new Map();
  vehicles = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const cityO = norm(row[iCity]);
    const badgeO = norm(row[iBadge]);
    const vehO = norm(row[iVeh]);
    const access = norm(row[iAccess]);
    const obs = iObs >= 0 ? row[iObs] ?? "" : "";
    const vig = iVig >= 0 ? norm(row[iVig]) : "";

    if (!cityO || !badgeO || !vehO) continue;

    const cCity = canon(cityO);
    const cBadge = canon(badgeO);
    const cVeh = canon(vehO);

    cities.set(cCity, cityO);
    badges.set(cBadge, badgeO);
    vehicles.set(cVeh, vehO);

    if (!cityCoords.has(cCity)) {
      let lat = NaN;
      let lng = NaN;

      if (iLat >= 0 && iLng >= 0) {
        lat = parseNumMaybe(row[iLat]);
        lng = parseNumMaybe(row[iLng]);
      } else if (iCoord >= 0) {
        const val = String(row[iCoord] || "");
        const parts = val.split(/[ ,;]+/).filter(Boolean);
        if (parts.length >= 2) {
          lat = parseNumMaybe(parts[0]);
          lng = parseNumMaybe(parts[1]);
        }
      }

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        cityCoords.set(cCity, { lat, lng });
      }
    }

    idx.set(key(cCity, cBadge, cVeh), {
      access,
      obs,
      vig,
      sourceUrl: ""
    });
  }
}

// Filters
function applyVehicleFromUI() {
  const mapped = VEH_MAP[state.baseVeh]?.[state.weight] || "turismo";
  state.cVeh = canon(mapped);

  if (vehicles.has(state.cVeh)) return;

  const want = state.cVeh;
  for (const [k] of vehicles.entries()) {
    if (k.includes(want) || want.includes(k)) {
      state.cVeh = k;
      return;
    }
  }
}

function normalizeBadgeToExisting() {
  if (badges.has(state.cBadge)) return;

  const want = state.cBadge;
  for (const [k] of badges.entries()) {
    if (k.includes(want) || want.includes(k)) {
      state.cBadge = k;
      return;
    }
  }

  const sin = Array.from(badges.entries()).find(([, o]) => String(o).toUpperCase() === "SIN ETIQUETA");
  state.cBadge = sin ? sin[0] : (Array.from(badges.keys())[0] || state.cBadge);
  updateActiveBadges();
}

function onFiltersChangedKeepCity() {
  applyVehicleFromUI();
  normalizeBadgeToExisting();
  refreshZonesStyle();
  refreshPins();

  if (suggestions.style.display !== "none") {
    renderSuggestions(cityInput.value || "");
  }

  if (state.cCity) {
    updateObservationPanel(state.cCity);
  }
}

// Events
btnLight.addEventListener("click", () => {
  state.weight = "LIGHT";
  setWeightButtons();
  onFiltersChangedKeepCity();
});

btnHeavy.addEventListener("click", () => {
  state.weight = "HEAVY";
  setWeightButtons();
  onFiltersChangedKeepCity();
});

cityInput.addEventListener("input", (e) => renderSuggestions(e.target.value));
cityInput.addEventListener("focus", () => renderSuggestions(cityInput.value));
cityInput.addEventListener("click", () => renderSuggestions(cityInput.value));
cityInput.addEventListener("blur", () => closeSuggestionsSoon());
cityInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") suggestions.style.display = "none";
});

btnClearCity.addEventListener("click", () => clearSelectionAndZoomOut());

btnOptions.addEventListener("click", () => {
  const open = optionsBody.style.display !== "none";
  optionsBody.style.display = open ? "none" : "block";
});

btnReload.addEventListener("click", async () => {
  try {
    showToast("Recargando access.csv…", 2000);
    await loadAccessCsv();
    applyVehicleFromUI();
    normalizeBadgeToExisting();
    refreshZonesStyle();
    buildPins();
    refreshPins();

    if (state.cCity) {
      updateObservationPanel(state.cCity);
    }

    setLastUpdatedNow();

    if (suggestions.style.display !== "none") {
      renderSuggestions(cityInput.value || "");
    }

    showToast("✅ CSV recargado", 1500);
  } catch (e) {
    console.error(e);
    showToast("❌ No pude recargar CSV: " + (e?.message || String(e)), 15000);
  }
});

btnReset.addEventListener("click", () => {
  state.baseVeh = "TURISMO";
  state.weight = "LIGHT";
  state.cBadge = canon("SIN ETIQUETA");
  buildVehicleButtons();
  buildBadgeButtons();
  setWeightButtons();
  onFiltersChangedKeepCity();
  flyToDefaultSlow();
});

// Init
async function init() {
  showToast("Cargando…", 1200);

  await loadAccessCsv();
  await loadGeojson();
  await loadCoordsOptional();

  applyVehicleFromUI();
  normalizeBadgeToExisting();

  buildVehicleButtons();
  buildBadgeButtons();
  setWeightButtons();

  state.cCity = "";
  clearObservationPanel();

  refreshZonesStyle();
  buildPins();
  refreshPins();

  setLastUpdatedNow();
  showToast("✅ Listo", 1200);
}

init().catch((e) => {
  console.error(e);
  showToast("❌ Error: " + (e?.message || String(e)), 20000);
});
