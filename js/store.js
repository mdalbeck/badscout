// Datenschicht: komplett getrennt von der Oberfläche (Aufbau wie in BadTeam und BadPlan).
// Speichert alles automatisch in IndexedDB, bietet Export/Import (JSON); der Dropbox-Abgleich (sync.js) hängt sich hier an.

const DB_NAME = 'badscout';
const STORE = 'kv';
export const FORMAT = 'badscout';
export const VERSION = 1;

/* ---------- Datenmodell ----------
 * games      Analysierte Spiele
 *   { id, day: 'JJJJ-MM-TT', event: 'Turnier / Anlass',
 *     kind: 'single' | 'double', scoring: 21 | 15,
 *     ours: [Spieler-ID aus BadTeam], names: { Spieler-ID: Name }   (Namen gemerkt, falls BadTeam gerade nicht erreichbar ist)
 *     opp: ['Name des Gegners', …],
 *     video: null
 *       | { kind: 'yt', ytId, title }                                            YouTube
 *       | { kind: 'file', id, title, fileName, size, mime, duration, thumb, dbx, from }   eigene Datei
 *         (dbx: liegt in Dropbox › Apps › Bad Apps › badscout-videos/<id>; from: 'badclip', wenn aus BadClip übernommen)
 *     rallies: [{ id, t0, t1 (Start/Ende in Sekunden), win: 'us' | 'them', type: Art-ID, shot: Schlagart | '', by: Spieler-ID | 'o0' | 'o1' | '' }]
 *       (by: wer den Punkt gemacht hat – beim Winner die Gewinnerseite, beim Fehler die Seite, die den Fehler gemacht hat)
 *     notes: [{ id, t, text }]
 *     done: false, createdAt, updatedAt }
 * settings   Einstellungen fürs Markieren (für alle Spiele): { types: [{ id, name, kind: 'win' | 'err' }], shots: ['…'], notePause, updatedAt }
 * deleted    Gelöschtes: { id: Zeitpunkt } – damit Löschungen beim Abgleich zwischen Geräten nicht wieder auftauchen
 */

const LISTS = ['games'];
const empty = () => ({ games: [], settings: defaultSettings(), deleted: {} });

// Grundausstattung der Markier-Knöpfe (Namen leer = Text aus i18n)
export const DEFAULT_TYPES = [
  { id: 'winner', name: '', kind: 'win' },
  { id: 'net', name: '', kind: 'err' },
  { id: 'out', name: '', kind: 'err' },
  { id: 'forced', name: '', kind: 'err' },
];
export const DEFAULT_SHOTS = ['serve', 'clear', 'drop', 'smash', 'drive', 'net', 'lift', 'defence'];
export const MAX_TYPES = 5;
function defaultSettings() { return { types: DEFAULT_TYPES.map((x) => ({ ...x })), shots: [...DEFAULT_SHOTS], notePause: false, updatedAt: 0 }; }
function cleanSettings(x) {
  const d = defaultSettings();
  if (!x || typeof x !== 'object') return d;
  const types = (Array.isArray(x.types) ? x.types : []).filter((y) => y?.id).slice(0, MAX_TYPES)
    .map((y) => ({ id: String(y.id), name: str(y.name), kind: y.kind === 'win' ? 'win' : 'err' }));
  const shots = (Array.isArray(x.shots) ? x.shots : []).map(str).filter(Boolean).slice(0, 9);
  return { types: types.length ? types : d.types, shots: Array.isArray(x.shots) ? shots : d.shots, notePause: !!x.notePause, updatedAt: x.updatedAt || 0 };
}
const TOMB_DAYS = 120; // so lange merkt sich die App Löschungen

export const S = {
  data: empty(),
  meta: { created: 0, lastExport: 0, lastChange: 0, showKeys: true, lastSync: 0, syncVersion: 0 },
  volatile: false, // true = Speicher im Browser nicht verfügbar
};

let db = null;
let timer = null;
const subs = new Set();
const savedSubs = new Set();
/** Wird nach jedem Speichern aufgerufen (der Cloud-Abgleich hängt sich hier an). */
export const onSaved = (fn) => savedSubs.add(fn);

// ---------- Freie Schlüssel im Browser-Speicher (z. B. Dropbox-Anmeldung) ----------
export async function getKey(k) { if (!db) return null; try { return (await kvGet(`key:${k}`)) ?? null; } catch { return null; } }
export async function setKey(k, v) { if (db) await kvPut([[`key:${k}`, v]]); }

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const kvGet = (k) => req(db.transaction(STORE).objectStore(STORE).get(k));
function kvPut(pairs) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const [k, v] of pairs) tx.objectStore(STORE).put(v, k);
    tx.oncomplete = res;
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}

