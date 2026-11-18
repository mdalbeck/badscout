// Dropbox: einmal verbinden (OAuth 2.0 mit PKCE, ganz ohne Server), danach bleibt die Verbindung bestehen.
// Gemeinsame Dropbox-App „Bad Apps“ (App-Typ "App folder"): alle Bad Apps sehen den Ordner Dropbox › Apps › Bad Apps.
import * as St from './store.js';
import { t } from './i18n.js';
import { DROPBOX_APP_KEY } from './config.js';

const AUTH = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';
export const FILE = 'badscout-daten.json';
export const BADTEAM_FILE = 'badteam-daten.json';
const KEY = 'dbxAuth';
const SS_LOGIN = 'badscout-dbx-login';

let auth = null; // { access, refresh, exp, account }

export const redirectUri = () => location.origin + location.pathname;
export const appKey = () => DROPBOX_APP_KEY;
export const account = () => auth?.account || '';
export const connected = () => !!auth?.refresh;

// ---------- Hilfsfunktionen ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomStr = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
function err(name, message) { const e = new Error(message); e.name = name; return e; }

async function tokenRequest(params) {
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: appKey(), ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw err('NotAllowedError', t('dbx.reconnect'));
    throw new Error(j.error_description || j.error || `Dropbox (${r.status})`);
  }
  auth = {
    access: j.access_token,
    refresh: j.refresh_token || auth?.refresh,
    exp: Date.now() + (j.expires_in || 14400) * 1000 - 60000,
    account: auth?.account || '',
    key: appKey(), // mit welcher Dropbox-App angemeldet (bei neuem App-Key: neu verbinden)
  };
  await St.setKey(KEY, auth);
}

async function token(force = false) {
  if (!auth?.refresh) throw err('NotAllowedError', t('dbx.notConnected'));
  if (force || !auth.access || Date.now() > auth.exp) await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh });
  return auth.access;
}

/** Dropbox-Aufruf mit Token; bei 401 einmal mit frischem Token wiederholen. */
async function call(url, opts = {}) {
  const go = async (force) => fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${await token(force)}` } });
  let r = await go(false);
  if (r.status === 401) r = await go(true);
  return r;
}
async function callError(r) {
  const txt = await r.text().catch(() => '');
  if (r.status === 401) return err('NotAllowedError', t('dbx.reconnect'));
  if (r.status === 400 && /scope/i.test(txt)) return new Error(t('dbx.scope'));
  if (r.status === 429 || r.status >= 500) return err('NoModificationAllowedError', t('dbx.busy'));
  let msg = txt;
  try { msg = JSON.parse(txt).error_summary || txt; } catch { /* Text */ }
  return new Error(`Dropbox: ${msg || r.status}`);
}

// ---------- Verbinden ----------
/** Zur Dropbox-Anmeldung weiterleiten. Danach kommt man wieder zur App zurück. */
export async function login() {
  const verifier = randomStr(), state = randomStr();
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const data = JSON.stringify({ verifier, state, hash: location.hash || '#/backup' });
  try { sessionStorage.setItem(SS_LOGIN, data); } catch { localStorage.setItem(SS_LOGIN, data); }
  location.assign(`${AUTH}?${new URLSearchParams({
    client_id: appKey(), response_type: 'code', redirect_uri: redirectUri(), state,
    code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline',
  })}`);
}

/** Beim Start: Kommt die Seite gerade von Dropbox zurück? Dann Code gegen Token tauschen. */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SS_LOGIN) || localStorage.getItem(SS_LOGIN) || 'null'); } catch { /* egal */ }
  try { sessionStorage.removeItem(SS_LOGIN); localStorage.removeItem(SS_LOGIN); } catch { /* egal */ }
  history.replaceState(null, '', redirectUri() + (saved?.hash || '#/backup'));
  if (q.has('error')) {
    if (q.get('error') === 'access_denied') throw err('AbortError', 'abort');
    throw new Error(q.get('error_description') || q.get('error'));
  }
  if (!saved || saved.state !== q.get('state')) throw new Error(t('dbx.expired'));
  await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier });
  try {
    const r = await call(`${API}/users/get_current_account`, { method: 'POST' });
    if (r.ok) { const j = await r.json(); auth.account = j.email || j.name?.display_name || ''; await St.setKey(KEY, auth); }
  } catch { /* nur Anzeige */ }
  return true;
}

export async function load() {
  auth = (await St.getKey(KEY)) || null;
  // Anmeldung gehört zu einer anderen (alten) Dropbox-App → nicht mehr benutzen, neu verbinden lassen
  if (auth && auth.key !== appKey()) { auth = null; await St.setKey(KEY, null); return false; }
  return !!auth?.refresh;
}
export async function logout() {
  try { if (auth?.access) await call(`${API}/auth/token/revoke`, { method: 'POST' }); } catch { /* egal */ }
  auth = null;
  await St.setKey(KEY, null);
}

// ---------- Dateien ----------
/** Version (rev) einer Datei plus Funktion zum Laden. null = Datei gibt es (noch) nicht. */
export async function peek(name = FILE) {
  const path = `/${name}`;
  const r = await call(`${API}/files/get_metadata`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
  });
  if (r.status === 409) return null; // path/not_found
  if (!r.ok) throw await callError(r);
  const m = await r.json();
  return {
    version: m.rev,
    load: async () => {
      const x = await call(`${CONTENT}/files/download`, { method: 'POST', headers: { 'Dropbox-API-Arg': JSON.stringify({ path }) } });
      if (!x.ok) throw await callError(x);
      return x.text();
    },
  };
}

/** Datendatei schreiben. ifVersion: nur überschreiben, wenn die Datei noch diesen Stand hat (sonst Conflict). */
export async function write(text, ifVersion) {
  const mode = ifVersion ? { '.tag': 'update', update: ifVersion } : { '.tag': 'add' };
  const r = await call(`${CONTENT}/files/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: `/${FILE}`, mode, autorename: false, mute: true }) },
    body: new Blob([text]),
  });
  if (r.status === 409) throw err('Conflict', 'conflict');
  if (!r.ok) throw await callError(r);
  return (await r.json()).rev;
}

