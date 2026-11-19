// Shenzhen map — Leaflet on Amap tiles. All coordinates are GCJ-02 (Amap's system).
const LAST_UPDATED = "20 Nov 2026";

const TILES = {
  en: { url: "https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=en&size=1&scl=1&style=7", label: "Labels: English" },
  zh: { url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}", label: "Labels: 中文" }
};
const HOTEL_ID = "hotel";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

// ---- WGS-84 (phone GPS) -> GCJ-02 (Amap) ----
function outOfChina(lat, lng) { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function tLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return r;
}
function tLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return r;
}
function wgsToGcj(lat, lng) {
  if (outOfChina(lat, lng)) return [lat, lng];
  const a = 6378245.0, ee = 0.00669342162296594323;
  let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat); magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lng + dLng];
}

function distanceM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(m) { return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`; }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- Amap links (official URI API, coordinate=gaode means GCJ-02) ----
function amapMarkerUrl(p) {
  const name = encodeURIComponent(p.name_zh || p.name);
  return `https://uri.amap.com/marker?position=${p.lng},${p.lat}&name=${name}&src=sz-map&coordinate=gaode&callnative=1`;
}
function amapDirUrl(p) {
  const name = encodeURIComponent(p.name_zh || p.name);
  return `https://uri.amap.com/navigation?to=${p.lng},${p.lat},${name}&mode=bus&policy=1&src=sz-map&coordinate=gaode&callnative=1`;
}

// ---- State ----
let data, map, tileLayer, filter = "all", me = null, meMarker = null, meCircle = null, watchId = null, activeId = null;
const markers = {};
let labelLang = store.get("sz-labels", "en") === "zh" ? "zh" : "en";

function setTiles() {
  if (tileLayer) map.removeLayer(tileLayer);
  let errors = 0, loads = 0;
  tileLayer = L.tileLayer(TILES[labelLang].url, { subdomains: "1234", maxNativeZoom: 18, maxZoom: 19, minZoom: 9 });
  tileLayer.on("tileerror", () => { errors++; if (errors >= 6 && loads === 0) showBanner("The map background isn't loading. Check that mobile data is on, then reload the page. Your pins and buttons still work."); });
  tileLayer.on("tileload", () => { loads++; hideBanner(); });
  tileLayer.addTo(map);
  const b = $("btn-labels");
  b.textContent = TILES[labelLang].label;
  b.setAttribute("aria-pressed", labelLang === "zh" ? "true" : "false");
}

function showBanner(t) { const b = $("banner"); b.textContent = t; b.hidden = false; }
function hideBanner() { $("banner").hidden = true; }

function catLabel(id) { return (data.categories.find((c) => c.id === id) || { label: id }).label; }

function visiblePlaces() {
  return data.places.filter((p) => filter === "all" || p.category === filter || p.id === HOTEL_ID);
}

function buildFilters() {
  const nav = $("filters");
  const counts = {};
  data.places.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
  const opts = [{ id: "all", label: `All (${data.places.length})` }]
    .concat(data.categories.filter((c) => counts[c.id] && c.id !== "hotel").map((c) => ({ id: c.id, label: `${c.label} (${counts[c.id]})` })));
  nav.innerHTML = "";
  opts.forEach((o) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn small"; b.textContent = o.label;
    b.setAttribute("aria-pressed", o.id === filter ? "true" : "false");
    b.onclick = () => { filter = o.id; buildFilters(); renderMarkers(); renderList(); fitAll(); };
    nav.appendChild(b);
  });
}

function pinIcon(p) {
  const cls = `pin cat-${p.category}${p.id === activeId ? " active" : ""}`;
  return L.divIcon({
    className: cls, iconSize: [0, 0],
    html: `<div class="pin-wrap"><span class="pin-dot"></span><span class="pin-label">${esc(p.name)}</span></div>`
  });
}

function renderMarkers() {
  Object.values(markers).forEach((m) => map.removeLayer(m));
  for (const k in markers) delete markers[k];
  visiblePlaces().forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(p), keyboard: true, title: p.name, zIndexOffset: p.id === HOTEL_ID ? 500 : 0 });
    m.on("click", () => openSheet(p.id));
    m.addTo(map);
    markers[p.id] = m;
  });
}

function fitAll() {
  const pts = visiblePlaces().map((p) => [p.lat, p.lng]);
  if (me) pts.push(me);
  if (!pts.length) return;
  if (pts.length === 1) map.setView(pts[0], 16);
  else map.fitBounds(pts, { paddingTopLeft: [40, 40], paddingBottomRight: [170, 110], maxZoom: 16 });
}