function str(v) { return String(v ?? '').trim(); }
const num = (v) => (Number.isFinite(+v) ? Math.max(0, Math.round(+v * 100) / 100) : 0);
const cleanRally = (r) => ({ id: r.id, t0: num(r.t0), t1: num(r.t1), win: r.win === 'them' ? 'them' : 'us', type: String(r.type || ''), shot: str(r.shot), by: str(r.by) });
const cleanNote = (n) => ({ id: n.id, t: num(n.t), text: str(n.text) });
const cleanGame = (x) => ({
  day: /^\d{4}-\d{2}-\d{2}$/.test(x.day || '') ? x.day : todayIso(),
  event: str(x.event),
  kind: x.kind === 'double' ? 'double' : 'single',
  scoring: Number(x.scoring) === 15 ? 15 : 21,
  ours: [...new Set(Array.isArray(x.ours) ? x.ours.filter(Boolean) : [])],
  names: x.names && typeof x.names === 'object' ? { ...x.names } : {},
  opp: (Array.isArray(x.opp) ? x.opp : []).map(str),
  video: x.video && typeof x.video === 'object' ? x.video : null,
  rallies: (Array.isArray(x.rallies) ? x.rallies : []).filter((r) => r?.id).map(cleanRally).sort((a, b) => a.t1 - b.t1),
  notes: (Array.isArray(x.notes) ? x.notes : []).filter((n) => n?.id).map(cleanNote).sort((a, b) => a.t - b.t),
  done: !!x.done,
  comment: String(x.comment ?? '').trim(),
});

function normalize(d) {
  const out = empty();
  for (const k of LISTS) out[k] = Array.isArray(d?.[k]) ? d[k].filter((x) => x && x.id) : [];
  out.games = out.games.map((g) => ({ id: g.id, ...cleanGame(g), createdAt: g.createdAt || 0, updatedAt: g.updatedAt || 0 }));
  out.settings = cleanSettings(d?.settings);
  // Alte Löschvermerke vergessen
  const cutoff = Date.now() - TOMB_DAYS * 864e5;
  out.deleted = Object.fromEntries(Object.entries(d?.deleted && typeof d.deleted === 'object' ? d.deleted : {}).filter(([, ts]) => ts > cutoff));
  return out;
}

// ---------- Start, Speichern, Benachrichtigen ----------
export async function init() {
  try {
    db = await openDb();
    const d = await kvGet('data');
    const m = await kvGet('meta');
    S.data = normalize(d);
    if (m) Object.assign(S.meta, m);
  } catch (e) {
    console.error('IndexedDB nicht verfügbar', e);
    S.volatile = true;
    S.data = normalize(null);
  }
  if (!S.meta.created) S.meta.created = Date.now();
  try { await navigator.storage?.persist?.(); } catch { /* egal */ }
}

export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const notify = () => subs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}
export async function flush() {
  clearTimeout(timer);
  if (!db) return;
  try { await kvPut([['data', S.data], ['meta', S.meta]]); } catch (e) { console.error('Speichern fehlgeschlagen', e); return; }
  savedSubs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
}

/** Jede Änderung an den Daten läuft hier durch: ändern, merken, speichern, Oberfläche benachrichtigen. */
export function change(fn) {
  fn(S.data);
  S.meta.lastChange = Date.now();
  save();
  notify();
}
export function setMeta(patch) {
  Object.assign(S.meta, patch);
  save();
  notify();
}
export const isDirty = () => S.meta.lastChange > (S.meta.lastExport || 0);
export const hasData = () => LISTS.some((k) => S.data[k].length);

// ---------- Videodateien auf diesem Gerät (nicht in der Sicherungsdatei, nicht im Abgleich) ----------
export async function getFile(id) { if (!db) return null; try { return (await kvGet(`file:${id}`)) || null; } catch { return null; } }
export async function putFile(id, blob) { if (!db) throw new Error('no db'); await kvPut([[`file:${id}`, blob]]); }
export async function delFile(id) {
  if (!db) return;
  await new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(`file:${id}`); tx.oncomplete = tx.onerror = tx.onabort = res; });
}

// ---------- Datum ----------
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());

// ---------- Spiele ----------
export const game = (id) => S.data.games.find((x) => x.id === id);
/** Neueste zuerst */
export const gamesSorted = () => [...S.data.games].sort((a, b) => b.day.localeCompare(a.day) || (b.createdAt - a.createdAt));
export function addGame(x) {
  const id = uid(), now = Date.now();
  change((d) => d.games.push({ id, ...cleanGame(x), createdAt: now, updatedAt: now }));
  return id;
}
export function updateGame(id, patch) {
  change(() => { const g = game(id); if (g) Object.assign(g, cleanGame({ ...g, ...patch }), { updatedAt: Date.now() }); });
}
/** Löscht ein Spiel. Gibt „Rückgängig“ zurück. */
export function deleteGame(id) {
  const before = JSON.parse(JSON.stringify(game(id) || null));
  change((d) => { tomb(id); d.games = d.games.filter((x) => x.id !== id); });
  return () => change((d) => { untomb(id); if (before && !game(id)) d.games.push({ ...before, updatedAt: Date.now() }); });
}

