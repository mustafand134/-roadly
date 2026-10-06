/* Roadly – vanilla JS navigation app (Leaflet + OSM + Nominatim + OSRM) */
(() => {
'use strict';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const btn = (x, c, f) => { const b = el('button', c, x); b.type = 'button'; b.addEventListener('click', f); return b; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isDesk = () => matchMedia('(min-width:900px)').matches;
const K = { settings: 'roadly.settings', reports: 'roadly.reports', favs: 'roadly.favorites', recents: 'roadly.recents', seeded: 'roadly.seeded' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save data (storage is full or blocked).'); } };
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dA = (b[0] - a[0]) * r, dO = (b[1] - a[1]) * r;
  const x = Math.sin(dA / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dO / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const ago = ts => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; };
const fmtDist = m => settings.unit === 'mi'
  ? (m < 160 ? Math.round(m * 3.28084) + ' ft' : (m / 1609.344).toFixed(m < 16093 ? 1 : 0) + ' mi')
  : (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 100000 ? 1 : 0) + ' km');
const fmtDur = s => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const fmtEta = s => new Date(Date.now() + s * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4500); }
const busyMap = {};
function busy(key, txt) { if (txt) busyMap[key] = txt; else delete busyMap[key];
  const v = Object.values(busyMap); $('#busy').hidden = !v.length; $('#busyText').textContent = v[v.length - 1] || ''; }

/* ---------- state ---------- */
const TYPES = {
  traffic: { i: '🚗', l: 'Traffic', c: '#e5484d' }, accident: { i: '🚨', l: 'Accident', c: '#d6336c' },
  roadwork: { i: '🚧', l: 'Road Work', c: '#f08c00' }, police: { i: '🚔', l: 'Police', c: '#1c7ed6' },
  pothole: { i: '🕳️', l: 'Pothole', c: '#7048e8' }, closed: { i: '🚫', l: 'Road Closed', c: '#c92a2a' },
  hazard: { i: '⚠️', l: 'Hazard', c: '#d9a400' }, fuel: { i: '⛽', l: 'Fuel', c: '#2f9e44' } };
let settings = Object.assign({ dark: matchMedia('(prefers-color-scheme: dark)').matches, follow: true, showReports: true, unit: 'km' }, load(K.settings, {}));
let reports = load(K.reports, []);
let favs = Object.assign({ home: null, work: null, list: [] }, load(K.favs, {}));
let recents = load(K.recents, []);
if (!load(K.seeded, false)) {
  const B = [33.3152, 44.3661], d = [['traffic', .012, .01, 4, 12], ['accident', -.015, .02, 2, 25], ['roadwork', .02, -.018, 6, 180],
    ['police', -.008, -.025, 1, 8], ['pothole', .005, .03, 3, 300], ['closed', -.03, -.005, 5, 60], ['hazard', .03, .012, 2, 40], ['fuel', -.02, .04, 1, 90]];
  d.forEach(x => reports.push({ id: uid(), type: x[0], latitude: B[0] + x[1], longitude: B[1] + x[2], confirmations: x[3], timestamp: Date.now() - x[4] * 60000, demo: true }));
  store(K.reports, reports); store(K.seeded, true);
}

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([33.3152, 44.3661], 12);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
const ic = (e, c) => L.divIcon({ className: '', html: `<div class="mk" style="--c:${c}">${e}</div>`, iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18] });
const fitOpts = () => isDesk() ? { paddingTopLeft: [420, 70], paddingBottomRight: [50, 160], maxZoom: 17 } : { paddingTopLeft: [30, 90], paddingBottomRight: [30, 260], maxZoom: 17 };
const reportLayer = L.layerGroup();
let destMarker = null;

/* ---------- panels / tabs ---------- */
function showPanel(n) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.p === n));
  if (n === 'map') { closeSheet(); return; }
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + n));
  $('#sheet').classList.add('open');
}
function closeSheet() { if (isDesk()) return; $('#sheet').classList.remove('open'); $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.p === 'map')); }
$$('.tab').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.p)));
$('#grab').addEventListener('click', closeSheet);
window.addEventListener('resize', () => { if (isDesk() && !$('.panel.active')) showPanel('search'); });

