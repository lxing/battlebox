import { escapeHtml, normalizeName } from './utils.js';
import { totalGuideItemQty } from './guidePlan.js';

const manaSymbolFiles = (() => {
  const out = {};
  const hybridPairs = ['WU', 'WB', 'UB', 'UR', 'BR', 'BG', 'RG', 'RW', 'GW', 'GU'];
  hybridPairs.forEach((pair) => {
    const [a, b] = pair.split('');
    const file = pair.toLowerCase();
    out[`${a}/${b}`] = file;
    out[`${b}/${a}`] = file;
  });
  ['W', 'U', 'B', 'R', 'G'].forEach((color) => {
    out[`${color}/P`] = `${color.toLowerCase()}p`;
  });
  out['2/W'] = '2w';
  out['W/2'] = '2w';
  return out;
})();

function renderManaTokenSymbol(token) {
  if (/^[0-9]$/.test(token)) {
    return `<img class="mana-cost-symbol" src="/assets/mana/${token}.svg" alt="{${token}}">`;
  }
  if (token === 'X') {
    return `<img class="mana-cost-symbol" src="/assets/mana/x.svg" alt="{X}">`;
  }
  if (token === 'W' || token === 'U' || token === 'B' || token === 'R' || token === 'G') {
    return `<img class="mana-cost-symbol" src="/assets/mana/${token.toLowerCase()}.svg" alt="{${token}}">`;
  }
  const symbolFile = manaSymbolFiles[token];
  if (symbolFile) {
    return `<img class="mana-cost-symbol" src="/assets/mana/${symbolFile}.svg" alt="{${token}}">`;
  }
  return '';
}

function renderManaToken(rawToken) {
  const token = String(rawToken || '').trim().toUpperCase();
  if (!token) return '';
  const symbol = renderManaTokenSymbol(token);
  if (symbol) return symbol;
  return `<span class="mana-cost-token">{${escapeHtml(token)}}</span>`;
}

function renderManaCostSymbols(rawCost) {
  const manaCost = (rawCost || '').trim();
  if (!manaCost) return '';

  const renderSide = (sideCost) => {
    const tokens = (sideCost || '').match(/\{[^}]+\}/g) || [];
    if (tokens.length === 0) return '';

    const pieces = tokens.map((tokenRaw) => {
      const token = tokenRaw.slice(1, -1);
      return renderManaToken(token);
    }).filter(Boolean);

    if (pieces.length === 0) return '';
    return pieces.join('');
  };

  const splitSides = manaCost.split(/\s*\/\/\s*/).map((s) => s.trim()).filter(Boolean);
  if (splitSides.length > 1) {
    const renderedSides = splitSides.map(renderSide).filter(Boolean);
    if (renderedSides.length === 0) return '';
    return `<span class="card-mana-cost">${renderedSides.join('<span class="mana-cost-sep">/</span>')}</span>`;
  }

  const singleSide = renderSide(manaCost);
  if (!singleSide) return '';
  return `<span class="card-mana-cost">${singleSide}</span>`;
}

function resolvePrinting(target, printingsList) {
  const key = normalizeName(target);
  if (!key) return '';
  for (const printings of printingsList) {
    if (printings && printings[key]) return printings[key];
  }
  return '';
}

function resolveDoubleFaced(target, doubleFacedList) {
  const key = normalizeName(target);
  if (!key) return false;
  for (const faces of doubleFacedList || []) {
    if (faces && faces[key]) return true;
  }
  return false;
}

