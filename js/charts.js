// Kleine Diagramme als SVG (ohne Bibliothek): Linien mit Punkten, waagerechte Balken, Tooltip beim Zeigen.
// Farben kommen aus CSS-Variablen (--c-us, --c-them, --c-grid …), damit hell, dunkel und Druck stimmen.
import { esc } from './ui.js';

/**
 * Liniendiagramm mit Punkten.
 * series: [{ name, color: 'us' | 'them', points: [{ x, y }], end: Text am letzten Punkt }]
 * tips: Text je x (für Fadenkreuz und Tooltip); xs: alle x-Werte; yMax; yStep; xLabel(x) für die Achse
 */
export function lineChart({ series, xs, tips = {}, yMax, yStep = 5, xLabel = (x) => String(x), xTicks, height = 220, yUnit = '', width = 640 }) {
  const W = Math.max(280, Math.round(width)), H = height, L = 34, R = 48, T = 12, B = 26;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const sx = (x) => L + (xMax === xMin ? (W - L - R) / 2 : ((x - xMin) / (xMax - xMin)) * (W - L - R));
  const sy = (y) => T + (1 - y / yMax) * (H - T - B);
  let g = '';
  for (let y = 0; y <= yMax; y += yStep) {
    g += `<line class="c-grid" x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}"/><text class="c-ax" x="${L - 6}" y="${sy(y) + 4}" text-anchor="end">${y}${yUnit}</text>`;
  }
  for (const x of xTicks || xs) g += `<text class="c-ax" x="${sx(x)}" y="${H - 6}" text-anchor="middle">${esc(xLabel(x))}</text>`;
  // Fadenkreuz-Ziele: je x ein schmaler, voller Streifen (größer als der Punkt)
  const step = xs.length > 1 ? (sx(xs[1]) - sx(xs[0])) : 40;
  const hits = xs.map((x) => `<rect class="c-hit" x="${sx(x) - step / 2}" y="${T}" width="${Math.max(step, 6)}" height="${H - T - B}" data-x="${sx(x)}" data-tip="${esc(tips[x] || '')}"/>`).join('');
  const lines = series.map((s) => {
    const pts = s.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    const last = s.points.at(-1);
    return `<polyline class="c-line c-${s.color}" points="${pts}"/>
      ${s.points.length <= 70 ? s.points.map((p) => `<circle class="c-dot c-${s.color}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4"/>`).join('') : ''}
      ${last && s.end != null ? `<text class="c-end" x="${sx(last.x) + 8}" y="${sy(last.y) + 4}">${esc(s.end)}</text>` : ''}`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
      ${g}<line class="c-axis" x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}"/>
      <line class="c-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      ${lines}${hits}</svg></div>`;
}

/** Legende (immer bei zwei Reihen) */
export const legend = (items) => `<div class="c-legend">${items.map((x) => `<span><i class="c-sw c-${x.color}"></i>${esc(x.name)}</span>`).join('')}</div>`;

/** Waagerechte Balken: rows [{ label, value, of (Bezugsgröße für %), tip }] in einer Farbe */
export function barRows(rows, color, max = Math.max(1, ...rows.map((r) => r.value))) {
  return `<div class="c-bars">${rows.map((r) => {
    const w = (r.value / max) * 100;
    const pct = r.of ? Math.round((r.value / r.of) * 100) : null;
    return `<div class="c-bar" data-tip="${esc(r.tip || `${r.label}: ${r.value}${pct != null ? ` (${pct} %)` : ''}`)}">
        <span class="c-bl">${esc(r.label)}</span>
        <span class="c-bt"><i class="c-${color}" style="width:${r.value ? `max(4px, ${w}%)` : '0'}"></i></span>
        <span class="c-bv"><b>${r.value}</b>${pct != null ? `<small>${pct} %</small>` : ''}</span></div>`;
  }).join('')}</div>`;
}

/** Tooltip und Fadenkreuz für alle Diagramme in einem Element */
export function bindTips(root) {
  let tip = document.querySelector('.c-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'c-tip hidden'; document.body.append(tip); }
  const hide = () => { tip.classList.add('hidden'); root.querySelectorAll('.c-cross').forEach((c) => c.setAttribute('visibility', 'hidden')); };
  root.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !t.dataset.tip) return hide();
    tip.textContent = t.dataset.tip;
    tip.classList.remove('hidden');
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, e.clientX - r.width / 2))}px`;
    tip.style.top = `${Math.max(8, e.clientY - r.height - 14)}px`;
    const svg = t.closest('svg'), cross = svg?.querySelector('.c-cross');
    if (cross && t.dataset.x) { cross.setAttribute('x1', t.dataset.x); cross.setAttribute('x2', t.dataset.x); cross.setAttribute('visibility', 'visible'); }
  });
  root.addEventListener('pointerleave', hide);
  return hide;
}
