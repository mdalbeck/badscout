// Auswertung: pro Spiel (Punkte nach Art, Fehlerquote, Verlauf im Satz, Schlagarten, Spieler im Doppel),
// pro Spieler über mehrere Spiele/die Saison, und Berichte zum Drucken oder als PDF.
import * as St from './store.js';
import * as BT from './badteam.js';
import { icon } from './icons.js';
import { t, fmtDay } from './i18n.js';
import { $, esc } from './ui.js';
import { compute, resultText, typeOf, typeName, types, shotName, sidePlayers, actorSide, rules } from './analysis.js';
import { oursText, oppText, kindText } from './games.js';
import { lineChart, legend, barRows, bindTips } from './charts.js';
import { fmtTime } from './video.js';
import { transferDialog } from './transfer.js';

// ================= Zahlen =================
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Alle Kennzahlen eines Spiels (aus Sicht „unsere Seite“) */
export function gameStats(game) {
  const c = compute(game);
  const rows = c.rows.filter((r) => !r.extra);
  const n = rows.length;
  const s = { c, rows, n, won: 0, lost: 0, ourWin: 0, ourErr: 0, oppWin: 0, oppErr: 0, usByType: {}, themByType: {}, streakUs: 0, streakThem: 0, shots: {}, players: {} };
  let run = 0, runSide = null;
  for (const { r } of rows) {
    const kind = typeOf(r.type)?.kind || 'err';
    if (r.win === 'us') { s.won++; s.usByType[r.type] = (s.usByType[r.type] || 0) + 1; if (kind === 'win') s.ourWin++; else s.oppErr++; }
    else { s.lost++; s.themByType[r.type] = (s.themByType[r.type] || 0) + 1; if (kind === 'win') s.oppWin++; else s.ourErr++; }
    run = r.win === runSide ? run + 1 : 1; runSide = r.win;
    if (r.win === 'us') s.streakUs = Math.max(s.streakUs, run); else s.streakThem = Math.max(s.streakThem, run);
    const actor = actorSide(r);
    if (r.shot) {
      const x = (s.shots[r.shot] ||= { usWin: 0, usErr: 0, themWin: 0, themErr: 0 });
      x[`${actor}${kind === 'win' ? 'Win' : 'Err'}`]++;
    }
    if (actor === 'us' && r.by) {
      const x = (s.players[r.by] ||= { win: 0, err: 0 });
      x[kind === 'win' ? 'win' : 'err']++;
    }
  }
  s.errRate = pct(s.ourErr, n);
  s.wonPct = pct(s.won, n);
  s.result = c.over ? (c.won.us > c.won.them ? 'win' : 'loss') : null;
  return s;
}