// ---------- Ballwechsel & Notizen ----------
/** Ändert die Ballwechsel/Notizen eines Spiels über eine Funktion auf einer Kopie */
function editGame(id, fn) {
  change(() => {
    const g = game(id); if (!g) return;
    const copy = { rallies: g.rallies.map((r) => ({ ...r })), notes: g.notes.map((n) => ({ ...n })) };
    fn(copy);
    Object.assign(g, cleanGame({ ...g, ...copy }), { updatedAt: Date.now() });
  });
}
export function addRally(gid, r) { const id = uid(); editGame(gid, (c) => c.rallies.push({ ...r, id })); return id; }
export function updateRally(gid, rid, patch) { editGame(gid, (c) => { const r = c.rallies.find((x) => x.id === rid); if (r) Object.assign(r, patch); }); }
export function deleteRally(gid, rid) {
  const g = game(gid), old = g?.rallies.find((x) => x.id === rid);
  editGame(gid, (c) => { c.rallies = c.rallies.filter((x) => x.id !== rid); });
  return () => { if (old && game(gid)) editGame(gid, (c) => c.rallies.push({ ...old })); };
}
export function addNote(gid, n) { const id = uid(); editGame(gid, (c) => c.notes.push({ ...n, id })); return id; }
export function updateNote(gid, nid, patch) { editGame(gid, (c) => { const n = c.notes.find((x) => x.id === nid); if (n) Object.assign(n, patch); }); }
export function deleteNote(gid, nid) {
  const g = game(gid), old = g?.notes.find((x) => x.id === nid);
  editGame(gid, (c) => { c.notes = c.notes.filter((x) => x.id !== nid); });
  return () => { if (old && game(gid)) editGame(gid, (c) => c.notes.push({ ...old })); };
}

// ---------- Einstellungen ----------
export const settings = () => S.data.settings;
export function setSettings(patch) {
  change((d) => { d.settings = cleanSettings({ ...d.settings, ...patch, updatedAt: Date.now() }); });
}

// ---------- Löschvermerke ----------
function tomb(id) { S.data.deleted[id] = Date.now(); }
function untomb(id) { delete S.data.deleted[id]; }

// ---------- Alles löschen ----------
export function wipeAll() {
  // Alles als gelöscht vermerken, damit es beim Abgleich nicht von anderen Geräten zurückkommt
  const now = Date.now();
  const deleted = { ...S.data.deleted };
  for (const k of LISTS) for (const x of S.data[k]) deleted[x.id] = now;
  change((d) => { Object.assign(d, normalize(null), { deleted }); });
}

// ---------- Export / Import ----------
export function buildExport() {
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), ...S.data };
}
export function markExported() { setMeta({ lastExport: Date.now() }); }

const stamp = (x) => x.updatedAt || x.createdAt || 0;
/** Zusammenführen ohne Rückfrage (auch für den Cloud-Abgleich): neuere Fassung gewinnt, Gelöschtes bleibt gelöscht. */
export function mergeInto(d, inc, mode = 'merge') {
  if (mode === 'replace') { Object.assign(d, inc); return; }
  if ((inc.settings?.updatedAt || 0) > (d.settings?.updatedAt || 0)) d.settings = inc.settings;
  for (const [id, ts] of Object.entries(inc.deleted || {})) d.deleted[id] = Math.max(ts, d.deleted[id] || 0);
  const dead = (x) => d.deleted[x.id] != null && d.deleted[x.id] >= stamp(x);
  for (const k of LISTS) {
    for (const x of inc[k]) {
      const i = d[k].findIndex((y) => y.id === x.id);
      if (i < 0) d[k].push(x);
      else if (stamp(x) > stamp(d[k][i])) d[k][i] = x;
    }
    d[k] = d[k].filter((x) => !dead(x));
  }
}
/** Cloud-Abgleich: Stand aus einer Datei übernehmen, ohne lastChange zu setzen. */
export function importData(obj, mode) {
  mergeInto(S.data, normalize(obj), mode);
  save();
  notify();
}
/** Prüft eine Datei und liefert die normalisierten Daten (oder wirft einen Fehler). */
export function parseImport(text) {
  const d = JSON.parse(text);
  if (!d || d.format !== FORMAT) throw new Error('format');
  return normalize(d);
}
/** mode: 'merge' (neuere Fassung gewinnt) oder 'replace' */
export function applyImport(inc, mode = 'merge') {
  change((d) => mergeInto(d, inc, mode));
  return { g: inc.games.length };
}
