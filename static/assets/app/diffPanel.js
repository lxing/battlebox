import { renderCardRef } from './render.js';
import { escapeHtml, normalizeName } from './utils.js';

function legacyDiffEntry(raw, printings, doubleFaced) {
  const text = String(raw || '').trim();
  const match = /^(\d+)\s*x?\s+(.+)$/.exec(text);
  if (!match) return null;

  const qty = Number.parseInt(match[1], 10);
  if (!Number.isFinite(qty) || qty < 1) return null;

  let name = match[2].trim();
  if (name.startsWith('[[') && name.endsWith(']]')) {
    name = name.slice(2, -2).trim();
    const pieces = name.split('|');
    name = (pieces[pieces.length - 1] || pieces[0] || '').trim();
  }
  if (!name) return null;

  const key = normalizeName(name);
  return {
    name,
    qty,
    printing: printings?.[key] || '',
    double_faced: doubleFaced?.[key] === true,
  };
}

function normalizeDiffEntry(raw, printings, doubleFaced) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const name = String(raw.name || '').trim();
    const qty = Number.parseInt(String(raw.qty || 0), 10);
    if (!name || !Number.isFinite(qty) || qty < 1) return null;
    const key = normalizeName(name);
    return {
      name,
      qty,
      printing: String(raw.printing || printings?.[key] || ''),
      double_faced: raw.double_faced === true || doubleFaced?.[key] === true,
    };
  }
  return legacyDiffEntry(raw, printings, doubleFaced);
}

function normalizeDiffEntries(entries, options) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => normalizeDiffEntry(entry, options.printings, options.doubleFaced))
    .filter(Boolean);
}

export function hasDiffPlanEntries(plan) {
  return (
    Array.isArray(plan?.in) && plan.in.length > 0
  ) || (
    Array.isArray(plan?.out) && plan.out.length > 0
  );
}

function renderDiffList(entries) {
  if (!entries.length) return '<li class="guide-plan-none">None</li>';
  return entries.map((entry) => `
    <li>
      <div class="card-row guide-plan-card-row">
        <span class="card-qty">${entry.qty}</span>${renderCardRef({
          name: entry.name,
          label: `<span class="card-hit">${escapeHtml(entry.name)}</span>`,
          printing: entry.printing,
          doubleFaced: entry.double_faced,
        })}
      </div>
    </li>
  `).join('');
}

export function renderDiffZone(plan, options = {}) {
  const ins = normalizeDiffEntries(plan?.in, options);
  const outs = normalizeDiffEntries(plan?.out, options);

  return `
    <div class="guide-plan diff-plan">
      <div class="guide-plan-col">
        <div class="card-group-label guide-plan-title">In (${ins.reduce((sum, entry) => sum + entry.qty, 0)})</div>
        <ul class="guide-plan-list card-list">${renderDiffList(ins)}</ul>
      </div>
      <div class="guide-plan-col">
        <div class="card-group-label guide-plan-title">Out (${outs.reduce((sum, entry) => sum + entry.qty, 0)})</div>
        <ul class="guide-plan-list card-list">${renderDiffList(outs)}</ul>
      </div>
    </div>
  `;
}
