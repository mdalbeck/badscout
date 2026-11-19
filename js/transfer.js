// An BadClip übertragen: ein ganzes Spiel oder ausgewählte Momente als Szenen (mit Spieler-Tag).
// BadScout schreibt nie in BadClips Datei – der Eintrag kommt in BadClips Briefkasten (Dropbox › Apps › Bad Apps › badclip-eingang),
// BadClip holt ihn beim nächsten Abgleich ab, kopiert das Video in seinen eigenen Ordner und legt die Szenen an.
import * as St from './store.js';
import * as Sync from './sync.js';
import { icon } from './icons.js';
import { t, fmtDay, fmtDateTime } from './i18n.js';
import { $, $$, esc, toast, modal, closeModal } from './ui.js';
import { compute, typeOf, typeName, shotName, sidePlayers, byName } from './analysis.js';
import { oursText, oppText, kindText } from './games.js';
import { fmtTime } from './video.js';

export const BADCLIP_URL = 'https://badclip.mpdalbeck.workers.dev/';
const clean = (s) => String(s || '').replace(/:/g, '-').trim();

/** Eintrag für BadClips Briefkasten bauen */
function buildItem(game, rallyIds, noteIds, session) {
  const v = game.video;
  const video = v.kind === 'yt'
    ? { local: false, id: v.ytId, title: v.title || '' }
    : { local: true, src: Sync.DBX.videoPath(v.id), origin: `badscout:${v.id}`, title: v.title || v.fileName || '', fileName: v.fileName || '', size: v.size || 0, mime: v.mime || 'video/mp4', duration: v.duration || null, thumb: v.thumb || null };
  const ours = sidePlayers(game, 'us').map((p) => p.name);
  const base = [...ours.map((n) => `Spieler:${clean(n)}`), `Disziplin:${game.kind === 'double' ? 'Doppel' : 'Einzel'}`];
  const about = `${fmtDay(game.day)}${game.event ? ` · ${game.event}` : ''} · ${oursText(game)} ${t('gm.vs')} ${oppText(game)}`;
  const c = compute(game);
  const scenes = [];
  for (const row of c.rows) {
    const r = row.r;
    if (!rallyIds.has(r.id)) continue;
    const side = r.win === 'us' ? sidePlayers(game, 'us').map((p) => p.name).join(' / ') : sidePlayers(game, 'them').map((p) => p.name).join(' / ');
    const notes = game.notes.filter((n) => n.t >= r.t0 - 1 && n.t <= r.t1 + 2).map((n) => n.text);
    const who = byName(game, r.by);
    scenes.push({
      origin: `badscout:${r.id}`, start: Math.max(0, Math.round((r.t0 - 1) * 10) / 10), end: Math.round((r.t1 + 1.5) * 10) / 10,
      title: `${row.extra ? '' : `${row.us}:${row.them} · `}${t('tr.pointFor', { who: side })} · ${typeName(typeOf(r.type))}${r.shot ? ` (${shotName(r.shot)})` : ''}`,
      note: [about, who ? `${t(typeOf(r.type)?.kind === 'win' ? 'an.byWin' : 'an.byErr')} ${who}` : '', ...notes].filter(Boolean).join('\n'),
      tags: [...base, `Analyse:${clean(typeName(typeOf(r.type)))}`, ...(r.shot ? [`Schlagtechnik:${clean(shotName(r.shot))}`] : [])],
    });
  }
  for (const n of game.notes) {
    if (!noteIds.has(n.id)) continue;
    scenes.push({ origin: `badscout:${n.id}`, start: Math.max(0, Math.round((n.t - 4) * 10) / 10), end: Math.round((n.t + 3) * 10) / 10,
      title: n.text.length > 70 ? `${n.text.slice(0, 68)}…` : n.text, note: `${about}\n${n.text}`, tags: [...base, `Analyse:${t('tr.noteTag')}`] });
  }
  scenes.sort((a, b) => a.start - b.start);
  return { from: 'badscout', version: 1, at: new Date().toISOString(), gameId: game.id, video, scenes, session: session || '' };
}