export function createMarkdownRenderer(printingsList, doubleFacedList) {
  const md = window.markdownit({
    html: false,
    linkify: true,
    breaks: true,
  });
  const defaultLinkOpen = md.renderer.rules.link_open
    || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  md.inline.ruler.before('emphasis', 'card_refs', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x5B || src.charCodeAt(start + 1) !== 0x5B) return false;

    const close = src.indexOf(']]', start + 2);
    if (close === -1) return false;

    const raw = src.slice(start + 2, close);
    const parts = raw.split('|');
    const display = (parts[0] || '').trim();
    const target = (parts[1] || parts[0] || '').trim();
    if (!display) return false;

    if (!silent) {
      const token = state.push('card_ref', '', 0);
      token.meta = { display, target };
    }

    state.pos = close + 2;
    return true;
  });

  md.inline.ruler.after('card_refs', 'mana_token', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x7B) return false; // {
    const close = src.indexOf('}', start + 1);
    if (close === -1) return false;

    const tokenText = src.slice(start + 1, close).trim();
    if (!tokenText) return false;

    if (!silent) {
      const token = state.push('mana_token', '', 0);
      token.meta = { token: tokenText };
    }

    state.pos = close + 1;
    return true;
  });

  md.renderer.rules.card_ref = (tokens, idx) => {
    const { display, target } = tokens[idx].meta;
    const printing = resolvePrinting(target, printingsList);
    const doubleFaced = resolveDoubleFaced(target, doubleFacedList);
    const doubleFacedAttr = doubleFaced ? ' data-double-faced="1"' : '';
    return `<span class="card card-ref" data-name="${target}" data-printing="${printing}"${doubleFacedAttr}>${md.utils.escapeHtml(display)}</span>`;
  };

  md.renderer.rules.mana_token = (tokens, idx) => renderManaToken(tokens[idx].meta?.token);

  return md;
}

export function renderGuideContent(mdPlan, mdProse, guide, options = {}) {
  let ins = [];
  let outs = [];
  let prose = '';
  const editablePlan = options.editablePlan === true;
  if (typeof guide === 'string') {
    prose = guide.trim();
  } else if (guide) {
    if (guide.plan && typeof guide.plan === 'object') {
      const toSortedLines = (counts) => Object.entries(counts || {})
        .map(([name, rawQty]) => {
          const qty = Number.parseInt(String(rawQty), 10);
          const trimmedName = String(name || '').trim();
          if (!trimmedName || !Number.isFinite(qty) || qty < 1) return null;
          return { name: trimmedName, qty };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, qty }) => ({ key: normalizeName(name), line: `${qty} [[${name}]]` }));
      ins = toSortedLines(guide.plan.in);
      outs = toSortedLines(guide.plan.out);
    } else {
      const toLegacyLines = (lines) => (Array.isArray(lines) ? lines : [])
        .map((line) => ({ key: '', line }));
      ins = toLegacyLines(guide.in);
      outs = toLegacyLines(guide.out);
    }
    prose = (guide.notes_md || guide.text || '').trim();
  }
  let html = '';
  const inTotal = guide?.plan ? totalGuideItemQty(guide.plan.in) : totalGuideItemQty({});
  const outTotal = guide?.plan ? totalGuideItemQty(guide.plan.out) : totalGuideItemQty({});
  const legacyInTotal = !guide?.plan ? ins.reduce((sum, entry) => {
    const match = /^(\d+)/.exec(String(entry.line || '').trim());
    return sum + (match ? Number.parseInt(match[1], 10) : 0);
  }, 0) : inTotal;
  const legacyOutTotal = !guide?.plan ? outs.reduce((sum, entry) => {
    const match = /^(\d+)/.exec(String(entry.line || '').trim());
    return sum + (match ? Number.parseInt(match[1], 10) : 0);
  }, 0) : outTotal;

  const renderGuidePlanLine = (line) => {
    const rawLine = String(line || '').trim();
    const match = /^(\d+)\s+\[\[([^\]]+)\]\]$/.exec(rawLine);
    if (!match) {
      return mdPlan.renderInline(rawLine);
    }
    const qty = match[1];
    const rawRef = match[2].trim();
    if (!rawRef) {
      return mdPlan.renderInline(rawLine);
    }
    return `<div class="card-row guide-plan-card-row"><span class="card-qty">${qty}</span>${mdPlan.renderInline(`[[${rawRef}]]`)}</div>`;
  };

  const renderItems = (items, zone) => items.map((item, idx) => {
    const attrs = editablePlan
      ? ` class="guide-plan-item is-editable" data-guide-zone="${zone}" data-guide-index="${idx}" data-guide-key="${escapeHtml(item.key || '')}"`
      : '';
    return `<li${attrs}>${renderGuidePlanLine(item.line)}</li>`;
  }).join('');
  const renderNone = () => `<li class="guide-plan-none">None</li>`;
  html += `
    <div class="guide-plan${editablePlan ? ' is-editable' : ''}">
      <div class="guide-plan-col">
        <div class="guide-plan-title">In (${guide?.plan ? inTotal : legacyInTotal})</div>
        <ul class="guide-plan-list">${ins.length ? renderItems(ins, 'in') : renderNone()}</ul>
      </div>
      <div class="guide-plan-col">
        <div class="guide-plan-title">Out (${guide?.plan ? outTotal : legacyOutTotal})</div>
        <ul class="guide-plan-list">${outs.length ? renderItems(outs, 'out') : renderNone()}</ul>
      </div>
    </div>
  `;

  if (prose) {
    html += `<div class="guide-prose">${mdProse.render(prose)}</div>`;
  }

  return html || '<em>No guide yet</em>';
}

