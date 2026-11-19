// Analyse eines Spiels: Ballwechsel markieren (wer macht den Punkt und wie), Spielstand automatisch mitzählen,
// Notizen an Zeitstellen, Liste der Ballwechsel zum Korrigieren. Die Zeitleiste zeichnet der Player (video.js).
import * as St from './store.js';
import * as BT from './badteam.js';
import * as People from './people.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, $$, esc, toast, modal, closeModal } from './ui.js';
import { fmtTime } from './video.js';

// ================= Spielstand =================
export const rules = (scoring) => (scoring === 15 ? { to: 15, cap: 21, mid: 8 } : { to: 21, cap: 30, mid: 11 });

/**
 * Zählt den Spielstand aus den Ballwechseln (nach Ende-Zeit sortiert).
 * rows: je Ballwechsel { r, set (1–3), us, them (Stand danach), setEnd, matchEnd, change (Seitenwechsel im 3. Satz), extra (nach Spielende) }
 * sets: fertige Sätze [{ us, them, win }], cur: laufender Satz { us, them, n }, won: { us, them }, over: Spiel vorbei
 */
export function compute(game) {
  const R = rules(game.scoring);
  const rows = [], sets = [];
  const won = { us: 0, them: 0 };
  let cur = { us: 0, them: 0 }, over = false;
  for (const r of [...game.rallies].sort((a, b) => a.t1 - b.t1)) {
    if (over) { rows.push({ r, extra: true, set: sets.length, us: cur.us, them: cur.them }); continue; }
    cur[r.win]++;
    const hi = Math.max(cur.us, cur.them), lo = Math.min(cur.us, cur.them);
    const setEnd = (hi >= R.to && hi - lo >= 2) || hi === R.cap;
    const change = sets.length === 2 && !setEnd && cur[r.win] === R.mid && cur[r.win === 'us' ? 'them' : 'us'] < R.mid;
    const row = { r, set: sets.length + 1, us: cur.us, them: cur.them, setEnd, change, matchEnd: false };
    if (setEnd) {
      sets.push({ us: cur.us, them: cur.them, win: r.win });
      won[r.win]++;
      cur = { us: 0, them: 0 };
      if (won[r.win] === 2) { over = true; row.matchEnd = true; }
    }
    rows.push(row);
  }
  return { rows, sets, cur, won, over, set: over ? sets.length : sets.length + 1, last: rows.filter((x) => !x.extra).at(-1) || null };
}
/** Ergebnis als Text, z. B. „21:15 18:21 21:19“ (laufender Satz in Klammern) */
export function resultText(game) {
  const c = compute(game);
  const parts = c.sets.map((s) => `${s.us}:${s.them}`);
  if (!c.over && (c.cur.us || c.cur.them)) parts.push(`(${c.cur.us}:${c.cur.them})`);
  return parts.join(' ');
}

// ================= Arten & Schlagarten =================
export const typeName = (ty) => ty?.name || (ty ? t(`ty.${ty.id}`) : '?');
export const types = () => St.settings().types;
export const typeOf = (id) => types().find((x) => x.id === id) || null;
export const shotName = (s) => (St.DEFAULT_SHOTS.includes(s) ? t(`sh.${s}`) : s);
const KEYS_US = ['q', 'w', 'e', 'r', 't'];
const KEYS_THEM = ['a', 's', 'd', 'f', 'g'];

/** Spieler einer Seite: [{ id, name }] – unsere aus BadTeam, Gegner als o0/o1 */
export function sidePlayers(g, side) {
  if (side === 'us') return g.ours.map((id) => ({ id, name: People.nameOf(id, g) }));
  return g.opp.map((name, i) => ({ id: `o${i}`, name: name || `${t('gm.opp')} ${i + 1}` })).slice(0, g.kind === 'double' ? 2 : 1);
}
export const byName = (g, by) => (!by ? '' : by.startsWith('o') && by.length === 2 ? sidePlayers(g, 'them').find((p) => p.id === by)?.name || '' : People.nameOf(by, g));
/** Wer hat den Punkt gemacht? Beim Winner die Gewinnerseite, beim Fehler die andere Seite */
export const actorSide = (r) => (typeOf(r.type)?.kind === 'win' ? r.win : r.win === 'us' ? 'them' : 'us');

