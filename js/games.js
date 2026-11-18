// Spiele: Liste mit Suche, Detailseite, Formular (Datum, Anlass, Einzel/Doppel, Zählweise, Spieler, Gegner).
import * as St from './store.js';
import * as BT from './badteam.js';
import { icon } from './icons.js';
import { t, fmtDay } from './i18n.js';
import { $, $$, esc, toast } from './ui.js';
import * as Video from './video.js';

const F = { q: '' };

// ================= Bausteine =================
/** Namen unserer Seite, z. B. „Anna / Ben“ */
export const oursText = (g) => g.ours.map((id) => BT.nameOf(id, g)).join(' / ');
export const oppText = (g) => g.opp.filter(Boolean).join(' / ') || '?';
export const kindText = (g) => t(g.kind === 'double' ? 'gm.double' : 'gm.single');

export function gameRow(g) {
  const th = Video.thumbOf(g);
  return `<a class="drow gmrow" href="#/game/${g.id}">
    <span class="gmthumb">${icon('video', 18)}${th ? `<img src="${esc(th)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
    <span class="dday"><b>${esc(fmtDay(g.day, { day: 'numeric', month: 'numeric' }))}</b><span>${esc(g.day.slice(0, 4))}</span></span>
    <span class="exrow-b"><b><span class="ours">${esc(oursText(g))}</span> <span class="muted vs">${esc(t('gm.vs'))}</span> ${esc(oppText(g))}</b>
      <span class="exmeta"><span>${esc(kindText(g))}</span>${g.event ? `<span>${esc(g.event)}</span>` : ''}${g.video ? '' : `<span>${icon('video', 13)}${esc(t('gm.noVideo'))}</span>`}</span></span>
    <span class="badge ${g.done ? 'ok' : ''}">${esc(t(g.done ? 'gm.done' : 'gm.open'))}</span></a>`;
}

const norm = (s) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function matches(g) {
  if (!F.q) return true;
  const hay = norm([oursText(g), oppText(g), g.event, g.day].join(' '));
  return norm(F.q).split(/\s+/).every((w) => hay.includes(w));
}

// ================= Liste =================
export function gamesView(el) {
  const render = () => {
    const all = St.S.data.games;
    if (!all.length) {
      el.innerHTML = `
        <div class="pagehead"><h1><span class="eyebrow">${esc(t('gm.eyebrow'))}</span>${esc(t('gm.title'))}</h1></div>
        <div class="emptybig">${icon('lens', 44)}<p>${esc(t('gm.empty'))}</p>
          <p><a class="btn primary big" id="gm-new" href="#/game/new">${icon('plus', 20)}<span>${esc(t('gm.new'))}</span><kbd>N</kbd></a></p></div>`;
      return;
    }
    el.innerHTML = `
      <div class="pagehead">
        <h1><span class="eyebrow">${esc(t('gm.eyebrow'))}</span>${esc(t('gm.title'))}</h1>
        <div class="acts"><a class="btn primary" id="gm-new" href="#/game/new">${icon('plus', 18)}<span>${esc(t('gm.new'))}</span><kbd>N</kbd></a></div>
      </div>
      <div class="toolbar">
        <label class="field">${icon('search', 18)}<input id="gm-q" type="search" value="${esc(F.q)}" placeholder="${esc(t('gm.search'))}" autocomplete="off"><kbd>/</kbd></label>
      </div>
      <div id="gm-list"></div>`;
    renderList();
    const q = $('#gm-q', el);
    q.oninput = () => { F.q = q.value.trim(); renderList(); };
    q.onkeydown = (e) => { if (e.key === 'Escape') { q.value = ''; F.q = ''; renderList(); q.blur(); } };
  };
  const renderList = () => {
    const shown = St.gamesSorted().filter(matches);
    $('#gm-list', el).innerHTML = shown.length ? `<div class="dlist">${shown.map(gameRow).join('')}</div>` : `<p class="empty muted">${esc(t('gm.noHit'))}</p>`;
  };
  render();
  return {
    refresh: () => { if (document.activeElement !== $('#gm-q', el)) render(); else renderList(); },
    key(e) {
      if (e.key === 'n' || e.key === 'N') { location.hash = '#/game/new'; return true; }
      if (e.key === '/') { $('#gm-q', el)?.focus(); return true; }
      return false;
    },
  };
}

// ================= Detail =================
const notFound = (el) => { el.innerHTML = `<div class="pagehead"><a class="back" href="#/games">${icon('back', 16)}${esc(t('nav.games'))}</a></div><p class="empty muted">${esc(t('gm.notFound'))}</p>`; };

export function gameView(el, id) {
  let vp = null; // Video-Bereich bleibt beim Auffrischen stehen (Player läuft weiter)
  const head = (g) => `
        <a class="back" href="#/games">${icon('back', 16)}${esc(t('nav.games'))}<kbd>Esc</kbd></a>
        <h1><span class="eyebrow">${esc(fmtDay(g.day))}${g.event ? ` · ${esc(g.event)}` : ''}</span><span class="ours">${esc(oursText(g))}</span> <span class="muted vs">${esc(t('gm.vs'))}</span> ${esc(oppText(g))}</h1>
        <div class="acts">
          <a class="btn" id="gm-edit" href="#/game/${g.id}/edit">${icon('edit', 18)}<span>${esc(t('gm.edit'))}</span><kbd>E</kbd></a>
          <button class="danger ghost" id="gm-del">${icon('trash', 18)}<span>${esc(t('gm.delete'))}</span></button>
        </div>`;
  const facts = (g) => `
          <dl>
            <dt>${esc(t('gm.day'))}</dt><dd>${esc(fmtDay(g.day))}</dd>
            ${g.event ? `<dt>${esc(t('gm.event'))}</dt><dd>${esc(g.event)}</dd>` : ''}
            <dt>${esc(t('gm.kind'))}</dt><dd>${esc(kindText(g))}</dd>
            <dt>${esc(t('gm.scoring'))}</dt><dd>${esc(t(g.scoring === 15 ? 'gm.s15' : 'gm.s21'))}</dd>
            <dt>${esc(t('gm.ours'))}</dt><dd>${g.ours.map((pid) => `<a href="#/player/${pid}">${esc(BT.nameOf(pid, g))}</a>`).join('<br>')}</dd>
            <dt>${esc(t('gm.opp'))}</dt><dd>${g.opp.filter(Boolean).map(esc).join('<br>') || '–'}</dd>
          </dl>`;
  const bindHead = (g) => {
    $('#gm-del', el).onclick = () => {
      const delMsg = g.video?.kind === 'file' ? t('gm.deleteConfirmVideo') : t('gm.deleteConfirm');
      if (!confirm(delMsg)) return;
      const video = g.video;
      const undo = St.deleteGame(id);
      location.hash = '#/games';
      toast(t('gm.deleted'), t('gm.undo'), undo);
      // Eigenes Video erst löschen, wenn „Rückgängig“ nicht mehr geht
      if (video?.kind === 'file') setTimeout(() => { if (!St.game(id)) Video.purge(video); }, 8000);
    };
  };
  const render = () => {
    const g = St.game(id);
    if (!g) { vp?.destroy(); vp = null; return notFound(el); }
    if (!$('#gm-head', el)) {
      el.innerHTML = `
      <div class="pagehead" id="gm-head"></div>
      <div class="gmlayout">
        <div class="gmmain" id="gm-video"></div>
        <aside class="panel exfacts" id="gm-facts"></aside>
      </div>`;
    }
    $('#gm-head', el).innerHTML = head(g);
    $('#gm-facts', el).innerHTML = facts(g);
    bindHead(g);
    // Video-Bereich nur neu aufbauen, wenn sich das Video selbst geändert hat
    const v = g.video;
    const sig = v ? JSON.stringify([v.kind, v.id || v.ytId, v.dbx]) : 'none';
    if (!vp || vp.sig !== sig) { vp?.destroy(); vp = Video.videoPanel($('#gm-video', el), id); }
    else vp.refresh?.();
  };
  render();
  return {
    refresh: render,
    key(e) {
      if (vp?.key(e)) return true;
      if (e.key === 'Escape') { location.hash = '#/games'; return true; }
      if ((e.key === 'e' || e.key === 'E') && St.game(id)) { location.hash = `#/game/${id}/edit`; return true; }
      return false;
    },
    destroy() { vp?.destroy(); vp = null; },
  };
}

