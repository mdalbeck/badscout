// Videos: hochladen (eigene Aufnahme → Dropbox › Apps › Bad Apps › badscout-videos), YouTube-Link,
// aus BadClip übernehmen (Dropbox kopiert die Datei selbst – nichts wird neu hochgeladen) und der Player.
// BadClips Datei und BadClips Videos werden nur gelesen, nie verändert oder gelöscht.
import * as St from './store.js';
import * as Sync from './sync.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, $$, esc, toast, modal, closeModal } from './ui.js';

// ================= Hilfen =================
export const isVideoFile = (f) => f && (f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(f.name));
export const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : `${Math.round(b / 1e6)} MB`).replace('.', t('dec'));
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
const shortId = () => 'v-' + St.uid().replace(/[^a-z0-9]/gi, '').slice(0, 14);
export const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
/** Vorschaubild eines Spiels (oder null) */
export const thumbOf = (g) => (g?.video?.kind === 'yt' ? ytThumb(g.video.ytId) : g?.video?.thumb || null);

export function parseYouTube(s) {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.includes('://') ? s : 'https://' + s);
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch { /* kein Link */ }
  return null;
}

/** Dauer und ein Vorschaubild aus der Datei lesen (null = Browser kann das Format nicht abspielen). */
function probeVideo(file) {
  return new Promise((res) => {
    const v = document.createElement('video'), url = URL.createObjectURL(file);
    let done = false;
    const fin = (r) => { if (done) return; done = true; clearTimeout(to); URL.revokeObjectURL(url); res(r); };
    const to = setTimeout(() => fin(v.duration ? { duration: v.duration, thumb: null } : null), 10000);
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    v.onerror = () => fin(null);
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) * 0.1); };
    v.onseeked = () => {
      let thumb = null;
      try {
        const c = document.createElement('canvas'); c.width = 320; c.height = 180;
        const g = c.getContext('2d'), k = Math.min(320 / v.videoWidth, 180 / v.videoHeight), w = v.videoWidth * k, h = v.videoHeight * k;
        g.fillStyle = '#000'; g.fillRect(0, 0, 320, 180); g.drawImage(v, (320 - w) / 2, (180 - h) / 2, w, h);
        thumb = c.toDataURL('image/jpeg', 0.72);
      } catch { /* kein Bild */ }
      fin({ duration: v.duration, thumb });
    };
  });
}
function pickFile() {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'video/*,.mp4,.m4v,.mov,.webm,.mkv';
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}

// ================= Dateien auf diesem Gerät, Hochladen =================
const mem = new Map(); // id → Datei, falls der Browser-Speicher für das Video nicht reicht (nur bis zum Neuladen)
const fileHere = async (id) => mem.get(id) || (await St.getFile(id));

/** Laufende Uploads: Video-ID → { pct, error, signal } */
const UP = new Map();
const upSubs = new Set();
const upNotify = () => upSubs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
export const uploading = () => [...UP.values()].some((u) => !u.error);
const gameOfVideo = (vid) => St.S.data.games.find((g) => g.video?.id === vid);

export async function startUpload(vid) {
  const g = gameOfVideo(vid);
  if (!g || g.video.kind !== 'file' || g.video.dbx) return;
  if (UP.has(vid) && !UP.get(vid).error) return;
  if (Sync.Y.state !== 'ok') { toast(t('vd.needDbx'), t('nav.backup'), () => (location.hash = '#/backup')); return; }
  const blob = await fileHere(vid);
  if (!blob) { toast(t('vd.notHere')); return; }
  const u = { pct: 0, error: '', signal: {} };
  UP.set(vid, u);
  upNotify();
  try {
    await Sync.DBX.uploadVideo(vid, blob, (f) => { u.pct = f; upNotify(); }, u.signal);
    UP.delete(vid);
    const now = gameOfVideo(vid);
    if (now) St.updateGame(now.id, { video: { ...now.video, dbx: true } });
    else Sync.DBX.deleteVideo(vid).catch(() => {}); // Spiel wurde inzwischen gelöscht
    upNotify();
    toast(t('vd.uploaded'));
  } catch (e) {
    console.error(e);
    if (e.name === 'AbortError') { UP.delete(vid); upNotify(); return; }
    u.error = e.message || String(e);
    upNotify();
  }
}