// ================= Bausteine =================
const tile = (value, label, sub = '') => `<div class="stat-tile"><b>${value}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;

/** Verlauf eines Satzes: Stand nach jedem Ballwechsel (wie im Bild des Trainers) */
function setChart(game, rows, setNo, width) {
  const R = rules(game.scoring);
  const list = rows.filter((x) => x.set === setNo);
  if (!list.length) return '';
  const xs = [0, ...list.map((_, i) => i + 1)];
  const us = [{ x: 0, y: 0 }, ...list.map((x, i) => ({ x: i + 1, y: x.us }))];
  const them = [{ x: 0, y: 0 }, ...list.map((x, i) => ({ x: i + 1, y: x.them }))];
  const tips = { 0: '0:0' };
  list.forEach((x, i) => { tips[i + 1] = `${t('st.rallyN', { n: i + 1 })} · ${x.us}:${x.them} · ${t(x.r.win === 'us' ? 'an.pointUs' : 'an.pointThem')} · ${typeName(typeOf(x.r.type))}${x.r.shot ? ` (${shotName(x.r.shot)})` : ''} · ${fmtTime(x.r.t1)}`; });
  const top = Math.max(R.to, ...list.map((x) => Math.max(x.us, x.them)));
  const yMax = Math.ceil(top / 5) * 5;
  const n = list.length;
  const every = n > 40 ? 10 : 5;
  const last = list.at(-1);
  return `<section class="st-set">
      <h3>${esc(t('an.setN', { n: setNo }))} <span class="mono">${last.us}:${last.them}</span></h3>
      ${lineChart({ xs, tips, yMax, yStep: 5, xTicks: xs.filter((x) => x % every === 0), width,
        series: [{ name: 'us', color: 'us', points: us, end: last.us }, { name: 'them', color: 'them', points: them, end: last.them }] })}
    </section>`;
}

/** Wie fallen die Punkte? Unsere Punkte und die des Gegners nach Art */
function byTypeBlock(game, s) {
  const ty = types();
  // Arten, die es in den Einstellungen nicht mehr gibt, trotzdem zeigen
  const ids = [...new Set([...ty.map((x) => x.id), ...Object.keys(s.usByType), ...Object.keys(s.themByType)])];
  const rowsFor = (by, of) => ids.filter((id) => typeOf(id) || by[id]).map((id) => ({ label: typeName(typeOf(id)) || id, value: by[id] || 0, of }));
  const max = Math.max(1, ...Object.values(s.usByType), ...Object.values(s.themByType));
  return `<div class="st-two">
      <div><h3><i class="c-sw c-us"></i>${esc(t('st.ourPoints'))} <span class="muted">${s.won}</span></h3>${barRows(rowsFor(s.usByType, s.won), 'us', max)}</div>
      <div><h3><i class="c-sw c-them"></i>${esc(t('st.oppPoints'))} <span class="muted">${s.lost}</span></h3>${barRows(rowsFor(s.themByType, s.lost), 'them', max)}</div>
    </div>`;
}

function shotsTable(s) {
  const list = Object.entries(s.shots);
  if (!list.length) return '';
  return `<table class="st-tab"><thead><tr><th>${esc(t('an.shot'))}</th><th>${esc(t('st.ourWin'))}</th><th>${esc(t('st.ourErr'))}</th><th>${esc(t('st.oppWin'))}</th><th>${esc(t('st.oppErr'))}</th></tr></thead>
    <tbody>${list.map(([k, x]) => `<tr><td>${esc(shotName(k))}</td><td>${x.usWin || ''}</td><td>${x.usErr || ''}</td><td>${x.themWin || ''}</td><td>${x.themErr || ''}</td></tr>`).join('')}</tbody></table>`;
}
function playersTable(game, s) {
  if (game.kind !== 'double') return '';
  const ps = sidePlayers(game, 'us');
  return `<table class="st-tab"><thead><tr><th>${esc(t('st.player'))}</th><th>${esc(t('st.winners'))}</th><th>${esc(t('st.errors'))}</th></tr></thead>
    <tbody>${ps.map((p) => `<tr><td>${esc(p.name)}</td><td>${s.players[p.id]?.win || 0}</td><td>${s.players[p.id]?.err || 0}</td></tr>`).join('')}
    ${s.ourWin + s.ourErr > ps.reduce((a, p) => a + (s.players[p.id]?.win || 0) + (s.players[p.id]?.err || 0), 0) ? `<tr class="muted"><td>${esc(t('st.unassigned'))}</td><td>${s.ourWin - ps.reduce((a, p) => a + (s.players[p.id]?.win || 0), 0)}</td><td>${s.ourErr - ps.reduce((a, p) => a + (s.players[p.id]?.err || 0), 0)}</td></tr>` : ''}</tbody></table>`;
}
function setsTable(game, s) {
  const sets = [...new Set(s.rows.map((x) => x.set))];
  return `<table class="st-tab"><thead><tr><th>${esc(t('st.set'))}</th><th>${esc(t('st.score'))}</th><th>${esc(t('st.winners'))}</th><th>${esc(t('st.errors'))}</th><th>${esc(t('st.oppWinShort'))}</th><th>${esc(t('st.oppErrShort'))}</th></tr></thead>
    <tbody>${sets.map((n) => {
      const rs = s.rows.filter((x) => x.set === n), last = rs.at(-1);
      const cnt = (win, kind) => rs.filter(({ r }) => r.win === win && (typeOf(r.type)?.kind || 'err') === kind).length;
      return `<tr><td>${n}.</td><td class="mono"><b>${last.us}:${last.them}</b></td><td>${cnt('us', 'win')}</td><td>${cnt('them', 'err')}</td><td>${cnt('them', 'win')}</td><td>${cnt('us', 'err')}</td></tr>`;
    }).join('')}</tbody></table>`;
}

/** Inhalt der Auswertung (Seite und Bericht nutzen ihn gleich) */
function gameBody(game, s, width, print = false) {
  const sets = [...new Set(s.rows.map((x) => x.set))];
  const tiles = `<div class="stats st-tiles">
      ${tile(`${s.won}<small>/${s.n}</small>`, t('st.tWon'), t('st.pctOf', { p: s.wonPct }))}
      ${tile(s.ourWin, t('st.tWinners'), t('st.oppHas', { n: s.oppWin }))}
      ${tile(s.ourErr, t('st.tErrors'), t('st.errRate', { p: s.errRate }))}
      ${tile(s.streakUs, t('st.tStreak'), t('st.oppHas', { n: s.streakThem }))}
    </div>`;
  const leg = legend([{ name: oursText(game), color: 'us' }, { name: oppText(game), color: 'them' }]);
  return `${tiles}
    <section class="${print ? 'p-sec' : 'panel wide'}"><h2>${icon('chart', 20)} ${esc(t('st.course'))}</h2>${leg}
      <div class="st-sets">${sets.map((n) => setChart(game, s.rows, n, width)).join('')}</div>
      <details class="st-table"${print ? ' open' : ''}><summary>${esc(t('st.asTable'))}</summary>${setsTable(game, s)}</details></section>
    <section class="${print ? 'p-sec' : 'panel wide'}"><h2>${icon('lens', 20)} ${esc(t('st.how'))}</h2>
      <p class="muted small">${esc(t('st.howHint'))}</p>${byTypeBlock(game, s)}</section>
    ${Object.keys(s.shots).length ? `<section class="${print ? 'p-sec' : 'panel wide'}"><h2>${esc(t('st.shots'))}</h2>${shotsTable(s)}</section>` : ''}
    ${game.kind === 'double' ? `<section class="${print ? 'p-sec' : 'panel wide'}"><h2>${icon('users', 20)} ${esc(t('st.players'))}</h2>${playersTable(game, s)}</section>` : ''}`;
}

// ================= Seite: Auswertung eines Spiels =================
export function gameStatsView(el, id) {
  let hide = () => {};
  const render = () => {
    const game = St.game(id);
    if (!game) { el.innerHTML = `<p class="empty muted">${esc(t('gm.notFound'))}</p>`; return; }
    const s = gameStats(game);
    const head = `<div class="pagehead">
        <a class="back" href="#/game/${id}">${icon('back', 16)}${esc(t('st.toGame'))}<kbd>Esc</kbd></a>
        <h1><span class="eyebrow">${esc([fmtDay(game.day), game.event, kindText(game)].filter(Boolean).join(' · '))}</span><span class="ours">${esc(oursText(game))}</span> <span class="muted vs">${esc(t('gm.vs'))}</span> ${esc(oppText(game))}</h1>
        <div class="acts">${game.video ? `<button id="st-clip">${icon('library', 18)}<span>${esc(t('tr.short'))}</span></button>` : ''}<a class="btn primary" id="st-print" href="#/report/game/${id}">${icon('printer', 18)}<span>${esc(t('st.report'))}</span><kbd>D</kbd></a></div>
      </div>`;
    if (!s.n) { el.innerHTML = `${head}<div class="emptybig">${icon('chart', 44)}<p>${esc(t('st.none'))}</p><p><a class="btn primary" href="#/game/${id}">${esc(t('st.toGame'))}</a></p></div>`; return; }
    const width = Math.min(1060, (el.clientWidth || 900)) - 44;
    el.innerHTML = `${head}
      <div class="st-result"><span class="st-res mono">${esc(resultText(game))}</span>${s.result ? `<span class="badge ${s.result === 'win' ? 'ok' : 'warn'}">${esc(t(s.result === 'win' ? 'st.won' : 'st.lost'))}</span>` : `<span class="badge">${esc(t('st.unfinished'))}</span>`}</div>
      ${gameBody(game, s, width)}
      <section class="panel wide"><h2>${icon('note', 20)} ${esc(t('st.comment'))}</h2>
        <textarea id="st-comment" rows="4" placeholder="${esc(t('st.commentPh'))}">${esc(game.comment || '')}</textarea>
        <p class="muted small">${esc(t('st.commentHint'))}</p></section>
      ${game.notes.length ? `<section class="panel wide"><h2>${icon('note', 20)} ${esc(t('an.notes'))}</h2><div class="nt-list">${game.notes.map((n) => `<div class="nt"><a class="tchip mono btn" href="#/game/${id}">${fmtTime(n.t)}</a><span class="nt-text pre">${esc(n.text)}</span></div>`).join('')}</div></section>` : ''}`;
    const clip = $('#st-clip', el);
    if (clip) clip.onclick = () => transferDialog(id);
    const ta = $('#st-comment', el);
    ta.onchange = () => St.updateGame(id, { comment: ta.value });
    hide = bindTips(el);
  };
  render();
  let w = innerWidth;
  const onResize = () => { if (Math.abs(innerWidth - w) > 40) { w = innerWidth; render(); } };
  addEventListener('resize', onResize);
  return {
    refresh: () => { if (document.activeElement?.id !== 'st-comment') render(); },
    key(e) {
      if (e.key === 'Escape') { location.hash = `#/game/${id}`; return true; }
      if (e.key === 'd' || e.key === 'D') { location.hash = `#/report/game/${id}`; return true; }
      return false;
    },
    destroy() { hide(); removeEventListener('resize', onResize); },
  };
}