// ================= Analyse-Bereich =================
/**
 * hosts: { marks, side } – Elemente für die Markier-Knöpfe (unter dem Video) und die Seitenleiste
 * ctl: Steuerung des Players (oder null, wenn es kein Video gibt)
 */
export function mountAnalysis(hosts, gameId, ctl) {
  let startAt = null;   // per Taste gesetzter Beginn des nächsten Ballwechsels
  let lastId = null;    // zuletzt markierter Ballwechsel (für Details und Rückgängig)
  let tab = 'notes';
  let noteT = null, resumeAfterNote = false;
  let lastSummary = '';

  const g = () => St.game(gameId);

  // ---------- Markier-Knöpfe ----------
  const renderMarks = () => {
    if (!hosts.marks) return;
    if (!ctl) { hosts.marks.innerHTML = ''; return; }
    const game = g(), ty = types();
    const side = (s) => `<div class="mk-side mk-${s}">
        <div class="mk-h">${esc(People.pointLabel(game, s))}<small>${esc(sidePlayers(game, s).map((p) => p.name).join(' / '))}</small></div>
        <div class="mk-btns">${ty.map((x, i) => `<button class="mk" data-mk="${s}:${x.id}"><span>${esc(typeName(x))}</span><kbd>${(s === 'us' ? KEYS_US : KEYS_THEM)[i].toUpperCase()}</kbd></button>`).join('')}</div>
      </div>`;
    hosts.marks.innerHTML = `<section class="panel marks">
        <div class="mk-top">
          <button class="sm" id="mk-start" title="${esc(t('an.startHint'))}">${icon('marker', 16)}<span>${esc(t('an.start'))}</span><kbd>B</kbd></button>
          <span class="mk-score" id="mk-score"></span>
          <span class="muted small" id="mk-startinfo"></span>
          <span class="grow"></span>
          <button class="sm ghost" id="mk-undo">${icon('undo', 16)}<span>${esc(t('an.undo'))}</span><kbd>Z</kbd></button>
          <button class="sm ghost" id="mk-set" title="${esc(t('an.setup'))}">${icon('gear', 16)}<span>${esc(t('an.setupShort'))}</span></button>
        </div>
        <div class="mk-grid">${side('us')}${side('them')}</div>
        <div id="mk-last"></div>
      </section>`;
    $$('[data-mk]', hosts.marks).forEach((b) => (b.onclick = () => { const [s, id] = b.dataset.mk.split(':'); mark(s, id); }));
    $('#mk-start', hosts.marks).onclick = setStart;
    $('#mk-undo', hosts.marks).onclick = undoLast;
    $('#mk-set', hosts.marks).onclick = setupDialog;
    renderStartInfo();
    renderLast();
  };
  const renderStartInfo = () => {
    const el = hosts.marks && $('#mk-startinfo', hosts.marks);
    if (el) el.textContent = startAt != null ? t('an.startSet', { t: fmtTime(startAt) }) : '';
  };

  // Letzter Ballwechsel: Schlagart und Spieler nachtragen (freiwillig)
  const renderLast = () => {
    const el = hosts.marks && $('#mk-last', hosts.marks);
    if (!el) return;
    const game = g();
    const r = game?.rallies.find((x) => x.id === lastId);
    if (!r) { el.innerHTML = `<p class="muted small mk-help">${esc(t('an.help'))}</p>`; return; }
    const row = compute(game).rows.find((x) => x.r.id === r.id);
    const actor = actorSide(r);
    const players = sidePlayers(game, actor);
    const shots = St.settings().shots;
    el.innerHTML = `<div class="mk-last mk-${r.win}">
        <div class="mk-lh"><b>${esc(People.pointLabel(game, r.win))} · ${esc(typeName(typeOf(r.type)))}</b>
          ${row && !row.extra ? `<span class="mono">${row.us}:${row.them}</span>` : ''}<span class="muted small mono">${fmtTime(r.t0)}–${fmtTime(r.t1)}</span>
          <span class="grow"></span><button class="sm ghost" data-ed="${r.id}">${icon('edit', 15)}<span>${esc(t('an.edit'))}</span></button></div>
        ${shots.length ? `<div class="mk-chips"><span class="muted small">${esc(t('an.shot'))}</span>${shots.map((s, i) => `<button class="chip ${r.shot === s ? 'on' : ''}" data-shot="${esc(s)}">${esc(shotName(s))}<kbd>${i + 1}</kbd></button>`).join('')}</div>` : ''}
        ${players.length > 1 ? `<div class="mk-chips"><span class="muted small">${esc(t(typeOf(r.type)?.kind === 'win' ? 'an.byWin' : 'an.byErr'))}</span>${players.map((p) => `<button class="chip ${r.by === p.id ? 'on' : ''}" data-by="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>` : ''}
      </div>`;
    $$('[data-shot]', el).forEach((b) => (b.onclick = () => St.updateRally(gameId, r.id, { shot: r.shot === b.dataset.shot ? '' : b.dataset.shot })));
    $$('[data-by]', el).forEach((b) => (b.onclick = () => St.updateRally(gameId, r.id, { by: r.by === b.dataset.by ? '' : b.dataset.by })));
    $('[data-ed]', el).onclick = () => editRally(r.id);
  };

  // ---------- Markieren ----------
  function mark(win, typeId) {
    if (!ctl?.ready()) return toast(t('an.noVideo'));
    const game = g();
    const t1 = ctl.time();
    const before = game.rallies.filter((x) => x.t1 <= t1).at(-1);
    let t0 = startAt != null && startAt < t1 ? startAt : Math.max(before?.t1 ?? 0, t1 - 30);
    const ty = typeOf(typeId);
    const actor = ty?.kind === 'win' ? win : win === 'us' ? 'them' : 'us';
    const ps = sidePlayers(game, actor);
    const prevSets = compute(game).sets.length;
    lastId = St.addRally(gameId, { t0, t1, win, type: typeId, shot: '', by: ps.length === 1 ? ps[0].id : '' });
    startAt = null;
    // Satzende, Spielende, Seitenwechsel ansagen
    const c = compute(g());
    const row = c.rows.find((x) => x.r.id === lastId);
    if (row?.matchEnd) toast(t('an.matchEnd', { res: resultText(g()) }));
    else if (row?.setEnd) toast(t('an.setEnd', { n: row.set, us: row.us, them: row.them }));
    else if (row?.change) toast(t('an.change'));
    else if (row?.extra) toast(t('an.afterEnd'));
    else if (c.sets.length !== prevSets) toast(t('an.recount'));
  }
  function setStart() {
    if (!ctl?.ready()) return;
    startAt = ctl.time();
    renderStartInfo();
  }
  function undoLast() {
    const game = g();
    // Zuletzt eingegebener Ballwechsel, sonst der letzte im Video
    const r = game.rallies.find((x) => x.id === lastId) || [...game.rallies].sort((a, b) => a.t1 - b.t1).at(-1);
    if (!r) return;
    const undo = St.deleteRally(gameId, r.id);
    lastId = null;
    toast(t('an.deleted'), t('gm.undo'), () => { undo(); lastId = r.id; });
  }

  // ---------- Seitenleiste: Spielstand, Notizen, Ballwechsel ----------
  const renderScore = () => {
    const game = g(), c = compute(game);
    const n = game.rallies.length;
    const server = c.last && !c.last.setEnd ? c.last.r.win : c.last?.setEnd ? c.last.r.win : null;
    const cur = c.over ? c.sets.at(-1) : c.cur;
    $('#an-score', hosts.side).innerHTML = `
      <div class="sc-top"><span class="eyebrow">${esc(c.over ? t('an.final') : t('an.setN', { n: c.set }))}</span>
        <label class="switch"><input type="checkbox" id="an-done" ${game.done ? 'checked' : ''}><i></i><span>${esc(t('an.done'))}</span></label></div>
      <div class="sc-main">
        <div class="sc-side sc-us ${server === 'us' && !c.over ? 'srv' : ''}"><small>${esc(sidePlayers(game, 'us').map((p) => p.name).join(' / '))}</small><b>${cur.us}</b></div>
        <span class="sc-colon">:</span>
        <div class="sc-side sc-them ${server === 'them' && !c.over ? 'srv' : ''}"><small>${esc(sidePlayers(game, 'them').map((p) => p.name).join(' / '))}</small><b>${cur.them}</b></div>
      </div>
      ${c.sets.length ? `<div class="sc-sets">${c.sets.map((s, i) => `<span class="${s.win === 'us' ? 'w' : 'l'}"><small>${i + 1}.</small> ${s.us}:${s.them}</span>`).join('')}</div>` : ''}
      <p class="muted small sc-n">${esc(n === 1 ? t('an.oneRally') : t('an.nRallies', { n }))} · ${esc(t(game.scoring === 15 ? 'gm.s15' : 'gm.s21'))}</p>`;
    $('#an-done', hosts.side).onchange = (e) => {
      St.updateGame(gameId, { done: e.target.checked });
      if (e.target.checked) toast(t('an.doneToast'), t('st.title'), () => (location.hash = `#/game/${gameId}/stats`));
    };
    // Kurzer Stand an den Knöpfen (am Handy/Tablet steht die Seitenleiste weiter unten)
    const ms = hosts.marks && $('#mk-score', hosts.marks);
    if (ms) ms.innerHTML = `<b class="us">${cur.us}</b>:<b class="them">${cur.them}</b><small>${esc(c.over ? t('an.final') : t('an.setN', { n: c.set }))}${c.sets.length ? ` · ${c.sets.map((x) => `${x.us}:${x.them}`).join(' ')}` : ''}</small>`;
  };

  const renderTabs = () => {
    const game = g();
    $('#an-tabs', hosts.side).innerHTML = `
      <div class="seg fullseg an-tabsw">
        <button data-tab="notes" class="${tab === 'notes' ? 'on' : ''}">${icon('note', 16)}<span>${esc(t('an.notes'))} <small>${game.notes.length}</small></span></button>
        <button data-tab="rallies" class="${tab === 'rallies' ? 'on' : ''}">${icon('list', 16)}<span>${esc(t('an.rallies'))} <small>${game.rallies.length}</small></span></button>
      </div>
      <div id="an-list"></div>`;
    $$('[data-tab]', hosts.side).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderTabs(); }));
    if (tab === 'notes') renderNotes(); else renderRallies();
  };

  // Notizen: Eingabe oben, Liste nach Zeit
  const renderNotes = () => {
    const game = g(), set = St.settings();
    $('#an-list', hosts.side).innerHTML = `
      ${ctl ? `<div class="nt-new">
        <textarea id="nt-in" rows="2" placeholder="${esc(t('an.notePh'))}"></textarea>
        <div class="nt-row"><span class="muted small" id="nt-at">${esc(t('an.noteKey'))}</span><span class="grow"></span>
          <label class="switch small"><input type="checkbox" id="nt-pause" ${set.notePause ? 'checked' : ''}><i></i><span>${esc(t('an.notePause'))}</span></label></div>
      </div>` : ''}
      <div class="nt-list">${game.notes.map((n) => `<div class="nt" data-nid="${n.id}">
          <button class="tchip mono" data-seek="${n.t}">${fmtTime(n.t)}</button>
          <span class="nt-text pre" data-edit="${n.id}">${esc(n.text)}</span>
          <button class="ib sm" data-del="${n.id}" title="${esc(t('gm.delete'))}">${icon('x', 15)}</button></div>`).join('') || `<p class="muted small">${esc(t('an.noNotes'))}</p>`}</div>`;
    const inp = $('#nt-in', hosts.side);
    if (inp) {
      inp.onfocus = () => beginNote(false);
      inp.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); }
        else if (e.key === 'Escape') { e.preventDefault(); inp.value = ''; endNote(); inp.blur(); renderTabs(); }
      };
      $('#nt-pause', hosts.side).onchange = (e) => St.setSettings({ notePause: e.target.checked });
    }
    bindList();
    $$('[data-edit]', hosts.side).forEach((x) => (x.onclick = async () => {
      const n = g().notes.find((y) => y.id === x.dataset.edit);
      const text = prompt(t('an.noteEdit'), n.text);
      if (text == null) return;
      if (text.trim()) St.updateNote(gameId, n.id, { text }); else St.deleteNote(gameId, n.id);
    }));
    $$('[data-del]', hosts.side).forEach((b) => (b.onclick = () => { const undo = St.deleteNote(gameId, b.dataset.del); toast(t('an.noteDeleted'), t('gm.undo'), undo); }));
  };
  function beginNote(focus = true) {
    if (!ctl) return;
    if (tab !== 'notes') { tab = 'notes'; renderTabs(); }
    if (noteT == null) {
      noteT = ctl.time();
      if (St.settings().notePause && !ctl.paused()) { ctl.pause(); resumeAfterNote = true; }
    }
    const at = $('#nt-at', hosts.side);
    if (at) at.textContent = t('an.noteAt', { t: fmtTime(noteT) });
    if (focus) $('#nt-in', hosts.side)?.focus();
  }
  function endNote() {
    noteT = null;
    if (resumeAfterNote) { resumeAfterNote = false; ctl?.play(); }
  }
  function saveNote() {
    const inp = $('#nt-in', hosts.side);
    const text = inp.value.trim();
    if (text) St.addNote(gameId, { t: noteT ?? ctl.time(), text });
    inp.value = '';
    endNote();
    inp.blur();
    renderTabs(); // während des Schreibens wurde die Liste nicht neu gezeichnet
  }

  // Ballwechsel-Liste (neueste oben) mit Stand, Art, Zeit
  const renderRallies = () => {
    const game = g(), c = compute(game);
    let html = '', set = 0;
    for (const row of [...c.rows].reverse()) {
      if (row.set !== set) { set = row.set; html += `<div class="rl-set">${esc(row.extra ? t('an.extra') : t('an.setN', { n: row.set }))}</div>`; }
      const r = row.r;
      html += `<div class="rl rl-${r.win}">
          <button class="tchip mono" data-seek="${r.t0}">${fmtTime(r.t0)}</button>
          <span class="rl-sc mono">${row.extra ? '–' : `${row.us}:${row.them}`}</span>
          <span class="rl-b"><b>${esc(typeName(typeOf(r.type)))}</b><small>${esc([r.shot ? shotName(r.shot) : '', byName(game, r.by)].filter(Boolean).join(' · '))}</small></span>
          <button class="ib sm" data-ed="${r.id}" title="${esc(t('an.edit'))}">${icon('edit', 15)}</button></div>`;
    }
    $('#an-list', hosts.side).innerHTML = html || `<p class="muted small">${esc(t('an.noRallies'))}</p>`;
    bindList();
    $$('[data-ed]', $('#an-list', hosts.side)).forEach((b) => (b.onclick = () => editRally(b.dataset.ed)));
  };
  const bindList = () => $$('[data-seek]', hosts.side).forEach((b) => (b.onclick = () => { if (ctl?.ready()) { ctl.seek(+b.dataset.seek); } }));

  // ---------- Ballwechsel bearbeiten ----------
  function editRally(rid) {
    const game = g(), r = game.rallies.find((x) => x.id === rid);
    if (!r) return;
    let x = { ...r };
    const d = modal(`<h2>${esc(t('an.editTitle'))}</h2><div id="er-body"></div>
      <div class="dlg-actions"><button class="danger ghost" id="er-del">${icon('trash', 16)}<span>${esc(t('gm.delete'))}</span></button><span class="grow"></span>
        <button class="ghost" id="er-no">${esc(t('gm.cancel'))}</button><button class="primary" id="er-ok">${esc(t('gm.save'))}</button></div>`, 'wide');
    const draw = () => {
      const actor = typeOf(x.type)?.kind === 'win' ? x.win : x.win === 'us' ? 'them' : 'us';
      $('#er-body', d).innerHTML = `
        <div class="lbl">${esc(t('an.who'))}</div>
        <div class="seg fullseg">${['us', 'them'].map((s) => `<button data-w="${s}" class="${x.win === s ? 'on' : ''}">${esc(People.pointLabel(game, s))}</button>`).join('')}</div>
        <div class="lbl" style="margin-top:12px">${esc(t('an.how'))}</div>
        <div class="chips">${types().map((ty) => `<button class="chip ${x.type === ty.id ? 'on' : ''}" data-ty="${ty.id}">${esc(typeName(ty))}</button>`).join('')}</div>
        <div class="lbl">${esc(t('an.shot'))}</div>
        <div class="chips">${St.settings().shots.map((s) => `<button class="chip ${x.shot === s ? 'on' : ''}" data-sh="${esc(s)}">${esc(shotName(s))}</button>`).join('')}</div>
        <div class="lbl">${esc(t(typeOf(x.type)?.kind === 'win' ? 'an.byWin' : 'an.byErr'))}</div>
        <div class="chips">${sidePlayers(game, actor).map((p) => `<button class="chip ${x.by === p.id ? 'on' : ''}" data-by="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>
        <div class="row2">
          <div><div class="lbl">${esc(t('an.from'))}</div><div class="er-time"><span class="mono">${fmtTime(x.t0)}</span>${ctl ? `<button class="sm" data-now="t0">${esc(t('an.now'))}</button>` : ''}</div></div>
          <div><div class="lbl">${esc(t('an.to'))}</div><div class="er-time"><span class="mono">${fmtTime(x.t1)}</span>${ctl ? `<button class="sm" data-now="t1">${esc(t('an.now'))}</button>` : ''}</div></div>
        </div>`;
      $$('[data-w]', d).forEach((b) => (b.onclick = () => { x.win = b.dataset.w; x.by = ''; draw(); }));
      $$('[data-ty]', d).forEach((b) => (b.onclick = () => { const k = typeOf(x.type)?.kind; x.type = b.dataset.ty; if (typeOf(x.type)?.kind !== k) x.by = ''; draw(); }));
      $$('[data-sh]', d).forEach((b) => (b.onclick = () => { x.shot = x.shot === b.dataset.sh ? '' : b.dataset.sh; draw(); }));
      $$('[data-by]', d).forEach((b) => (b.onclick = () => { x.by = x.by === b.dataset.by ? '' : b.dataset.by; draw(); }));
      $$('[data-now]', d).forEach((b) => (b.onclick = () => { x[b.dataset.now] = ctl.time(); if (x.t0 > x.t1) [x.t0, x.t1] = [x.t1, x.t0]; draw(); }));
    };
    draw();
    $('#er-no', d).onclick = closeModal;
    $('#er-ok', d).onclick = () => {
      // Einzel: Spieler ergibt sich von selbst
      const actor = typeOf(x.type)?.kind === 'win' ? x.win : x.win === 'us' ? 'them' : 'us';
      const ps = sidePlayers(game, actor);
      if (!x.by && ps.length === 1) x.by = ps[0].id;
      St.updateRally(gameId, rid, { win: x.win, type: x.type, shot: x.shot, by: x.by, t0: x.t0, t1: x.t1 });
      closeModal();
    };
    $('#er-del', d).onclick = () => { closeModal(); const undo = St.deleteRally(gameId, rid); if (lastId === rid) lastId = null; toast(t('an.deleted'), t('gm.undo'), undo); };
  }

  // ---------- Knöpfe einstellen ----------
  function setupDialog() {
    let list = types().map((x) => ({ ...x }));
    let shots = [...St.settings().shots];
    const d = modal(`<h2>${icon('gear', 20)} ${esc(t('an.setup'))}</h2><p class="muted small">${esc(t('an.setupText'))}</p><div id="su-body"></div>
      <div class="dlg-actions"><button class="ghost" id="su-reset">${esc(t('an.reset'))}</button><span class="grow"></span>
        <button class="ghost" id="su-no">${esc(t('gm.cancel'))}</button><button class="primary" id="su-ok">${esc(t('gm.save'))}</button></div>`, 'wide');
    const draw = () => {
      $('#su-body', d).innerHTML = `
        <h3>${esc(t('an.howTitle'))}</h3>
        <div class="su-list">${list.map((x, i) => `<div class="su-row">
            <span class="su-keys"><kbd>${KEYS_US[i].toUpperCase()}</kbd><kbd>${KEYS_THEM[i].toUpperCase()}</kbd></span>
            <input data-name="${i}" value="${esc(x.name || typeName(x))}" maxlength="24">
            <select data-kind="${i}"><option value="win" ${x.kind === 'win' ? 'selected' : ''}>${esc(t('an.kindWin'))}</option><option value="err" ${x.kind === 'err' ? 'selected' : ''}>${esc(t('an.kindErr'))}</option></select>
            <button class="ib sm" data-rm="${i}" ${list.length < 2 ? 'disabled' : ''} title="${esc(t('gm.delete'))}">${icon('x', 15)}</button></div>`).join('')}</div>
        ${list.length < St.MAX_TYPES ? `<button class="sm" id="su-add">${icon('plus', 16)}<span>${esc(t('an.addType'))}</span></button>` : ''}
        <h3>${esc(t('an.shotsTitle'))}</h3>
        <label>${esc(t('an.shotsLabel'))}<input id="su-shots" value="${esc(shots.map(shotName).join(', '))}"></label>`;
      $$('[data-name]', d).forEach((inp) => (inp.oninput = () => { const x = list[+inp.dataset.name]; x.name = inp.value.trim() === typeName({ ...x, name: '' }) ? '' : inp.value; }));
      $$('[data-kind]', d).forEach((sel) => (sel.onchange = () => { list[+sel.dataset.kind].kind = sel.value; }));
      $$('[data-rm]', d).forEach((b) => (b.onclick = () => { list.splice(+b.dataset.rm, 1); draw(); }));
      const add = $('#su-add', d);
      if (add) add.onclick = () => { list.push({ id: St.uid().slice(0, 8), name: t('an.newType'), kind: 'err' }); draw(); };
    };
    draw();
    const readShots = () => $('#su-shots', d).value.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => St.DEFAULT_SHOTS.find((k) => t(`sh.${k}`).toLowerCase() === s.toLowerCase()) || s);
    $('#su-no', d).onclick = closeModal;
    $('#su-reset', d).onclick = () => { list = St.DEFAULT_TYPES.map((x) => ({ ...x })); shots = [...St.DEFAULT_SHOTS]; draw(); };
    $('#su-ok', d).onclick = () => {
      St.setSettings({ types: list.map((x) => ({ ...x, name: x.name.trim() })), shots: readShots() });
      closeModal();
      toast(t('an.saved'));
    };
  }

  // ---------- Zeitleiste ----------
  const renderTimeline = () => {
    if (!ctl) return;
    const game = g(), c = compute(game);
    const items = c.rows.map((row) => ({ t0: row.r.t0, t1: row.r.t1, cls: `${row.r.win}${row.setEnd ? ' setend' : ''}`, title: `${fmtTime(row.r.t1)} · ${row.extra ? '' : `${row.us}:${row.them} · `}${typeName(typeOf(row.r.type))}` }));
    for (const n of game.notes) items.push({ t: n.t, cls: 'note', title: `${fmtTime(n.t)} · ${n.text}` });
    ctl.setItems(items);
  };

  // ---------- Aufbau ----------
  hosts.side.innerHTML = `<section class="panel an-score" id="an-score"></section><section class="panel an-tabs" id="an-tabs"></section>`;
  const render = () => {
    if (!g()) return;
    const sum = JSON.stringify([types(), St.settings().shots, g().ours, g().opp, g().kind, sidePlayers(g(), 'us').map((p) => p.name)]);
    if (sum !== lastSummary || !hosts.marks?.firstChild) { lastSummary = sum; renderMarks(); } else renderLast();
    renderScore();
    // Notiz-Eingabe nicht wegwerfen, während jemand schreibt
    const typing = document.activeElement?.id === 'nt-in';
    if (!typing) renderTabs();
    renderTimeline();
  };
  render();

  return {
    refresh: render,
    key(e) {
      if (!ctl) return false;
      const k = e.key.toLowerCase();
      const iu = KEYS_US.indexOf(k), it = KEYS_THEM.indexOf(k), ty = types();
      if (iu >= 0 && ty[iu]) { mark('us', ty[iu].id); return true; }
      if (it >= 0 && ty[it]) { mark('them', ty[it].id); return true; }
      if (k === 'b') { setStart(); return true; }
      if (k === 'n') { beginNote(true); return true; }
      if (k === 'z' || e.key === 'Backspace') { undoLast(); return true; }
      if (/^[1-9]$/.test(e.key)) {
        const s = St.settings().shots[+e.key - 1], r = g().rallies.find((x) => x.id === lastId);
        if (s && r) { St.updateRally(gameId, r.id, { shot: r.shot === s ? '' : s }); return true; }
      }
      return false;
    },
    destroy() {},
  };
}