/** Eigene Videodatei vom Gerät/Computer zu einem Spiel hinzufügen */
export async function addFile(gameId, file) {
  if (!isVideoFile(file)) return toast(t('vd.notVideo', { name: file.name }));
  const meta = await probeVideo(file);
  if (!meta) toast(t('vd.format', { name: file.name }));
  const id = shortId();
  try { await St.putFile(id, file); } catch { mem.set(id, file); }
  St.updateGame(gameId, { video: { kind: 'file', id, title: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, size: file.size, mime: file.type || 'video/mp4', duration: meta?.duration || null, thumb: meta?.thumb || null, dbx: false, from: '' } });
  if (Sync.Y.state === 'ok') startUpload(id);
}

/** Video von einem Spiel lösen und – wenn es BadScouts eigene Datei ist – auf dem Gerät und in Dropbox löschen */
export async function purge(video) {
  if (video?.kind !== 'file') return;
  const u = UP.get(video.id);
  if (u) { u.signal.stop = true; UP.delete(video.id); upNotify(); }
  mem.delete(video.id);
  await St.delFile(video.id).catch(() => {});
  if (Sync.Y.state === 'ok') await Sync.DBX.deleteVideo(video.id).catch((e) => console.error(e));
}

// ================= YouTube =================
async function addYouTube(gameId, input) {
  const id = parseYouTube(input);
  if (!id) { toast(t('vd.ytBad')); return false; }
  let title = '';
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    if (r.ok) title = (await r.json()).title || '';
  } catch { /* offline – Titel ist nicht wichtig */ }
  St.updateGame(gameId, { video: { kind: 'yt', ytId: id, title } });
  return true;
}
function ytDialog(gameId) {
  const d = modal(`<h2>${icon('play', 20)} ${esc(t('vd.ytTitle'))}</h2>
    <label>${esc(t('vd.ytLabel'))}<input id="yt-in" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off"></label>
    <div class="dlg-actions"><span class="grow"></span><button class="ghost" id="yt-no">${esc(t('gm.cancel'))}</button><button class="primary" id="yt-ok">${esc(t('vd.take'))}</button></div>`);
  const inp = $('#yt-in', d);
  const ok = async () => { if (await addYouTube(gameId, inp.value)) closeModal(); };
  $('#yt-ok', d).onclick = ok;
  $('#yt-no', d).onclick = closeModal;
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } };
  setTimeout(() => inp.focus(), 30);
}

let ytPromise;
function ytReady() {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytPromise) ytPromise = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytPromise = null; s.remove(); rej(new Error('offline')); };
    document.head.appendChild(s);
    setTimeout(() => rej(new Error('timeout')), 15000);
  });
  return ytPromise;
}