// ================= Spieler über mehrere Spiele =================
/** Zeiträume: alle, diese Saison (ab 1. August), letzte Saison */
export function periods() {
  const now = new Date(), y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return [
    { id: 'all', label: t('st.pAll'), from: '0000', to: '9999' },
    { id: 'season', label: t('st.pSeason', { a: y, b: String(y + 1).slice(2) }), from: `${y}-08-01`, to: `${y + 1}-07-31` },
    { id: 'last', label: t('st.pSeason', { a: y - 1, b: String(y).slice(2) }), from: `${y - 1}-08-01`, to: `${y}-07-31` },
  ];
}
export function playerSeason(pid, periodId = 'all') {
  const p = periods().find((x) => x.id === periodId) || periods()[0];
  const games = St.S.data.games.filter((g) => g.ours.includes(pid) && g.day >= p.from && g.day <= p.to).sort((a, b) => a.day.localeCompare(b.day) || a.createdAt - b.createdAt);
  const list = games.map((g) => ({ g, s: gameStats(g) })).filter((x) => x.s.n);
  const sum = (f) => list.reduce((a, x) => a + f(x.s), 0);
  const n = sum((s) => s.n);
  return {
    period: p, games, list,
    played: list.length, wins: list.filter((x) => x.s.result === 'win').length, finished: list.filter((x) => x.s.result).length,
    wonPct: pct(sum((s) => s.won), n), errRate: pct(sum((s) => s.ourErr), n),
    winnersPer: list.length ? Math.round((sum((s) => s.ourWin) / list.length) * 10) / 10 : 0,
    errorsPer: list.length ? Math.round((sum((s) => s.ourErr) / list.length) * 10) / 10 : 0,
  };
}
/** Block für die Spielerseite (und den Spielerbericht) */
export function seasonBlock(pid, periodId, width, print = false) {
  const x = playerSeason(pid, periodId);
  if (!x.list.length) return `<p class="muted">${esc(t('st.noSeason'))}</p>`;
  const tiles = `<div class="stats st-tiles">
      ${tile(x.played, t('st.tGames'), x.finished ? t('st.winsOf', { w: x.wins, n: x.finished }) : '')}
      ${tile(`${x.wonPct}<small>%</small>`, t('st.tWonPct'))}
      ${tile(`${x.errRate}<small>%</small>`, t('st.tErrRate'), t('st.perGame', { n: String(x.errorsPer).replace('.', t('dec')) }))}
      ${tile(String(x.winnersPer).replace('.', t('dec')), t('st.tWinnersPer'))}
    </div>`;
  const xs = x.list.map((_, i) => i);
  const label = (i) => fmtDay(x.list[i].g.day, { day: 'numeric', month: 'numeric' });
  const tipFor = (i) => { const { g, s } = x.list[i]; return `${fmtDay(g.day)} · ${t('gm.vs')} ${oppText(g)} · ${resultText(g)} · ${t('st.tWonPct')} ${s.wonPct} % · ${t('st.tErrRate')} ${s.errRate} %`; };
  const tips = Object.fromEntries(xs.map((i) => [i, tipFor(i)]));
  const every = Math.ceil(xs.length / 8);
  const charts = x.list.length >= 2 ? `<div class="st-trend">
      <div><h3><i class="c-sw c-us"></i>${esc(t('st.tWonPct'))}</h3>${lineChart({ xs, tips, yMax: 100, yStep: 25, yUnit: '', xLabel: label, xTicks: xs.filter((i) => i % every === 0), height: 180, width,
        series: [{ name: 'won', color: 'us', points: x.list.map((y, i) => ({ x: i, y: y.s.wonPct })), end: `${x.list.at(-1).s.wonPct} %` }] })}</div>
      <div><h3><i class="c-sw c-them"></i>${esc(t('st.tErrRate'))}</h3>${lineChart({ xs, tips, yMax: 100, yStep: 25, xLabel: label, xTicks: xs.filter((i) => i % every === 0), height: 180, width,
        series: [{ name: 'err', color: 'them', points: x.list.map((y, i) => ({ x: i, y: y.s.errRate })), end: `${x.list.at(-1).s.errRate} %` }] })}</div>
    </div>` : `<p class="muted small">${esc(t('st.trendLater'))}</p>`;
  const table = `<table class="st-tab"><thead><tr><th>${esc(t('gm.day'))}</th><th>${esc(t('gm.opp'))}</th><th>${esc(t('st.score'))}</th><th>${esc(t('st.tWonPct'))}</th><th>${esc(t('st.winners'))}</th><th>${esc(t('st.errors'))}</th></tr></thead>
    <tbody>${[...x.list].reverse().map(({ g, s }) => `<tr><td>${print ? esc(fmtDay(g.day, { day: 'numeric', month: 'numeric', year: '2-digit' })) : `<a href="#/game/${g.id}/stats">${esc(fmtDay(g.day, { day: 'numeric', month: 'numeric', year: '2-digit' }))}</a>`}</td>
      <td>${esc(oppText(g))}${g.kind === 'double' ? ` <span class="muted small">(${esc(t('gm.double'))})</span>` : ''}</td><td class="mono">${esc(resultText(g))}${s.result ? ` <b class="${s.result === 'win' ? 'ok-t' : 'bad-t'}">${esc(t(s.result === 'win' ? 'st.wonShort' : 'st.lostShort'))}</b>` : ''}</td>
      <td>${s.wonPct} %</td><td>${s.ourWin}</td><td>${s.ourErr}</td></tr>`).join('')}</tbody></table>`;
  return `${tiles}${charts}${print ? '' : `<p class="muted small">${esc(t('st.doubleHint'))}</p>`}${table}`;
}