function renderCardRow(card, bannedSet, highlightClass) {
  const banned = bannedSet && bannedSet.has(normalizeName(card.name));
  const bannedTag = banned ? '<span class="banned-inline-tag" title="Banned">🔨 BAN</span>' : '';
  const doubleFacedAttr = card.double_faced ? ' data-double-faced="1"' : '';
  const manaCostHtml = renderManaCostSymbols(card.mana_cost);
  const rowClass = highlightClass ? `card-row ${highlightClass}` : 'card-row';
  return `<div class="${rowClass}"><span class="card-qty">${card.qty}</span><span class="card card-ref" data-name="${card.name}" data-printing="${card.printing}"${doubleFacedAttr}><span class="card-hit">${card.name}${bannedTag}</span></span>${manaCostHtml}</div>`;
}

function compareCardsByManaThenName(a, b) {
  const aValue = Number.isFinite(a.mana_value) ? a.mana_value : 0;
  const bValue = Number.isFinite(b.mana_value) ? b.mana_value : 0;
  if (aValue !== bValue) return aValue - bValue;
  return normalizeName(a.name).localeCompare(normalizeName(b.name));
}

export function renderCardsByType(cards, bannedSet, types, highlightMap, highlightClass, options = {}) {
  const groups = { creature: [], spell: [], artifact: [], land: [] };
  cards.forEach(c => {
    const type = c.type || 'spell';
    if (groups[type]) groups[type].push(c);
  });

  const labels = { creature: 'Creatures', spell: 'Spells', artifact: 'Artifacts', land: 'Lands' };
  const showGroupLabels = options.showGroupLabels !== false;
  let html = '';

  const order = types && types.length ? types : ['creature', 'spell', 'artifact', 'land'];
  for (const type of order) {
    const group = [...groups[type]].sort(compareCardsByManaThenName);
    if (group.length === 0) continue;
    const count = group.reduce((sum, c) => sum + c.qty, 0);
    html += `<div class="card-group">`;
    if (showGroupLabels) {
      html += `<div class="card-group-label">${labels[type]} (${count})</div>`;
    }
    html += group.map(c => {
      const key = normalizeName(c.name);
      const rowHighlight = highlightMap && highlightMap[key] ? highlightClass : '';
      return renderCardRow(c, bannedSet, rowHighlight);
    }).join('');
    html += `</div>`;
  }
  return html;
}

export function renderCardGroup(cards, label, bannedSet, highlightMap, highlightClass, options = {}) {
  if (!cards || cards.length === 0) return '';
  const sorted = [...cards].sort(compareCardsByManaThenName);
  const count = sorted.reduce((sum, c) => sum + c.qty, 0);
  const showLabel = options.showLabel !== false;
  return `
    <div class="card-group">
      ${showLabel ? `<div class="card-group-label">${label} (${count})</div>` : ''}
      ${sorted.map(c => {
        const key = normalizeName(c.name);
        const rowHighlight = highlightMap && highlightMap[key] ? highlightClass : '';
        return renderCardRow(c, bannedSet, rowHighlight);
      }).join('')}
    </div>
  `;
}
