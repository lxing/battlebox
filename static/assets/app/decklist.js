import { renderCardGroup, renderCardsByType } from './render.js';
import { normalizeName } from './utils.js';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

const CUBE_MULTICOLOR_GROUP_ORDER = [
  'WU', 'UB', 'BR', 'RG', 'GW',
  'WB', 'UR', 'BG', 'RW', 'GU',
  'GWU', 'WUB', 'UBR', 'BRG', 'RGW',
  'WBG', 'URW', 'BGU', 'RWB', 'GUR',
  'WUBR', 'UBRG', 'BRGW', 'RGWU', 'GWUB',
  'WUBRG',
];

const CUBE_LAND_SUBTYPE_ORDER = [
  'fetch', 'shock', 'fastland', 'surveil', 'tapland', 'cycling',
  'canopy', 'manland', 'vivid', 'bounce', 'gates',
];

const cubeMulticolorOrderIndex = new Map(
  CUBE_MULTICOLOR_GROUP_ORDER.map((combo, idx) => [combo, idx]),
);

const cubeLandSubtypeOrderIndex = new Map(
  CUBE_LAND_SUBTYPE_ORDER.map((subtype, idx) => [subtype, idx]),
);

function parseManaColors(manaCost) {
  const out = new Set();
  const text = String(manaCost || '').toUpperCase();
  const matches = text.match(/\{[^}]+\}/g) || [];
  matches.forEach((raw) => {
    const token = raw.slice(1, -1).trim();
    if (!token) return;
    const letters = token.match(/[WUBRG]/g) || [];
    letters.forEach((letter) => out.add(letter));
  });
  return out;
}

function colorSetSignature(colors) {
  return COLOR_ORDER.filter((color) => colors.has(color)).join('');
}

function comboSignature(combo) {
  const letters = new Set(String(combo || '').toUpperCase().split(''));
  return COLOR_ORDER.filter((color) => letters.has(color)).join('');
}

const canonicalComboBySignature = new Map(
  CUBE_MULTICOLOR_GROUP_ORDER.map((combo) => [comboSignature(combo), combo]),
);

function resolveCubeBucket(card) {
  if ((card.type || 'spell') === 'land') return 'land';
  const colors = parseManaColors(card.mana_cost);
  if (colors.size === 0) return 'colorless';
  if (colors.size === 1) {
    const [only] = [...colors];
    if (only === 'W') return 'white';
    if (only === 'U') return 'blue';
    if (only === 'B') return 'black';
    if (only === 'R') return 'red';
    if (only === 'G') return 'green';
  }
  return 'multicolor';
}

function formatLandSubtypeLabel(subtype) {
  const key = normalizeName(subtype || '');
  if (!key) return '';
  if (key === 'gates') return 'Gates';
  if (key === 'fastland') return 'Fast lands';
  if (key === 'tapland') return 'Tap Lands';
  if (key === 'cycling') return 'Cycling Lands';
  if (key === 'canopy') return 'Canopy Lands';
  if (key === 'manland') return 'Man Lands';
  if (key === 'vivid') return 'Vivid Lands';
  return `${key.charAt(0).toUpperCase()}${key.slice(1)} Lands`;
}

function countCards(cards) {
  return (cards || []).reduce((sum, card) => sum + (Number(card.qty) || 0), 0);
}