function openSheet(id) {
  const p = data.places.find((x) => x.id === id);
  if (!p) return;
  closeList();
  activeId = id;
  Object.entries(markers).forEach(([pid, m]) => m.setIcon(pinIcon(data.places.find((x) => x.id === pid))));
  $("s-name").textContent = p.name;
  $("s-zh").textContent = p.name_zh && p.name_zh !== p.name ? p.name_zh : "";
  const bits = [catLabel(p.category)];
  if (me) bits.push(`${fmtDist(distanceM(me, [p.lat, p.lng]))} from you (straight line)`);
  else if (p.id !== HOTEL_ID) {
    const h = data.places.find((x) => x.id === HOTEL_ID);
    if (h) bits.push(`${fmtDist(distanceM([h.lat, h.lng], [p.lat, p.lng]))} from hotel (straight line)`);
  }
  $("s-meta").textContent = bits.join(" · ");
  $("s-addr").textContent = p.address_zh || "";
  $("s-note").textContent = p.note || "";
  $("s-amap").href = amapMarkerUrl(p);
  $("s-dir").href = amapDirUrl(p);
  const tel = $("s-tel");
  if (p.phone) { tel.hidden = false; tel.href = `tel:${p.phone.split(/[;,]/)[0].replace(/[^\d+]/g, "")}`; tel.textContent = `Call ${p.phone.split(/[;,]/)[0]}`; }
  else tel.hidden = true;
  $("s-copy").hidden = !p.address_zh;
  $("s-copied").hidden = true;
  $("sheet").hidden = false;
  // keep the pin visible above the sheet
  const y = map.getSize().y;
  const pt = map.latLngToContainerPoint([p.lat, p.lng]);
  if (pt.y > y * 0.4) map.panBy([0, pt.y - y * 0.3]);
}

function closeSheet() {
  $("sheet").hidden = true;
  if (activeId) { const prev = activeId; activeId = null; const m = markers[prev]; if (m) m.setIcon(pinIcon(data.places.find((x) => x.id === prev))); }
}

async function copyAddress() {
  const p = data.places.find((x) => x.id === activeId);
  if (!p) return;
  const text = `${p.name_zh || p.name} ${p.address_zh || ""}`.trim();
  const out = $("s-copied");
  try {
    await navigator.clipboard.writeText(text);
    out.textContent = "Copied. Paste it into DiDi or show it to a driver.";
  } catch {
    out.innerHTML = `Couldn't copy automatically. Press and hold to select:<textarea class="copybox" readonly rows="3">${esc(text)}</textarea>`;
  }
  out.hidden = false;
}

function renderList() {
  const ol = $("l-items");
  const items = visiblePlaces().map((p) => ({ p, d: me ? distanceM(me, [p.lat, p.lng]) : null }));
  if (me) items.sort((a, b) => a.d - b.d);
  ol.innerHTML = "";
  items.forEach(({ p, d }) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span><strong>${esc(p.name)}</strong><span class="sub">${esc(catLabel(p.category))}${p.name_zh && p.name_zh !== p.name ? " · " + esc(p.name_zh) : ""}</span></span>${d !== null ? `<span class="dist">${fmtDist(d)}</span>` : ""}`;
    b.onclick = () => openSheet(p.id);
    li.appendChild(b);
    ol.appendChild(li);
  });
}
function openList() { closeSheet(); renderList(); $("list").hidden = false; }
function closeList() { $("list").hidden = true; }

function toggleLocate() {
  const btn = $("btn-locate");
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId); watchId = null; me = null;
    if (meMarker) { map.removeLayer(meMarker); map.removeLayer(meCircle); meMarker = meCircle = null; }
    btn.textContent = "My location";
    renderList();
    return;
  }
  if (!("geolocation" in navigator)) { showBanner("This browser can't share your location."); return; }
  btn.textContent = "Finding you…";
  let first = true;
  watchId = navigator.geolocation.watchPosition((pos) => {
    me = wgsToGcj(pos.coords.latitude, pos.coords.longitude);
    const acc = pos.coords.accuracy || 0;
    if (!meMarker) {
      meCircle = L.circle(me, { radius: acc, color: "#2b8cff", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker(me, { icon: L.divIcon({ className: "", iconSize: [18, 18], html: '<div class="me-dot"></div>' }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    } else { meMarker.setLatLng(me); meCircle.setLatLng(me).setRadius(acc); }
    btn.textContent = "Stop location";
    if (first) { map.setView(me, Math.max(map.getZoom(), 15)); first = false; }
    if (!$("list").hidden) renderList();
  }, (err) => {
    watchId !== null && navigator.geolocation.clearWatch(watchId); watchId = null;
    btn.textContent = "My location";
    showBanner(err.code === 1
      ? "Location is blocked. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Then try again."
      : "Couldn't get your location. Try again in a moment.");
    setTimeout(hideBanner, 8000);
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
}

async function init() {
  $("updated").textContent = `Last updated ${LAST_UPDATED}`;
  map = L.map("map", { zoomControl: false, attributionControl: false, tap: true }).setView([22.53, 113.95], 13);
  setTiles();
  try {
    const res = await fetch("data/places.json", { cache: "no-cache" });
    data = await res.json();
  } catch {
    showBanner("Couldn't load the list of places. Reload the page.");
    return;
  }
  buildFilters();
  renderMarkers();
  fitAll();

  map.on("click", closeSheet);
  $("s-close").onclick = closeSheet;
  $("s-copy").onclick = copyAddress;
  $("btn-list").onclick = () => ($("list").hidden ? openList() : closeList());
  $("l-close").onclick = closeList;
  $("btn-fit").onclick = () => { closeSheet(); fitAll(); };
  $("btn-locate").onclick = toggleLocate;
  $("btn-labels").onclick = () => { labelLang = labelLang === "en" ? "zh" : "en"; store.set("sz-labels", labelLang); setTiles(); };
}

init();