// ================= Berichte (A4, drucken oder als PDF speichern) =================
export function reportView(el, kind, id, periodId = 'season') {
  document.body.classList.add('printmode');
  const back = kind === 'player' ? `#/player/${id}` : `#/game/${id}/stats`;
  const bar = `<div class="p-bar no-print">
      <a class="btn" href="${back}">${icon('back', 18)}<span>${esc(t('gm.back'))}</span><kbd>Esc</kbd></a>
      <button class="primary" id="p-go">${icon('printer', 18)}<span>${esc(t('st.print'))}</span><kbd>D</kbd></button>
      <span class="muted small">${esc(t('st.printHint'))}</span></div>`;
  const brand = (what) => `<div class="p-brand">Bad<b>Scout</b> · ${esc(what)}</div>`;
  const W = 640;
  if (kind === 'player') {
    const games = St.S.data.games.filter((g) => g.ours.includes(id));
    const name = BT.player(id)?.name || (games[0] && BT.nameOf(id, games[0])) || '?';
    const p = periods().find((x) => x.id === periodId) || periods()[0];
    el.innerHTML = `${bar}<div class="sheet">
      <div class="p-head"><div>${brand(t('st.playerReport'))}<h1>${esc(name)}</h1><div class="p-sub">${esc(p.label)}</div></div></div>
      ${seasonBlock(id, periodId, W, true)}
      <div class="p-foot muted small">${esc(t('st.made', { d: fmtDay(St.todayIso()) }))}</div></div>`;
  } else {
    const game = St.game(id);
    if (!game) { el.innerHTML = `${bar}<p class="empty muted">${esc(t('gm.notFound'))}</p>`; return {}; }
    const s = gameStats(game);
    el.innerHTML = `${bar}<div class="sheet">
      <div class="p-head"><div>${brand(t('st.gameReport'))}<h1>${esc(oursText(game))} <span class="p-vs">${esc(t('gm.vs'))}</span> ${esc(oppText(game))}</h1>
        <div class="p-sub">${esc([fmtDay(game.day), game.event, kindText(game)].filter(Boolean).join(' · '))}</div></div>
        <div class="p-score"><b class="mono">${esc(resultText(game))}</b>${s.result ? `<span>${esc(t(s.result === 'win' ? 'st.won' : 'st.lost'))}</span>` : ''}</div></div>
      ${game.comment ? `<div class="p-comment"><h2>${esc(t('st.comment'))}</h2><p class="pre">${esc(game.comment)}</p></div>` : ''}
      ${s.n ? gameBody(game, s, W, true) : `<p>${esc(t('st.none'))}</p>`}
      ${game.notes.length ? `<div class="p-sec"><h2>${esc(t('an.notes'))}</h2><table class="p-tab">${game.notes.map((n) => `<tr><td class="p-t">${fmtTime(n.t)}</td><td class="pre">${esc(n.text)}</td></tr>`).join('')}</table></div>` : ''}
      <div class="p-foot muted small">${esc(t('st.made', { d: fmtDay(St.todayIso()) }))}</div></div>`;
  }
  $('#p-go', el).onclick = () => window.print();
  return {
    key(e) {
      if (e.key === 'Escape') { location.hash = back; return true; }
      if (e.key === 'd' || e.key === 'D') { window.print(); return true; }
      return false;
    },
    destroy() { document.body.classList.remove('printmode'); },
  };
}

