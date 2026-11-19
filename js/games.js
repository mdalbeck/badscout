// Spiele: Liste mit Suche, Detailseite, Formular (Datum, Anlass, Einzel/Doppel, Zählweise, Spieler, Gegner).
import * as St from './store.js';
import * as BT from './badteam.js';
import * as People from './people.js';
import { icon } from './icons.js';
import { t, fmtDay } from './i18n.js';
import { $, $$, esc, toast } from './ui.js';
import * as Video from './video.js';
import { mountAnalysis, resultText } from './analysis.js';
import { transferDialog } from './transfer.js';

const F = { q: '' };

// ================= Bausteine =================
/** Namen unserer Seite, z. B. „Anna / Ben“ */
export const oursText = (g) => g.ours.map((id) => People.nameOf(id, g)).join(' / ');
export const oppText = (g) => g.opp.filter(Boolean).join(' / ') || '?';
export const kindText = (g) => t(g.kind === 'double' ? 'gm.double' : 'gm.single');

export function gameRow(g) {
  const th = Video.thumbOf(g);
  return `<a class="drow gmrow" href="#/game/${g.id}">
    <span class="gmthumb">${icon('video', 18)}${th ? `<img src="${esc(th)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
    <span class="dday"><b>${esc(fmtDay(g.day, { day: 'numeric', month: 'numeric' }))}</b><span>${esc(g.day.slice(0, 4))}</span></span>
    <span class="exrow-b"><b><span class="ours">${esc(oursText(g))}</span> <span class="muted vs">${esc(t('gm.vs'))}</span> ${esc(oppText(g))}</b>
      <span class="exmeta">${g.rallies.length ? `<span class="res mono">${esc(resultText(g))}</span>` : ''}<span>${esc(kindText(g))}</span>${g.event ? `<span>${esc(g.event)}</span>` : ''}${g.video ? '' : `<span>${icon('video', 13)}${esc(t('gm.noVideo'))}</span>`}</span></span>
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
  let an = null; // Analyse (Markier-Knöpfe, Spielstand, Notizen) – hängt am Player
  const head = (g) => `
        <a class="back" href="#/games">${icon('back', 16)}${esc(t('nav.games'))}<kbd>Esc</kbd></a>
        <h1><span class="eyebrow">${esc([fmtDay(g.day), g.event, kindText(g)].filter(Boolean).join(' · '))}</span><span class="ours">${esc(oursText(g))}</span> <span class="muted vs">${esc(t('gm.vs'))}</span> ${esc(oppText(g))}</h1>
        <div class="acts">
          ${g.rallies.length ? `<a class="btn primary" id="gm-stats" href="#/game/${g.id}/stats">${icon('chart', 18)}<span>${esc(t('st.title'))}</span></a>` : ''}
          ${g.video && (g.rallies.length || g.notes.length) ? `<button id="gm-clip" title="${esc(t('tr.title'))}">${icon('library', 18)}<span>${esc(t('tr.short'))}</span></button>` : ''}
          <a class="btn" id="gm-edit" href="#/game/${g.id}/edit">${icon('edit', 18)}<span>${esc(t('gm.edit'))}</span></a>
          <button class="danger ghost" id="gm-del">${icon('trash', 18)}<span>${esc(t('gm.delete'))}</span></button>
        </div>`;
  const bindHead = (g) => {
    const clip = $('#gm-clip', el);
    if (clip) clip.onclick = () => transferDialog(id);
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
    if (!g) { vp?.destroy(); an?.destroy(); vp = an = null; return notFound(el); }
    if (!$('#gm-head', el)) {
      el.innerHTML = `
      <div class="pagehead" id="gm-head"></div>
      <div class="gmlayout">
        <div class="gmmain"><div id="gm-video"></div><div id="gm-marks"></div></div>
        <aside class="anside" id="gm-side"></aside>
      </div>`;
    }
    $('#gm-head', el).innerHTML = head(g);
    bindHead(g);
    // Video-Bereich nur neu aufbauen, wenn sich das Video selbst geändert hat
    const v = g.video;
    const sig = v ? JSON.stringify([v.kind, v.id || v.ytId, v.dbx]) : 'none';
    if (!vp || vp.sig !== sig) {
      vp?.destroy(); an?.destroy();
      vp = Video.videoPanel($('#gm-video', el), id);
      an = mountAnalysis({ marks: $('#gm-marks', el), side: $('#gm-side', el) }, id, vp.ctl || null);
    } else { vp.refresh?.(); an.refresh(); }
  };
  render();
  return {
    refresh: render,
    key(e) {
      if (an?.key(e)) return true;
      if (vp?.key(e)) return true;
      if (e.key === 'Escape') { location.hash = '#/games'; return true; }
      return false;
    },
    destroy() { vp?.destroy(); an?.destroy(); vp = an = null; },
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

  // Vorschläge: alle Spieler aus BadTeam und die weiteren Spieler (Gäste, Gegner, Profis)
  const opts = () => People.all().map((p) => `<option value="${esc(p.name)}">${esc(p.group || (p.source === 'team' ? 'BadTeam' : ''))}</option>`).join('');
  const noTeam = !BT.players().length;
  g.oppIds = g.oppIds || [];
  // Name → Spieler-ID: zuerst die bisher im Spiel stehenden, dann alle bekannten Spieler
  const known = (name, prev) => {
    const nm = String(name || '').trim().toLocaleLowerCase();
    if (!nm) return null;
    const keep = prev.find((pid) => pid && People.nameOf(pid, g).toLocaleLowerCase() === nm);
    return keep || People.findByName(name)?.id || null;
  };

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
          <h2>${icon('users', 20)} ${esc(t('gm.players'))}</h2>
          ${noTeam ? `<p class="note">${icon('alert', 16)}<span>${esc(t('gm.noTeam'))} <a href="#/backup">${esc(t('nav.backup'))}</a></span></p>` : ''}
          <datalist id="gmf-people">${opts()}</datalist>
          <div class="sides">
            <div><div class="lbl side1">${esc(t('gm.side1Long'))}</div><div id="gmf-ours"></div><p class="muted small hint">${esc(t('gm.side1Hint'))}</p></div>
            <div class="vsline"><span>${esc(t('gm.vs'))}</span></div>
            <div><div class="lbl side2">${esc(t('gm.side2'))}</div><div id="gmf-opp"></div>
              <label class="switch small"><input type="checkbox" id="gmf-saveopp"><i></i><span>${esc(t('gm.saveOpp'))}</span></label></div>
          </div>
        </section>
      </div>
    </form>`;
  const f = $('#gmf', el);
  const n = () => (kind === 'double' ? 2 : 1);
  // Felder für beide Seiten (Werte beim Umschalten Einzel/Doppel behalten)
  const field = (name, v, ph, i) => `<input name="${name}" list="gmf-people" value="${esc(v || '')}" placeholder="${esc(t(ph))}" autocomplete="off" aria-label="${esc(t(name === 'our' ? 'gm.side1' : 'gm.side2'))} ${i + 1}">`;
  const renderSides = () => {
    const ours = $$('input[name=our]', f).map((s) => s.value);
    const opp = $$('input[name=opp]', f).map((s) => s.value);
    const o = ours.length ? ours : g.ours.map((pid) => People.nameOf(pid, g)), p = opp.length ? opp : g.opp;
    $('#gmf-ours', el).innerHTML = Array.from({ length: n() }, (_, i) => field('our', o[i], i ? 'gm.ourPh2' : 'gm.ourPh', i)).join('');
    $('#gmf-opp', el).innerHTML = Array.from({ length: n() }, (_, i) => field('opp', p[i], i ? 'gm.oppPh2' : 'gm.oppPh', i)).join('');
  };
  renderSides();
  $$('[data-kind]', f).forEach((b) => { b.onclick = () => { kind = b.dataset.kind; $$('[data-kind]', f).forEach((x) => x.classList.toggle('on', x === b)); renderSides(); }; });
  $$('[data-sc]', f).forEach((b) => { b.onclick = () => { scoring = +b.dataset.sc; $$('[data-sc]', f).forEach((x) => x.classList.toggle('on', x === b)); }; });

  const read = () => ({
    day: f.day.value || St.todayIso(), event: f.event.value, kind, scoring,
    ourNames: $$('input[name=our]', f).map((x) => x.value.trim()).filter(Boolean),
    opp: $$('input[name=opp]', f).map((x) => x.value.trim()),
  });
  const initial = JSON.stringify(read());
  let saved = false;
  const dirty = () => !saved && JSON.stringify(read()) !== initial;
  const save = () => {
    const x = read();
    if (!x.ourNames.length) { toast(t('gm.needOurs')); $('input[name=our]', f)?.focus(); return; }
    // Seite 1: bekannte Spieler verknüpfen, neue Namen als weitere Spieler speichern
    const created = [];
    const resolve = (name, prev, create) => {
      const pid = known(name, prev);
      if (pid || !create) return pid;
      created.push(name);
      return St.addPlayer({ name });
    };
    const ours = [...new Set(x.ourNames.map((nm) => resolve(nm, g.ours, true)))];
    const saveOpp = $('#gmf-saveopp', f).checked;
    const oppIds = x.opp.map((nm) => (nm ? resolve(nm, g.oppIds, saveOpp) || '' : ''));
    const names = { ...g.names };
    for (const pid of [...ours, ...oppIds]) if (pid) names[pid] = People.nameOf(pid, g);
    const data = { day: x.day, event: x.event, kind, scoring, ours, names, opp: x.opp, oppIds };
    saved = true;
    if (created.length) toast(t('gm.created', { names: created.join(', ') }));
    if (id) { St.updateGame(id, data); location.hash = `#/game/${id}`; return; }
    const nid = St.addGame(data);
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