/* ---------- theme / settings ---------- */
function applySettings() {
  document.documentElement.classList.toggle('dark', settings.dark);
  $('#btnTheme').textContent = settings.dark ? '☀️' : '🌙';
  $$('#segTheme button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'dark') === settings.dark));
  $$('#segUnit button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.unit));
  $('#setFollow').checked = settings.follow; $('#setReports').checked = settings.showReports;
  if (settings.showReports) reportLayer.addTo(map); else map.removeLayer(reportLayer);
}
const setS = (k, v) => { settings[k] = v; store(K.settings, settings); applySettings(); if (k === 'unit') refreshUnits(); };
$('#btnTheme').addEventListener('click', () => setS('dark', !settings.dark));
$$('#segTheme button').forEach(b => b.addEventListener('click', () => setS('dark', b.dataset.v === 'dark')));
$$('#segUnit button').forEach(b => b.addEventListener('click', () => setS('unit', b.dataset.v)));
$('#setFollow').addEventListener('change', e => setS('follow', e.target.checked));
$('#setReports').addEventListener('change', e => setS('showReports', e.target.checked));
function refreshUnits() { if (route) { fillCard(); if (nav.active) trackNav(); } renderReportList(); }

/* ---------- geolocation ---------- */
let me = null, meMarker = null, meCircle = null, watchId = null, firstFix = false, waiters = [];
function geoErr(e) {
  const msg = { 1: 'Location permission denied. Allow location access for this site in your browser settings.',
    2: 'Your location is unavailable. Check that GPS or network location is on.', 3: 'Finding your location timed out. Please try again.' };
  toast(msg[e.code] || 'Could not get your location.'); busy('loc');
  waiters.splice(0).forEach(w => w.rej(e));
  if (e.code === 1) stopWatch();
}
function startWatch() {
  if (!('geolocation' in navigator)) { toast('This browser does not support location services.'); return false; }
  if (watchId !== null) return true;
  if (!me) busy('loc', 'Finding your location…');
  watchId = navigator.geolocation.watchPosition(onPos, geoErr, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  return true;
}
function stopWatch() { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } busy('loc'); }
function onPos(p) {
  const { latitude: lat, longitude: lng, accuracy: acc } = p.coords;
  me = { lat, lng, acc, t: Date.now() }; busy('loc');
  if (!meMarker) {
    meMarker = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 }).addTo(map);
    meCircle = L.circle([lat, lng], { radius: acc, color: '#2563ff', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
  } else { meMarker.setLatLng([lat, lng]); meCircle.setLatLng([lat, lng]).setRadius(acc); }
  const c = $('#coords'); c.hidden = false; c.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)} · ±${Math.round(acc)} m`;
  if (!firstFix) { firstFix = true; map.flyTo([lat, lng], Math.max(map.getZoom(), 16)); }
  else if (nav.active && settings.follow) map.panTo([lat, lng]);
  waiters.splice(0).forEach(w => w.res(me));
  if (nav.active) trackNav();
}
function needPos() {
  return new Promise((res, rej) => {
    if (me && Date.now() - me.t < 60000) return res(me);
    if (!startWatch()) return rej(new Error('unsupported'));
    const w = { res, rej }; waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i > -1) { waiters.splice(i, 1); rej(new Error('timeout')); } }, 20000);
  });
}
const noPos = e => { if (!e.code) toast('Could not find your location. Turn on location access to continue.'); busy('loc'); };
$('#btnLocate').addEventListener('click', () => { if (startWatch() && me) map.flyTo([me.lat, me.lng], Math.max(map.getZoom(), 16)); });

/* ---------- search ---------- */
let sCtl = null, sTimer = null;
const toPlace = d => ({ name: d.name || (d.display_name || '').split(',')[0] || 'Unnamed place', address: d.display_name || '', lat: parseFloat(d.lat), lng: parseFloat(d.lon) });
$('#q').addEventListener('input', () => {
  clearTimeout(sTimer); const v = $('#q').value.trim();
  if (v.length < 3) { if (sCtl) sCtl.abort(); busy('search'); renderResults(null); return; }
  sTimer = setTimeout(() => doSearch(v), 450);
});
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(sTimer); const v = e.target.value.trim(); if (v.length > 1) doSearch(v); } });
async function doSearch(q) {
  if (sCtl) sCtl.abort(); const ctl = sCtl = new AbortController(); busy('search', 'Searching…');
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&q=' + encodeURIComponent(q), { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(); if (ctl !== sCtl) return;
    renderResults(d.map(toPlace).filter(p => isFinite(p.lat) && isFinite(p.lng)));
  } catch (e) {
    if (ctl !== sCtl) return;
    renderResults([], navigator.onLine ? 'Search failed. Please try again in a moment.' : 'You are offline. Connect to the internet to search.', true);
  } finally { if (ctl === sCtl) busy('search'); }
}
function renderResults(list, err, isErr) {
  const box = $('#results'); box.replaceChildren(); $('#recents').hidden = list !== null;
  if (list === null) { renderRecents(); return; }
  if (!list.length) { box.append(el('div', 'empty', err || 'No places found. Try another spelling or add the city name.')); return; }
  list.forEach(p => box.append(placeRow(p)));
}
function placeRow(p, onDelete) {
  const row = el('div', 'item'), main = btn('', 'main', () => selectPlace(p));
  main.append(el('span', 't', p.name), el('span', 's', p.address)); row.append(main);
  if (onDelete) { const d = btn('✕', 'mini', onDelete); d.setAttribute('aria-label', 'Delete'); row.append(d); }
  return row;
}
function selectPlace(p, remember = true) {
  if (!isFinite(p.lat) || !isFinite(p.lng)) { toast('That place has no valid location.'); return; }
  if (remember) addRecent(p);
  setDestMarker(p); closeSheet();
  map.flyTo([p.lat, p.lng], 16); destMarker.openPopup();
}
function setDestMarker(p) {
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([p.lat, p.lng], { icon: ic('📍', '#2563ff') }).addTo(map);
  destMarker.bindPopup(() => placePopup(p));
}
function placePopup(p) {
  const b = el('div', 'pop'); b.append(el('h3', '', p.name), el('p', '', p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`));
  const r = el('div', 'row'); r.append(btn('Navigate', 'primary', () => { map.closePopup(); navigateTo(p); }), btn('Save', 'ghost', () => openSave(p))); b.append(r); return b;
}