// ================= Formular =================
/** preset: Spieler-ID, die schon eingetragen sein soll (z. B. von der Spielerseite aus) */
export function gameFormView(el, id, preset = null) {
  const src = id ? St.game(id) : null;
  if (id && !src) { notFound(el); return {}; }
  const g = src ? JSON.parse(JSON.stringify(src)) : { day: St.todayIso(), event: '', kind: 'single', scoring: 21, ours: preset ? [preset] : [], opp: [], names: {} };
  const backTo = id ? `#/game/${id}` : preset ? `#/player/${preset}` : '#/games';
  let kind = g.kind, scoring = g.scoring;

  // Auswahlliste: aktive Spieler aus BadTeam nach Gruppen; dazu Spieler, die schon im Spiel stehen
  const playerOptions = (sel) => {
    const list = BT.players();
    const groups = BT.groups();
    const opt = (p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`;
    const used = new Set();
    let html = '';
    for (const gr of groups) {
      const ps = list.filter((p) => p.groups.includes(gr.id));
      if (!ps.length) continue;
      html += `<optgroup label="${esc(gr.name)}">${ps.map((p) => { used.add(p.id); return opt(p); }).join('')}</optgroup>`;
    }
    const rest = list.filter((p) => !used.has(p.id));
    if (rest.length) html += groups.length ? `<optgroup label="${esc(t('pl.noGroup'))}">${rest.map(opt).join('')}</optgroup>` : rest.map(opt).join('');
    if (sel && !list.some((p) => p.id === sel)) html += `<option value="${sel}" selected>${esc(BT.nameOf(sel, g))}</option>`;
    return `<option value="">${esc(t('gm.ourPick'))}</option>${html}`;
  };
  const noTeam = !BT.players().length;

  el.innerHTML = `
    <form id="gmf" class="exform" novalidate>
      <div class="pagehead">
        <a class="back" href="${backTo}">${icon('back', 16)}${esc(id ? t('gm.back') : t('nav.games'))}<kbd>Esc</kbd></a>
        <h1><span class="eyebrow">${esc(t('gm.eyebrow'))}</span>${esc(t(id ? 'gm.editTitle' : 'gm.newTitle'))}</h1>
        <div class="acts">
          <button type="button" class="ghost" id="gmf-no">${esc(t('gm.cancel'))}</button>
          <button type="submit" class="primary">${icon('check', 18)}<span>${esc(t('gm.save'))}</span><kbd>${esc(t('key.ctrl'))} + ↵</kbd></button>
        </div>
      </div>
      <div class="exform-grid">
        <section class="panel">
          <div class="row2">
            <label>${esc(t('gm.day'))}<input name="day" type="date" value="${esc(g.day)}"></label>
            <label>${esc(t('gm.event'))}<input name="event" value="${esc(g.event)}" placeholder="${esc(t('gm.eventPh'))}" autocomplete="off"></label>
          </div>
          <div class="row2">
            <div><div class="lbl">${esc(t('gm.kind'))}</div><div class="seg fullseg" id="gmf-kind">${['single', 'double'].map((k) => `<button type="button" data-kind="${k}" class="${kind === k ? 'on' : ''}">${esc(t(k === 'double' ? 'gm.double' : 'gm.single'))}</button>`).join('')}</div></div>
            <div><div class="lbl">${esc(t('gm.scoring'))}</div><div class="seg fullseg" id="gmf-sc">${[21, 15].map((s) => `<button type="button" data-sc="${s}" class="${scoring === s ? 'on' : ''}">${esc(t(`gm.s${s}`))}</button>`).join('')}</div></div>
          </div>
        </section>
        <section class="panel">
          <h2>${icon('users', 20)} ${esc(t('gm.ours'))}</h2>
          ${noTeam ? `<p class="note">${icon('alert', 16)}<span>${esc(t('gm.noTeam'))} <a href="#/backup">${esc(t('nav.backup'))}</a></span></p>` : `<p class="muted small hint">${esc(t('gm.oursHint'))}</p>`}
          <div class="sides">
            <div id="gmf-ours"></div>
            <div class="vsline"><span>${esc(t('gm.vs'))}</span></div>
            <div><div class="lbl">${esc(t('gm.opp'))}</div><div id="gmf-opp"></div></div>
          </div>
        </section>
      </div>
    </form>`;
  const f = $('#gmf', el);
  const n = () => (kind === 'double' ? 2 : 1);
  // Felder für unsere Seite und die Gegner (Werte beim Umschalten Einzel/Doppel behalten)
  const renderSides = () => {
    const ours = $$('select[name=our]', f).map((s) => s.value);
    const opp = $$('input[name=opp]', f).map((s) => s.value);
    const o = ours.length ? ours : g.ours, p = opp.length ? opp : g.opp;
    $('#gmf-ours', el).innerHTML = Array.from({ length: n() }, (_, i) => `<select name="our" aria-label="${esc(t('gm.ours'))} ${i + 1}">${playerOptions(o[i] || '')}</select>`).join('');
    $('#gmf-opp', el).innerHTML = Array.from({ length: n() }, (_, i) => `<input name="opp" value="${esc(p[i] || '')}" placeholder="${esc(t(i ? 'gm.oppPh2' : 'gm.oppPh'))}" autocomplete="off">`).join('');
  };
  renderSides();
  $$('[data-kind]', f).forEach((b) => { b.onclick = () => { kind = b.dataset.kind; $$('[data-kind]', f).forEach((x) => x.classList.toggle('on', x === b)); renderSides(); }; });
  $$('[data-sc]', f).forEach((b) => { b.onclick = () => { scoring = +b.dataset.sc; $$('[data-sc]', f).forEach((x) => x.classList.toggle('on', x === b)); }; });

  const read = () => {
    const ours = [...new Set($$('select[name=our]', f).map((s) => s.value).filter(Boolean))];
    const names = { ...g.names };
    for (const pid of ours) names[pid] = BT.nameOf(pid, g);
    return { day: f.day.value || St.todayIso(), event: f.event.value, kind, scoring, ours, names, opp: $$('input[name=opp]', f).map((s) => s.value.trim()) };
  };
  const initial = JSON.stringify(read());
  let saved = false;
  const dirty = () => !saved && JSON.stringify(read()) !== initial;
  const save = () => {
    const x = read();
    if (!x.ours.length) { toast(t('gm.needOurs')); $('select[name=our]', f)?.focus(); return; }
    saved = true;
    if (id) { St.updateGame(id, x); location.hash = `#/game/${id}`; return; }
    const nid = St.addGame(x);
    location.hash = `#/game/${nid}`;
  };
  $('#gmf-no', el).onclick = () => { location.hash = backTo; };
  f.onkeydown = (ev) => {
    if (ev.key === 'Enter' && !(ev.ctrlKey || ev.metaKey) && ev.target.tagName === 'INPUT') ev.preventDefault(); // Enter speichert nicht aus Versehen
    else if (ev.key === 'Escape' && ev.target.matches('input, textarea, select')) { ev.preventDefault(); ev.target.blur(); }
  };
  f.onsubmit = (ev) => { ev.preventDefault(); save(); };
  return {
    canLeave: () => !dirty() || confirm(t('gm.unsaved')),
    isDirty: dirty,
    submit: save,
    key(e) { if (e.key === 'Escape') { location.hash = backTo; return true; } return false; },
  };
}