export function transferDialog(gameId) {
  const game = St.game(gameId);
  if (!game) return;
  if (Sync.Y.state !== 'ok') return toast(t('vd.needDbx'), t('nav.backup'), () => (location.hash = '#/backup'));
  if (!game.video) return toast(t('tr.noVideo'));
  if (game.video.kind === 'file' && !game.video.dbx) return toast(t('tr.notInDbx'));
  const c = compute(game);
  const sel = { r: new Set(), n: new Set() };
  let mode = 'all';
  const kindOf = (r) => typeOf(r.type)?.kind || 'err';
  const quick = {
    ourWin: (r) => r.win === 'us' && kindOf(r) === 'win',
    ourErr: (r) => r.win === 'them' && kindOf(r) === 'err',
    oppWin: (r) => r.win === 'them' && kindOf(r) === 'win',
  };
  const d = modal(`<h2>${icon('library', 20)} ${esc(t('tr.title'))}</h2>
    <p class="muted small">${esc(t('tr.text'))}</p>
    ${game.sent ? `<p class="note">${icon('alert', 16)}<span>${esc(t('tr.already', { when: fmtDateTime(game.sent.at), n: game.sent.n }))}</span></p>` : ''}
    <div class="seg fullseg" style="margin:10px 0 12px">${['all', 'pick'].map((m) => `<button data-mode="${m}" class="${m === mode ? 'on' : ''}">${esc(t(`tr.${m}`))}</button>`).join('')}</div>
    <div id="tr-body"></div>
    <label class="switch courtsw" style="margin-top:12px"><input type="checkbox" id="tr-ses" checked><i></i><span>${esc(t('tr.session'))}</span></label>
    <input id="tr-sname" value="${esc(`${oursText(game)} – ${game.event || kindText(game)} ${fmtDay(game.day, { day: 'numeric', month: 'numeric', year: '2-digit' })}`)}">
    <div class="dlg-actions"><span class="muted small" id="tr-count"></span><span class="grow"></span><button class="ghost" id="tr-no">${esc(t('gm.cancel'))}</button>
      <button class="primary" id="tr-ok">${icon('upload', 18)}<span>${esc(t('tr.send'))}</span></button></div>`, 'wide');
  const count = () => (mode === 'all' ? c.rows.length + ($('#tr-notes', d)?.checked ? game.notes.length : 0) : sel.r.size + sel.n.size);
  const showCount = () => { $('#tr-count', d).textContent = t('tr.count', { n: count() }); $('#tr-ok', d).disabled = !count(); };
  const draw = () => {
    if (mode === 'all') {
      $('#tr-body', d).innerHTML = `<p>${esc(t('tr.allText', { n: c.rows.length }))}</p>
        ${game.notes.length ? `<label class="switch"><input type="checkbox" id="tr-notes" checked><i></i><span>${esc(t('tr.withNotes', { n: game.notes.length }))}</span></label>` : ''}`;
      const nb = $('#tr-notes', d);
      if (nb) nb.onchange = showCount;
    } else {
      $('#tr-body', d).innerHTML = `<div class="tr-quick">
          <button class="chip" data-q="ourWin">${esc(t('st.ourWin'))}</button><button class="chip" data-q="ourErr">${esc(t('st.ourErr'))}</button>
          <button class="chip" data-q="oppWin">${esc(t('st.oppWin'))}</button>${game.notes.length ? `<button class="chip" data-q="notes">${esc(t('an.notes'))}</button>` : ''}
          <button class="chip ghost" data-q="none">${esc(t('tr.none'))}</button></div>
        <div class="picklist tr-list">
          ${[...c.rows.map((row) => ({ k: 'r', id: row.r.id, t: row.r.t0, html: `<span class="rl-sc mono">${row.extra ? '–' : `${row.us}:${row.them}`}</span><span class="rl-b"><b>${esc(typeName(typeOf(row.r.type)))}</b><small>${esc(t(row.r.win === 'us' ? 'an.pointUs' : 'an.pointThem'))}${row.r.shot ? ` · ${esc(shotName(row.r.shot))}` : ''}</small></span>`, cls: `rl-${row.r.win}` })),
            ...game.notes.map((n) => ({ k: 'n', id: n.id, t: n.t, html: `<span class="rl-b"><b>${icon('note', 14)} ${esc(n.text)}</b></span>`, cls: 'tr-note' }))]
            .sort((a, b) => a.t - b.t).map((x) => `<label class="pickrow tr-row ${x.cls}"><input type="checkbox" data-k="${x.k}" value="${esc(x.id)}" ${sel[x.k].has(x.id) ? 'checked' : ''}>
              <span class="tchip mono">${fmtTime(x.t)}</span>${x.html}</label>`).join('')}
        </div>`;
      $$('[data-k]', d).forEach((cb) => (cb.onchange = () => { const s = sel[cb.dataset.k]; if (cb.checked) s.add(cb.value); else s.delete(cb.value); showCount(); }));
      $$('[data-q]', d).forEach((b) => (b.onclick = () => {
        const q = b.dataset.q;
        if (q === 'none') { sel.r.clear(); sel.n.clear(); }
        else if (q === 'notes') game.notes.forEach((n) => sel.n.add(n.id));
        else c.rows.filter((row) => quick[q](row.r)).forEach((row) => sel.r.add(row.r.id));
        draw();
      }));
    }
    showCount();
  };
  $$('[data-mode]', d).forEach((b) => (b.onclick = () => { mode = b.dataset.mode; $$('[data-mode]', d).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#tr-ses', d).onchange = (e) => ($('#tr-sname', d).disabled = !e.target.checked);
  $('#tr-no', d).onclick = closeModal;
  $('#tr-ok', d).onclick = async () => {
    const rIds = mode === 'all' ? new Set(c.rows.map((x) => x.r.id)) : sel.r;
    const nIds = mode === 'all' ? new Set($('#tr-notes', d)?.checked ? game.notes.map((n) => n.id) : []) : sel.n;
    const item = buildItem(game, rIds, nIds, $('#tr-ses', d).checked ? $('#tr-sname', d).value.trim() : '');
    if (!item.scenes.length) return;
    $('#tr-ok', d).disabled = true;
    try {
      await Sync.DBX.putInbox(`badscout-${St.uid()}`, JSON.stringify(item));
      St.updateGame(gameId, { sent: { at: Date.now(), n: item.scenes.length } });
      closeModal();
      toast(t('tr.done', { n: item.scenes.length }), t('tr.open'), () => window.open(BADCLIP_URL, '_blank', 'noopener'));
    } catch (e) {
      console.error(e);
      toast(t('tr.failed', { msg: e.message || e }));
      $('#tr-ok', d).disabled = false;
    }
  };
  draw();
}