/* ---------- recents ---------- */
function addRecent(p) {
  recents = recents.filter(r => !(Math.abs(r.lat - p.lat) < 1e-5 && Math.abs(r.lng - p.lng) < 1e-5));
  recents.unshift({ name: p.name, address: p.address, lat: p.lat, lng: p.lng }); recents = recents.slice(0, 10);
  store(K.recents, recents); renderRecents();
}
function renderRecents() {
  const box = $('#recents'); box.replaceChildren(); if (!recents.length) { box.append(el('div', 'empty', 'Your recent searches will appear here.')); return; }
  const h = el('div', 'sect'); h.append(el('span', '', 'Recent searches'), btn('Clear history', '', clearHistory)); box.append(h);
  recents.forEach((p, i) => box.append(placeRow(p, () => { recents.splice(i, 1); store(K.recents, recents); renderRecents(); })));
}
function clearHistory() { recents = []; store(K.recents, recents); renderRecents(); toast('Search history cleared.'); }

/* ---------- reverse geocoding + map click ---------- */
async function reverse(lat, lng) {
  busy('rev', 'Looking up address…');
  try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`); if (!r.ok) throw 0; const d = await r.json(); return d.display_name || null; }
  catch (e) { return null; } finally { busy('rev'); }
}
map.on('click', e => {
  const { lat, lng } = e.latlng, b = el('div', 'pop'), addr = el('p', '', 'Looking up address…');
  b.append(el('h3', '', 'Selected Location'), addr, el('p', '', `Latitude ${lat.toFixed(5)}\nLongitude ${lng.toFixed(5)}`));
  b.lastChild.style.whiteSpace = 'pre-line'; let name = 'Selected location';
  const place = () => ({ name, address: addr.textContent.startsWith('Looking') || addr.textContent.startsWith('Address') ? '' : addr.textContent, lat, lng });
  const r = el('div', 'row');
  r.append(btn('Navigate Here', 'primary', () => { map.closePopup(); navigateTo(place()); }),
    btn('Add Report', 'ghost', () => { map.closePopup(); openReport({ lat, lng }); }), btn('Save', 'ghost', () => openSave(place())));
  b.append(r); const pop = L.popup().setLatLng(e.latlng).setContent(b).openOn(map);
  reverse(lat, lng).then(a => { if (a) { addr.textContent = a; name = a.split(',')[0]; } else addr.textContent = 'Address unavailable'; pop.update(); });
});

/* ---------- routing ---------- */
let route = null, routeLayer = null, dest = null;
const nav = { active: false, last: 0, busy: false };
async function getRoute(o, p) {
  let r, d;
  try { r = await fetch(`https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${p.lng},${p.lat}?overview=full&geometries=geojson&steps=true`); d = await r.json(); }
  catch (e) { throw new Error(navigator.onLine ? 'The routing service is not responding. Please try again.' : 'You are offline. Connect to the internet to get directions.'); }
  if (d.code === 'InvalidInput') throw new Error('That destination is not valid for driving directions.');
  if (d.code === 'NoRoute' || (d.routes && !d.routes.length)) throw new Error('No driving route found to this destination.');
  if (d.code !== 'Ok' || !d.routes) throw new Error('Routing failed. Please try again.');
  return d.routes[0];
}
async function navigateTo(p) {
  if (!p || !isFinite(p.lat) || !isFinite(p.lng)) { toast('Invalid destination.'); return; }
  let o; try { o = await needPos(); } catch (e) { noPos(e); return; }
  dest = p; setDestMarker(p); closeSheet(); stopNav(true);
  busy('route', 'Calculating route…');
  try { setRoute(await getRoute(o, p)); } catch (e) { toast(e.message); } finally { busy('route'); }
}
const nearest = (c, loc) => { let bi = 0, bd = 1e18; for (let i = 0; i < c.length; i++) { const d = (c[i][0] - loc[1]) ** 2 + (c[i][1] - loc[0]) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
function setRoute(rt, keep) {
  if (routeLayer) map.removeLayer(routeLayer);
  const coords = rt.geometry.coordinates.map(c => [c[1], c[0]]), cum = [0];
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + hav(coords[i - 1], coords[i]);
  const steps = ((rt.legs[0] && rt.legs[0].steps) || []).map(s => ({ type: s.maneuver.type, mod: s.maneuver.modifier, name: s.name, at: cum[nearest(coords, s.maneuver.location)] }));
  route = { dist: rt.distance, dur: rt.duration, coords, cum, total: cum[cum.length - 1] || 1, steps };
  routeLayer = L.layerGroup([L.polyline(coords, { color: '#fff', weight: 11, opacity: .9, interactive: false }), L.polyline(coords, { color: '#2563ff', weight: 6, interactive: false })]).addTo(map);
  if (!keep) { map.fitBounds(L.latLngBounds(coords), fitOpts()); fillCard(); $('#routeCard').hidden = false; }
}
function fillCard() { if (!route) return; $('#rcDest').textContent = dest ? dest.name : 'Destination'; $('#rcDist').textContent = fmtDist(route.dist); $('#rcTime').textContent = fmtDur(route.dur); }
$('#rcClose').addEventListener('click', clearRoute);
$('#rcStart').addEventListener('click', startNav);
$('#hudStop').addEventListener('click', clearRoute);
function clearRoute() { stopNav(true); if (routeLayer) map.removeLayer(routeLayer); routeLayer = null; route = null; dest = null; $('#routeCard').hidden = true;
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; } }

/* ---------- navigation mode ---------- */
const ARROW = { left: '↰', right: '↱', 'slight left': '↖', 'slight right': '↗', 'sharp left': '↰', 'sharp right': '↱', uturn: '↩', straight: '↑' };
function turnInfo(s) {
  const t = s.type, m = s.mod || ''; let txt;
  if (t === 'arrive') return { icon: '⚑', txt: 'Arrive at your destination' };
  if (t === 'roundabout' || t === 'rotary') txt = 'Take the roundabout';
  else if (m === 'uturn') txt = 'Make a U-turn';
  else if (m === 'straight' || (t === 'continue' && !m)) txt = 'Continue straight';
  else if (m.startsWith('slight')) txt = 'Bear ' + m.split(' ')[1];
  else if (t === 'merge') txt = 'Merge ' + m;
  else if (t === 'fork') txt = 'Keep ' + m;
  else txt = (m.startsWith('sharp') ? 'Sharp ' : 'Turn ') + (m.startsWith('sharp') ? m.split(' ')[1] : m);
  return { icon: ARROW[m] || '↑', txt };
}
function startNav() {
  if (!route) return; nav.active = true; nav.last = 0;
  $('#routeCard').hidden = true; $('#navHud').hidden = false; document.body.classList.add('navigating');
  startWatch(); if (me) map.setView([me.lat, me.lng], 17);
  trackNav();
}
function stopNav(silent) { if (!nav.active) return; nav.active = false; $('#navHud').hidden = true; document.body.classList.remove('navigating'); if (!silent) toast('Navigation ended.'); }
function project(p, c) {
  const k = Math.cos(p.lat * Math.PI / 180), M = 111320; let best = { i: 0, d: 1e12, t: 0 };
  for (let i = 0; i < c.length - 1; i++) {
    const ax = (c[i][1] - p.lng) * k * M, ay = (c[i][0] - p.lat) * M, bx = (c[i + 1][1] - p.lng) * k * M, by = (c[i + 1][0] - p.lat) * M;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy); if (d < best.d) best = { i, d, t };
  }
  return best;
}
function trackNav() {
  if (!nav.active || !route || !me) return;
  const pr = project(me, route.coords);
  if (pr.d > Math.max(60, me.acc)) { reroute(); }
  const c = route.cum, along = c[pr.i] + pr.t * ((c[pr.i + 1] || c[pr.i]) - c[pr.i]), remain = Math.max(0, route.total - along);
  if (remain < 25) { toast('You have arrived at your destination.'); clearRoute(); return; }
  const st = route.steps.find(s => s.type !== 'depart' && s.at > along + 3) || route.steps[route.steps.length - 1];
  if (st) { const t = turnInfo(st); $('#hudIcon').textContent = t.icon; $('#hudTurn').textContent = t.txt; $('#hudRoad').textContent = st.name || ''; $('#hudDist').textContent = fmtDist(Math.max(0, st.at - along)); }
  $('#hudRemain').textContent = fmtDist(remain); $('#hudEta').textContent = fmtEta(route.dur * remain / route.total);
}
async function reroute() {
  if (nav.busy || !dest || Date.now() - nav.last < 12000) return;
  nav.busy = true; nav.last = Date.now(); busy('route', 'Off route – recalculating…');
  try { setRoute(await getRoute(me, dest), true); toast('Route updated.'); } catch (e) { toast(e.message); } finally { nav.busy = false; busy('route'); }
  trackNav();
}

/* ---------- reports ---------- */
let pendingPos = null;
function renderReports() {
  reportLayer.clearLayers();
  reports.forEach(r => { const t = TYPES[r.type]; if (!t) return;
    L.marker([r.latitude, r.longitude], { icon: ic(t.i, t.c) }).bindPopup(() => reportPopup(r.id)).addTo(reportLayer); });
  renderReportList();
}
function reportPopup(id) {
  const r = reports.find(x => x.id === id), b = el('div', 'pop'); if (!r) { b.append(el('p', '', 'This report is no longer available.')); return b; }
  b.append(el('h3', '', TYPES[r.type].i + ' ' + TYPES[r.type].l), el('p', '', 'Reported ' + ago(r.timestamp)), el('p', '', 'Confirmed: ' + r.confirmations));
  const row = el('div', 'row');
  row.append(btn('Confirm', 'primary', () => { r.confirmations++; store(K.reports, reports); map.closePopup(); renderReports(); toast('Thanks for confirming.'); }),
    btn('Not Here', 'ghost', () => { r.confirmations--; if (r.confirmations < 0) reports = reports.filter(x => x.id !== r.id); store(K.reports, reports); map.closePopup(); renderReports(); toast('Thanks for the update.'); }));
  b.append(row); return b;
}
function renderReportList() {
  const box = $('#reportList'); box.replaceChildren();
  if (!reports.length) { box.append(el('div', 'empty', 'No reports yet. Tap Report to warn other drivers.')); return; }
  [...reports].sort((a, b) => b.timestamp - a.timestamp).forEach(r => {
    const t = TYPES[r.type]; if (!t) return;
    const row = el('div', 'item'), m = btn('', 'main', () => { closeSheet(); map.flyTo([r.latitude, r.longitude], 16); });
    const dist = me ? ' · ' + fmtDist(hav([me.lat, me.lng], [r.latitude, r.longitude])) : '';
    m.append(el('span', 't', t.i + ' ' + t.l), el('span', 's', `${ago(r.timestamp)} · Confirmed ${r.confirmations}${dist}`)); row.append(m); box.append(row);
  });
}
function openReport(pos) { pendingPos = pos || null; $('#reportModal').hidden = false; }
function closeModals() { $('#reportModal').hidden = true; $('#saveModal').hidden = true; }
Object.entries(TYPES).forEach(([k, t]) => { const b = btn(t.i + ' ' + t.l, '', () => addReport(k)); b.style.setProperty('--c', t.c); $('#reportGrid').append(b); });
async function addReport(type) {
  let pos = pendingPos; pendingPos = null; closeModals();
  if (!pos) { try { pos = await needPos(); } catch (e) { noPos(e); return; } }
  reports.push({ id: uid(), type, latitude: pos.lat, longitude: pos.lng, timestamp: Date.now(), confirmations: 1 });
  store(K.reports, reports); renderReports(); map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 15)); toast(TYPES[type].l + ' reported. Thank you!');
}
$('#btnReport').addEventListener('click', () => openReport());
$('#btnReport2').addEventListener('click', () => openReport());
$('#reportCancel').addEventListener('click', closeModals);
$('#clearDemo').addEventListener('click', () => { reports = reports.filter(r => !r.demo); store(K.reports, reports); renderReports(); toast('Demo reports cleared.'); });

/* ---------- favorites ---------- */
let savePlace = null;
function openSave(p) { savePlace = p; $('#saveName').value = p.name || ''; $('#saveModal').hidden = false; map.closePopup(); }
$$('#saveModal [data-kind]').forEach(b => b.addEventListener('click', () => {
  if (!savePlace) return; const title = $('#saveName').value.trim() || savePlace.name || 'Saved place';
  const item = { id: uid(), title, name: savePlace.name, address: savePlace.address, lat: savePlace.lat, lng: savePlace.lng }, k = b.dataset.kind;
  if (k === 'home') favs.home = item; else if (k === 'work') favs.work = item; else favs.list.push(item);
  store(K.favs, favs); renderFavs(); closeModals(); toast('Saved to ' + (k === 'fav' ? 'Favorites' : k === 'home' ? 'Home' : 'Work') + '.');
}));
$('#saveCancel').addEventListener('click', closeModals);
function favRow(item, label, onSet, onDel) {
  const row = el('div', 'item'), m = btn('', 'main', () => selectPlace(item, false));
  m.append(el('span', 's', label), el('span', 't', item.title), el('span', 's', item.address || '')); row.append(m);
  row.append(btn('Go', 'mini', () => navigateTo(item)), btn('Edit', 'mini', () => { const v = prompt('Rename this place:', item.title); if (v && v.trim()) { item.title = v.trim(); store(K.favs, favs); renderFavs(); } }),
    btn('Delete', 'mini', onDel)); return row;
}
function renderFavs() {
  const box = $('#favs'); box.replaceChildren();
  [['home', 'Home'], ['work', 'Work']].forEach(([k, l]) => {
    const s = el('div', 'fav-slot');
    if (favs[k]) s.append(favRow(favs[k], l, null, () => { favs[k] = null; store(K.favs, favs); renderFavs(); }));
    else { s.append(el('span', 'lbl', l), el('div', 'empty', 'Not set yet')); }
    box.append(s);
  });
  const fh = el('div', 'sect'); fh.append(el('span', '', 'Favorites')); box.append(fh);
  if (!favs.list.length) box.append(el('div', 'empty', 'No saved places yet.'));
  favs.list.forEach(f => box.append(favRow(f, 'Favorite', null, () => { favs.list = favs.list.filter(x => x.id !== f.id); store(K.favs, favs); renderFavs(); })));
}

/* ---------- clear data ---------- */
const ask = m => confirm(m);
$('#clrHistory').addEventListener('click', () => ask('Clear search history?') && clearHistory());
$('#clrFavs').addEventListener('click', () => { if (ask('Clear all favorites?')) { favs = { home: null, work: null, list: [] }; store(K.favs, favs); renderFavs(); toast('Favorites cleared.'); } });
$('#clrReports').addEventListener('click', () => { if (ask('Clear all reports?')) { reports = []; store(K.reports, reports); renderReports(); toast('Reports cleared.'); } });
$('#clrAll').addEventListener('click', () => {
  if (!ask('Clear ALL Roadly data on this device?')) return;
  try { Object.values(K).forEach(k => localStorage.removeItem(k)); localStorage.setItem(K.seeded, 'true'); } catch (e) { /* ignore */ }
  location.reload();
});

/* ---------- connectivity + misc ---------- */
const net = () => { $('#offline').hidden = navigator.onLine; };
window.addEventListener('online', net); window.addEventListener('offline', net);
$('#reportModal').addEventListener('click', e => { if (e.target.id === 'reportModal') closeModals(); });
$('#saveModal').addEventListener('click', e => { if (e.target.id === 'saveModal') closeModals(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

applySettings(); renderReports(); renderRecents(); renderFavs(); net();
if (isDesk()) showPanel('search');
})();
