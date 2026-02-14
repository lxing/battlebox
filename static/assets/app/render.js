import { normalizeName } from './utils.js';

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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
  return out;
})();

function renderManaCostSymbols(rawCost) {
  const manaCost = (rawCost || '').trim();
  if (!manaCost) return '';

  const renderTokenSymbol = (token) => {
    if (/^[0-9]$/.test(token)) {
      return `<img class="mana-cost-symbol" src="/assets/mana/${token}.svg" alt="{${token}}" loading="lazy" decoding="async">`;
    }
    if (token === 'X') {
      return `<img class="mana-cost-symbol" src="/assets/mana/x.svg" alt="{X}" loading="lazy" decoding="async">`;
    }
    if (token === 'W' || token === 'U' || token === 'B' || token === 'R' || token === 'G') {
      return `<img class="mana-cost-symbol" src="/assets/mana/${token.toLowerCase()}.svg" alt="{${token}}" loading="lazy" decoding="async">`;
    }
    const symbolFile = manaSymbolFiles[token];
    if (symbolFile) {
      return `<img class="mana-cost-symbol" src="/assets/mana/${symbolFile}.svg" alt="{${token}}" loading="lazy" decoding="async">`;
    }
    return '';
  };

  const renderSide = (sideCost) => {
    const tokens = (sideCost || '').match(/\{[^}]+\}/g) || [];
    if (tokens.length === 0) return '';

    const pieces = tokens.map((tokenRaw) => {
      const token = tokenRaw.slice(1, -1).trim().toUpperCase();
      if (!token) return '';
      const symbol = renderTokenSymbol(token);
      if (symbol) return symbol;

      return `<span class="mana-cost-token">{${escapeHtml(token)}}</span>`;
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

  md.renderer.rules.card_ref = (tokens, idx) => {
    const { display, target } = tokens[idx].meta;
    const printing = resolvePrinting(target, printingsList);
    const doubleFaced = resolveDoubleFaced(target, doubleFacedList);
    const doubleFacedAttr = doubleFaced ? ' data-double-faced="1"' : '';
    return `<span class="card card-ref" data-name="${target}" data-printing="${printing}"${doubleFacedAttr}>${md.utils.escapeHtml(display)}</span>`;
  };

  return md;
}

export function renderGuideContent(mdPlan, mdProse, guide) {
  let ins = [];
  let outs = [];
  let prose = '';
  if (typeof guide === 'string') {
    prose = guide.trim();
  } else if (guide) {
    ins = Array.isArray(guide.in) ? guide.in : [];
    outs = Array.isArray(guide.out) ? guide.out : [];
    prose = (guide.text || '').trim();
  }
  let html = '';

  const renderItems = (items) => items.map(item => `<li>${mdPlan.renderInline(item)}</li>`).join('');
  const renderNone = () => `<li class="guide-plan-none">None</li>`;
  html += `
    <div class="guide-plan">
      <div class="guide-plan-col">
        <div class="guide-plan-title">In</div>
        <ul class="guide-plan-list">${ins.length ? renderItems(ins) : renderNone()}</ul>
      </div>
      <div class="guide-plan-col">
        <div class="guide-plan-title">Out</div>
        <ul class="guide-plan-list">${outs.length ? renderItems(outs) : renderNone()}</ul>
      </div>
    </div>
  `;

  if (prose) {
    html += `<div class="guide-prose">${mdProse.render(prose)}</div>`;
  }

  return html || '<em>No guide yet</em>';
}

export function buildDoubleFacedMap(deck) {
  const out = {};
  const addCards = (cards) => {
    if (!cards) return;
    cards.forEach(c => {
      if (c.double_faced) {
        out[normalizeName(c.name)] = true;
      }
    });
  };
  addCards(deck.cards);
  addCards(deck.sideboard);
  return out;
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

export function renderCardGroup(cards, label, bannedSet, highlightMap, highlightClass) {
  if (!cards || cards.length === 0) return '';
  const sorted = [...cards].sort(compareCardsByManaThenName);
  const count = sorted.reduce((sum, c) => sum + c.qty, 0);
  return `
    <div class="card-group">
      <div class="card-group-label">${label} (${count})</div>
      ${sorted.map(c => {
        const key = normalizeName(c.name);
        const rowHighlight = highlightMap && highlightMap[key] ? highlightClass : '';
        return renderCardRow(c, bannedSet, rowHighlight);
      }).join('')}
    </div>
  `;
}