// ---------- Andere Bad Apps: Dateien nur lesen ----------
export const BADCLIP_FILE = 'badclip-daten.json';
export const BADCLIP_VIDEOS = 'badclip-videos';
/** Beliebige Textdatei aus dem gemeinsamen Ordner lesen; null, wenn es sie nicht gibt */
export async function readText(name) {
  const r = await call(`${CONTENT}/files/download`, { method: 'POST', headers: { 'Dropbox-API-Arg': JSON.stringify({ path: `/${name}` }) } });
  if (r.status === 409) return null;
  if (!r.ok) throw await callError(r);
  return r.text();
}

// ---------- Eigene Videos: Dropbox › Apps › Bad Apps › badscout-videos/<id> ----------
export const VIDEO_DIR = 'badscout-videos';
export const videoPath = (id) => `/${VIDEO_DIR}/${id}`;
const CHUNK = 8 * 1024 * 1024; // 8 MB pro Stück (wie BadClip) – auch sehr große Videos gehen so
async function apiJson(endpoint, arg) {
  const r = await call(`${API}/files/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg) });
  if (r.status === 409) { const e = err('NotFound', 'not_found'); e.detail = await r.text().catch(() => ''); throw e; }
  if (!r.ok) throw await callError(r);
  return r.json().catch(() => ({}));
}
async function contentCall(endpoint, arg, body) {
  const r = await call(`${CONTENT}/files/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify(arg) }, body });
  if (!r.ok) throw await callError(r);
  return r.json().catch(() => ({}));
}
/** Video hochladen; onProgress(0..1). signal: { stop: true } bricht zwischen zwei Stücken ab. */
export async function uploadVideo(id, blob, onProgress = () => {}, signal = {}) {
  const path = videoPath(id);
  if (blob.size <= CHUNK) { await contentCall('upload', { path, mode: { '.tag': 'overwrite' }, mute: true }, blob); onProgress(1); return; }
  const { session_id } = await contentCall('upload_session/start', { close: false }, blob.slice(0, CHUNK));
  let offset = CHUNK;
  onProgress(offset / blob.size);
  while (blob.size - offset > CHUNK) {
    if (signal.stop) throw err('AbortError', 'abort');
    await contentCall('upload_session/append_v2', { cursor: { session_id, offset }, close: false }, blob.slice(offset, offset + CHUNK));
    offset += CHUNK;
    onProgress(offset / blob.size);
  }
  await contentCall('upload_session/finish', { cursor: { session_id, offset }, commit: { path, mode: { '.tag': 'overwrite' }, mute: true } }, blob.slice(offset));
  onProgress(1);
}
/** Zeitlich begrenzter Link (4 Stunden) zum direkten Abspielen – das Video wird gestreamt, nicht ganz geladen. null = Datei fehlt */
export async function tempLink(path) {
  try { return (await apiJson('get_temporary_link', { path })).link; } catch (e) { if (e.name === 'NotFound') return null; throw e; }
}
/** Datei innerhalb von Dropbox kopieren (ohne Hoch- oder Herunterladen) */
export async function copyFile(from, to) {
  return apiJson('copy_v2', { from_path: from, to_path: to, autorename: false });
}
export async function deleteVideo(id) {
  try { await apiJson('delete_v2', { path: videoPath(id) }); } catch (e) { if (e.name !== 'NotFound') throw e; }
}
