// Spieler: kommen aus BadTeam (nur lesen). Liste nach Gruppen, Spielerseite mit allen analysierten Spielen.
import * as St from './store.js';
import * as BT from './badteam.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { esc } from './ui.js';
import { gameRow } from './games.js';
import { seasonBlock, periods } from './stats.js';
import { bindTips } from './charts.js';
import { $, $$ } from './ui.js';

let period = 'season';

export const initials = (name) => (name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const gamesOf = (pid) => St.gamesSorted().filter((g) => g.ours.includes(pid));
const countText = (n) => (n === 1 ? t('gm.oneGame') : t('gm.nGames', { n }));

function playerRow(id, name) {
  const n = gamesOf(id).length;
  return `<a class="exrow plrow" href="#/player/${id}"><span class="avatar">${esc(initials(name))}</span>
    <span class="exrow-b"><b>${esc(name)}</b><span class="exmeta"><span>${esc(countText(n))}</span></span></span>${icon('right', 18)}</a>`;
}

export function playersView(el) {
  const render = () => {
    const list = BT.players();
    // Spieler mit Spielen, die in BadTeam pausiert oder nicht (mehr) da sind, trotzdem zeigen
    const extra = new Map();
    for (const g of St.S.data.games) for (const pid of g.ours) if (!list.some((p) => p.id === pid)) extra.set(pid, BT.nameOf(pid, g));
    if (!list.length && !extra.size) {
      el.innerHTML = `
        <div class="pagehead"><h1><span class="eyebrow">${esc(t('pl.eyebrow'))}</span>${esc(t('pl.title'))}</h1></div>
        <div class="emptybig">${icon('users', 44)}<p>${esc(t('pl.none'))}</p>
          <p><a class="btn primary big" id="pl-connect" href="#/backup">${icon('cloud', 20)}<span>${esc(t('pl.connect'))}</span></a></p></div>`;
      return;
    }
    const used = new Set();
    let html = '';
    for (const gr of BT.groups()) {
      const ps = list.filter((p) => p.groups.includes(gr.id));
      if (!ps.length) continue;
      ps.forEach((p) => used.add(p.id));
      html += `<section class="exgroup"><h2 class="exgroup-h">${esc(gr.name)} <span class="gcount">${ps.length}</span></h2><div class="exlist">${ps.map((p) => playerRow(p.id, p.name)).join('')}</div></section>`;
    }
    const rest = [...list.filter((p) => !used.has(p.id)).map((p) => [p.id, p.name]), ...extra];
    if (rest.length) html += `<section class="exgroup"><h2 class="exgroup-h">${esc(t('pl.noGroup'))} <span class="gcount">${rest.length}</span></h2><div class="exlist">${rest.map(([id, name]) => playerRow(id, name)).join('')}</div></section>`;
    el.innerHTML = `
      <div class="pagehead">
        <h1><span class="eyebrow">${esc(t('pl.eyebrow'))}</span>${esc(t('pl.title'))}</h1>
        <div class="acts"><a class="btn" href="${BT.BADTEAM_URL}" target="_blank" rel="noopener">${icon('external', 18)}<span>${esc(t('pl.openTeam'))}</span></a></div>
      </div>
      <p class="lead muted">${esc(t('pl.lead'))}</p>
      ${html}`;
  };
  render();
  return { refresh: render };
}

export function playerView(el, id) {
  const render = () => {
    const games = gamesOf(id);
    const name = BT.player(id)?.name || (games[0] && BT.nameOf(id, games[0])) || '?';
    const groups = (BT.player(id)?.groups || []).map(BT.groupName).filter(Boolean);
    el.innerHTML = `
      <div class="pagehead">
        <a class="back" href="#/players">${icon('back', 16)}${esc(t('nav.players'))}<kbd>Esc</kbd></a>
        <h1><span class="eyebrow">${groups.length ? `<span class="tags">${groups.map((g) => `<span class="tag">${esc(g)}</span>`).join('')}</span>` : esc(t('pl.eyebrow'))}</span>${esc(name)}</h1>
        <div class="acts"><a class="btn primary" id="pl-newgame" href="#/game/new/${encodeURIComponent(id)}">${icon('plus', 18)}<span>${esc(t('pl.newGame'))}</span><kbd>N</kbd></a></div>
      </div>
      <section class="panel wide" id="pl-season">
        <div class="lblrow"><h2>${icon('chart', 20)} ${esc(t('st.season'))}</h2>
          <a class="btn sm" id="pl-report" href="#/report/player/${encodeURIComponent(id)}/${period}">${icon('printer', 16)}<span>${esc(t('st.report'))}</span><kbd>D</kbd></a></div>
        <div class="seg st-periods">${periods().map((p) => `<button data-per="${p.id}" class="${p.id === period ? 'on' : ''}">${esc(p.label)}</button>`).join('')}</div>
        <div id="pl-sblock">${seasonBlock(id, period, Math.min(1000, (el.clientWidth || 900)) - 44)}</div>
      </section>
      <section class="panel wide">
        <h2>${icon('lens', 20)} ${esc(t('pl.games'))} <span class="gcount">${games.length}</span></h2>
        ${games.length ? `<div class="dlist">${games.map(gameRow).join('')}</div>` : `<p class="muted">${esc(t('pl.noGames'))}</p>`}
      </section>`;
    $$('[data-per]', el).forEach((b) => (b.onclick = () => { period = b.dataset.per; render(); }));
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
