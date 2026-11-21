'use strict';
/* =====================================================================
   Grundlagen / Helfer
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDs = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDs(s); d.setDate(d.getDate() + n); return ds(d); };
const dayDiff = (a, b) => { const A = parseDs(a), B = parseDs(b);
  return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 864e5); };
const todayDs = () => ds(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const fmtTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const parseTime = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmtDate = s => { const d = parseDs(s); return `${WD_SHORT[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const fmtDateLong = s => { const d = parseDs(s); return `${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const mapsUrl = addr => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
/* Zwei getrennte Seiten: Hauptadresse = Kundenseite (index.html), Verwaltung = verwaltung.html */
const dirUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');
const cardUrl = () => dirUrl();                       // Visitenkarten-Seite (Ziel des gedruckten QR-Codes)
const customerUrl = () => dirUrl() + 'buchen.html';   // Online-Buchung
const ownerUrl = () => dirUrl() + 'verwaltung.html';
const PAGE = document.body.dataset.page || 'kunde';   // karte | kunde | verwaltung | impressum | datenschutz
const K = window.HUFPFLEGE_KONTAKT || {};

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function openModal(title, html, onMount) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; const d = $('#modal'); if (!d.open) d.showModal(); d.scrollTop = 0; onMount && onMount($('#modal-body')); }
function closeModal() { $('#modal').close(); }

/* Telefonnummer -> internationales Format für wa.me (Standard: Deutschland) */
function waNumber(phone) {
  let n = String(phone || '').replace(/[^\d+]/g, '');
  if (!n) return '';
  if (n.startsWith('+')) return n.slice(1);
  if (n.startsWith('00')) return n.slice(2);
  if (n.startsWith('0')) return '49' + n.slice(1);
  return n;
}
const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
const mailLink = (to, subject, body) => `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/* Daten kompakt in einen Link packen (deflate + base64url) */
function b64u(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function pack(obj) {
  const json = JSON.stringify(obj);
  if (window.CompressionStream) {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'z' + b64u(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return 'j' + b64u(new TextEncoder().encode(json));
}
async function unpack(str) {
  const kind = str[0], bytes = unb64u(str.slice(1));
  if (kind === 'z') return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
  if (kind === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  throw new Error('Unbekanntes Format');
}

/* =====================================================================
   Verfügbarkeit: freie Startzeiten für einen Tag berechnen
   (wird vom Betreiber UND vom Kunden-Bereich benutzt)
   ===================================================================== */
function makeAvailability({ work, raster, buffer, blocked, busy, from, to }) {
  // work: Array[7] (So..Sa) mit [startMin, endMin] oder null
  // busy: { 'YYYY-MM-DD': [[start, end], ...] }
  const blockedSet = new Set(blocked);
  return {
    starts(day, duration) {
      if (day < from || day > to || blockedSet.has(day)) return [];
      const wh = work[parseDs(day).getDay()];
      if (!wh) return [];
      const list = busy[day] || [];
      const minStart = day === todayDs() ? nowMin() + 30 : -1;
      const res = [];
      for (let t = wh[0]; t + duration <= wh[1]; t += raster) {
        if (t < minStart) continue;
        const clash = list.some(([s, e]) => t < e + buffer && t + duration + buffer > s);
        if (!clash) res.push(t);
      }
      return res;
    }
  };
}

/* Kalender-Komponente: freie Tage grün, auswählbar */
function mountCalendar(el, { isFree, selected, onSelect, startMonth }) {
  const start = selected ? parseDs(selected) : (startMonth ? parseDs(startMonth) : new Date());
  let y = start.getFullYear(), m = start.getMonth();
  const today = todayDs();
  function render() {
    const first = new Date(y, m, 1), offset = (first.getDay() + 6) % 7, daysIn = new Date(y, m + 1, 0).getDate();
    let h = `<div class="cal"><div class="cal-head"><button type="button" data-nav="-1" aria-label="Vorheriger Monat">‹</button>
      <b>${MONTHS[m]} ${y}</b><button type="button" data-nav="1" aria-label="Nächster Monat">›</button></div><div class="cal-grid">`;
    h += ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<div class="cal-wd">${w}</div>`).join('');
    for (let i = 0; i < offset; i++) h += '<div></div>';
    for (let d = 1; d <= daysIn; d++) {
      const s = ds(new Date(y, m, d)), free = isFree(s);
      h += `<button type="button" class="cal-day ${free ? 'free' : 'off'} ${s === selected ? 'sel' : ''} ${s === today ? 'today' : ''}"
        ${free ? '' : 'disabled'} data-day="${s}">${d}</button>`;
    }
    h += `</div><div class="legend"><span><i style="background:var(--free-bg);border:1px solid var(--free-line)"></i>frei</span>
      <span><i style="background:var(--off-bg)"></i>belegt / geschlossen</span></div></div>`;
    el.innerHTML = h;
  }
  el.onclick = e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { m += Number(nav.dataset.nav); if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } render(); return; }
    const b = e.target.closest('[data-day]');
    if (b && !b.disabled) { selected = b.dataset.day; render(); onSelect(selected); }
  };
  render();
  return { refresh(sel) { if (sel !== undefined) selected = sel; render(); } };
}

function mountTimes(el, starts, duration, selected, onSelect) {
  if (!starts.length) { el.innerHTML = '<p class="muted">An diesem Tag ist keine passende Uhrzeit frei.</p>'; return; }
  el.innerHTML = `<div class="times">${starts.map(t =>
    `<button type="button" class="time ${t === selected ? 'sel' : ''}" data-t="${t}" title="${fmtTime(t)}–${fmtTime(t + duration)}">${fmtTime(t)}</button>`).join('')}</div>`;
  el.onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return;
    $$('.time', el).forEach(x => x.classList.toggle('sel', x === b)); onSelect(Number(b.dataset.t)); };
}

/* =====================================================================
   Lokaler Speicher (Betreiber)
   ===================================================================== */
const KEY = 'stalltermine-v1';
const DEFAULT_SETTINGS = {
  name: "Franzi's Hufpflege", phone: '', mail: '',
  work: [null, [480, 1020], [480, 1020], [480, 1020], [480, 1020], [480, 1020], [480, 720]], // So..Sa
  raster: 30, minPerHorse: 45, buffer: 30, horizonWeeks: 8, blocked: [], lastBackup: null,
  // Rechnungen (Preise sind Endpreise; bei MwSt-Pflicht inkl. MwSt)
  inv: { fullName: '', street: '', zip: '', city: '', taxNo: '', vatId: '', taxMode: 'klein', vatRate: 19,
    iban: '', bic: '', bank: '', holder: '', payDays: 14, pricePerHorse: 0, travelFee: 0 }
};
let data = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.customers) return { customers: d.customers, appts: d.appts || [], invoices: d.invoices || [], settings: { ...DEFAULT_SETTINGS, ...d.settings, inv: { ...DEFAULT_SETTINGS.inv, ...(d.settings || {}).inv } } };
  } catch (e) { console.error(e); }
  return { customers: [], appts: [], invoices: [], settings: structuredClone(DEFAULT_SETTINGS) };
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(data));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (CLOUD && cloud.user) queueDiff();
}
const customerById = id => data.customers.find(c => c.id === id);
const custLabel = c => c ? (c.stable ? `${c.stable} – ${c.owner}` : c.owner) : '(gelöschter Kunde)';
const apptLabel = a => { const c = customerById(a.customerId); if (c) return custLabel(c);
  const r = a.request; return r ? (r.s ? `${r.s} – ${r.o}` : r.o) : '(gelöschter Kunde)'; };

/* =====================================================================
   Online-Speicher (Google Firebase / Firestore): beide Geräte teilen dieselben Daten.
   Ohne Eintrag in config.js läuft die App rein lokal wie bisher.
   Datenmodell:
     settings/main   – Einstellungen (nur Team)
     public/info     – öffentliche Angaben für die Kundenseite (Arbeitszeiten, Puffer …)
     customers/{id}  – Kunden (nur Team)
     appts/{id}      – Termine (nur Team; Kunden dürfen nur neue Online-Buchungen anlegen)
     busy/{datum}    – belegte Zeiten je Tag OHNE Namen, für die Kundenseite
   ===================================================================== */
const CFG = window.HUFPFLEGE_CONFIG || {};
const CLOUD = !!(CFG.firebase && CFG.firebase.apiKey && CFG.firebase.projectId);
const loadJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
let FB = null;
async function fb() {
  if (FB) return FB;
  const [appM, fs] = await Promise.all([import('./firebase/firebase-app.js'), import('./firebase/firebase-firestore.js')]);
  const app = appM.initializeApp(CFG.firebase);
  let db;
  try {
    db = fs.initializeFirestore(app, PAGE === 'verwaltung'
      ? { ignoreUndefinedProperties: true, localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }
      : { ignoreUndefinedProperties: true });
  } catch (e) { db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true }); }
  if (CFG.emulator) fs.connectFirestoreEmulator(db, CFG.emulator.host || 'localhost', CFG.emulator.firestorePort);
  FB = { app, db, fs };
  if (PAGE === 'verwaltung') {
    const authM = await import('./firebase/firebase-auth.js');
    FB.authM = authM; FB.auth = authM.getAuth(app);
    if (CFG.emulator) authM.connectAuthEmulator(FB.auth, CFG.emulator.authUrl, { disableWarnings: true });
  }
  return FB;
}
const cloud = { user: null, ready: false };   // user = angemeldeter Benutzer (Franzi oder zweite Person)

/* Firestore kann keine verschachtelten Listen speichern → Einstellungen als Text, Arbeitszeiten als Objekte */
const settingsForCloud = s => ({ json: JSON.stringify({ ...s, lastBackup: undefined }) });
const publicInfo = s => ({
  name: s.name || '', phone: s.phone || '', mail: s.mail || '',
  work: s.work.map(w => w ? { s: w[0], e: w[1] } : null), raster: s.raster, minPerHorse: s.minPerHorse, buffer: s.buffer,
  horizonWeeks: s.horizonWeeks, blocked: (s.blocked || []).filter(d => d >= todayDs()).sort()
});
const busyKey = a => `${a.start}-${a.end}-${a.id}`;
const isActive = a => a.status !== 'storniert';
/* Geheimer Code für den persönlichen „Termin verwalten“-Link (32 Zeichen, nicht erratbar) */
function newSecret() {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = new Uint8Array(32);
  crypto.getRandomValues(b); return Array.from(b, x => abc[x % abc.length]).join('');
}
const apptStartDate = a => { const d = parseDs(a.date); d.setMinutes(a.start); return d; };
const manageUrl = ms => customerUrl() + '#t=' + ms;
const CHANGE_LIMIT_H = 3;   // Stornieren/Umbuchen durch Kunden bis 3 Stunden vorher
function ensureMs(a) { if (CLOUD && a && !a.ms) { a.ms = newSecret(); save(); } return a && a.ms; }
const manageInfo = a => { const c = customerById(a.customerId), r = a.request || {};
  return { apptId: a.id, date: a.date, start: a.start, end: a.end, horses: a.horses || [], count: a.count || 1,
    name: c ? c.owner : (r.o || ''), stable: c ? (c.stable || '') : (r.s || ''), addr: c ? (c.stableAddr || '') : (r.a || ''),
    status: a.status || 'bestätigt' }; };

/* Änderungen erkennen (Vergleich mit dem letzten Stand aus der Datenbank) und schreiben.
   Firestore speichert Änderungen ohne Netz zwischen und sendet sie automatisch nach. */
let shadow = null, syncState = 'ok', pendingWrites = false;
const snapshot = d => ({
  settings: JSON.stringify({ ...d.settings, lastBackup: undefined }),
  customers: Object.fromEntries(d.customers.map(c => [c.id, JSON.stringify(c)])),
  appts: Object.fromEntries(d.appts.map(a => [a.id, JSON.stringify(a)])),
  invoices: Object.fromEntries((d.invoices || []).map(x => [x.id, JSON.stringify(x)]))
});
function queueDiff() {
  if (!FB || !cloud.user || !shadow) return;
  const { fs, db } = FB, cur = snapshot(data), old = shadow, batch = fs.writeBatch(db);
  const days = new Set(); let n = 0;
  if (cur.settings !== old.settings) {
    batch.set(fs.doc(db, 'settings', 'main'), settingsForCloud(data.settings));
    batch.set(fs.doc(db, 'public', 'info'), publicInfo(data.settings)); n += 2;
  }
  for (const t of ['customers', 'appts', 'invoices']) {
    for (const id in cur[t]) if (cur[t][id] !== old[t][id]) {
      const obj = JSON.parse(cur[t][id]);
      if (t === 'appts') {
        obj.startAt = apptStartDate(obj);
        if (obj.ms) { batch.set(fs.doc(db, 'manage', obj.ms), manageInfo(obj)); n++; }
      }
      batch.set(fs.doc(db, t, id), obj); n++;
      if (t === 'appts') { days.add(obj.date); if (old.appts[id]) days.add(JSON.parse(old.appts[id]).date); }
    }
    for (const id in old[t]) if (!(id in cur[t])) {
      batch.delete(fs.doc(db, t, id)); n++;
      if (t === 'appts') { const o = JSON.parse(old.appts[id]);
        if (o.ms) { batch.set(fs.doc(db, 'manage', o.ms), { ...manageInfo(o), status: o.status === 'storniert' ? 'storniert' : 'abgesagt' }); n++; } }
      if (t === 'appts') days.add(JSON.parse(old.appts[id]).date);
    }
  }
  // Belegte Zeiten (ohne Namen) für die Kundenseite aktuell halten
  for (const d of days) {
    const iv = data.appts.filter(a => a.date === d && isActive(a)).map(busyKey);
    batch.set(fs.doc(db, 'busy', d), { iv }); n++;
  }
  shadow = cur;
  if (n) batch.commit().catch(e => { console.warn('Speichern fehlgeschlagen:', e); syncState = 'error'; showSyncState(); });
}

/* Live-Abgleich: Änderungen vom anderen Gerät kommen sofort an */
let unsubs = [], invoicesBlocked = false;
const dataListeners = new Set();
async function startSync(localBefore) {
  const { fs, db } = FB;
  unsubs.forEach(u => u()); unsubs = [];
  const got = { customers: null, appts: null, invoices: null, settings: undefined };
  let first = true;
  const apply = () => {
    if (got.customers === null || got.appts === null || got.invoices === null || got.settings === undefined) return;
    const before = JSON.stringify(data);
    const next = {
      customers: got.customers, appts: got.appts, invoices: got.invoices,
      settings: got.settings ? { ...DEFAULT_SETTINGS, ...got.settings, inv: { ...DEFAULT_SETTINGS.inv, ...got.settings.inv }, lastBackup: data.settings.lastBackup } : data.settings
    };
    // Nur ersetzen, wenn sich inhaltlich etwas geändert hat – sonst arbeiten offene Fenster mit alten Kopien weiter
    if (JSON.stringify(next) !== before) data = next;
    shadow = snapshot(data);
    if (!got.settings) shadow.settings = null;          // noch keine Einstellungen online → hochladen
    if (first) {
      first = false;
      // Erste Anmeldung auf diesem Gerät: lokale Daten, die online noch fehlen, hochladen
      const migKey = KEY + '-fbmig-' + cloud.user.uid;
      if (localBefore && !localStorage.getItem(migKey)) {
        const has = (list, id) => list.some(x => x.id === id);
        data.customers.push(...localBefore.customers.filter(c => !has(data.customers, c.id)));
        data.appts.push(...localBefore.appts.filter(a => !has(data.appts, a.id)));
        data.invoices.push(...(localBefore.invoices || []).filter(x => !has(data.invoices, x.id)));
        if (!got.settings) data.settings = { ...DEFAULT_SETTINGS, ...localBefore.settings };
        localStorage.setItem(migKey, '1');
      }
      queueDiff();
      // Kundenseite: öffentliche Angaben + Belegt-Zeiten einmal komplett neu schreiben
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, 'public', 'info'), publicInfo(data.settings));
      const days = [...new Set(data.appts.filter(a => a.date >= todayDs()).map(a => a.date))];
      for (const d of days) batch.set(fs.doc(db, 'busy', d), { iv: data.appts.filter(a => a.date === d && isActive(a)).map(busyKey) });
      batch.commit().catch(e => console.warn(e));
    }
    localStorage.setItem(KEY, JSON.stringify(data));
    if (JSON.stringify(data) !== before) { safeRender(); dataListeners.forEach(f => f()); }
  };
  const onMeta = snap => { pendingWrites = snap.metadata.hasPendingWrites; syncState = snap.metadata.fromCache ? 'offline' : 'ok'; showSyncState(); };
  const onErr = e => { console.warn('Abgleich:', e); syncState = e.code === 'permission-denied' ? 'denied' : 'error'; showSyncState(); if (syncState === 'denied') render(); };
  unsubs.push(fs.onSnapshot(fs.collection(db, 'customers'), { includeMetadataChanges: true }, s => { got.customers = s.docs.map(d => d.data()); onMeta(s); apply(); }, onErr));
  unsubs.push(fs.onSnapshot(fs.collection(db, 'appts'), { includeMetadataChanges: true }, s => { got.appts = s.docs.map(d => { const x = { ...d.data(), id: d.id }; delete x.startAt; delete x.proof; return x; }); onMeta(s); apply(); }, onErr));
  // Rechnungen: fehlt die Berechtigung (alte Regeln), läuft der restliche Abgleich trotzdem weiter
  unsubs.push(fs.onSnapshot(fs.collection(db, 'invoices'), { includeMetadataChanges: true }, s => { got.invoices = s.docs.map(d => d.data()); onMeta(s); apply(); },
    e => { console.warn('Rechnungen:', e.code); invoicesBlocked = true; if (got.invoices === null) { got.invoices = data.invoices || []; apply(); } }));
  unsubs.push(fs.onSnapshot(fs.doc(db, 'settings', 'main'), { includeMetadataChanges: true }, s => {
    got.settings = s.exists() ? JSON.parse(s.data().json) : null; onMeta(s); apply(); }, onErr));
}
async function cloudLogin(email, pw) {
  const { authM, auth } = await fb();
  await authM.signInWithEmailAndPassword(auth, email, pw);
}
async function cloudLogout() {
  const { authM, auth } = await fb();
  unsubs.forEach(u => u()); unsubs = []; shadow = null;
  await authM.signOut(auth);
}
/* Nicht neu zeichnen, während jemand gerade tippt */
let renderPending = false;
function safeRender() {
  const el = document.activeElement;
  if (el && $('#app').contains(el) && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) { renderPending = true; return; }
  renderPending = false; render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (renderPending) safeRender(); }, 300));
