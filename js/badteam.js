// Brücke zu BadTeam: liest Spieler und Gruppen aus badteam-daten.json im gemeinsamen Dropbox-Ordner.
// BadScout schreibt nie in BadTeams Datei. Kontaktdaten (Telefon, E-Mail, Eltern) werden nicht übernommen.
import * as St from './store.js';
import * as Sync from './sync.js';

export const BADTEAM_URL = 'https://badteam.mpdalbeck.workers.dev/';
const CACHE_KEY = 'badteamCache';
let data = null; // { players: [{ id, name, active, groups }], groups: [{ id, name }], rev, at }
let loading = null;

/** BadTeam-Daten holen (aus Dropbox, nur wenn sich die Datei geändert hat; sonst die zuletzt geholte Fassung). */
export async function load(force = false) {
  if (loading) return loading;
  loading = (async () => {
    if (!data) data = (await St.getKey(CACHE_KEY)) || null;
    if (Sync.Y.state === 'ok') {
      try {
        const p = await Sync.DBX.peek(Sync.DBX.BADTEAM_FILE);
        if (p && (force || p.version !== data?.rev)) {
          const obj = JSON.parse(await p.load());
          // Nur das, was BadScout braucht – keine Kontaktdaten
          data = {
            players: (obj.players || []).filter((x) => x?.id).map((x) => ({ id: x.id, name: String(x.name || ''), active: x.active !== false, groups: Array.isArray(x.groups) ? x.groups : [] })),
            groups: (obj.groups || []).filter((x) => x?.id).map((x) => ({ id: x.id, name: String(x.name || '') })),
            rev: p.version, at: Date.now(),
          };
          await St.setKey(CACHE_KEY, data);
        }
      } catch (e) { console.error('BadTeam-Daten', e); }
    }
    loading = null;
    St.notify();
    return data;
  })();
  return loading;
}
export const cached = () => data;
export function init() {
  Sync.afterSync(() => load());
  return load();
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
/** Spieler aus BadTeam (standardmäßig nur aktive), nach Namen sortiert */
export const players = (all = false) => (data?.players || []).filter((p) => all || p.active).sort(byName);
export const groups = () => [...(data?.groups || [])].sort(byName);
export const player = (id) => data?.players.find((p) => p.id === id) || null;
export const groupName = (id) => data?.groups.find((g) => g.id === id)?.name || '';
/** Name eines Spielers: aus BadTeam, sonst der im Spiel gemerkte Name */
export const nameOf = (id, game) => player(id)?.name || game?.names?.[id] || '?';