function renderCubeMulticolorByColor(cards, options) {
  const groups = new Map();
  cards.forEach((card) => {
    const signature = colorSetSignature(parseManaColors(card.mana_cost));
    if (!signature) return;
    const key = canonicalComboBySignature.get(signature) || signature;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(card);
    } else {
      groups.set(key, [card]);
    }
  });

  const groupKeys = [...groups.keys()].sort((a, b) => {
    const aRank = cubeMulticolorOrderIndex.get(a);
    const bRank = cubeMulticolorOrderIndex.get(b);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
  if (!groupKeys.length) return '<div class="decklist-cube-empty">None</div>';

  return groupKeys.map((key) => (
    renderCardGroup(
      groups.get(key),
      '',
      options.bannedSet,
      options.mainboardHighlightMap,
      options.mainboardHighlightClass,
      { showLabel: false },
    )
  )).join('');
}

function renderCubeLandGroups(cards, options) {
  const untyped = [];
  const grouped = new Map();
  cards.forEach((card) => {
    const subtype = normalizeName(card.land_subtype || '');
    if (!subtype) {
      untyped.push(card);
      return;
    }
    const bucket = grouped.get(subtype);
    if (bucket) {
      bucket.push(card);
    } else {
      grouped.set(subtype, [card]);
    }
  });

  const pieces = [];
  if (untyped.length) {
    pieces.push(renderCardGroup(
      untyped,
      '',
      options.bannedSet,
      options.mainboardHighlightMap,
      options.mainboardHighlightClass,
      { showLabel: false },
    ));
  }

  const subtypeKeys = [...grouped.keys()].sort((a, b) => {
    const aRank = cubeLandSubtypeOrderIndex.get(a);
    const bRank = cubeLandSubtypeOrderIndex.get(b);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return a.localeCompare(b);
  });

  subtypeKeys.forEach((subtype) => {
    pieces.push(renderCardGroup(
      grouped.get(subtype),
      formatLandSubtypeLabel(subtype),
      options.bannedSet,
      options.mainboardHighlightMap,
      options.mainboardHighlightClass,
      { showLabel: true },
    ));
  });

  if (!pieces.length) return '<div class="decklist-cube-empty">None</div>';
  return pieces.join('');
}

function renderCubeDecklist(deckView, options) {
  const buckets = {
    white: [],
    blue: [],
    black: [],
    red: [],
    green: [],
    multicolor: [],
    colorless: [],
    land: [],
  };
  deckView.mainCards.forEach((card) => {
    buckets[resolveCubeBucket(card)].push(card);
  });

  const columns = [
    { key: 'white', label: 'White', types: ['creature', 'spell', 'artifact'] },
    { key: 'blue', label: 'Blue', types: ['creature', 'spell', 'artifact'] },
    { key: 'black', label: 'Black', types: ['creature', 'spell', 'artifact'] },
    { key: 'red', label: 'Red', types: ['creature', 'spell', 'artifact'] },
    { key: 'green', label: 'Green', types: ['creature', 'spell', 'artifact'] },
    { key: 'colorless', label: 'Colorless', types: ['creature', 'spell', 'artifact'] },
    { key: 'multicolor', label: 'Multicolor', types: ['creature', 'spell', 'artifact'] },
    { key: 'land', label: 'Lands', types: ['land'] },
  ];

  const columnHtml = columns.map((column) => {
    const cards = buckets[column.key];
    let body = '<div class="decklist-cube-empty">None</div>';
    if (cards.length) {
      if (column.key === 'multicolor') {
        body = renderCubeMulticolorByColor(cards, options);
      } else if (column.key === 'land') {
        body = renderCubeLandGroups(cards, options);
      } else {
        body = renderCardsByType(
          cards,
          options.bannedSet,
          column.types,
          options.mainboardHighlightMap,
          options.mainboardHighlightClass,
          { showGroupLabels: column.key !== 'land' },
        );
      }
    }
    return `
      <div class="decklist-col decklist-col-cube">
        <div class="card-group-label decklist-cube-title">${column.label} (${countCards(cards)})</div>
        <div class="card-list">${body}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="decklist-cube-scroll">
      <div class="decklist-grid decklist-grid-cube">
        ${columnHtml}
      </div>
    </div>
  `;
}

function computeDecklistLayout(viewMode, deckView) {
  const hasMainLands = deckView.mainCards.some((card) => (card.type || 'spell') === 'land');
  const hasSideboardCards = !!(deckView.sideCards && deckView.sideCards.length);

  if (viewMode === 'nosideboard') {
    return {
      mainTypes: ['creature', 'spell', 'artifact'],
      showSideboard: false,
      showLandColumn: hasMainLands,
    };
  }
  if (viewMode === 'cube') {
    return {
      mainTypes: undefined,
      showSideboard: false,
      showLandColumn: false,
    };
  }
  return {
    mainTypes: hasSideboardCards ? undefined : ['creature', 'spell', 'artifact'],
    showSideboard: hasSideboardCards,
    showLandColumn: !hasSideboardCards && hasMainLands,
  };
}

export function renderDecklistGrid({
  viewMode = 'default',
  deckView,
  bannedSet = null,
  mainboardHighlightMap = null,
  sideboardHighlightMap = null,
  mainboardHighlightClass = 'sb-added',
  sideboardHighlightClass = 'sb-removed',
} = {}) {
  const safeDeckView = deckView || {
    mainCards: [],
    sideCards: [],
    mainboardAdded: {},
    sideboardFromMain: {},
  };
  const resolvedMainboardHighlightMap = mainboardHighlightMap || safeDeckView.mainboardAdded || null;
  const resolvedSideboardHighlightMap = sideboardHighlightMap || safeDeckView.sideboardFromMain || null;

  const options = {
    bannedSet,
    mainboardHighlightMap: resolvedMainboardHighlightMap,
    sideboardHighlightMap: resolvedSideboardHighlightMap,
    mainboardHighlightClass,
    sideboardHighlightClass,
  };

  if (viewMode === 'cube') {
    return renderCubeDecklist(safeDeckView, options);
  }

  const layout = computeDecklistLayout(viewMode, safeDeckView);
  const hasSecondColumn = layout.showSideboard || layout.showLandColumn;
  const sideboardHtml = layout.showSideboard ? `
    <div class="decklist-col">
      <div class="card-list">
        ${renderCardGroup(
          safeDeckView.sideCards,
          'Sideboard',
          options.bannedSet,
          options.sideboardHighlightMap,
          options.sideboardHighlightClass,
        )}
      </div>
    </div>
  ` : '';
  const landColumnHtml = layout.showLandColumn ? `
    <div class="decklist-col">
      <div class="card-list">
        ${renderCardsByType(
          safeDeckView.mainCards,
          options.bannedSet,
          ['land'],
          options.mainboardHighlightMap,
          options.mainboardHighlightClass,
        )}
      </div>
    </div>
  ` : '';

  return `
    <div class="decklist-grid${hasSecondColumn ? '' : ' single'}">
      <div class="decklist-col">
        <div class="card-list">
          ${renderCardsByType(
            safeDeckView.mainCards,
            options.bannedSet,
            layout.mainTypes,
            options.mainboardHighlightMap,
            options.mainboardHighlightClass,
          )}
        </div>
      </div>
      ${sideboardHtml || landColumnHtml}
    </div>
  `;
}