function showSyncState() {
  const el = $('#subtitle'); if (!el || !CLOUD || !cloud.user || mode !== 'owner') return;
  el.textContent = syncState === 'denied' ? '⛔ Kein Zugriff – Konto nicht freigeschaltet'
    : syncState === 'error' ? '⚠️ Fehler beim Speichern'
    : syncState === 'offline' ? '⚠️ offline – Änderungen werden später gesendet'
    : pendingWrites ? '⏳ wird gespeichert …' : '✓ synchronisiert';
}

function ownerAvailability(excludeApptId) {
  const s = data.settings, from = todayDs(), to = addDays(from, s.horizonWeeks * 7 - 1);
  const busy = {};
  for (const a of data.appts) if (a.id !== excludeApptId && isActive(a)) (busy[a.date] ||= []).push([a.start, a.end]);
  return makeAvailability({ work: s.work, raster: s.raster, buffer: s.buffer, blocked: s.blocked, busy, from, to });
}
function overlaps(date, start, end, excludeId) {
  return data.appts.filter(a => a.id !== excludeId && isActive(a) && a.date === date && start < a.end && end > a.start);
}

/* =====================================================================
   Nachrichten-Texte
   ===================================================================== */
function apptMessage(a) {
  const c = customerById(a.customerId) || {}, s = data.settings;
  const horses = a.horses && a.horses.length ? a.horses.join(', ') : `${a.count} Pferd(e)`;
  return `Hallo ${c.owner || ''},

hiermit bestätige ich Ihren Termin:
📅 ${fmtDateLong(a.date)}
🕐 ${fmtTime(a.start)} – ${fmtTime(a.end)} Uhr
🐴 ${horses}
📍 ${c.stable ? c.stable + ', ' : ''}${c.stableAddr || ''}
${a.note ? '\nHinweis: ' + a.note + '\n' : ''}${a.ms ? `\nTermin ansehen, in den Kalender eintragen, stornieren oder umbuchen (bis ${CHANGE_LIMIT_H} Std. vorher):\n${manageUrl(a.ms)}\n` : ''}
Viele Grüße
${s.name || ''}`.replace(/\n{3,}/g, '\n\n');
}
function sendButtons(phone, mail, subject, text) {
  return `<div class="row">
    <a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(phone, text))}">WhatsApp${phone ? '' : ' (Kontakt wählen)'}</a>
    <a class="btn" href="${esc(mailLink(mail, subject, text))}">E-Mail${mail ? '' : ' (ohne Adresse)'}</a>
    <button type="button" data-copy="${esc(text)}">Text kopieren</button></div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]');
  if (b) navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Kopiert'), () => toast('Kopieren nicht möglich'));
});

/* =====================================================================
   BETREIBER-OBERFLÄCHE
   ===================================================================== */
const TABS = [['termine', '📅 Termine'], ['kunden', '🐴 Kunden'], ['buchung', '🔗 QR / Link'], ['einstellungen', '⚙️ Einstellungen']];
let tab = 'termine';
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="${k === tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('');
  $('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); window.scrollTo(0, 0); } };
}
function render() {
  $('#title').textContent = data.settings.name || "Franzi's Hufpflege";
  $('#subtitle').textContent = 'Kunden & Terminplanung';
  if (CLOUD && !cloud.ready) { if ($('#tabs')) $('#tabs').style.display = 'none'; $('#app').innerHTML = '<div class="card">Wird geladen …</div>'; return; }
  if (CLOUD && !cloud.user) return renderLogin();
  $('#tabs').style.display = '';
  renderTabs(); showSyncState();
  $('#app').onchange = null;
  ({ termine: renderTermine, kunden: renderKunden, buchung: renderBuchung, einstellungen: renderEinstellungen })[tab]();
}

function backupBanner() {
  const s = data.settings;
  if (CLOUD || (!data.customers.length && !data.appts.length)) return '';
  const days = s.lastBackup ? dayDiff(s.lastBackup.slice(0, 10), todayDs()) : null;
  if (days !== null && days < 14) return '';
  return `<div class="banner">⚠️ Ihre Daten liegen nur auf diesem Gerät. ${days === null ? 'Es gibt noch keine Sicherung.' : `Letzte Sicherung vor ${days} Tagen.`}
    <button class="small" style="margin-left:6px" onclick="exportBackup()">Jetzt sichern</button></div>`;
}

/* ---------- Anmeldung (nur im Online-Modus) ---------- */
function renderLogin() {
  if ($('#tabs')) $('#tabs').style.display = 'none';
  $('#app').innerHTML = `<div class="hero"><img src="apple-touch-icon.png" alt="Logo"></div>
    <div class="card"><h2>Anmelden</h2>
      <p class="muted small">Melden Sie sich mit Ihrem Zugang an. Beide Geräte sehen danach dieselben Kunden und Termine.</p>
      <form id="loginForm">
        <label class="f">E-Mail <input id="lMail" type="email" autocomplete="username" required></label>
        <label class="f">Passwort <input id="lPw" type="password" autocomplete="current-password" required></label>
        <button class="primary big" type="submit">Anmelden</button>
      </form><p id="lErr" class="small" style="color:var(--danger)"></p></div>`;
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#loginForm button'); btn.disabled = true; $('#lErr').textContent = '';
    try {
      await cloudLogin($('#lMail').value.trim(), $('#lPw').value);
      toast('Angemeldet');   // Rest erledigt onAuthStateChanged
    } catch (err) {
      const c = err.code || '';
      $('#lErr').textContent = /network/.test(c) ? 'Keine Verbindung zum Server.'
        : /too-many/.test(c) ? 'Zu viele Versuche – bitte kurz warten.' : 'E-Mail oder Passwort falsch.';
      btn.disabled = false;
    }
  };
}

/* ---------- Termine ---------- */
let showPast = false;
function renderTermine() {
  const today = todayDs();
  const sorted = [...data.appts].sort((a, b) => (a.date + pad(a.start).padStart(4, '0')).localeCompare(b.date + pad(b.start).padStart(4, '0')));
  const cancelled = sorted.filter(a => a.status === 'storniert');
  const active = sorted.filter(isActive);
  const fresh = active.filter(a => a.status === 'neu');
  const upcoming = active.filter(a => a.date >= today && a.status !== 'neu'), past = active.filter(a => a.date < today).reverse();
  const due = dueReminders();
  const group = list => {
    let h = '', last = '';
    for (const a of list) {
      if (a.date !== last) { h += `<div class="daylabel">${fmtDateLong(a.date)}</div>`; last = a.date; }
      const c = customerById(a.customerId);
      h += `<div class="card appt"><div class="t">${fmtTime(a.start)}<div class="muted small">${fmtTime(a.end)}</div></div>
        <div class="grow"><b>${esc(apptLabel(a))}</b>
          <div class="muted small">${esc(a.horses && a.horses.length ? a.horses.join(', ') : a.count + ' Pferd(e)')}
          ${c && c.stableAddr ? ' · ' + esc(c.stableAddr) : ''}</div>
          ${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}
          ${a.source === 'kunde' ? '<span class="pill green">vom Kunden gebucht</span>' : ''}
          ${a.cc === 'umgebucht' ? `<div class="banner" style="margin:6px 0 0;padding:6px 10px">🔄 Vom Kunden umgebucht${a.prev ? ' (vorher ' + esc(a.prev) + ')' : ''}
            <button class="small" style="margin-left:6px" onclick="ackChange('${a.id}')">✓ gesehen</button></div>` : ''}
          <div class="row" style="margin-top:8px">
            <button class="small" onclick="openSend('${a.id}')">📤 Senden</button>
            ${c && c.stableAddr ? `<a class="btn small" target="_blank" rel="noopener" href="${esc(mapsUrl(c.stableAddr))}">🗺 Route</a>` : ''}
            <button class="small" onclick="openApptEditor(null,'${a.id}')">✏️ Verschieben</button>
            <button class="small danger" onclick="deleteAppt('${a.id}')">🗑</button>
          </div></div></div>`;
    }
    return h;
  };
  const freshHTML = fresh.map(a => { const r = a.request || {};
    return `<div class="card" style="border:2px solid var(--gold)"><div class="row"><b class="grow">${fmtDateLong(a.date)}, ${fmtTime(a.start)}–${fmtTime(a.end)}</b>
      <span class="pill green">online gebucht</span></div>
      <div class="small" style="margin-top:4px"><b>${esc(r.o)}</b>${r.s ? ' · ' + esc(r.s) : ''}<br>${r.a ? '📍 ' + esc(r.a) + '<br>' : ''}
      ${r.t ? '📞 ' + esc(r.t) + ' ' : ''}${r.e ? '✉️ ' + esc(r.e) : ''}<br>🐴 ${esc(a.horses && a.horses.length ? a.horses.join(', ') : a.count + ' Pferd(e)')}
      ${a.note ? '<br>💬 ' + esc(a.note) : ''}</div>
      <div class="row" style="margin-top:10px"><button class="primary small" onclick="confirmOnline('${a.id}')">✅ Bestätigen</button>
      <button class="small danger" onclick="rejectOnline('${a.id}')">Ablehnen</button></div></div>`; }).join('');
  const cancelledHTML = cancelled.map(a => `<div class="card" style="border:2px solid #fca5a5"><div class="row"><b class="grow">❌ ${esc(apptLabel(a))}</b></div>
      <div class="small">hat den Termin am ${fmtDateLong(a.date)}, ${fmtTime(a.start)} Uhr storniert. Die Zeit ist wieder frei.</div>
      <div class="row" style="margin-top:8px"><button class="small" onclick="ackCancel('${a.id}')">✓ gesehen – entfernen</button></div></div>`).join('');
  const dueHTML = due.map(({ a, kind }) => { const c = customerById(a.customerId) || {}, txt = reminderText(a, kind);
    return `<div class="card"><div class="row"><div class="grow"><b>${esc(apptLabel(a))}</b>
      <div class="muted small">${kind === 'r1' ? 'Morgen' : 'Heute'}, ${fmtTime(a.start)} Uhr</div></div>
      <a class="btn wa small" target="_blank" rel="noopener" href="${esc(waLink(c.phone, txt))}" onclick="setTimeout(()=>markReminder('${a.id}','${kind}'),400)">💬 Erinnern</a>
      <button class="small" title="ohne Nachricht als erledigt markieren" onclick="markReminder('${a.id}','${kind}')">✓</button></div></div>`; }).join('');
  $('#app').innerHTML = `${backupBanner()}
    ${fresh.length ? `<h3>Neue Online-Buchungen (${fresh.length})</h3>${freshHTML}` : ''}
    ${cancelled.length ? `<h3>Vom Kunden storniert (${cancelled.length})</h3>${cancelledHTML}` : ''}
    ${due.length ? `<h3>Erinnerungen fällig (${due.length})</h3>${dueHTML}` : ''}
    ${CLOUD ? '' : `<div class="card"><b>Buchungsanfrage übernehmen</b>
      <p class="muted small" style="margin:4px 0 8px">Kunden schicken Ihnen nach der Buchung einen Link. Tippen Sie ihn an – oder fügen Sie ihn hier ein.</p>
      <div class="row"><input class="grow" id="reqInput" placeholder="Link aus WhatsApp/E-Mail einfügen">
      <button onclick="importFromInput()">Übernehmen</button></div></div>`}
    <h3>Kommende Termine (${upcoming.length})</h3>
    ${upcoming.length ? group(upcoming) : '<p class="muted">Noch keine Termine. Tippen Sie auf „+ Neuer Termin“.</p>'}
    ${past.length ? `<button style="margin-top:14px" onclick="showPast=!showPast;render()">${showPast ? 'Vergangene ausblenden' : `Vergangene Termine anzeigen (${past.length})`}</button>
      ${showPast ? group(past) : ''}` : ''}
    <button class="primary fab" onclick="openApptEditor()">+ Neuer Termin</button>`;
}
/* Erinnerungen: morgen (r1) und heute (r2) – ein Tipp öffnet WhatsApp mit fertigem Text */
function dueReminders() {
  const today = todayDs(), tomorrow = addDays(today, 1), now = nowMin();
  return data.appts.filter(a => isActive(a) && a.status !== 'neu').flatMap(a => [
    ...(a.date === tomorrow && !a.r1 ? [{ a, kind: 'r1' }] : []),
    ...(a.date === today && !a.r2 && a.start > now ? [{ a, kind: 'r2' }] : [])
  ]).sort((x, y) => (x.a.date + pad(x.a.start).padStart(4, '0')).localeCompare(y.a.date + pad(y.a.start).padStart(4, '0')));
}
function reminderText(a, kind) {
  const c = customerById(a.customerId) || {}, horses = a.horses && a.horses.length ? a.horses.join(', ') : `${a.count} Pferd(e)`;
  const when = kind === 'r1' ? `morgen, ${fmtDateLong(a.date)}, um ${fmtTime(a.start)} Uhr` : `heute um ${fmtTime(a.start)} Uhr`;
  return `Hallo ${c.owner || ''},\n\nkleine Erinnerung: Ich komme ${when} zu ${horses}${c.stable ? ' (' + c.stable + ')' : ''}.` +
    (a.ms && kind === 'r1' ? `\n\nFalls etwas dazwischenkommt, können Sie hier bis ${CHANGE_LIMIT_H} Std. vorher absagen oder umbuchen:\n${manageUrl(a.ms)}` : '') +
    `\n\nViele Grüße\n${data.settings.name || ''}`;
}
function markReminder(id, kind) { const a = data.appts.find(x => x.id === id); if (!a) return; a[kind] = true; save(); render(); }
function ackChange(id) { const a = data.appts.find(x => x.id === id); if (!a) return; delete a.cc; delete a.ccAt; delete a.prev; save(); render(); }
function ackCancel(id) { data.appts = data.appts.filter(x => x.id !== id); save(); render(); }

function deleteAppt(id) {
  const a = data.appts.find(x => x.id === id); if (!a) return;
  if (!confirm(`Termin am ${fmtDate(a.date)} um ${fmtTime(a.start)} löschen?`)) return;
  data.appts = data.appts.filter(x => x.id !== id); save(); render();
  const c = customerById(a.customerId);
  if (a.date >= todayDs() && c && confirm('Kunden über die Absage informieren?')) {
    const text = `Hallo ${c.owner},\n\nleider muss ich den Termin am ${fmtDateLong(a.date)} um ${fmtTime(a.start)} Uhr absagen. Ich melde mich mit einem neuen Terminvorschlag.\n\nViele Grüße\n${data.settings.name}`;
    openModal('Absage senden', sendButtons(c.phone, c.mail, 'Terminabsage', text));
  }
}
function openSend(id) {
  const a = data.appts.find(x => x.id === id), c = customerById(a.customerId) || {};
  ensureMs(a);
  openModal('Termin senden', `<p class="muted small">An: ${esc(c.owner || '')} ${c.phone ? '· ' + esc(c.phone) : ''} ${c.mail ? '· ' + esc(c.mail) : ''}</p>
    <textarea id="sendText" style="width:100%;min-height:220px">${esc(apptMessage(a))}</textarea><div id="sendBtns" style="margin-top:10px"></div>`, body => {
    const upd = () => { $('#sendBtns', body).innerHTML = sendButtons(c.phone, c.mail, `Termin am ${fmtDate(a.date)}`, $('#sendText', body).value); };
    $('#sendText', body).oninput = upd; upd();
  });
}

/* Termin anlegen / verschieben */
function openApptEditor(presetCustomerId, editId) {
  const editing = editId ? data.appts.find(a => a.id === editId) : null;
  const st = {
    customerId: editing ? editing.customerId : (presetCustomerId || ''),
    horses: editing ? [...(editing.horses || [])] : null,
    count: editing ? editing.count : 1,
    duration: editing ? editing.end - editing.start : data.settings.minPerHorse,
    date: editing ? editing.date : null, start: editing ? editing.start : null,
    note: editing ? editing.note || '' : ''
  };
  let avail = ownerAvailability(editId);
  const custOptions = () => '<option value="">– Kunde wählen –</option>' + [...data.customers].sort((a, b) => custLabel(a).localeCompare(custLabel(b)))
    .map(c => `<option value="${c.id}" ${c.id === st.customerId ? 'selected' : ''}>${esc(custLabel(c))}</option>`).join('');

  openModal(editing ? 'Termin verschieben' : 'Neuer Termin', `
    <label class="f">Kunde <div class="row" style="margin-top:4px"><select id="eCust" class="grow">${custOptions()}</select>
      <button type="button" id="eNewCust">+ Neu</button></div></label>
    <div id="eHorses"></div>
    <label class="f">Dauer (Minuten) <input id="eDur" type="number" min="5" step="5" value="${st.duration}"></label>
    <div class="muted small" style="margin-bottom:6px">Tag wählen (grün = frei):</div>
    <div id="eCal" class="card"></div>
    <div id="eTimesWrap" class="card" style="display:none"><div class="muted small" style="margin-bottom:6px" id="eDayLabel"></div>
      <div id="eTimes"></div>
      <label class="f" style="margin-top:10px">…oder eigene Uhrzeit <input id="eManual" type="time" step="300"></label></div>
    <label class="f">Notiz <textarea id="eNote" placeholder="z. B. Eisen vorne neu">${esc(st.note)}</textarea></label>
    <button class="primary big" id="eSave" disabled>Termin speichern</button>`, body => {
    const cal = mountCalendar($('#eCal', body), { isFree: d => avail.starts(d, st.duration).length > 0, selected: st.date, onSelect: d => { st.date = d; st.start = null; showTimes(); check(); } });
    function renderHorses() {
      const c = customerById(st.customerId), el = $('#eHorses', body);
      if (c && c.horses.length) {
        if (!st.horses) st.horses = c.horses.map(h => h.name);
        el.innerHTML = `<div class="muted small">Pferde</div>` + c.horses.map(h =>
          `<label class="chk"><input type="checkbox" value="${esc(h.name)}" ${st.horses.includes(h.name) ? 'checked' : ''}> ${esc(h.name)}</label>`).join('');
        el.onchange = () => { st.horses = $$('input:checked', el).map(i => i.value); st.count = st.horses.length; autoDuration(); };
        st.count = st.horses.length;
      } else {
        st.horses = [];
        el.innerHTML = `<label class="f">Anzahl Pferde <input type="number" min="1" value="${st.count}" id="eCount"></label>`;
        $('#eCount', el).oninput = e => { st.count = Math.max(1, Number(e.target.value) || 1); autoDuration(); };
      }
    }
    function autoDuration() { st.duration = Math.max(1, st.count) * data.settings.minPerHorse; $('#eDur', body).value = st.duration; durationChanged(); }
    function durationChanged() { if (st.start !== null && !avail.starts(st.date, st.duration).includes(st.start) && !$('#eManual', body).value) st.start = null; cal.refresh(); showTimes(); check(); }
    function showTimes() {
      const wrap = $('#eTimesWrap', body);
      if (!st.date) { wrap.style.display = 'none'; return; }
      wrap.style.display = '';
      $('#eDayLabel', body).textContent = `Freie Uhrzeiten am ${fmtDateLong(st.date)}:`;
      mountTimes($('#eTimes', body), avail.starts(st.date, st.duration), st.duration, st.start, t => { st.start = t; $('#eManual', body).value = ''; check(); });
    }
    function check() { $('#eSave', body).disabled = !(st.customerId && st.date && st.start !== null && st.duration > 0); }
    $('#eCust', body).onchange = e => { st.customerId = e.target.value; st.horses = null; renderHorses(); autoDuration(); check(); };
    $('#eNewCust', body).onclick = () => openCustomerEditor(null, c => openApptEditor(c.id));
    $('#eDur', body).oninput = e => { st.duration = Math.max(5, Number(e.target.value) || 5); durationChanged(); };
    $('#eManual', body).oninput = e => { const t = parseTime(e.target.value); st.start = t; $$('.time', body).forEach(x => x.classList.remove('sel')); check(); };
    $('#eSave', body).onclick = () => {
      st.note = $('#eNote', body).value.trim();
      const end = st.start + st.duration;
      const clash = overlaps(st.date, st.start, end, editId);
      if (clash.length && !confirm(`Achtung: überschneidet sich mit ${clash.map(a => fmtTime(a.start) + ' ' + apptLabel(a)).join(', ')}. Trotzdem speichern?`)) return;
      let appt;
      if (editing) { appt = data.appts.find(a => a.id === editId) || editing; if (!data.appts.includes(appt)) data.appts.push(appt); Object.assign(appt, { customerId: st.customerId, date: st.date, start: st.start, end, horses: st.horses, count: st.count, note: st.note }); }
      else { appt = { id: uid(), customerId: st.customerId, date: st.date, start: st.start, end, horses: st.horses, count: st.count, note: st.note, created: new Date().toISOString(), source: 'betrieb', status: 'bestätigt' }; data.appts.push(appt); }
      save(); tab = 'termine'; render(); openSend(appt.id); toast('Termin gespeichert');
    };
    renderHorses(); showTimes(); check();
    // Bucht inzwischen ein Kunde oder das zweite Gerät, Kalender sofort aktualisieren
    const refresh = () => { if (!$('#eCal', body)) return; avail = ownerAvailability(editId);
      if (st.start !== null && !avail.starts(st.date, st.duration).includes(st.start) && !$('#eManual', body).value) { st.start = null; toast('Die gewählte Uhrzeit ist inzwischen belegt'); }
      cal.refresh(); showTimes(); check(); };
    dataListeners.add(refresh);
    $('#modal').addEventListener('close', () => dataListeners.delete(refresh), { once: true });
  });
}

/* ---------- Kunden ---------- */
let custSearch = '';
function renderKunden() {
  const q = custSearch.toLowerCase();
  const list = [...data.customers].filter(c => !q || JSON.stringify(c).toLowerCase().includes(q)).sort((a, b) => custLabel(a).localeCompare(custLabel(b)));
  $('#app').innerHTML = `${backupBanner()}
    <button class="primary big" style="margin-bottom:10px" onclick="openCustomerEditor()">➕ Neuen Kunden anlegen</button>
    <input id="cSearch" style="width:100%;margin-bottom:12px" placeholder="🔍 Suchen (Name, Stall, Pferd, Ort …)" value="${esc(custSearch)}">
    <div id="cList">${list.length ? list.map(c => {
      const next = data.appts.filter(a => a.customerId === c.id && a.date >= todayDs()).sort((a, b) => a.date.localeCompare(b.date))[0];
      return `<div class="card">
        <div class="row"><div class="grow"><b>${esc(c.stable || c.owner)}</b>${c.stable ? `<div class="muted small">Besitzer: ${esc(c.owner)}</div>` : ''}</div>
          <span class="pill">${c.horses.length} Pferd${c.horses.length === 1 ? '' : 'e'}</span></div>
        ${c.horses.length ? `<div class="small" style="margin-top:4px">🐴 ${esc(c.horses.map(h => h.name).join(', '))}</div>` : ''}
        ${c.stableAddr ? `<div class="small muted">📍 Stall: ${esc(c.stableAddr)}</div>` : ''}
        ${c.ownerAddr ? `<div class="small muted">🏠 Besitzer: ${esc(c.ownerAddr)}</div>` : ''}
        ${c.phone || c.mail ? `<div class="small muted">${c.phone ? '📞 ' + esc(c.phone) : ''} ${c.mail ? '✉️ ' + esc(c.mail) : ''}</div>` : ''}
        ${c.route ? `<div class="small" style="margin-top:4px">🚗 ${esc(c.route)}</div>` : ''}
        ${next ? `<div style="margin-top:4px"><span class="pill green">Nächster Termin: ${fmtDate(next.date)} ${fmtTime(next.start)}</span></div>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="small primary" onclick="openApptEditor('${c.id}')">+ Termin</button>
          <button class="small" onclick="sendBookingLink('${c.id}')">🔗 Buchungslink</button>
          ${c.stableAddr ? `<a class="btn small" target="_blank" rel="noopener" href="${esc(mapsUrl(c.stableAddr))}">🗺 Route</a>` : ''}
          <button class="small" onclick="openInvoiceEditor('${c.id}')">🧾 Rechnung</button>
          <button class="small" onclick="openCustomerEditor('${c.id}')">✏️ Bearbeiten</button>
        </div>${invoiceListHTML(c.id)}</div>`;
    }).join('') : '<p class="muted">Keine Kunden gefunden.</p>'}</div>
    <button class="primary fab" onclick="openCustomerEditor()">+ Neuer Kunde</button>`;
  const inp = $('#cSearch');
  inp.oninput = e => { custSearch = e.target.value; const pos = inp.selectionStart; renderKunden(); const n = $('#cSearch'); n.focus(); n.setSelectionRange(pos, pos); };
}

function openCustomerEditor(id, afterSave) {
  const c = id ? customerById(id) : { owner: '', ownerAddr: '', stable: '', stableAddr: '', phone: '', mail: '', route: '', note: '', horses: [] };
  const horses = c.horses.map(h => ({ ...h }));
  openModal(id ? 'Kunde bearbeiten' : 'Neuer Kunde', `
    <div class="grid2">
      <label class="f">Name des Besitzers * <input id="kOwner" value="${esc(c.owner)}" autocomplete="off"></label>
      <label class="f">Name des Stalls <input id="kStable" value="${esc(c.stable)}"></label>
      <label class="f">Telefon (WhatsApp) <input id="kPhone" type="tel" value="${esc(c.phone)}" placeholder="0171 1234567"></label>
      <label class="f">E-Mail-Adresse <input id="kMail" type="email" value="${esc(c.mail)}"></label>
    </div>
    <label class="f">Anschrift des Besitzers <textarea id="kOwnerAddr" rows="2">${esc(c.ownerAddr)}</textarea></label>
    <label class="f">Anschrift des Stalls <textarea id="kStableAddr" rows="2">${esc(c.stableAddr)}</textarea></label>
    <label class="f">Anfahrtsweg <textarea id="kRoute" placeholder="z. B. 2. Einfahrt links nach dem Hof, Schranke Code 1234">${esc(c.route)}</textarea></label>
    <div class="muted small">Pferde – Anzahl: <b id="kCount">${horses.length}</b></div>
    <div id="kHorses" style="margin:6px 0"></div>
    <button type="button" id="kAddHorse">+ Pferd hinzufügen</button>
    <label class="f" style="margin-top:12px">Notizen <textarea id="kNote">${esc(c.note)}</textarea></label>
    <div class="row" style="margin-top:6px">
      <button class="primary grow big" id="kSave">Speichern</button>
      ${id ? '<button class="danger" id="kDel">Löschen</button>' : ''}</div>`, body => {
    const drawHorses = () => {
      $('#kHorses', body).innerHTML = horses.map((h, i) => `<div class="horse-row">
        <input class="grow" data-i="${i}" data-k="name" placeholder="Name des Pferdes" value="${esc(h.name)}">
        <input style="width:30%" data-i="${i}" data-k="info" placeholder="Info (optional)" value="${esc(h.info || '')}">
        <input style="width:72px;text-align:right" data-i="${i}" data-k="priceTxt" inputmode="decimal" placeholder="Preis €" value="${h.price != null ? centsToInput(h.price) : ''}">
        <button type="button" data-rm="${i}" aria-label="Entfernen">✕</button></div>`).join('');
      $('#kCount', body).textContent = horses.length;
    };
    $('#kHorses', body).oninput = e => { const i = e.target.dataset.i; if (i !== undefined) horses[i][e.target.dataset.k] = e.target.value; };
    $('#kHorses', body).onclick = e => { const r = e.target.closest('[data-rm]'); if (r) { horses.splice(Number(r.dataset.rm), 1); drawHorses(); } };
    $('#kAddHorse', body).onclick = () => { horses.push({ name: '', info: '' }); drawHorses(); $$('#kHorses input[data-k=name]', body).pop().focus(); };
    drawHorses();
    $('#kSave', body).onclick = () => {
      const v = k => $(k, body).value.trim();
      if (!v('#kOwner')) { toast('Bitte den Namen des Besitzers eintragen'); $('#kOwner', body).focus(); return; }
      const rec = id ? (customerById(id) || c) : { id: uid(), created: new Date().toISOString() };
      Object.assign(rec, { owner: v('#kOwner'), stable: v('#kStable'), phone: v('#kPhone'), mail: v('#kMail'), ownerAddr: v('#kOwnerAddr'),
        stableAddr: v('#kStableAddr'), route: v('#kRoute'), note: v('#kNote'),
        horses: horses.map(h => { const o = { name: h.name.trim(), info: (h.info || '').trim() };
          const pt = h.priceTxt !== undefined ? h.priceTxt : (h.price != null ? centsToInput(h.price) : '');
          if (String(pt).trim() !== '') o.price = toCents(pt); return o; }).filter(h => h.name) });
      if (!customerById(rec.id)) data.customers.push(rec);
      save(); closeModal(); render(); toast('Kunde gespeichert');
      if (afterSave) afterSave(rec);
    };
    if (id) $('#kDel', body).onclick = () => {
      const n = data.appts.filter(a => a.customerId === id).length;
      if (!confirm(`Kunde „${c.owner}“ ${n ? `und ${n} Termin(e) ` : ''}endgültig löschen?`)) return;
      data.customers = data.customers.filter(x => x.id !== id); data.appts = data.appts.filter(a => a.customerId !== id);
      save(); closeModal(); render();
    };
  });
}

/* ---------- Buchungslink / QR ---------- */
async function buildBookingLink(customer) {
  if (CLOUD) {
    if (!customer) return customerUrl() + '#live';
    return customerUrl() + '#live=' + await pack({ c: { i: customer.id, o: customer.owner, s: customer.stable, a: customer.stableAddr,
      t: customer.phone, e: customer.mail, h: customer.horses.map(h => h.name) } });
  }
  const s = data.settings, from = todayDs(), days = s.horizonWeeks * 7, to = addDays(from, days - 1);
  const r5 = m => Math.round(m / 5);
  const p = {
    v: 1, n: s.name, p: s.phone, m: s.mail,
    w: s.work.map(x => x ? [r5(x[0]), r5(x[1])] : 0), r: s.raster, h: s.minPerHorse, b: s.buffer,
    f: from.replace(/-/g, ''), d: days,
    x: s.blocked.filter(d => d >= from && d <= to).map(d => dayDiff(from, d)),
    o: data.appts.filter(a => a.date >= from && a.date <= to).map(a => [dayDiff(from, a.date), Math.floor(a.start / 5), Math.ceil(a.end / 5)])
  };
  if (customer) p.c = { i: customer.id, o: customer.owner, s: customer.stable, a: customer.stableAddr, t: customer.phone, e: customer.mail, h: customer.horses.map(h => h.name) };
  return customerUrl() + '#b=' + await pack(p);
}
async function sendBookingLink(id) {
  const c = customerById(id);
  if (!data.settings.phone && !data.settings.mail) { toast('Bitte zuerst in den Einstellungen Ihre Telefonnummer/E-Mail eintragen'); tab = 'einstellungen'; render(); return; }
  const link = await buildBookingLink(c);
  const text = `Hallo ${c.owner},\n\nüber diesen Link können Sie sich direkt einen freien Termin aussuchen:\n${link}\n\nViele Grüße\n${data.settings.name}`;
  openModal('Persönlichen Buchungslink senden', `<p class="muted small">Der Link enthält ${CLOUD ? '' : 'die freien Zeiten von heute und '}die Daten von ${esc(c.owner)} (vorausgefüllt).
    ${CLOUD ? 'Zeigt immer die aktuellen freien Zeiten.' : `Gültig ${data.settings.horizonWeeks} Wochen.`}</p>${sendButtons(c.phone, c.mail, 'Termin buchen', text)}`);
}
function qrSvg(text) {
  const qr = qrcode(0, text.length < 300 ? 'M' : 'L'); qr.addData(text, 'Byte'); qr.make();
  return { svg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), img: qr.createDataURL(8, 4), modules: qr.getModuleCount() };
}
function renderBuchung() {
  const s = data.settings;
  const card = qrSvg(cardUrl());
  $('#app').innerHTML = `
    <div class="card"><h2>QR-Code für die Visitenkarte</h2>
      <p class="muted small">Führt zur Visitenkarten-Seite (Logo, Anrufen, WhatsApp, Kontakt speichern, Termin buchen).
      Dieser Code ändert sich nie – er kann gedruckt werden, sobald die endgültige Internet-Adresse feststeht.</p>
      <div style="text-align:center"><div class="qr">${card.svg}</div><p class="muted small">${esc(cardUrl())}</p></div>
      <div class="row">
        <button id="cardSvg">⬇️ SVG für die Druckerei</button><button id="cardPng">⬇️ PNG (hochauflösend)</button>
        <a class="btn" target="_blank" rel="noopener" href="${esc(cardUrl() + '#karte')}">Visitenkarten-Seite ansehen</a></div></div>
    <div class="card"><h2>Kunden-Bereich per QR-Code</h2>
      <p class="muted small">Kunden scannen den Code, sehen freie Tage (grün), wählen eine Uhrzeit und buchen.
      ${CLOUD ? 'Die Buchung erscheint sofort unter „Termine → Neue Online-Buchungen“ auf beiden Geräten.' : 'Die Buchung kommt per WhatsApp oder E-Mail bei Ihnen an – ein Tipp auf den Link darin trägt den Termin hier ein.'}</p>
      ${CLOUD ? '<div class="banner" style="background:var(--free-bg);border-color:var(--free-line);color:var(--brand)">✅ Dieser Code bleibt <b>dauerhaft gültig</b> und zeigt immer die aktuellen freien Zeiten – ideal zum Aufhängen am Stall.</div>'
      : `<div class="banner">ℹ️ Der Code enthält die freien Zeiten von <b>heute</b> für ${s.horizonWeeks} Wochen. Nach neuen Terminen bitte neu erzeugen,
      sonst sehen Kunden veraltete Lücken.</div>`}
      ${!s.phone && !s.mail ? '<div class="banner">Bitte zuerst in den <b>Einstellungen</b> Ihre Telefonnummer und/oder E-Mail eintragen – dorthin werden Buchungen geschickt.</div>' : ''}
      <button class="primary big" id="qrMake" ${!s.phone && !s.mail ? 'disabled' : ''}>QR-Code & Link erzeugen</button>
      <div id="qrOut" style="margin-top:14px"></div></div>`;
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const svgFile = () => card.svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg" (.*)xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'xmlns="http://www.w3.org/2000/svg" $1');
  $('#cardSvg').onclick = () => dl(new Blob([svgFile()], { type: 'image/svg+xml' }), 'visitenkarte-qr.svg');
  $('#cardPng').onclick = () => {
    const img = new Image(), size = 2000;
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, size, size);
      c.toBlob(b => dl(b, 'visitenkarte-qr.png'), 'image/png'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgFile());
  };
  $('#qrMake').onclick = async () => {
    const link = await buildBookingLink(null);
    let q;
    try { q = qrSvg(link); } catch (e) { $('#qrOut').innerHTML = `<div class="banner">Zu viele Daten für einen QR-Code (${link.length} Zeichen). Bitte in den Einstellungen den Buchungszeitraum verkürzen. Den Link können Sie trotzdem verschicken.</div>`; }
    $('#qrOut').innerHTML = (q ? `<div style="text-align:center"><div class="qr">${q.svg}</div>
        <p class="muted small">Termin buchen bei ${esc(s.name)}${CLOUD ? '' : ' – gültig bis ' + fmtDate(addDays(todayDs(), s.horizonWeeks * 7 - 1))}</p>
        ${link.length > 1200 ? '<p class="small" style="color:#b45309">Der Code ist sehr fein – zum Scannen ggf. vergrößern oder den Zeitraum verkürzen.</p>' : ''}</div>` : $('#qrOut').innerHTML) + `
      <label class="f">Link <input id="qrLink" readonly value="${esc(link)}"></label>
      <div class="row noprint">
        <button data-copy="${esc(link)}">Link kopieren</button>
        ${navigator.share ? '<button id="qrShare">Teilen …</button>' : ''}
        ${q ? `<a class="btn" download="buchungs-qr.gif" href="${q.img}">QR herunterladen</a><button onclick="window.print()">Drucken</button>` : ''}
        <a class="btn" target="_blank" rel="noopener" href="${esc(link)}">Kundenansicht testen</a></div>`;
    const sh = $('#qrShare'); if (sh) sh.onclick = () => navigator.share({ title: 'Termin buchen', text: `Termin buchen bei ${s.name}`, url: link }).catch(() => {});
  };
}

/* ---------- Einstellungen ---------- */
function renderEinstellungen() {
  const s = data.settings;
  const order = [1, 2, 3, 4, 5, 6, 0];
  $('#app').innerHTML = `
    <div class="card"><h2>Ihre Daten</h2><p class="muted small">Erscheinen im Kunden-Bereich; Buchungen werden an diese Nummer/Adresse geschickt.</p>
      <label class="f">Name / Betrieb <input id="sName" value="${esc(s.name)}" placeholder="z. B. Hufpflege Müller"></label>
      <div class="grid2"><label class="f">Telefon (WhatsApp) <input id="sPhone" type="tel" value="${esc(s.phone)}"></label>
      <label class="f">E-Mail <input id="sMail" type="email" value="${esc(s.mail)}"></label></div></div>
    <div class="card"><h2>Arbeitszeiten</h2>
      ${order.map(d => `<div class="row" style="margin-bottom:6px"><label class="chk" style="width:130px"><input type="checkbox" data-wd="${d}" ${s.work[d] ? 'checked' : ''}> ${WD_LONG[d]}</label>
        <input type="time" step="300" data-from="${d}" value="${s.work[d] ? fmtTime(s.work[d][0]) : '08:00'}"> – <input type="time" step="300" data-to="${d}" value="${s.work[d] ? fmtTime(s.work[d][1]) : '17:00'}"></div>`).join('')}
      <div class="grid2" style="margin-top:10px">
        <label class="f">Minuten pro Pferd <input id="sMph" type="number" min="5" step="5" value="${s.minPerHorse}"></label>
        <label class="f">Puffer zwischen Terminen (Anfahrt, Min.) <input id="sBuf" type="number" min="0" step="5" value="${s.buffer}"></label>
        <label class="f">Startzeiten-Raster (Min.) <select id="sRaster">${[15, 30, 60].map(v => `<option ${v === s.raster ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">Buchbar für die nächsten … Wochen <input id="sWeeks" type="number" min="1" max="26" value="${s.horizonWeeks}"></label>
      </div></div>
    <div class="card"><h2>Freie Tage / Urlaub</h2>
      <div class="row"><input type="date" id="bFrom"> bis <input type="date" id="bTo"><button id="bAdd">Sperren</button></div>
      <div id="bList" style="margin-top:8px">${s.blocked.filter(d => d >= todayDs()).sort().map(d => `<span class="pill" style="margin:2px">${fmtDate(d)} <a href="#" data-unblock="${d}">✕</a></span>`).join('') || '<span class="muted small">Keine gesperrten Tage.</span>'}</div></div>
    <div class="card"><h2>🧾 Rechnungen</h2>
      ${invComplete(s.inv) ? '<div class="banner" style="background:var(--free-bg);border-color:var(--free-line);color:var(--brand)">✅ Vollständig – Rechnungen werden fortlaufend nummeriert.</div>'
        : '<div class="banner">⚠️ Solange Name, Anschrift und Steuernummer fehlen, erstellt die App nur <b>Entwürfe ohne Rechnungsnummer</b>.</div>'}
      <p class="muted small">Diese Angaben erscheinen nur auf Rechnungen, nicht auf der öffentlichen Seite.</p>
      <label class="f">Vollständiger Name (Inhaberin) <input id="i_fullName" value="${esc(s.inv.fullName)}"></label>
      <label class="f">Straße und Hausnummer <input id="i_street" value="${esc(s.inv.street)}"></label>
      <div class="grid2"><label class="f">PLZ <input id="i_zip" inputmode="numeric" value="${esc(s.inv.zip)}"></label>
        <label class="f">Ort <input id="i_city" value="${esc(s.inv.city)}"></label>
        <label class="f">Steuernummer <input id="i_taxNo" value="${esc(s.inv.taxNo)}" placeholder="vom Finanzamt"></label>
        <label class="f">USt-IdNr. (falls vorhanden) <input id="i_vatId" value="${esc(s.inv.vatId)}"></label></div>
      <label class="f">Umsatzsteuer <select id="i_taxMode">
        <option value="klein" ${s.inv.taxMode !== 'ust' ? 'selected' : ''}>Kleinunternehmerin – keine USt (§ 19 UStG)</option>
        <option value="ust" ${s.inv.taxMode === 'ust' ? 'selected' : ''}>Umsatzsteuer ausweisen</option></select></label>
      <div class="grid2">
        <label class="f">USt-Satz in % <input id="i_vatRate" type="number" min="0" value="${esc(s.inv.vatRate)}"></label>
        <label class="f">Zahlungsziel (Tage) <input id="i_payDays" type="number" min="0" value="${esc(s.inv.payDays)}"></label>
        <label class="f">Standardpreis pro Pferd (€) <input id="i_pricePerHorse" inputmode="decimal" value="${esc(s.inv.pricePerHorse)}"></label>
        <label class="f">Anfahrtspauschale (€) <input id="i_travelFee" inputmode="decimal" value="${esc(s.inv.travelFee)}"></label></div>
      <p class="muted small">Preise sind Endpreise (bei Umsatzsteuer inkl. USt). Abweichende Preise je Pferd beim Kunden eintragen.</p>
      <div class="grid2"><label class="f">Kontoinhaber <input id="i_holder" value="${esc(s.inv.holder)}"></label>
        <label class="f">IBAN <input id="i_iban" value="${esc(s.inv.iban)}"></label>
        <label class="f">BIC <input id="i_bic" value="${esc(s.inv.bic)}"></label>
        <label class="f">Bank <input id="i_bank" value="${esc(s.inv.bank)}"></label></div>
    </div>
    ${CLOUD ? `<div class="card"><h2>Online-Konto</h2><p class="small">Angemeldet als <b>${esc(cloud.user && cloud.user.email)}</b><br>
      <span class="muted">Kunden und Termine werden sofort mit dem zweiten Gerät abgeglichen – auch ohne Netz wird weitergearbeitet.</span></p>
      <div class="row"><button class="danger" onclick="if(pendingWrites&&!confirm('Es gibt noch nicht gesendete Änderungen. Trotzdem abmelden?'))return;cloudLogout()">Abmelden</button></div></div>` : ''}
    <div class="card"><h2>Datensicherung</h2>
      <p class="muted small">${CLOUD ? 'Die Daten liegen online und auf Ihren Geräten. Eine zusätzliche Sicherung schadet trotzdem nicht.'
      : 'Alle Daten liegen ausschließlich in diesem Browser auf diesem Gerät. Wird der Browser-Speicher gelöscht, sind sie weg.'}
      Sichern Sie regelmäßig (z. B. in iCloud/OneDrive/Google Drive). ${s.lastBackup ? 'Letzte Sicherung: ' + fmtDate(s.lastBackup.slice(0, 10)) : ''}</p>
      <div class="row"><button onclick="exportBackup()">💾 Sicherung herunterladen</button>
      <label class="btn">📂 Sicherung laden<input type="file" accept=".json,application/json" id="bImport" hidden></label></div>
      <p class="muted small" style="margin-top:10px">${data.customers.length} Kunden · ${data.appts.length} Termine gespeichert</p></div>`;

  const saveSettings = () => {
    const s = data.settings;
    s.name = $('#sName').value.trim(); s.phone = $('#sPhone').value.trim(); s.mail = $('#sMail').value.trim();
    for (const d of order) {
      const on = $(`[data-wd="${d}"]`).checked, f = parseTime($(`[data-from="${d}"]`).value), t = parseTime($(`[data-to="${d}"]`).value);
      s.work[d] = on && f !== null && t !== null && t > f ? [f, t] : null;
    }
    s.minPerHorse = Math.max(5, Number($('#sMph').value) || 45); s.buffer = Math.max(0, Number($('#sBuf').value) || 0);
    s.raster = Number($('#sRaster').value); s.horizonWeeks = Math.min(26, Math.max(1, Number($('#sWeeks').value) || 8));
    s.inv = { ...DEFAULT_SETTINGS.inv, ...s.inv };
    for (const k of ['fullName', 'street', 'zip', 'city', 'taxNo', 'vatId', 'taxMode', 'holder', 'iban', 'bic', 'bank', 'pricePerHorse', 'travelFee']) { const el = $('#i_' + k); if (el) s.inv[k] = el.value.trim(); }
    s.inv.vatRate = Number($('#i_vatRate').value) || 19; s.inv.payDays = Number($('#i_payDays').value) || 0;
    save(); $('#title').textContent = s.name || "Franzi's Hufpflege";
  };
  $('#app').onchange = e => { if (e.target.id !== 'bImport' && e.target.id !== 'bFrom' && e.target.id !== 'bTo') { saveSettings(); toast('Gespeichert'); } };
  $('#bAdd').onclick = () => {
    const s = data.settings;
    const f = $('#bFrom').value, t = $('#bTo').value || f; if (!f) return toast('Bitte Datum wählen');
    for (let d = f; d <= t; d = addDays(d, 1)) if (!s.blocked.includes(d)) s.blocked.push(d);
    s.blocked = s.blocked.filter(d => d >= addDays(todayDs(), -60));
    save(); renderEinstellungen(); toast('Tage gesperrt');
  };
  $('#bList').onclick = e => { const a = e.target.closest('[data-unblock]'); if (a) { e.preventDefault(); const s = data.settings; s.blocked = s.blocked.filter(d => d !== a.dataset.unblock); save(); renderEinstellungen(); } };
  $('#bImport').onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    file.text().then(t => {
      const d = JSON.parse(t);
      if (!d.customers || !d.appts) throw new Error('Keine gültige Sicherung');
      if (!confirm(`Sicherung mit ${d.customers.length} Kunden und ${d.appts.length} Terminen laden? Die aktuellen Daten werden ersetzt.`)) return;
      data = { customers: d.customers, appts: d.appts, invoices: d.invoices || [], settings: { ...DEFAULT_SETTINGS, ...d.settings, inv: { ...DEFAULT_SETTINGS.inv, ...(d.settings || {}).inv } } }; save(); render(); toast('Sicherung geladen');
    }).catch(err => alert('Fehler beim Laden: ' + err.message));
  };
}
function exportBackup() {
  data.settings.lastBackup = new Date().toISOString(); save();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `stalltermine-sicherung-${todayDs()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  render();
}

/* =====================================================================
   RECHNUNGEN (PDF, fortlaufende Nummer, Teilen per WhatsApp)
   ===================================================================== */
const eur = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const toCents = v => Math.round((Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0) * 100);
const centsToInput = c => (c / 100).toFixed(2).replace('.', ',');
const fmtD = d => { const x = parseDs(d); return `${pad(x.getDate())}.${pad(x.getMonth() + 1)}.${x.getFullYear()}`; };
const invComplete = inv => !!(inv.fullName && inv.street && inv.zip && inv.city && (inv.taxNo || inv.vatId));
function invTotals(items, taxMode, vatRate) {
  const gross = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  if (taxMode === 'ust') { const net = Math.round(gross / (1 + vatRate / 100)); return { gross, net, vat: gross - net }; }
  return { gross, net: gross, vat: 0 };
}
/* Fortlaufende Nummer – online über eine Transaktion, damit zwei Geräte nie dieselbe Nummer vergeben */
async function nextInvoiceNo() {
  const year = new Date().getFullYear(), fmt = n => `${year}-${String(n).padStart(3, '0')}`;
  if (CLOUD && FB) {
    const { fs, db } = FB;
    return fs.runTransaction(db, async tx => {
      const ref = fs.doc(db, 'counters', 'invoices'), snap = await tx.get(ref), d = snap.exists() ? snap.data() : {};
      const n = d.year === year ? (d.last || 0) + 1 : 1;
      tx.set(ref, { year, last: n }); return fmt(n);
    });
  }
  const c = data.settings.invCounter || {}, n = c.year === year ? (c.last || 0) + 1 : 1;
  data.settings.invCounter = { year, last: n }; save(); return fmt(n);
}
function openInvoiceEditor(cid) {
  const c = customerById(cid); if (!c) return;
  const inv = data.settings.inv, complete = invComplete(inv);
  const last = data.appts.filter(a => a.customerId === cid && isActive(a) && a.date <= todayDs()).sort((a, b) => b.date.localeCompare(a.date))[0];
  const want = last && last.horses && last.horses.length ? last.horses : c.horses.map(h => h.name);
  const rows = c.horses.length ? c.horses.map(h => ({ name: h.name, on: want.includes(h.name), price: h.price ?? toCents(inv.pricePerHorse) }))
    : [{ name: '', on: true, price: toCents(inv.pricePerHorse), qty: (last && last.count) || 1 }];
  openModal('Rechnung erstellen', `
    ${complete ? '' : `<div class="banner">⚠️ Rechnungsdaten unvollständig (Name, Anschrift, Steuernummer). Es entsteht nur ein <b>Entwurf ohne Rechnungsnummer</b>.
      Ergänzen unter ⚙️ Einstellungen → Rechnungen.</div>`}
    <label class="f">Rechnung an <textarea id="rTo" rows="3">${esc([c.owner, c.ownerAddr || c.stableAddr].filter(Boolean).join('\n'))}</textarea></label>
    <label class="f">Leistungsdatum <input id="rDate" type="date" value="${last ? last.date : todayDs()}"></label>
    <div class="muted small">Pferde und Preis (Endpreis in €)</div>
    <div id="rRows">${rows.map((r, i) => `<div class="row" style="margin:6px 0">
      <label class="chk grow" style="padding:0"><input type="checkbox" data-r="${i}" ${r.on ? 'checked' : ''}> ${r.name ? esc(r.name) : `Hufbearbeitung <input data-qty="${i}" type="number" min="1" value="${r.qty}" style="width:64px;padding:6px"> Pferd(e)`}</label>
      <input data-p="${i}" inputmode="decimal" value="${centsToInput(r.price)}" style="width:96px;text-align:right"> €</div>`).join('')}</div>
    <div class="row" style="margin:10px 0"><label class="chk grow" style="padding:0"><input type="checkbox" id="rTravelOn" ${toCents(inv.travelFee) > 0 ? 'checked' : ''}> Anfahrtspauschale</label>
      <input id="rTravel" inputmode="decimal" value="${centsToInput(toCents(inv.travelFee))}" style="width:96px;text-align:right"> €</div>
    <div class="muted small">Zahlung</div>
    <div class="row" style="margin:4px 0 10px"><label class="chk"><input type="radio" name="rPay" value="ueberweisung" checked> Überweisung</label>
      <label class="chk"><input type="radio" name="rPay" value="bar"> Bar erhalten</label></div>
    <div class="card" id="rSum" style="background:var(--free-bg);border-color:var(--free-line)"></div>
    <button class="primary big" id="rGo">🧾 ${complete ? 'Rechnung erstellen' : 'Entwurf ansehen'}</button>`, body => {
    const read = () => {
      const items = [];
      rows.forEach((r, i) => { if (!$(`[data-r="${i}"]`, body).checked) return;
        const price = toCents($(`[data-p="${i}"]`, body).value), qty = r.name ? 1 : Math.max(1, Number(($(`[data-qty="${i}"]`, body) || {}).value) || 1);
        items.push({ text: r.name ? `Hufbearbeitung ${r.name}` : 'Hufbearbeitung', qty, price, horse: r.name || null }); });
      if ($('#rTravelOn', body).checked) items.push({ text: 'Anfahrtspauschale', qty: 1, price: toCents($('#rTravel', body).value) });
      return items;
    };
    const sum = () => { const t = invTotals(read(), inv.taxMode, Number(inv.vatRate) || 19);
      $('#rSum', body).innerHTML = inv.taxMode === 'ust'
        ? `Netto ${eur(t.net)} · USt ${inv.vatRate} % ${eur(t.vat)}<br><b style="font-size:18px">Gesamt ${eur(t.gross)}</b>`
        : `<b style="font-size:18px">Gesamt ${eur(t.gross)}</b><br><span class="muted small">ohne Umsatzsteuer (§ 19 UStG)</span>`; };
    body.oninput = sum; body.onchange = sum; sum();
    $('#rGo', body).onclick = async () => {
      const items = read();
      if (!items.length) return toast('Bitte mindestens eine Position auswählen');
      const pay = $('input[name=rPay]:checked', body).value, btn = $('#rGo', body);
      const rec = { id: uid(), no: 'ENTWURF', date: todayDs(), serviceDate: $('#rDate', body).value || todayDs(), customerId: cid,
        to: $('#rTo', body).value.trim(), items, pay, taxMode: inv.taxMode, vatRate: Number(inv.vatRate) || 19,
        ...invTotals(items, inv.taxMode, Number(inv.vatRate) || 19), status: pay === 'bar' ? 'bezahlt' : 'offen',
        seller: { ...inv, name: data.settings.name, phone: data.settings.phone, mail: data.settings.mail }, created: new Date().toISOString() };
      if (complete && invoicesBlocked) return alert('Rechnungen sind im Online-Speicher noch nicht freigeschaltet. Bitte die neuen Firestore-Regeln einfügen.');
      if (complete) {
        btn.disabled = true; btn.textContent = 'Rechnungsnummer wird vergeben …';
        try { rec.no = await nextInvoiceNo(); }
        catch (e) { console.warn(e); btn.disabled = false; btn.textContent = '🧾 Rechnung erstellen';
          return alert('Für eine Rechnungsnummer wird eine Internetverbindung benötigt. Bitte später erneut versuchen.'); }
        data.invoices.push(rec);
        // Zuletzt verwendeten Preis je Pferd beim Kunden merken
        const cc = customerById(cid); if (cc) for (const it of items) { const h = cc.horses.find(x => x.name === it.horse); if (h) h.price = it.price; }
        save(); render();
      }
      showInvoice(rec, !complete);
    };
  });
}
let invPdf = null;
async function showInvoice(rec, draft) {
  const c = customerById(rec.customerId) || {};
  openModal(draft ? 'Rechnungsentwurf' : `Rechnung ${rec.no}`, `
    <p><b>${eur(rec.gross)}</b> · ${esc((rec.to || '').split('\n')[0])}<br><span class="muted small">${draft ? 'Entwurf – nicht gespeichert, ohne Rechnungsnummer' : 'gespeichert · ' + (rec.status === 'bezahlt' ? 'bezahlt' : 'offen')}</span></p>
    <p class="muted small" id="pdfState">PDF wird erstellt …</p>
    <div style="display:grid;gap:8px">
      <button class="wa big" id="pShare" disabled>📤 Teilen (WhatsApp, Mail …)</button>
      <button class="big" id="pDl" disabled>⬇️ PDF speichern</button>
      ${c.phone ? `<a class="btn big" target="_blank" rel="noopener" href="${esc(waLink(c.phone, `Hallo ${c.owner || ''},\n\nanbei meine Rechnung ${draft ? '' : 'Nr. ' + rec.no + ' '}über ${eur(rec.gross)}. Die PDF schicke ich Ihnen gleich mit.\n\nViele Grüße\n${data.settings.name || ''}`))}">💬 WhatsApp-Chat mit ${esc(c.owner)} öffnen</a>` : ''}
    </div>
    <p class="muted small" style="margin-top:10px">Tipp: „Teilen“ antippen → WhatsApp → Kunden auswählen. Die PDF wird als Datei verschickt.</p>`);
  invPdf = null;
  try { invPdf = await buildInvoicePdf(rec, draft); }
  catch (e) { console.warn(e); $('#pdfState').textContent = 'PDF konnte nicht erstellt werden.'; return; }
  const name = `Rechnung-${draft ? 'Entwurf' : rec.no}.pdf`;
  $('#pdfState').textContent = `${name} ist fertig.`;
  const file = new File([invPdf], name, { type: 'application/pdf' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  $('#pShare').disabled = !canShare; if (!canShare) $('#pShare').textContent = '📤 Teilen (auf diesem Gerät nicht verfügbar)';
  $('#pDl').disabled = false;
  $('#pShare').onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
  $('#pDl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(invPdf); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
}
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve();
  return new Promise((ok, fail) => { const sc = document.createElement('script'); sc.src = 'vendor/jspdf.umd.min.js'; sc.onload = ok; sc.onerror = fail; document.head.appendChild(sc); });
}
let logoData = null;
async function getLogo() {
  if (logoData) return logoData;
  const b = await (await fetch('apple-touch-icon.png')).blob();
  logoData = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  return logoData;
}
async function buildInvoicePdf(rec, draft) {
  await loadJsPdf();
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const S = rec.seller || {}, green = [22, 74, 46], grey = [110, 110, 110], dark = [25, 25, 25];
  const addr1 = [S.fullName, S.street, [S.zip, S.city].filter(Boolean).join(' ')].filter(Boolean);
  // Wasserzeichen zuerst zeichnen, damit es hinter dem Text liegt
  if (draft) { doc.setTextColor(236, 236, 236); doc.setFont('helvetica', 'bold'); doc.setFontSize(90); doc.text('ENTWURF', 45, 215, { angle: 35 }); }
  try { doc.addImage(await getLogo(), 'PNG', 163, 12, 30, 30); } catch (e) { /* ohne Logo */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...green); doc.text(S.name || 'Hufpflege', 20, 22);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...grey);
  doc.text([...addr1, S.phone ? 'Tel. ' + S.phone : '', S.mail || ''].filter(Boolean), 20, 28);
  // Absenderzeile + Empfänger (Fensterposition)
  doc.setFontSize(7); doc.text(addr1.join(' · '), 20, 52);
  doc.setDrawColor(200); doc.line(20, 53.5, 95, 53.5);
  doc.setFontSize(11); doc.setTextColor(...dark); doc.text((rec.to || '').split('\n').slice(0, 6), 20, 59);
  // Rechnungsdaten rechts
  let y = 59;
  for (const [k, v] of [['Rechnungsnr.', rec.no], ['Rechnungsdatum', fmtD(rec.date)], ['Leistungsdatum', fmtD(rec.serviceDate)]]) {
    doc.setFontSize(9); doc.setTextColor(...grey); doc.text(k, 130, y); doc.setTextColor(...dark); doc.text(String(v), 190, y, { align: 'right' }); y += 5.5;
  }
  // Titel
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...dark);
  doc.text(rec.stornoOf ? 'Stornorechnung' : 'Rechnung', 20, 100);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(rec.stornoOf ? `Storno zu Rechnung Nr. ${rec.stornoOf}. Die Rechnung wird hiermit aufgehoben.` : 'Vielen Dank für Ihren Auftrag. Ich berechne Ihnen folgende Leistungen:', 20, 107);
  // Tabelle
  y = 116;
  doc.setFillColor(243, 227, 181); doc.rect(20, y - 5, 170, 7.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text('Pos.', 22, y); doc.text('Leistung', 34, y); doc.text('Menge', 132, y, { align: 'right' }); doc.text('Einzelpreis', 160, y, { align: 'right' }); doc.text('Gesamt', 188, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); y += 8;
  rec.items.forEach((it, i) => {
    doc.text(String(i + 1), 22, y); doc.text(doc.splitTextToSize(it.text, 90), 34, y);
    doc.text(String(it.qty), 132, y, { align: 'right' }); doc.text(eur(it.price), 160, y, { align: 'right' }); doc.text(eur(it.qty * it.price), 188, y, { align: 'right' });
    y += 7; doc.setDrawColor(230); doc.line(20, y - 4, 190, y - 4);
  });
  // Summen
  y += 3;
  const line = (k, v, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 11.5 : 10); doc.text(k, 140, y, { align: 'right' }); doc.text(v, 188, y, { align: 'right' }); y += bold ? 7 : 6; };
  if (rec.taxMode === 'ust') { line('Nettobetrag', eur(rec.net)); line(`zzgl. ${rec.vatRate} % USt`, eur(rec.vat)); }
  doc.setDrawColor(...green); doc.line(120, y - 4, 190, y - 4);
  line('Gesamtbetrag', eur(rec.gross), true);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...dark); y += 3;
  if (rec.taxMode !== 'ust') { doc.text('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', 20, y); y += 7; }
  else { doc.text(`Alle Einzelpreise inkl. ${rec.vatRate} % Umsatzsteuer.`, 20, y); y += 7; }
  // Zahlung
  if (!rec.stornoOf) {
    if (rec.pay === 'bar') { doc.text(`Betrag in bar erhalten am ${fmtD(rec.date)}. Vielen Dank!`, 20, y); y += 7; }
    else {
      const due = addDays(rec.date, Number(S.payDays) || 14);
      doc.text(doc.splitTextToSize(`Bitte überweisen Sie den Gesamtbetrag bis zum ${fmtD(due)} unter Angabe der Rechnungsnummer ${rec.no} auf folgendes Konto:`, 170), 20, y); y += 11;
      const bank = [S.holder ? 'Kontoinhaber: ' + S.holder : '', S.iban ? 'IBAN: ' + S.iban : '', S.bic ? 'BIC: ' + S.bic : '', S.bank ? 'Bank: ' + S.bank : ''].filter(Boolean);
      if (bank.length) { doc.text(bank, 25, y); y += bank.length * 5 + 3; }
    }
    doc.text('Vielen Dank für Ihr Vertrauen!', 20, y + 2);
  }
  // Fußzeile
  doc.setDrawColor(...green); doc.line(20, 280, 190, 280); doc.setFontSize(7.5); doc.setTextColor(...grey);
  doc.text([[S.name, ...addr1].filter(Boolean).join(' · '),
    [S.taxNo ? 'Steuernummer: ' + S.taxNo : '', S.vatId ? 'USt-IdNr.: ' + S.vatId : '', S.iban ? 'IBAN: ' + S.iban : ''].filter(Boolean).join(' · ')], 105, 285, { align: 'center' });
  return doc.output('blob');
}
function markPaid(id) { const r = data.invoices.find(x => x.id === id); if (!r) return; r.status = 'bezahlt'; r.paidAt = todayDs(); save(); render(); toast('Als bezahlt markiert'); }
async function stornoInvoice(id) {
  const r = data.invoices.find(x => x.id === id); if (!r) return;
  if (!confirm(`Rechnung ${r.no} stornieren? Es wird eine Stornorechnung mit neuer Nummer erstellt.`)) return;
  let no; try { no = await nextInvoiceNo(); } catch (e) { return alert('Für eine Rechnungsnummer wird eine Internetverbindung benötigt.'); }
  const items = r.items.map(it => ({ ...it, price: -it.price }));
  const st = { ...r, id: uid(), no, date: todayDs(), items, ...invTotals(items, r.taxMode, r.vatRate), stornoOf: r.no, status: 'storno', created: new Date().toISOString() };
  delete st.paidAt;
  r.status = 'storniert'; data.invoices.push(st); save(); render(); showInvoice(st, false);
}
function invoiceListHTML(cid) {
  const list = data.invoices.filter(x => x.customerId === cid).sort((a, b) => b.created.localeCompare(a.created));
  if (!list.length) return '';
  const pill = s => s === 'bezahlt' ? '<span class="pill green">bezahlt</span>' : s === 'offen' ? '<span class="pill" style="background:#fef3c7;color:#92400e">offen</span>'
    : s === 'storniert' ? '<span class="pill">storniert</span>' : '<span class="pill">Storno</span>';
  return `<details style="margin-top:8px"><summary class="small">🧾 Rechnungen (${list.length})</summary>${list.map(r => `
    <div class="row small" style="margin:6px 0"><span class="grow">${esc(r.no)} · ${fmtD(r.date)} · <b>${eur(r.gross)}</b> ${pill(r.status)}</span>
      <button class="small" onclick="showInvoice(data.invoices.find(x=>x.id==='${r.id}'),false)">PDF</button>
      ${r.status === 'offen' ? `<button class="small" onclick="markPaid('${r.id}')">✓ bezahlt</button>` : ''}
      ${['offen', 'bezahlt'].includes(r.status) ? `<button class="small danger" onclick="stornoInvoice('${r.id}')">Storno</button>` : ''}</div>`).join('')}</details>`;
}

/* ---------- Buchungsanfrage eines Kunden übernehmen ---------- */
function findCustomer(rc) {
  const norm = p => waNumber(p);
  return (rc.i && customerById(rc.i)) || data.customers.find(c => (rc.t && c.phone && norm(c.phone) === norm(rc.t)) ||
    (rc.e && c.mail && c.mail.toLowerCase() === String(rc.e).toLowerCase()) ||
    (c.owner.toLowerCase() === String(rc.o || '').toLowerCase() && (c.stable || '').toLowerCase() === String(rc.s || '').toLowerCase()));
}
function ensureCustomerFrom(rc, horses) {
  let cust = findCustomer(rc);
  if (cust) {
    if (!cust.phone && rc.t) cust.phone = String(rc.t);
    if (!cust.mail && rc.e) cust.mail = String(rc.e);
    if (!cust.stableAddr && rc.a) cust.stableAddr = String(rc.a);
    if (!cust.stable && rc.s) cust.stable = String(rc.s);
    for (const h of horses) if (!cust.horses.some(x => x.name.toLowerCase() === h.toLowerCase())) cust.horses.push({ name: h, info: '' });
    return cust;
  }
  cust = { id: uid(), created: new Date().toISOString(), owner: String(rc.o || 'Unbekannt'), stable: String(rc.s || ''), stableAddr: String(rc.a || ''),
    ownerAddr: '', phone: String(rc.t || ''), mail: String(rc.e || ''), route: '', note: '', horses: horses.map(name => ({ name, info: '' })) };
  data.customers.push(cust); return cust;
}
/* Online-Buchung bestätigen / ablehnen */
function confirmOnline(id) {
  const a = data.appts.find(x => x.id === id); if (!a) return;
  const horses = (a.horses || []).map(String).filter(Boolean);
  const c = ensureCustomerFrom(a.request || {}, horses);
  a.customerId = c.id; a.status = 'bestätigt';
  save(); render(); openSend(a.id); toast('Termin bestätigt');
}
async function rejectOnline(id) {
  const a = data.appts.find(x => x.id === id); if (!a) return;
  if (!confirm(`Buchung von ${apptLabel(a)} am ${fmtDate(a.date)} ablehnen? Die Zeit wird wieder frei.`)) return;
  const r = a.request || {};
  data.appts = data.appts.filter(x => x.id !== id); save(); render();
  const text = `Hallo ${r.o || ''},\n\nden Termin am ${fmtDateLong(a.date)} um ${fmtTime(a.start)} Uhr kann ich leider nicht wahrnehmen. Bitte suchen Sie sich hier einen anderen Termin aus:\n${await buildBookingLink(findCustomer(r) || null)}\n\nViele Grüße\n${data.settings.name}`;
  openModal('Absage senden', sendButtons(r.t, r.e, 'Ihre Terminbuchung', text));
}
function importFromInput() {
  const v = $('#reqInput').value.trim(), i = v.indexOf('#r=');
  if (i < 0) return toast('Kein gültiger Buchungslink');
  handleRequest(v.slice(i + 3));
}
async function handleRequest(packed) {
  let r;
  try { r = await unpack(packed); if (!r || !/^\d{4}-\d\d-\d\d$/.test(r.d) || typeof r.s !== 'number' || typeof r.e !== 'number' || !r.c) throw 0; }
  catch (e) { toast('Buchungslink ist beschädigt'); return; }
  if (data.appts.some(a => a.reqId === r.q)) { toast('Diese Buchung wurde bereits übernommen'); tab = 'termine'; render(); return; }
  const rc = r.c;
  let cust = findCustomer(rc);
  const clash = overlaps(r.d, r.s, r.e);
  const horses = Array.isArray(rc.h) ? rc.h.map(String).filter(Boolean) : [];
  openModal('Neue Buchung', `
    <div class="card"><b>${fmtDateLong(r.d)}</b><br>${fmtTime(r.s)} – ${fmtTime(r.e)} Uhr</div>
    <div class="card small">
      <b>${esc(rc.o)}</b>${rc.s ? ' · ' + esc(rc.s) : ''}<br>
      ${rc.a ? '📍 ' + esc(rc.a) + '<br>' : ''}${rc.t ? '📞 ' + esc(rc.t) + ' ' : ''}${rc.e ? '✉️ ' + esc(rc.e) : ''}<br>
      🐴 ${esc(horses.length ? horses.join(', ') : (rc.n || 1) + ' Pferd(e)')}
      ${r.k ? `<br>💬 ${esc(r.k)}` : ''}</div>
    <p class="small">${cust ? `✅ Zugeordnet zu Kunde <b>${esc(custLabel(cust))}</b>` : '🆕 Neuer Kunde – wird automatisch angelegt.'}</p>
    ${clash.length ? `<div class="banner">⚠️ Überschneidung mit: ${clash.map(a => esc(fmtTime(a.start) + ' ' + apptLabel(a))).join(', ')}</div>` : ''}
    <div class="row"><button class="primary grow big" id="rOk">${clash.length ? 'Trotzdem bestätigen' : 'Termin bestätigen'}</button></div>
    <div class="row" style="margin-top:8px"><button class="grow" id="rNo">Ablehnen & neuen Link senden</button></div>`, body => {
    const ensureCustomer = () => (cust = ensureCustomerFrom(rc, horses));
    $('#rOk', body).onclick = () => {
      const c = ensureCustomer();
      const a = { id: uid(), reqId: r.q, customerId: c.id, date: r.d, start: r.s, end: r.e, horses, count: horses.length || Number(rc.n) || 1,
        note: r.k ? String(r.k) : '', created: new Date().toISOString(), source: 'kunde' };
      data.appts.push(a); save(); tab = 'termine'; render(); openSend(a.id); toast('Termin eingetragen');
    };
    $('#rNo', body).onclick = async () => {
      const c = ensureCustomer(); save();
      const link = await buildBookingLink(c);
      const text = `Hallo ${c.owner},\n\nder Termin am ${fmtDateLong(r.d)} um ${fmtTime(r.s)} Uhr ist leider schon vergeben. Hier sind die aktuell freien Zeiten:\n${link}\n\nViele Grüße\n${data.settings.name}`;
      openModal('Absage senden', sendButtons(c.phone, c.mail, 'Ihre Terminanfrage', text)); render();
    };
  });
}

/* =====================================================================
   KUNDEN-BEREICH (über QR-Code / Link, läuft auf dem Handy des Kunden)
   ===================================================================== */
async function renderCustomer(packed, live) {
  if ($('#tabs')) $('#tabs').style.display = 'none';
  $('#subtitle').textContent = 'Termin online buchen';
  let p;
  if (live) {
    // Live-Modus: aktuelle freie Zeiten direkt vom Server (QR-Code bleibt dauerhaft gültig)
    $('#app').innerHTML = '<div class="card">Freie Termine werden geladen …</div>';
    let info, pre = null;
    try { if (packed) pre = (await unpack(packed)).c || null; } catch (e) { pre = null; }
    try { info = await loadBookingInfo(); } catch (e) {
      console.warn(e);
      $('#app').innerHTML = `<div class="card"><h2>Keine Verbindung</h2><p>Die freien Termine konnten nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung.</p>
        <button onclick="location.reload()">Erneut versuchen</button></div>`; return; }
    if (!info.ok) { $('#app').innerHTML = `<div class="card">${esc(info.error)}</div>`; return; }
    const today = info.today, r5 = m => m / 5;
    p = { n: info.name, p: info.phone, m: info.mail, w: (info.work || []).map(x => x ? [r5(x[0]), r5(x[1])] : 0),
      r: info.raster || 30, h: info.minPerHorse || 45, b: info.buffer || 0, f: today.replace(/-/g, ''), d: info.horizonWeeks * 7,
      x: (info.blocked || []).filter(d => d >= today).map(d => dayDiff(today, d)),
      o: (info.busy || []).map(([d, s, e]) => [dayDiff(today, d), r5(s), r5(e)]), c: pre };
  } else {
    try { p = await unpack(packed); } catch (e) { $('#app').innerHTML = '<div class="card">Dieser Buchungslink ist leider beschädigt. Bitte fordern Sie einen neuen an.</div>'; return; }
  }
  $('#title').textContent = p.n ? `Termin bei ${p.n}` : 'Termin buchen';
  document.title = $('#title').textContent;
  const from = `${p.f.slice(0, 4)}-${p.f.slice(4, 6)}-${p.f.slice(6, 8)}`, to = addDays(from, p.d - 1);
  if (to < todayDs()) { $('#app').innerHTML = `<div class="card"><h2>Link abgelaufen</h2><p>Bitte fordern Sie bei ${esc(p.n)} einen aktuellen Buchungslink an.</p></div>`; return; }
  const initialBusy = {};
  for (const [off, s, e] of p.o || []) (initialBusy[addDays(from, off)] ||= []).push([s * 5, e * 5]);
  const makeAvail = busy => makeAvailability({ work: p.w.map(x => x ? [x[0] * 5, x[1] * 5] : null), raster: p.r, buffer: p.b,
    blocked: (p.x || []).map(o => addDays(from, o)), busy, from: from > todayDs() ? from : todayDs(), to });
  let avail = makeAvail(initialBusy);
  const pre = p.c || null;
  const guestKey = 'stalltermine-gast';
  const guest = pre ? {} : (JSON.parse(localStorage.getItem(guestKey) || '{}'));
  const st = { date: null, start: null, horses: pre ? [...(pre.h || [])] : [], count: pre && pre.h && pre.h.length ? pre.h.length : (guest.count || 1) };
  const duration = () => Math.max(1, st.count) * p.h;

  $('#app').innerHTML = `<div class="hero"><img src="apple-touch-icon.png" alt="Logo"><div style="margin-top:8px">Wählen Sie Ihren Wunschtermin – grün markierte Tage und Uhrzeiten sind frei.</div></div>
  <div class="steps">
    <div class="step"><div class="card"><b>Ihre Angaben</b>
      ${pre ? `<p class="small" style="margin:6px 0">${esc(pre.o)}${pre.s ? ' · ' + esc(pre.s) : ''}${pre.a ? '<br><span class="muted">' + esc(pre.a) + '</span>' : ''}</p>
        ${pre.h && pre.h.length ? '<div class="muted small">Welche Pferde?</div>' + pre.h.map(h => `<label class="chk"><input type="checkbox" checked value="${esc(h)}"> ${esc(h)}</label>`).join('') : `<label class="f">Anzahl Pferde <input id="gCount" type="number" min="1" value="${st.count}"></label>`}`
      : `<div class="grid2" style="margin-top:8px">
        <label class="f">Ihr Name * <input id="gOwner" autocomplete="name" value="${esc(guest.o || '')}"></label>
        <label class="f">Telefon (WhatsApp) * <input id="gPhone" type="tel" autocomplete="tel" value="${esc(guest.t || '')}"></label>
        <label class="f">Name des Stalls <input id="gStable" value="${esc(guest.s || '')}"></label>
        <label class="f">E-Mail <input id="gMail" type="email" autocomplete="email" value="${esc(guest.e || '')}"></label></div>
        <label class="f">Anschrift des Stalls * <input id="gAddr" autocomplete="street-address" value="${esc(guest.a || '')}"></label>
        <div class="grid2"><label class="f">Anzahl Pferde * <input id="gCount" type="number" min="1" value="${st.count}"></label>
        <label class="f">Namen der Pferde <input id="gHorses" placeholder="z. B. Luna, Max" value="${esc(guest.hn || '')}"></label></div>`}
      <div class="muted small">Geplante Dauer: <b id="gDur">${duration()}</b> Minuten</div></div></div>
    <div class="step"><div class="card"><b>Tag wählen</b> <span class="muted small">(grün = frei)</span><div id="gCal" style="margin-top:8px"></div></div></div>
    <div class="step"><div class="card"><b>Uhrzeit wählen</b><div id="gTimes" style="margin-top:8px"><p class="muted small">Bitte zuerst einen grünen Tag wählen.</p></div></div></div>
    <div class="step"><div class="card"><b>Verbindlich buchen</b>
      <label class="f" style="margin-top:8px">Nachricht (optional) <textarea id="gNote" placeholder="z. B. Pferd lahmt vorne links"></textarea></label>
      <div id="gSummary" class="muted small"></div>
      <div id="gSend" style="margin-top:10px"></div>
      <p class="muted small" style="margin-top:10px">${live ? 'Mit dem Buchen wird der Termin fest für Sie reserviert.' : `Mit dem Absenden wird Ihre Buchung an ${esc(p.n)} übermittelt.`} Sie erhalten anschließend eine Bestätigung.
      Ihre Angaben werden nur zur Terminvereinbarung verwendet.</p></div></div></div>`;

  const app = $('#app');
  const firstFree = (() => { for (let d = from > todayDs() ? from : todayDs(); d <= to; d = addDays(d, 1)) if (avail.starts(d, duration()).length) return d; return null; })();
  const cal = mountCalendar($('#gCal'), { isFree: d => avail.starts(d, duration()).length > 0, selected: null, startMonth: firstFree,
    onSelect: d => { st.date = d; st.start = null; showTimes(); update(); } });
  function showTimes() {
    if (!st.date) return;
    const starts = avail.starts(st.date, duration());
    if (!starts.includes(st.start)) st.start = null;
    $('#gTimes').innerHTML = `<div class="muted small" style="margin-bottom:6px">${fmtDateLong(st.date)}</div><div id="gTimeGrid"></div>`;
    mountTimes($('#gTimeGrid'), starts, duration(), st.start, t => { st.start = t; update(); });
  }
  function readGuest() {
    if (pre) return { i: pre.i, o: pre.o, s: pre.s, a: pre.a, t: pre.t, e: pre.e, h: st.horses, n: st.count };
    const v = id => ($('#' + id) || {}).value?.trim() || '';
    const hn = v('gHorses');
    return { o: v('gOwner'), t: v('gPhone'), s: v('gStable'), e: v('gMail'), a: v('gAddr'), n: st.count, hn,
      h: hn ? hn.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean) : [] };
  }
  function update() {
    $('#gDur').textContent = duration();
    const g = readGuest();
    const missing = [];
    if (!pre) { if (!g.o) missing.push('Name'); if (!g.t) missing.push('Telefon'); if (!g.a) missing.push('Anschrift des Stalls'); }
    if (st.count < 1) missing.push('mind. 1 Pferd');
    if (!st.date) missing.push('Tag'); if (st.start === null) missing.push('Uhrzeit');
    $('#gSummary').innerHTML = st.date && st.start !== null
      ? `<b style="color:var(--brand)">${fmtDateLong(st.date)}, ${fmtTime(st.start)} – ${fmtTime(st.start + duration())} Uhr</b>` : '';
    const send = $('#gSend');
    if (missing.length) { send.innerHTML = `<button class="primary big" disabled>Termin verbindlich buchen</button><p class="muted small">Es fehlt noch: ${missing.join(', ')}</p>`; return; }
    if (live) {
      send.innerHTML = '<button class="primary big" id="gBook">✅ Termin verbindlich buchen</button>';
      $('#gBook').onclick = async () => {
        const btn = $('#gBook'); btn.disabled = true; btn.textContent = 'Wird gebucht …';
        const g2 = readGuest(), note = $('#gNote').value.trim(), end = st.start + duration();
        if (!pre) localStorage.setItem(guestKey, JSON.stringify({ o: g2.o, t: g2.t, s: g2.s, e: g2.e, a: g2.a, hn: g2.hn, count: st.count }));
        let res;
        try { res = await bookSlot(st.date, st.start, end, { ...g2, hn: undefined }, note, p.b); }
        catch (e) { btn.disabled = false; btn.textContent = '✅ Termin verbindlich buchen'; alert('Keine Verbindung – bitte erneut versuchen.'); return; }
        if (!res.ok) {
          if (res.error === 'belegt') { alert('Diese Uhrzeit wurde gerade vergeben. Bitte wählen Sie eine andere.'); return renderCustomer(packed, true); }
          btn.disabled = false; btn.textContent = '✅ Termin verbindlich buchen'; alert(res.error); return;
        }
        const text = `Hallo, ich habe gerade online einen Termin gebucht:\n📅 ${fmtDateLong(st.date)}, ${fmtTime(st.start)} Uhr\n👤 ${g2.o}${g2.s ? ' (' + g2.s + ')' : ''}`;
        window.scrollTo(0, 0);
        $('#app').innerHTML = `<div class="card" style="text-align:center"><h2>Termin gebucht ✅</h2>
          <p><b>${fmtDateLong(st.date)}<br>${fmtTime(st.start)} – ${fmtTime(end)} Uhr</b></p>
          <p>Ihr Termin ist fest reserviert. ${esc(p.n)} meldet sich mit einer Bestätigung.</p>
          <div style="display:grid;gap:8px;margin:12px 0">${calendarButtons({ date: st.date, start: st.start, end, addr: g2.a, horses: g2.h, count: st.count }, p.n)}
          <a class="btn big" href="${esc(manageUrl(res.ms))}">✏️ Termin verwalten (stornieren / umbuchen)</a></div>
          <p class="small">Stornieren oder umbuchen können Sie bis ${CHANGE_LIMIT_H} Stunden vor dem Termin über
          <b>„Termin verwalten“</b>. Den Link finden Sie auch in der Bestätigung von ${esc(p.n)}.</p>
          ${p.p ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(p.p, text + '\n\nTermin verwalten: ' + manageUrl(res.ms)))}">Zusätzlich per WhatsApp Bescheid geben</a>` : ''}</div>`;
      };
      return;
    }
    send.innerHTML = `${p.p ? '<button class="wa big" id="gWa">✅ Verbindlich buchen per WhatsApp</button>' : ''}
      ${p.m ? `<button class="${p.p ? '' : 'primary '}big" id="gMailBtn" style="margin-top:8px">✅ Verbindlich buchen per E-Mail</button>` : ''}`;
    const go = async via => {
      const g2 = readGuest();
      if (!pre) localStorage.setItem(guestKey, JSON.stringify({ o: g2.o, t: g2.t, s: g2.s, e: g2.e, a: g2.a, hn: g2.hn, count: st.count }));
      const req = { v: 1, q: uid(), d: st.date, s: st.start, e: st.start + duration(), c: { ...g2, hn: undefined }, k: $('#gNote').value.trim() };
      const link = ownerUrl() + '#r=' + await pack(req);
      const text = `Verbindliche Terminbuchung
📅 ${fmtDateLong(st.date)}, ${fmtTime(st.start)}–${fmtTime(req.e)} Uhr
👤 ${g2.o}${g2.s ? ' (' + g2.s + ')' : ''}
📍 ${g2.a || ''}
🐴 ${g2.h.length ? g2.h.join(', ') : st.count + ' Pferd(e)'}${req.k ? '\n💬 ' + req.k : ''}

In den Kalender übernehmen:
${link}`;
      if (via === 'wa') location.href = waLink(p.p, text); else location.href = mailLink(p.m, `Terminbuchung ${fmtDate(st.date)} ${fmtTime(st.start)}`, text);
      setTimeout(() => {
        $('#app').innerHTML = `<div class="card" style="text-align:center"><h2>Fast geschafft ✅</h2>
          <p>Bitte senden Sie die vorbereitete ${via === 'wa' ? 'WhatsApp-Nachricht' : 'E-Mail'} ab.</p>
          <p><b>${fmtDateLong(st.date)}<br>${fmtTime(st.start)} – ${fmtTime(req.e)} Uhr</b></p>
          <p class="muted small">Sie erhalten eine Bestätigung von ${esc(p.n)}.</p>
          <button onclick="location.reload()">Zurück</button></div>`;
      }, 600);
    };
    if ($('#gWa')) $('#gWa').onclick = () => go('wa');
    if ($('#gMailBtn')) $('#gMailBtn').onclick = () => go('mail');
  }
  app.addEventListener('input', e => {
    if (e.target.id === 'gCount') { st.count = Math.max(1, Number(e.target.value) || 1); cal.refresh(); showTimes(); }
    update();
  });
  app.addEventListener('change', e => {
    if (e.target.type === 'checkbox') { st.horses = $$('.chk input:checked', app).map(i => i.value); st.count = st.horses.length; cal.refresh(); showTimes(); update(); }
  });
  if (!firstFree) $('#gCal').insertAdjacentHTML('beforeend', '<p class="muted small">Im angebotenen Zeitraum ist leider nichts mehr frei.</p>');
  // Live: bucht jemand anderes, verschwindet die Zeit sofort (nicht mehr grün, nicht mehr wählbar)
  if (live && CLOUD) {
    const { fs, db } = await fb();
    const q = fs.query(fs.collection(db, 'busy'), fs.where(fs.documentId(), '>=', todayDs()), fs.where(fs.documentId(), '<=', to));
    const unsub = fs.onSnapshot(q, snap => {
      if (!$('#gCal')) return unsub();                     // Seite schon weiter (z. B. gebucht)
      const busy = {};
      snap.forEach(d => (d.data().iv || []).forEach(k => { const [a, b] = k.split('-').map(Number); (busy[d.id] ||= []).push([a, b]); }));
      avail = makeAvail(busy);
      const hadTime = st.start;
      cal.refresh(); showTimes();
      if (hadTime !== null && st.start === null) {
        $('#gTimes').insertAdjacentHTML('afterbegin', '<div class="banner">⚠️ Die gewählte Uhrzeit wurde soeben vergeben – bitte wählen Sie eine andere.</div>');
      }
      update();
    }, e => console.warn('Live-Aktualisierung:', e));
  }
  update();
}

/* =====================================================================
   Start
   ===================================================================== */
let mode = PAGE === 'verwaltung' ? 'owner' : 'customer';
async function boot() {
  const h = location.hash;
  if (PAGE === 'impressum' || PAGE === 'datenschutz') return renderLegal(PAGE);
  if (PAGE === 'karte' || PAGE === 'kunde') {
    // Anfrage-Links gehören in die Verwaltung (auch alte Links, die noch auf die Hauptadresse zeigen)
    if (h.startsWith('#r=')) return location.replace(ownerUrl() + h);
  }
  if (PAGE === 'karte') {
    if (h.startsWith('#b=') || h.startsWith('#live') || h.startsWith('#t=')) return location.replace(customerUrl() + h);   // Buchungs-/Verwalten-Links
    // Altes Home-Bildschirm-Symbol der Betreiberin zeigt auf die Hauptadresse → Verwaltung öffnen
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (!h && standalone && (localStorage.getItem(KEY + '-auth') || (loadJSON(KEY, {}).customers || []).length)) return location.replace(ownerUrl());
    return renderKarte();
  }
  if (PAGE === 'kunde') {
    if (h.startsWith('#t=')) return CLOUD ? renderManage(h.slice(3)) : renderNoBooking();
    if (h.startsWith('#b=')) return renderCustomer(h.slice(3));
    if (h.startsWith('#live=')) return CLOUD ? renderCustomer(h.slice(6), true) : renderNoBooking();
    return CLOUD ? renderCustomer('', true) : renderNoBooking();
  }
  // Verwaltung: Kunden-Links gehören auf die Buchungsseite
  if (h.startsWith('#b=') || h.startsWith('#live') || h.startsWith('#t=')) return location.replace(customerUrl() + h);
  render();
  if (CLOUD) {
    try { await fb(); } catch (e) { cloud.ready = true; $('#app').innerHTML = '<div class="card">Verbindung zum Online-Speicher nicht möglich. Bitte Seite neu laden.</div>'; return; }
    FB.authM.onAuthStateChanged(FB.auth, user => {
      cloud.user = user; cloud.ready = true;
      if (user) startSync(structuredClone(data)); else { unsubs.forEach(u => u()); unsubs = []; shadow = null; }
      render();
    });
  }
  if (h.startsWith('#r=')) { const packed = h.slice(3); history.replaceState(null, '', ownerUrl()); await handleRequest(packed); }
}

/* ---------- Kundenseite ↔ Firestore ---------- */
async function loadBookingInfo() {
  const { fs, db } = await fb();
  const pi = await fs.getDoc(fs.doc(db, 'public', 'info'));
  if (!pi.exists()) return { ok: false, error: 'Online-Buchung ist noch nicht eingerichtet.' };
  const i = pi.data(), today = todayDs(), to = addDays(today, (i.horizonWeeks || 8) * 7);
  const q = fs.query(fs.collection(db, 'busy'), fs.where(fs.documentId(), '>=', today), fs.where(fs.documentId(), '<=', to));
  const busy = [];
  (await fs.getDocs(q)).forEach(d => (d.data().iv || []).forEach(k => { const [a, b] = k.split('-').map(Number); busy.push([d.id, a, b]); }));
  return { ok: true, today, name: i.name, phone: i.phone, mail: i.mail, work: (i.work || []).map(w => w ? [w.s, w.e] : null),
    raster: i.raster, minPerHorse: i.minPerHorse, buffer: i.buffer, horizonWeeks: i.horizonWeeks || 8, blocked: i.blocked || [], busy };
}
/* Buchen als Transaktion: Tag lesen, auf Überschneidung prüfen, Termin + Belegt-Eintrag gemeinsam schreiben.
   Buchen zwei Kunden gleichzeitig, wiederholt Firestore die Prüfung → der zweite bekommt „belegt“. */
async function bookSlot(date, start, end, cust, note, buffer) {
  const { fs, db } = await fb();
  const id = 'k' + uid(), ms = newSecret();
  const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
  const request = clean({ i: cust.i, o: String(cust.o || '').slice(0, 100), s: cust.s, a: cust.a, t: String(cust.t || '').slice(0, 40), e: cust.e,
    h: (cust.h || []).slice(0, 20), n: cust.n });
  // Bei gleichzeitigen Buchungen lehnt Firestore die zweite ab → mit frischem Stand erneut prüfen
  for (let attempt = 0; ; attempt++) try {
    await fs.runTransaction(db, async tx => {
      const ref = fs.doc(db, 'busy', date), snap = await tx.get(ref);
      const iv = snap.exists() ? (snap.data().iv || []) : [];
      const clash = iv.some(k => { const [a, b] = k.split('-').map(Number); return start < b + buffer && end + buffer > a; });
      if (clash) throw new Error('belegt');
      tx.set(fs.doc(db, 'appts', id), { id, customerId: cust.i || null, date, start, end, horses: request.h || [], count: Math.max(1, Number(cust.n) || (request.h || []).length || 1),
        note: String(note || '').slice(0, 1000), source: 'kunde', status: 'neu', request, created: new Date().toISOString(),
        ms, startAt: apptStartDate({ date, start }) });
      tx.set(ref, { iv: [...iv, `${start}-${end}-${id}`] });
      tx.set(fs.doc(db, 'manage', ms), { apptId: id, date, start, end, horses: request.h || [], count: Math.max(1, Number(cust.n) || (request.h || []).length || 1),
        name: request.o, stable: request.s || '', addr: request.a || '', status: 'neu' });
    });
    return { ok: true, id, ms };
  } catch (e) {
    if (e.message === 'belegt') return { ok: false, error: 'belegt' };
    if (attempt >= 2) throw e;
    await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
  }
}

/* ---------- Kalendereintrag mit Erinnerung 1 Tag und 2 Stunden vorher ---------- */
function icsFor(t, ownerName) {
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const e = v => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const st = apptStartDate(t), en = apptStartDate({ date: t.date, start: t.end });
  const horses = t.horses && t.horses.length ? t.horses.join(', ') : `${t.count || 1} Pferd(e)`;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Franzis Hufpflege//Termin//DE', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${t.date}-${t.start}-${Math.random().toString(36).slice(2)}@hufpflege`, `DTSTAMP:${z(new Date())}`,
    `DTSTART:${z(st)}`, `DTEND:${z(en)}`, `SUMMARY:${e('Hufpflege – ' + (ownerName || ''))}`,
    t.addr ? `LOCATION:${e(t.addr)}` : '', `DESCRIPTION:${e('Pferde: ' + horses)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Hufpflege morgen', 'TRIGGER:-P1D', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Hufpflege in 2 Stunden', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n') + '\r\n';
}
function googleCalUrl(t, ownerName) {
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const horses = t.horses && t.horses.length ? t.horses.join(', ') : `${t.count || 1} Pferd(e)`;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Hufpflege – ' + (ownerName || '')) +
    '&dates=' + z(apptStartDate(t)) + '/' + z(apptStartDate({ date: t.date, start: t.end })) +
    '&details=' + encodeURIComponent('Pferde: ' + horses) + (t.addr ? '&location=' + encodeURIComponent(t.addr) : '');
}
let lastCal = null;
function calendarButtons(t, ownerName) {
  lastCal = { t, ownerName };
  return `<button class="btn big primary" type="button" onclick="downloadIcs()">📅 In meinen Kalender (mit Erinnerung)</button>
    <a class="btn big" target="_blank" rel="noopener" href="${esc(googleCalUrl(t, ownerName))}">📅 Google Kalender</a>`;
}
function downloadIcs() {
  if (!lastCal) return;
  const blob = new Blob([icsFor(lastCal.t, lastCal.ownerName)], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Hufpflege-Termin.ics';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- „Termin verwalten“: Kunde sieht, storniert oder bucht um (bis 3 Std. vorher) ---------- */
async function renderManage(secret) {
  if ($('#tabs')) $('#tabs').style.display = 'none';
  $('#subtitle').textContent = 'Ihr Termin';
  $('#app').innerHTML = '<div class="card">Termin wird geladen …</div>';
  let info, m;
  try {
    const { fs, db } = await fb();
    const snap = await fs.getDoc(fs.doc(db, 'manage', secret));
    if (!snap.exists()) { $('#app').innerHTML = '<div class="card"><h2>Termin nicht gefunden</h2><p>Dieser Link ist ungültig oder abgelaufen.</p></div>'; return; }
    m = snap.data();
    info = await loadBookingInfo();
  } catch (e) { console.warn(e); $('#app').innerHTML = '<div class="card"><h2>Keine Verbindung</h2><p>Bitte prüfen Sie Ihre Internetverbindung.</p><button onclick="location.reload()">Erneut versuchen</button></div>'; return; }
  const owner = (info && info.ok && info.name) || "Franzi's Hufpflege", phone = info && info.phone;
  $('#title').textContent = owner;
  const startD = apptStartDate(m), deadline = new Date(startD.getTime() - CHANGE_LIMIT_H * 3600e3);
  const canChange = !['storniert', 'abgesagt'].includes(m.status) && new Date() < deadline;
  const horses = m.horses && m.horses.length ? m.horses.join(', ') : `${m.count || 1} Pferd(e)`;
  const statusTxt = m.status === 'storniert' ? '<div class="banner">❌ Dieser Termin wurde storniert.</div>'
    : m.status === 'abgesagt' ? `<div class="banner">❌ Dieser Termin wurde von ${esc(owner)} abgesagt.</div>`
    : m.status === 'neu' ? '<span class="pill green">gebucht – Bestätigung folgt</span>' : '<span class="pill green">bestätigt</span>';
  $('#app').innerHTML = `<div class="hero"><img src="apple-touch-icon.png" alt="Logo"></div>
    <div class="card"><h2>Ihr Termin</h2>${statusTxt}
      <p style="font-size:18px;margin:10px 0"><b>${fmtDateLong(m.date)}</b><br>${fmtTime(m.start)} – ${fmtTime(m.end)} Uhr</p>
      <div class="small">🐴 ${esc(horses)}${m.name ? '<br>👤 ' + esc(m.name) : ''}${m.stable ? ' · ' + esc(m.stable) : ''}${m.addr ? '<br>📍 ' + esc(m.addr) : ''}</div></div>
    ${!['storniert', 'abgesagt'].includes(m.status) ? `<div class="card" style="display:grid;gap:8px">${calendarButtons(m, owner)}</div>` : ''}
    ${canChange ? `<div class="card"><b>Etwas dazwischengekommen?</b>
        <p class="muted small" style="margin:4px 0 10px">Möglich bis ${fmtDate(ds(deadline))}, ${fmtTime(deadline.getHours() * 60 + deadline.getMinutes())} Uhr (${CHANGE_LIMIT_H} Stunden vorher).</p>
        <div style="display:grid;gap:8px"><button class="big primary" id="mRebook">🔄 Termin umbuchen</button>
        <button class="big danger" id="mCancel">❌ Termin stornieren</button></div></div><div id="mRebookArea"></div>`
      : !['storniert', 'abgesagt'].includes(m.status) ? `<div class="card small">Stornieren oder Umbuchen ist nur bis ${CHANGE_LIMIT_H} Stunden vor dem Termin online möglich.
        Bitte melden Sie sich direkt bei ${esc(owner)}.${phone ? `<div style="margin-top:8px"><a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(phone, `Hallo, zu meinem Termin am ${fmtDateLong(m.date)} um ${fmtTime(m.start)} Uhr: `))}">💬 WhatsApp</a></div>` : ''}</div>` : ''}
`;
  if (!canChange) return;
  $('#mCancel').onclick = async () => {
    if (!confirm(`Termin am ${fmtDateLong(m.date)} um ${fmtTime(m.start)} Uhr wirklich stornieren?`)) return;
    try { await customerChange(secret, m, null); }
    catch (e) { console.warn(e); alert('Stornieren hat nicht geklappt. Bitte erneut versuchen' + (new Date() >= deadline ? ' – die Frist ist inzwischen abgelaufen.' : '.')); return renderManage(secret); }
    $('#app').innerHTML = `<div class="card" style="text-align:center"><h2>Termin storniert</h2><p>Ihr Termin am ${fmtDateLong(m.date)} um ${fmtTime(m.start)} Uhr wurde storniert.
      ${esc(owner)} sieht das sofort.</p><a class="btn big primary" href="${esc(customerUrl() + '#live')}">Neuen Termin buchen</a></div>`;
  };
  $('#mRebook').onclick = () => {
    $('#mRebook').disabled = true;
    const dur = m.end - m.start, from = todayDs(), to = addDays(from, info.horizonWeeks * 7);
    const ownKey = `${m.start}-${m.end}-${m.apptId}`;
    let busy = {};
    const rebuild = list => { busy = {}; for (const [d, a, b, k] of list) if (k !== ownKey) (busy[d] ||= []).push([a, b]); };
    rebuild(info.busy.map(([d, a, b]) => [d, a, b, `${a}-${b}-?`]));
    // eigene Zeit nicht als belegt zählen
    if (busy[m.date]) busy[m.date] = busy[m.date].filter(([a, b]) => !(a === m.start && b === m.end));
    let avail = makeAvailability({ work: info.work, raster: info.raster, buffer: info.buffer, blocked: info.blocked, busy, from, to });
    const st = { date: null, start: null };
    $('#mRebookArea').innerHTML = `<div class="card"><b>Neuen Tag wählen</b> <span class="muted small">(grün = frei)</span><div id="rbCal" style="margin-top:8px"></div></div>
      <div class="card"><b>Neue Uhrzeit</b><div id="rbTimes" class="muted small" style="margin-top:8px">Bitte zuerst einen grünen Tag wählen.</div></div>
      <div class="card"><button class="big primary" id="rbGo" disabled>Auf neuen Termin umbuchen</button></div>`;
    const cal = mountCalendar($('#rbCal'), { isFree: d => avail.starts(d, dur).length > 0, selected: null, startMonth: m.date,
      onSelect: d => { st.date = d; st.start = null; showT(); } });
    const showT = () => { if (!st.date) return; const starts = avail.starts(st.date, dur).filter(t => !(st.date === m.date && t === m.start));
      if (!starts.includes(st.start)) st.start = null;
      mountTimes($('#rbTimes'), starts, dur, st.start, t => { st.start = t; $('#rbGo').disabled = false; });
      $('#rbGo').disabled = st.start === null; };
    // Live: Zeiten, die andere gerade buchen, verschwinden sofort
    fb().then(({ fs, db }) => {
      const q = fs.query(fs.collection(db, 'busy'), fs.where(fs.documentId(), '>=', from), fs.where(fs.documentId(), '<=', to));
      const unsub = fs.onSnapshot(q, snap => {
        if (!$('#rbCal')) return unsub();
        const list = []; snap.forEach(d => (d.data().iv || []).forEach(k => { const [a, b] = k.split('-').map(Number); list.push([d.id, a, b, k]); }));
        rebuild(list);
        avail = makeAvailability({ work: info.work, raster: info.raster, buffer: info.buffer, blocked: info.blocked, busy, from, to });
        cal.refresh(); showT();
      });
    });
    $('#mRebookArea').scrollIntoView({ behavior: 'smooth' });
    $('#rbGo').onclick = async () => {
      const btn = $('#rbGo'); btn.disabled = true; btn.textContent = 'Wird umgebucht …';
      let res;
      try { res = await customerChange(secret, m, { date: st.date, start: st.start, end: st.start + dur }, info.buffer); }
      catch (e) { console.warn(e); alert('Umbuchen hat nicht geklappt. Bitte erneut versuchen.'); return renderManage(secret); }
      if (res === 'belegt') { alert('Diese Uhrzeit wurde gerade vergeben. Bitte wählen Sie eine andere.'); btn.textContent = 'Auf neuen Termin umbuchen'; st.start = null; showT(); return; }
      renderManage(secret).then(() => toast('Termin umgebucht'));
    };
  };
}
/* Stornieren (neu = null) oder Umbuchen – als Transaktion: Termin, Belegt-Zeiten und Verwalten-Seite gemeinsam */
async function customerChange(secret, m, neu, buffer = 0) {
  const { fs, db } = await fb();
  const id = m.apptId, oldKey = `${m.start}-${m.end}-${id}`, ccAt = new Date().toISOString();
  for (let attempt = 0; ; attempt++) try {
    let result = 'ok';
    await fs.runTransaction(db, async tx => {
      const mRef = fs.doc(db, 'manage', secret), cur = (await tx.get(mRef)).data();
      const curKey = `${cur.start}-${cur.end}-${id}`;
      const oldRef = fs.doc(db, 'busy', cur.date), oldIv = ((await tx.get(oldRef)).data() || {}).iv || [];
      if (!neu) {
        tx.update(fs.doc(db, 'appts', id), { status: 'storniert', proof: secret, cc: 'storniert', ccAt });
        tx.set(oldRef, { iv: oldIv.filter(k => k !== curKey) });
        tx.update(mRef, { status: 'storniert' });
        return;
      }
      const newKey = `${neu.start}-${neu.end}-${id}`, same = neu.date === cur.date;
      const newRef = fs.doc(db, 'busy', neu.date);
      const newIv = same ? oldIv : (((await tx.get(newRef)).data() || {}).iv || []);
      const clash = newIv.some(k => k !== curKey && (() => { const [a, b] = k.split('-').map(Number); return neu.start < b + buffer && neu.end + buffer > a; })());
      if (clash) { result = 'belegt'; return; }
      tx.update(fs.doc(db, 'appts', id), { date: neu.date, start: neu.start, end: neu.end, startAt: apptStartDate(neu),
        proof: secret, cc: 'umgebucht', ccAt, prev: `${fmtDate(cur.date)} ${fmtTime(cur.start)}` });
      if (same) tx.set(oldRef, { iv: [...oldIv.filter(k => k !== curKey), newKey] });
      else { tx.set(oldRef, { iv: oldIv.filter(k => k !== curKey) }); tx.set(newRef, { iv: [...newIv, newKey] }); }
      tx.update(mRef, { date: neu.date, start: neu.start, end: neu.end });
    });
    return result;
  } catch (e) {
    if (attempt >= 2) throw e;
    await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
  }
}

/* =====================================================================
   VISITENKARTEN-SEITE (Hauptadresse, Ziel des gedruckten QR-Codes)
   ===================================================================== */
const kWa = () => K.whatsapp || K.telefon;
const kAddr = () => [K.strasse, [K.plz, K.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const legalFooter = () => `<p class="footer-links"><a href="impressum.html">Impressum</a> · <a href="datenschutz.html">Datenschutz</a></p>`;
function renderKarte() {
  document.title = K.firma || "Franzi's Hufpflege";
  const tel = K.telefon ? 'tel:' + K.telefon.replace(/[^\d+]/g, '') : '';
  const btn = (href, icon, label, cls = '', attrs = '') => href ? `<a class="btn big kbtn ${cls}" href="${esc(href)}" ${attrs}><span>${icon}</span>${label}</a>` : '';
  $('#app').innerHTML = `
    <div class="hero karte-hero"><img src="apple-touch-icon.png" alt="Logo ${esc(K.firma)}">
      <h1 class="karte-name">${esc(K.firma || "Franzi's Hufpflege")}</h1>
      ${K.inhaberin ? `<div class="karte-sub">${esc(K.inhaberin)}</div>` : ''}
      ${K.beruf ? `<div class="karte-sub" style="opacity:.8">${esc(K.beruf)}</div>` : ''}</div>
    <div class="karte-buttons">
      ${CLOUD ? btn('buchen.html', '📅', 'Termin buchen', 'primary')
        : (kWa() ? btn(waLink(kWa(), 'Hallo, ich hätte gerne einen Termin zur Hufbearbeitung.'), '📅', 'Termin anfragen', 'primary', 'target="_blank" rel="noopener"') : '')}
      ${btn(tel, '📞', 'Anrufen')}
      ${btn(kWa() ? waLink(kWa(), '') : '', '💬', 'WhatsApp', 'wa', 'target="_blank" rel="noopener"')}
      ${btn(K.email ? 'mailto:' + K.email : '', '✉️', 'E-Mail schreiben')}
      <button class="btn big kbtn" id="vcf"><span>👤</span>Kontakt speichern</button>
    </div>
    ${(K.leistungen || []).length ? `<div class="card"><b>Leistungen</b><ul class="kliste">${K.leistungen.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
    ${K.einzugsgebiet || K.erreichbarkeit || kAddr() ? `<div class="card small">
      ${K.einzugsgebiet ? `<div><b>🚗 Einsatzgebiet:</b> ${esc(K.einzugsgebiet)}</div>` : ''}
      ${K.erreichbarkeit ? `<div style="margin-top:4px"><b>🕐 Erreichbar:</b> ${esc(K.erreichbarkeit)}</div>` : ''}
      ${kAddr() ? `<div style="margin-top:4px"><b>📍</b> ${esc(kAddr())}</div>` : ''}</div>` : ''}
    ${K.instagram || K.facebook ? `<div class="row" style="justify-content:center">
      ${K.instagram ? `<a class="btn" target="_blank" rel="noopener" href="${esc(K.instagram)}">Instagram</a>` : ''}
      ${K.facebook ? `<a class="btn" target="_blank" rel="noopener" href="${esc(K.facebook)}">Facebook</a>` : ''}</div>` : ''}
    ${legalFooter()}`;
  $('#vcf').onclick = saveVCard;
}
async function saveVCard() {
  const e = v => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const [vor, ...rest] = (K.inhaberin || '').split(' ');
  let photo = '';
  try { const b = await (await fetch('apple-touch-icon.png')).blob(); photo = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(b); }); } catch (err) { photo = ''; }
  const lines = ['BEGIN:VCARD', 'VERSION:3.0',
    K.inhaberin ? `N:${e(rest.join(' '))};${e(vor)};;;` : `N:;;;;`, `FN:${e(K.inhaberin || K.firma)}`, `ORG:${e(K.firma)}`,
    K.beruf ? `TITLE:${e(K.beruf)}` : '', K.telefon ? `TEL;TYPE=CELL,VOICE:${K.telefon}` : '',
    K.email ? `EMAIL;TYPE=INTERNET:${K.email}` : '',
    kAddr() ? `ADR;TYPE=WORK:;;${e(K.strasse)};${e(K.ort)};;${e(K.plz)};Deutschland` : '',
    `URL:${cardUrl()}`, K.erreichbarkeit ? `NOTE:${e('Erreichbar: ' + K.erreichbarkeit)}` : '',
    photo ? `PHOTO;ENCODING=b;TYPE=PNG:${photo}` : '', 'END:VCARD'].filter(Boolean);
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/vcard' });
  const name = (K.firma || 'Kontakt').replace(/[^\wäöüÄÖÜß-]+/g, '-') + '.vcf';
  const file = new File([blob], name, { type: 'text/vcard' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (err) { /* abgebrochen → Download */ } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- Impressum & Datenschutz (Inhalte aus kontakt.js) ---------- */
function renderLegal(which) {
  const fehlt = '<span style="color:var(--danger)">[bitte in kontakt.js eintragen]</span>';
  const v = x => x ? esc(x) : fehlt;
  const wer = `${v(K.inhaberin)}<br>${esc(K.firma || '')}<br>${v(K.strasse)}<br>${K.plz || K.ort ? esc(K.plz + ' ' + K.ort) : fehlt}`;
  const kontakt = `Telefon: ${v(K.telefon)}<br>E-Mail: ${v(K.email)}`;
  const html = which === 'impressum' ? `<h2>Impressum</h2>
      <h3>Angaben gemäß § 5 DDG</h3><p>${wer}</p><h3>Kontakt</h3><p>${kontakt}</p>
      ${K.ustId ? `<h3>Umsatzsteuer-ID</h3><p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: ${esc(K.ustId)}</p>` : ''}
      <h3>Verbraucherstreitbeilegung</h3><p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>`
    : `<h2>Datenschutzerklärung</h2>
      <div class="banner">Entwurf – bitte vor dem Druck der Visitenkarten prüfen bzw. mit einem Datenschutz-Generator abgleichen.</div>
      <h3>1. Verantwortliche</h3><p>${wer}<br>${kontakt}</p>
      <h3>2. Bereitstellung der Webseite</h3><p>Diese Seite wird über GitHub Pages (GitHub Inc., USA) bereitgestellt. Beim Aufruf verarbeitet der Anbieter technisch notwendige Daten
      wie IP-Adresse, Zeitpunkt und aufgerufene Seite, um die Seite auszuliefern und abzusichern (Art. 6 Abs. 1 lit. f DSGVO).
      GitHub ist unter dem EU-US Data Privacy Framework zertifiziert.</p>
      <h3>3. Online-Terminbuchung</h3><p>Wenn Sie einen Termin buchen, verarbeiten wir Name, Telefonnummer, ggf. E-Mail, Name und Anschrift des Stalls,
      Anzahl und Namen der Pferde, gewünschten Termin und Ihre Nachricht. Zweck ist die Vereinbarung und Durchführung des Termins (Art. 6 Abs. 1 lit. b DSGVO).
      ${CLOUD ? 'Die Daten werden in Google Firebase (Google Ireland Ltd.) auf Servern in Frankfurt am Main (EU) gespeichert; mit dem Anbieter besteht ein Vertrag zur Auftragsverarbeitung.' : 'Die Buchung wird per WhatsApp oder E-Mail an uns übermittelt.'}
      Damit Sie Ihre Angaben nicht erneut eintippen müssen, werden sie zusätzlich nur in Ihrem eigenen Browser gespeichert (lokaler Speicher); Sie können sie über die Browser-Einstellungen löschen.</p>
      <h3>4. Kontakt per Telefon, E-Mail oder WhatsApp</h3><p>Wenn Sie uns kontaktieren, verarbeiten wir Ihre Angaben zur Bearbeitung der Anfrage (Art. 6 Abs. 1 lit. b bzw. f DSGVO).
      Bei WhatsApp gelten zusätzlich die Datenschutzbestimmungen von WhatsApp (Meta Platforms Ireland Ltd.).</p>
      <h3>5. Speicherdauer</h3><p>Wir speichern Kunden- und Termindaten, solange die Geschäftsbeziehung besteht, und darüber hinaus nur, soweit gesetzliche Aufbewahrungspflichten
      (z. B. für Rechnungen) bestehen.</p>
      <h3>6. Ihre Rechte</h3><p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch.
      Wenden Sie sich dazu an die oben genannte Kontaktadresse. Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren.</p>
      <h3>7. Cookies und Tracking</h3><p>Diese Seite verwendet keine Cookies zu Werbe- oder Analysezwecken und kein Tracking.</p>`;
  $('#app').innerHTML = `<div class="card legal">${html}</div><p class="footer-links"><a href="./">← Zurück</a></p>`;
}

function renderNoBooking() {
  $('#subtitle').textContent = 'Termin online buchen';
  $('#app').innerHTML = `<div class="hero"><img src="apple-touch-icon.png" alt="Logo"></div>
    <div class="card" style="text-align:center"><h2>Termin buchen</h2>
    <p>Bitte öffnen Sie den Buchungslink, den Sie erhalten haben${kWa() ? ', oder fragen Sie per WhatsApp an' : ''}.</p>
    ${kWa() ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(kWa(), 'Hallo, ich hätte gerne einen Termin.'))}">💬 Termin per WhatsApp anfragen</a>` : ''}</div>
    <p class="footer-links"><a href="./">← Zur Visitenkarte</a></p>${legalFooter()}`;
}
window.addEventListener('hashchange', () => location.reload());
boot();