// ================= Aus BadClip übernehmen =================
/** Videos aus BadClips Datei: eigene Videos, die in Dropbox liegen, und YouTube-Videos */
async function badclipVideos() {
  const txt = await Sync.DBX.readText(Sync.DBX.BADCLIP_FILE);
  if (!txt) return [];
  const d = JSON.parse(txt);
  const gone = d.deleted || {};
  return (d.videos || []).filter((v) => v?.id && !gone[v.id] && (v.local ? v.dbx : /^[\w-]{11}$/.test(v.id)))
    .map((v) => ({ id: v.id, local: !!v.local, title: v.title || v.fileName || v.id, fileName: v.fileName || '', size: v.size || 0, mime: v.mime || 'video/mp4', duration: v.duration || null, thumb: v.local ? v.thumb || null : ytThumb(v.id), addedAt: v.addedAt || 0 }))
    .sort((a, b) => b.addedAt - a.addedAt);
}
async function takeFromBadclip(gameId, v) {
  if (!v.local) { St.updateGame(gameId, { video: { kind: 'yt', ytId: v.id, title: v.title } }); return; }
  const id = shortId();
  await Sync.DBX.copyFile(`/${Sync.DBX.BADCLIP_VIDEOS}/${v.id}`, Sync.DBX.videoPath(id));
  St.updateGame(gameId, { video: { kind: 'file', id, title: v.title, fileName: v.fileName, size: v.size, mime: v.mime, duration: v.duration, thumb: v.local ? v.thumb : null, dbx: true, from: 'badclip' } });
}
async function badclipDialog(gameId) {
  if (Sync.Y.state !== 'ok') return toast(t('vd.needDbx'), t('nav.backup'), () => (location.hash = '#/backup'));
  const d = modal(`<h2>${icon('library', 20)} ${esc(t('vd.bcTitle'))}</h2><p class="muted small">${esc(t('vd.bcText'))}</p>
    <label class="field">${icon('search', 18)}<input id="bc-q" type="search" placeholder="${esc(t('vd.bcSearch'))}" autocomplete="off"></label>
    <div class="picklist" id="bc-list"><div class="bf-loading muted">${esc(t('vd.loading'))}</div></div>
    <div class="dlg-actions"><span class="grow"></span><button class="ghost" id="bc-no">${esc(t('gm.cancel'))}</button></div>`, 'wide');
  $('#bc-no', d).onclick = closeModal;
  let list = [];
  try { list = await badclipVideos(); } catch (e) { $('#bc-list', d).innerHTML = `<p class="muted">${esc(t('vd.bcError', { msg: e.message || e }))}</p>`; return; }
  const q = $('#bc-q', d);
  const draw = () => {
    const w = q.value.trim().toLowerCase();
    const shown = list.filter((v) => !w || v.title.toLowerCase().includes(w));
    $('#bc-list', d).innerHTML = shown.map((v) => `<button class="pickrow bcrow" data-id="${esc(v.id)}">
        ${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" onerror="this.replaceWith(document.createElement('i'))">` : `<i class="nothumb">${icon('video', 20)}</i>`}
        <span><b>${esc(v.title)}</b><small>${esc(v.local ? t('vd.bcOwn') : 'YouTube')}${v.duration ? ` · ${fmtTime(v.duration)}` : ''}${v.size ? ` · ${fmtSize(v.size)}` : ''}</small></span></button>`).join('')
      || `<p class="muted">${esc(list.length ? t('vd.bcNoHit') : t('vd.bcNone'))}</p>`;
    $$('[data-id]', d).forEach((b) => (b.onclick = async () => {
      const v = list.find((x) => x.id === b.dataset.id);
      $$('[data-id]', d).forEach((x) => (x.disabled = true));
      b.querySelector('small').textContent = t('vd.copying');
      try { await takeFromBadclip(gameId, v); closeModal(); toast(t('vd.bcDone')); }
      catch (e) { console.error(e); toast(t('vd.bcError', { msg: e.message || e })); $$('[data-id]', d).forEach((x) => (x.disabled = false)); draw(); }
    }));
  };
  q.oninput = draw;
  draw();
  setTimeout(() => q.focus(), 30);
}

// ================= Player =================
/** Gleiche Befehle für eigene Datei und YouTube */
class FilePlayer {
  constructor(slot, src, on) {
    this.rates = [1, 0.5, 0.25, 0.125];
    const v = this.v = document.createElement('video');
    v.className = 'vfile'; v.playsInline = true; v.preload = 'auto'; v.src = src;
    slot.replaceChildren(v);
    v.addEventListener('loadedmetadata', () => on.ready?.(), { once: true });
    v.addEventListener('play', () => on.state?.());
    v.addEventListener('pause', () => on.state?.());
    v.addEventListener('error', () => on.error?.('file'));
    v.addEventListener('click', () => (v.paused ? this.play() : this.pause()));
  }
  time() { return this.v.currentTime || 0; }
  duration() { return Number.isFinite(this.v.duration) ? this.v.duration : 0; }
  paused() { return this.v.paused; }
  play() { this.v.play().catch(() => {}); }
  pause() { this.v.pause(); }
  seek(s) { this.v.currentTime = Math.max(0, Math.min(s, this.duration() || s)); }
  setRate(r) { this.v.playbackRate = r; }
  destroy() { try { this.v.pause(); this.v.removeAttribute('src'); this.v.load(); } catch { /* egal */ } this.v.remove(); }
}
class YtPlayer {
  constructor(slot, ytId, on) {
    this.rates = [1, 0.5, 0.25];
    this.isPaused = true; this.t = 0;
    const el = document.createElement('div');
    slot.replaceChildren(el);
    const vars = { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, iv_load_policy: 3, fs: 0 };
    if (location.protocol.startsWith('http')) vars.origin = location.origin;
    this.p = new YT.Player(el, {
      videoId: ytId, playerVars: vars,
      events: {
        onReady: () => { this.ok = true; on.ready?.(); },
        onStateChange: (e) => { this.isPaused = e.data !== 1 && e.data !== 3; on.state?.(); },
        onError: (e) => on.error?.(e.data === 101 || e.data === 150 ? 'embed' : 'yt'),
      },
    });
  }
  time() { return this.ok ? this.p.getCurrentTime() || 0 : 0; }
  duration() { return this.ok ? this.p.getDuration() || 0 : 0; }
  paused() { return this.isPaused; }
  play() { if (this.ok) this.p.playVideo(); }
  pause() { if (this.ok) this.p.pauseVideo(); }
  seek(s) { if (this.ok) this.p.seekTo(Math.max(0, s), true); }
  setRate(r) { if (this.ok) this.p.setPlaybackRate(r); }
  destroy() { try { this.p.destroy(); } catch { /* egal */ } }
}

const linkCache = new Map(); // Dropbox-Pfad → { link, until }
async function dropboxLink(id) {
  const path = Sync.DBX.videoPath(id), c = linkCache.get(path);
  if (c && c.until > Date.now()) return c.link;
  const link = await Sync.DBX.tempLink(path);
  if (link) linkCache.set(path, { link, until: Date.now() + 3.5 * 3600e3 });
  return link;
}

const RATE_LABEL = { 1: '1×', 0.5: '½', 0.25: '¼', 0.125: '⅛' };
const FRAME = 1 / 30;

/**
 * Video-Bereich eines Spiels: Auswahl (ohne Video) oder Player mit Steuerleiste.
 * Liefert { key(e), destroy(), sig } – sig ändert sich, wenn der Bereich neu aufgebaut werden muss.
 */
export function videoPanel(host, gameId) {
  const g = St.game(gameId);
  const v = g?.video;
  const sig = v ? JSON.stringify([v.kind, v.id || v.ytId, v.dbx]) : 'none';
  if (!v) return choosePanel(host, gameId, sig);
  return playerPanel(host, gameId, v, sig);
}

function choosePanel(host, gameId, sig) {
  host.innerHTML = `<section class="panel vchoose" id="vd-choose">
      <h2>${icon('video', 20)} ${esc(t('vd.addTitle'))}</h2>
      <div class="vopts">
        <button class="vopt" id="vd-file">${icon('upload', 26)}<b>${esc(t('vd.file'))}</b><small>${esc(t('vd.fileText'))}</small><kbd>U</kbd></button>
        <button class="vopt" id="vd-yt">${icon('play', 26)}<b>${esc(t('vd.yt'))}</b><small>${esc(t('vd.ytText'))}</small><kbd>Y</kbd></button>
        <button class="vopt" id="vd-bc">${icon('library', 26)}<b>${esc(t('vd.bc'))}</b><small>${esc(t('vd.bcShort'))}</small><kbd>B</kbd></button>
      </div>
      <p class="muted small vdrop">${esc(t('vd.drop'))}</p>
    </section>`;
  const sec = $('#vd-choose', host);
  const file = async () => { const f = await pickFile(); if (f) addFile(gameId, f); };
  $('#vd-file', host).onclick = file;
  $('#vd-yt', host).onclick = () => ytDialog(gameId);
  $('#vd-bc', host).onclick = () => badclipDialog(gameId);
  sec.ondragover = (e) => { e.preventDefault(); sec.classList.add('over'); };
  sec.ondragleave = () => sec.classList.remove('over');
  sec.ondrop = (e) => { e.preventDefault(); sec.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) addFile(gameId, f); };
  return {
    sig,
    key(e) {
      const k = e.key.toLowerCase();
      if (k === 'u') { file(); return true; }
      if (k === 'y') { ytDialog(gameId); return true; }
      if (k === 'b') { badclipDialog(gameId); return true; }
      return false;
    },
    destroy() {},
  };
}

function playerPanel(host, gameId, v, sig) {
  host.innerHTML = `<section class="vp">
      <div class="vstage"><div class="vslot"></div><div class="vmsg hidden"></div></div>
      <div class="vbar">
        <button class="ib vplay" data-v="toggle" title="${esc(t('vd.play'))} (${esc(t('key.space'))})">${icon('play', 20)}</button>
        <button class="ib" data-v="back" title="${esc(t('vd.back5'))} (←)">${icon('back5', 20)}</button>
        <button class="ib" data-v="fwd" title="${esc(t('vd.fwd5'))} (→)">${icon('fwd5', 20)}</button>
        <button class="ib" data-v="fb" title="${esc(t('vd.frameBack'))} (,)">${icon('left', 20)}</button>
        <button class="ib" data-v="ff" title="${esc(t('vd.frameFwd'))} (.)">${icon('right', 20)}</button>
        <span class="vtime mono">0:00 / 0:00</span>
        <span class="grow"></span>
        <div class="vrates" title="${esc(t('vd.rate'))} (− / +)"></div>
      </div>
      <input class="vseek" type="range" min="0" max="1000" value="0" step="1" aria-label="${esc(t('vd.seek'))}">
    </section>
    <div class="vinfo"></div>`;
  const stage = $('.vstage', host), slot = $('.vslot', host), msgEl = $('.vmsg', host), seek = $('.vseek', host);
  let p = null, rate = 1, raf = 0, dead = false, dragging = false, waitDbx = false;
  const msg = (html) => { msgEl.innerHTML = html; msgEl.classList.toggle('hidden', !html); };

  const renderRates = () => {
    const rates = p?.rates || [1, 0.5, 0.25];
    $('.vrates', host).innerHTML = `<div class="seg">${rates.map((r) => `<button data-rate="${r}" class="${r === rate ? 'on' : ''}">${RATE_LABEL[r]}</button>`).join('')}</div>`;
    $$('[data-rate]', host).forEach((b) => (b.onclick = () => setRate(+b.dataset.rate)));
  };
  const setRate = (r) => { rate = r; p?.setRate(r); renderRates(); };
  const stepRate = (dir) => { const rs = p?.rates || [1]; const i = rs.indexOf(rate); setRate(rs[Math.max(0, Math.min(rs.length - 1, i + dir))]); };
  const syncPlay = () => { const b = $('[data-v=toggle]', host); if (b && p) b.innerHTML = icon(p.paused() ? 'play' : 'pause', 20); };
  const tick = () => {
    if (dead) return;
    if (p) {
      const tm = p.time(), d = p.duration();
      $('.vtime', host).textContent = `${fmtTime(tm)} / ${fmtTime(d)}`;
      if (!dragging && d) seek.value = Math.round((tm / d) * 1000);
    }
    raf = requestAnimationFrame(tick);
  };
  const act = {
    toggle: () => { if (!p) return; if (p.paused()) p.play(); else p.pause(); },
    back: (s = 5) => p?.seek(p.time() - s),
    fwd: (s = 5) => p?.seek(p.time() + s),
    fb: () => { if (!p) return; p.pause(); p.seek(p.time() - FRAME); },
    ff: () => { if (!p) return; p.pause(); p.seek(p.time() + FRAME); },
  };
  $$('[data-v]', host).forEach((b) => (b.onclick = () => act[b.dataset.v]()));
  seek.oninput = () => { dragging = true; const d = p?.duration(); if (d) p.seek((seek.value / 1000) * d); };
  seek.onchange = () => { dragging = false; };
  const on = {
    ready: () => { msg(''); renderRates(); p.setRate(rate); syncPlay(); },
    state: syncPlay,
    error: (kind) => msg(`<p>${esc(t(kind === 'embed' ? 'vd.errEmbed' : kind === 'yt' ? 'vd.errYt' : 'vd.errFile'))}</p>${v.kind === 'yt' ? `<a class="btn" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${esc(v.ytId)}">${icon('external', 16)}<span>${esc(t('vd.openYt'))}</span></a>` : ''}`),
  };

  // Quelle laden: YouTube · Datei auf diesem Gerät · Dropbox (gestreamt)
  async function load() {
    msg(`<div class="bf-loading">${esc(t('vd.loading'))}</div>`);
    if (v.kind === 'yt') {
      try { await ytReady(); } catch { return on.error('yt'); }
      if (!dead) p = new YtPlayer(slot, v.ytId, on);
      return;
    }
    const blob = await fileHere(v.id);
    if (dead) return;
    let src = blob ? URL.createObjectURL(blob) : null;
    if (!src && v.dbx) {
      waitDbx = Sync.Y.state !== 'ok';
      if (waitDbx) return msg(`<p>${esc(t('vd.needDbxPlay'))}</p><a class="btn primary" href="#/backup">${icon('cloud', 16)}<span>${esc(t('nav.backup'))}</span></a>`);
      try { src = await dropboxLink(v.id); } catch (e) { return msg(`<p>${esc(e.message || e)}</p><button class="btn" data-m="retry">${esc(t('vd.retry'))}</button>`); }
      if (!src) return msg(`<p>${esc(t('vd.goneDbx'))}</p><button class="btn primary" data-m="relink">${icon('upload', 16)}<span>${esc(t('vd.pick'))}</span></button>`);
    }
    if (!src) return msg(`<p>${esc(t('vd.onlyThere', { name: v.fileName || v.title }))}</p><button class="btn primary" data-m="relink">${icon('upload', 16)}<span>${esc(t('vd.pick'))}</span></button>`);
    if (dead) return;
    p = new FilePlayer(slot, src, on);
    if (blob) p.blobUrl = src;
  }
  msgEl.onclick = async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    if (b.dataset.m === 'retry') load();
    if (b.dataset.m === 'relink') {
      const f = await pickFile();
      if (!f) return;
      try { await St.putFile(v.id, f); } catch { mem.set(v.id, f); }
      const g = St.game(gameId);
      if (g?.video) St.updateGame(gameId, { video: { ...g.video, fileName: f.name, size: f.size, mime: f.type || g.video.mime } });
      load();
    }
  };

  // Info unter dem Player: Herkunft, Dropbox-Stand, Hochladen, Entfernen
  const renderInfo = async () => {
    const g = St.game(gameId), cur = g?.video;
    if (!cur) return;
    const u = cur.kind === 'file' ? UP.get(cur.id) : null;
    let state = '';
    if (cur.kind === 'yt') state = `<span class="vsrc">${icon('play', 15)}YouTube</span>`;
    else if (u && !u.error) state = `<span class="vsrc">${icon('cloud', 15)}${esc(t('vd.uploading', { pct: Math.round(u.pct * 100) }))}</span><span class="vbarp"><i style="width:${Math.round(u.pct * 100)}%"></i></span>`;
    else if (u?.error) state = `<span class="vsrc warn-t">${icon('alert', 15)}${esc(t('vd.upFailed', { msg: u.error }))}</span><button class="sm" data-i="up">${esc(t('vd.retry'))}</button>`;
    else if (cur.dbx) state = `<span class="vsrc">${icon('cloud', 15)}${esc(t(cur.from === 'badclip' ? 'vd.fromBc' : 'vd.inDbx'))}</span>`;
    else state = `<span class="vsrc warn-t">${icon('alert', 15)}${esc(t('vd.onlyDevice'))}</span><button class="sm primary" data-i="up">${icon('cloud', 16)}<span>${esc(t('vd.toDbx'))}</span></button>`;
    $('.vinfo', host).innerHTML = `${state}<span class="vmeta muted small">${esc([cur.title, cur.size ? fmtSize(cur.size) : ''].filter(Boolean).join(' · '))}</span>
      <span class="grow"></span><button class="sm ghost danger" data-i="rm">${icon('trash', 16)}<span>${esc(t('vd.remove'))}</span></button>`;
    const up = $('[data-i=up]', host);
    if (up) up.onclick = () => startUpload(cur.id);
    $('[data-i=rm]', host).onclick = () => {
      if (!confirm(t(cur.kind === 'yt' ? 'vd.rmYt' : 'vd.rmFile'))) return;
      St.updateGame(gameId, { video: null });
      purge(cur);
    };
  };
  upSubs.add(renderInfo);
  renderInfo();
  renderRates();
  load();
  raf = requestAnimationFrame(tick);
  stage.tabIndex = -1;

  return {
    sig,
    refresh() {
      renderInfo();
      // Beim Start ist Dropbox oft erst kurz nach der Seite verbunden – dann jetzt laden
      if (waitDbx && Sync.Y.state === 'ok' && !p) { waitDbx = false; load(); }
    },
    key(e) {
      const k = e.key;
      if (k === ' ' || k === 'k' || k === 'K') { act.toggle(); return true; }
      if (k === 'ArrowLeft') { act.back(e.shiftKey ? 1 : 5); return true; }
      if (k === 'ArrowRight') { act.fwd(e.shiftKey ? 1 : 5); return true; }
      if (k === ',') { act.fb(); return true; }
      if (k === '.') { act.ff(); return true; }
      if (k === '-') { stepRate(1); return true; }
      if (k === '+' || k === '=') { stepRate(-1); return true; }
      return false;
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      upSubs.delete(renderInfo);
      if (p) { const u = p.blobUrl; p.destroy(); if (u) URL.revokeObjectURL(u); }
    },
  };
}
