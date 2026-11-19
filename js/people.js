// Alle Spieler an einer Stelle: aus BadTeam (nur lesen) und BadScouts eigene „weitere Spieler“
// (z. B. Gäste, Gegner, Profis) – die liegen nur in BadScout und werden nie nach BadTeam geschrieben.
import * as St from './store.js';
import * as BT from './badteam.js';
import { t } from './i18n.js';

/** Ein Spieler: { id, name, source: 'team' | 'own', group (Text), active } oder null */
export function person(id) {
  const b = BT.player(id);
  if (b) return { id, name: b.name, source: 'team', group: (b.groups || []).map(BT.groupName).filter(Boolean).join(', '), active: b.active };
  const o = St.player(id);
  return o ? { id, name: o.name, source: 'own', group: o.group, note: o.note, active: true } : null;
}
/** Name eines Spielers; sonst der im Spiel gemerkte Name */
export const nameOf = (id, game) => person(id)?.name || game?.names?.[id] || '?';

/** Alle wählbaren Spieler: aktive aus BadTeam, dann die eigenen */
export function all() {
  const team = BT.players().map((p) => ({ id: p.id, name: p.name, source: 'team', group: (p.groups || []).map(BT.groupName).filter(Boolean).join(', ') }));
  const own = St.playersSorted().map((p) => ({ id: p.id, name: p.name, source: 'own', group: p.group || t('pl.ownShort') }));
  return [...team, ...own];
}
const norm = (s) => String(s || '').trim().toLocaleLowerCase();
/** Spieler mit genau diesem Namen (Groß-/Kleinschreibung egal); BadTeam zuerst */
export const findByName = (name) => (norm(name) ? all().find((p) => norm(p.name) === norm(name)) || null : null);

/** Auf welcher Seite steht ein Spieler in einem Spiel? 'us' (Seite 1), 'them' (Seite 2) oder null */
export function sideOf(game, pid) {
  if (game.ours.includes(pid)) return 'us';
  if ((game.oppIds || []).includes(pid)) return 'them';
  return null;
}
/** Kurzname: Nachname (letztes Wort) */
export const lastName = (n) => String(n || '').trim().split(/\s+/).filter(Boolean).at(-1) || '?';
/** Namen einer Seite */
export const sideNames = (game, side) => (side === 'us' ? game.ours.map((id) => nameOf(id, game)) : game.opp.filter(Boolean).slice(0, game.kind === 'double' ? 2 : 1));
/** Kurzer Seitenname für Knöpfe, z. B. „Axelsen“ oder „Schmidt/Müller“ */
export function sideShort(game, side) {
  const n = sideNames(game, side);
  if (!n.length) return t(side === 'us' ? 'gm.side1' : 'gm.side2');
  return n.map(lastName).join('/');
}
/** „Punkt Axelsen“ */
export const pointLabel = (game, side) => t('an.pointFor', { who: sideShort(game, side) });

/**
 * Das Spiel aus Sicht von Seite 2: Seiten getauscht, Ballwechsel umgedreht.
 * So rechnet die Auswertung für einen Spieler, der auf Seite 2 stand, genauso wie für Seite 1.
 */
export function flip(game) {
  const ids = game.opp.map((n, i) => (game.oppIds || [])[i] || `x${i}`);
  const names = { ...game.names };
  ids.forEach((id, i) => { if (!names[id]) names[id] = game.opp[i] || '?'; });
  const swapBy = (by) => {
    if (!by) return '';
    if (/^o\d$/.test(by)) return ids[+by.slice(1)] || '';
    const i = game.ours.indexOf(by);
    return i >= 0 ? `o${i}` : by;
  };
  return {
    ...game, ours: ids, names, opp: game.ours.map((id) => nameOf(id, game)), oppIds: [...game.ours],
    rallies: game.rallies.map((r) => ({ ...r, win: r.win === 'us' ? 'them' : 'us', by: swapBy(r.by) })),
  };
}
/** Spiel aus Sicht eines Spielers (für Statistiken über mehrere Spiele) */
export const asSeenBy = (game, pid) => (sideOf(game, pid) === 'them' ? flip(game) : game);
