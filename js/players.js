// Spieler: aus BadTeam (nur lesen) und weitere Spieler, die nur in BadScout liegen (Gäste, Gegner, Profis …).
// Liste nach Gruppen, Spielerseite mit allen Spielen (egal auf welcher Seite) und der Auswertung über die Saison.
import * as St from './store.js';
import * as BT from './badteam.js';
import * as People from './people.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, $$, esc, toast, modal, closeModal } from './ui.js';
import { gameRow } from './games.js';
import { seasonBlock, periods } from './stats.js';
import { bindTips } from './charts.js';

let period = 'season';
const GROUP_IDEAS = () => [t('pl.gProfi'), t('pl.gOpp'), t('pl.gGuest')];

export const initials = (name) => (name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
/** Alle Spiele eines Spielers – auf Seite 1 oder Seite 2 */
export const gamesOf = (pid) => St.gamesSorted().filter((g) => People.sideOf(g, pid));
const countText = (n) => (n === 1 ? t('gm.oneGame') : t('gm.nGames', { n }));

function playerRow(id, name, own = false) {
  const n = gamesOf(id).length;
  return `<a class="exrow plrow ${own ? 'own' : ''}" href="#/player/${encodeURIComponent(id)}"><span class="avatar">${esc(initials(name))}</span>
    <span class="exrow-b"><b>${esc(name)}</b><span class="exmeta"><span>${esc(countText(n))}</span>${own && St.player(id)?.note ? `<span>${esc(St.player(id).note)}</span>` : ''}</span></span>${icon('right', 18)}</a>`;
}

/** Weiteren Spieler anlegen oder ändern */
export function personDialog(id = null, onSaved = () => {}) {
  const p = id ? St.player(id) : { name: '', group: '', note: '' };
  const groups = [...new Set([...GROUP_IDEAS(), ...St.S.data.players.map((x) => x.group).filter(Boolean)])];
  const d = modal(`<h2>${icon('userplus', 20)} ${esc(t(id ? 'pl.editOwn' : 'pl.newOwn'))}</h2>
    <p class="muted small">${esc(t('pl.ownText'))}</p>
    <label>${esc(t('pl.name'))}<input id="pd-name" value="${esc(p.name)}" autocomplete="off" placeholder="${esc(t('pl.namePh'))}"></label>
    <label>${esc(t('pl.group'))}<input id="pd-group" list="pd-groups" value="${esc(p.group)}" autocomplete="off" placeholder="${esc(t('pl.groupPh'))}"></label>
    <datalist id="pd-groups">${groups.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="chips">${groups.map((x) => `<button type="button" class="chip" data-g="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <label>${esc(t('pl.note'))}<input id="pd-note" value="${esc(p.note)}" autocomplete="off" placeholder="${esc(t('pl.notePh'))}"></label>
    <div class="dlg-actions"><span class="grow"></span><button class="ghost" id="pd-no">${esc(t('gm.cancel'))}</button><button class="primary" id="pd-ok">${esc(t('gm.save'))}</button></div>`);
  $$('[data-g]', d).forEach((b) => (b.onclick = () => { $('#pd-group', d).value = b.dataset.g; }));
  const ok = () => {
    const x = { name: $('#pd-name', d).value, group: $('#pd-group', d).value, note: $('#pd-note', d).value };
    if (!x.name.trim()) { toast(t('pl.nameMissing')); $('#pd-name', d).focus(); return; }
    const other = People.findByName(x.name);
    if (other && other.id !== id && !confirm(t('pl.sameName', { name: x.name.trim() }))) return;
    let nid = id;
    if (id) St.updatePlayer(id, x); else nid = St.addPlayer(x);
    closeModal();
    onSaved(nid);
  };
  $('#pd-ok', d).onclick = ok;
  $('#pd-no', d).onclick = closeModal;
  d.querySelectorAll('input').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }));
  setTimeout(() => $('#pd-name', d).focus(), 30);
}

export function playersView(el) {
  const render = () => {
    const list = BT.players();
    const own = St.playersSorted();
    // Spieler mit Spielen, die in BadTeam pausiert oder nicht (mehr) da sind, trotzdem zeigen
    const extra = new Map();
    for (const g of St.S.data.games) for (const pid of g.ours) if (!People.person(pid) || (BT.player(pid) && !BT.player(pid).active)) extra.set(pid, People.nameOf(pid, g));
    const used = new Set();
    let team = '';
    for (const gr of BT.groups()) {
      const ps = list.filter((p) => p.groups.includes(gr.id));
      if (!ps.length) continue;
      ps.forEach((p) => used.add(p.id));
      team += `<section class="exgroup"><h2 class="exgroup-h">${esc(gr.name)} <span class="gcount">${ps.length}</span></h2><div class="exlist">${ps.map((p) => playerRow(p.id, p.name)).join('')}</div></section>`;
    }
    const rest = [...list.filter((p) => !used.has(p.id)).map((p) => [p.id, p.name]), ...extra];
    if (rest.length) team += `<section class="exgroup"><h2 class="exgroup-h">${esc(t('pl.noGroup'))} <span class="gcount">${rest.length}</span></h2><div class="exlist">${rest.map(([id, name]) => playerRow(id, name)).join('')}</div></section>`;
    // Weitere Spieler nach ihrer Gruppe
    const byGroup = new Map();
    for (const p of own) { const k = p.group || t('pl.noGroup'); byGroup.set(k, [...(byGroup.get(k) || []), p]); }
    const ownHtml = [...byGroup].map(([gname, ps]) => `<section class="exgroup"><h2 class="exgroup-h">${esc(gname)} <span class="gcount">${ps.length}</span></h2><div class="exlist">${ps.map((p) => playerRow(p.id, p.name, true)).join('')}</div></section>`).join('');
    el.innerHTML = `
      <div class="pagehead">
        <h1><span class="eyebrow">${esc(t('pl.eyebrow'))}</span>${esc(t('pl.title'))}</h1>
        <div class="acts"><button class="primary" id="pl-add">${icon('userplus', 18)}<span>${esc(t('pl.newOwn'))}</span><kbd>N</kbd></button>
          <a class="btn" href="${BT.BADTEAM_URL}" target="_blank" rel="noopener">${icon('external', 18)}<span>${esc(t('pl.openTeam'))}</span></a></div>
      </div>
      <h2 class="pl-src">${icon('users', 20)} ${esc(t('pl.fromTeam'))}</h2>
      ${team || `<p class="muted pl-empty">${esc(t('pl.none'))} <a href="#/backup" id="pl-connect">${esc(t('pl.connect'))}</a></p>`}
      <h2 class="pl-src">${icon('userplus', 20)} ${esc(t('pl.ownTitle'))}</h2>
      <p class="lead muted small">${esc(t('pl.ownLead'))}</p>
      ${ownHtml || `<p class="muted pl-empty">${esc(t('pl.ownNone'))}</p>`}`;
    $('#pl-add', el).onclick = () => personDialog(null, (nid) => (location.hash = `#/player/${encodeURIComponent(nid)}`));
  };
  render();
  return {
    refresh: render,
    key(e) { if (e.key === 'n' || e.key === 'N') { $('#pl-add', el).click(); return true; } return false; },
  };
}

export function playerView(el, id) {
  const render = () => {
    const games = gamesOf(id);
    const p = People.person(id);
    const name = p?.name || (games[0] && People.nameOf(id, games[0])) || '?';
    const own = p?.source === 'own';
    const groups = p?.source === 'team' ? (BT.player(id)?.groups || []).map(BT.groupName).filter(Boolean) : own && p.group ? [p.group] : [];
    el.innerHTML = `
      <div class="pagehead">
        <a class="back" href="#/players">${icon('back', 16)}${esc(t('nav.players'))}<kbd>Esc</kbd></a>
        <h1><span class="eyebrow">${groups.length ? `<span class="tags">${groups.map((g) => `<span class="tag">${esc(g)}</span>`).join('')}</span>` : esc(t(own ? 'pl.ownShort' : 'pl.eyebrow'))}</span>${esc(name)}</h1>
        <div class="acts">
          <a class="btn primary" id="pl-newgame" href="#/game/new/${encodeURIComponent(id)}">${icon('plus', 18)}<span>${esc(t('pl.newGame'))}</span><kbd>N</kbd></a>
          ${own ? `<button id="pl-edit">${icon('edit', 18)}<span>${esc(t('gm.edit'))}</span></button><button class="danger ghost" id="pl-del">${icon('trash', 18)}<span>${esc(t('gm.delete'))}</span></button>` : ''}
        </div>
      </div>
      ${own && p.note ? `<p class="lead muted">${esc(p.note)}</p>` : ''}
      <section class="panel wide" id="pl-season">
        <div class="lblrow"><h2>${icon('chart', 20)} ${esc(t('st.season'))}</h2>
          <a class="btn sm" id="pl-report" href="#/report/player/${encodeURIComponent(id)}/${period}">${icon('printer', 16)}<span>${esc(t('st.report'))}</span><kbd>D</kbd></a></div>
        <div class="seg st-periods">${periods().map((x) => `<button data-per="${x.id}" class="${x.id === period ? 'on' : ''}">${esc(x.label)}</button>`).join('')}</div>
        <div id="pl-sblock">${seasonBlock(id, period, Math.min(1000, (el.clientWidth || 900)) - 44)}</div>
      </section>
      <section class="panel wide">
        <h2>${icon('lens', 20)} ${esc(t('pl.games'))} <span class="gcount">${games.length}</span></h2>
        ${games.length ? `<div class="dlist">${games.map(gameRow).join('')}</div>` : `<p class="muted">${esc(t('pl.noGames'))}</p>`}
      </section>`;
    $$('[data-per]', el).forEach((b) => (b.onclick = () => { period = b.dataset.per; render(); }));
    const ed = $('#pl-edit', el);
    if (ed) ed.onclick = () => personDialog(id);
    const del = $('#pl-del', el);
    if (del) del.onclick = () => {
      if (!confirm(t('pl.delConfirm', { name }))) return;
      St.deletePlayer(id);
      location.hash = '#/players';
      toast(t('pl.deleted', { name }));
    };
  };
  let hide = () => {};
  render();
  hide = bindTips(el);
  return {
    refresh: render,
    key(e) {
      if (e.key === 'Escape') { location.hash = '#/players'; return true; }
      if (e.key === 'n' || e.key === 'N') { location.hash = `#/game/new/${encodeURIComponent(id)}`; return true; }
      if (e.key === 'd' || e.key === 'D') { location.hash = $('#pl-report', el).getAttribute('href'); return true; }
      return false;
    },
    destroy() { hide(); },
  };
}
