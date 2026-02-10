import {
  formatColors,
  sortArchetypeTags,
  sortDifficultyTags,
  renderDeckTags,
  renderDifficultyTags,
  renderDeckSelectionTags,
  capitalize,
  normalizeName,
} from './app/utils.js';
import {
  normalizeSortMode,
  normalizeSortDirection,
  normalizeCollapsedMask,
  normalizeApplySideboard,
  parseHashRoute,
  buildBattleboxHash,
  buildDeckHash,
} from './app/state.js';
import { computeDeckView } from './app/deckView.js';
import {
  createMarkdownRenderer,
  renderGuideContent,
  buildDoubleFacedMap,
  renderCardsByType,
  renderCardGroup,
} from './app/render.js';
import { createCardPreview } from './app/preview.js';
import { createLifeCounter } from './app/life.js';

const app = document.getElementById('app');
let data = { index: null, battleboxes: {}, matrices: {}, buildId: '' };
const TAB_BATTLEBOX = 'battlebox';
const TAB_LIFE = 'life';
const TAB_MATRIX = 'matrix';
const ui = {
  shell: null,
  header: null,
  body: null,
  footer: null,
  battleboxPane: null,
  lifePane: null,
  matrixPane: null,
  activeTab: TAB_BATTLEBOX,
};
const qrUi = {
  overlay: null,
  canvas: null,
};

function getCardTarget(event) {
  if (!event.target || !event.target.closest) return null;
  const hit = event.target.closest('.card-hit');
  if (hit) {
    const parentCard = hit.closest('.card');
    if (parentCard) return parentCard;
  }
  return event.target.closest('.card');
}

const preview = createCardPreview(app, getCardTarget);

function hideQrPopup() {
  if (!qrUi.overlay) return;
  qrUi.overlay.hidden = true;
}

function showQrPopup() {
  if (!qrUi.overlay || !qrUi.canvas) return;
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete('tab');
  qrUi.canvas.innerHTML = '';
  if (window.QRCode) {
    // eslint-disable-next-line no-new
    new window.QRCode(qrUi.canvas, {
      text: currentUrl.toString(),
      width: 224,
      height: 224,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  } else {
    qrUi.canvas.innerHTML = '<div class="qr-popup-fallback">QR unavailable</div>';
  }
  qrUi.overlay.hidden = false;
}

function ensureQrOverlay() {
  if (qrUi.overlay) return;

  const overlay = document.createElement('div');
  overlay.className = 'qr-popup-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="qr-popup-canvas" id="qr-popup-canvas" role="dialog" aria-modal="true" aria-label="Page QR code"></div>
  `;

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) hideQrPopup();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideQrPopup();
  });

  document.body.appendChild(overlay);

  qrUi.overlay = overlay;
  qrUi.canvas = overlay.querySelector('#qr-popup-canvas');
}

function bindBreadcrumbQrButton(container) {
  const scope = container || ui.header || app;
  const button = scope.querySelector('.qr-breadcrumb-button');
  if (!button) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showQrPopup();
  });
}

function normalizeTab(tab) {
  return [TAB_BATTLEBOX, TAB_LIFE, TAB_MATRIX].includes(tab) ? tab : TAB_BATTLEBOX;
}

function replaceHashPreserveSearch(nextHash) {
  const nextUrl = `${location.pathname}${location.search}${nextHash}`;
  history.replaceState(null, '', nextUrl);
}

function applyActiveTab(tab) {
  if (!ui.battleboxPane || !ui.lifePane || !ui.matrixPane || !ui.footer) return;
  const nextTab = normalizeTab(tab);
  ui.activeTab = nextTab;
  ui.battleboxPane.hidden = nextTab !== TAB_BATTLEBOX;
  ui.lifePane.hidden = nextTab !== TAB_LIFE;
  ui.matrixPane.hidden = nextTab !== TAB_MATRIX;
  if (nextTab !== TAB_BATTLEBOX) {
    preview.hidePreview();
  }
  ui.footer.querySelectorAll('.tabbar-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === nextTab);
  });
}

function setActiveTab(tab) {
  const nextTab = normalizeTab(tab);
  applyActiveTab(nextTab);
}

function ensureShell() {
  if (ui.shell) return;
  const shell = document.createElement('div');
  shell.className = 'view-shell';
  const header = document.createElement('div');
  header.className = 'view-header';
  const body = document.createElement('div');
  body.className = 'view-body';
  body.id = 'view-body';
  const battleboxPane = document.createElement('div');
  battleboxPane.className = 'tab-pane tab-pane-battlebox';
  battleboxPane.id = 'tab-battlebox';
  const lifePane = document.createElement('div');
  lifePane.className = 'tab-pane tab-pane-life';
  lifePane.id = 'tab-life';
  createLifeCounter(lifePane);
  const matrixPane = document.createElement('div');
  matrixPane.className = 'tab-pane tab-pane-matrix';
  matrixPane.id = 'tab-matrix';
  const footer = document.createElement('div');
  footer.className = 'view-footer';
  footer.innerHTML = `
    <div class="tabbar">
      <button type="button" class="action-button tabbar-button" data-tab="battlebox" aria-label="Battlebox tab">📚</button>
      <button type="button" class="action-button tabbar-button" data-tab="life" aria-label="Life tab">❤️‍🩹</button>
      <button type="button" class="action-button tabbar-button" data-tab="matrix" aria-label="Winrate matrix tab">📊</button>
    </div>
  `;

  footer.addEventListener('click', (event) => {
    const button = event.target.closest('.tabbar-button');
    if (!button) return;
    setActiveTab(button.dataset.tab);
  });

  body.appendChild(battleboxPane);
  body.appendChild(lifePane);
  body.appendChild(matrixPane);
  shell.appendChild(header);
  shell.appendChild(body);
  shell.appendChild(footer);
  app.replaceChildren(shell);

  ui.shell = shell;
  ui.header = header;
  ui.body = body;
  ui.footer = footer;
  ui.battleboxPane = battleboxPane;
  ui.lifePane = lifePane;
  ui.matrixPane = matrixPane;
  preview.setScrollContainer(battleboxPane);
}

function renderBattleboxPane(headerHtml, bodyHtml) {
  ensureShell();
  ui.header.innerHTML = headerHtml;
  ui.battleboxPane.innerHTML = bodyHtml;
  bindBreadcrumbQrButton(ui.header);
}

function withCacheBust(path) {
  if (!data.buildId) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}v=${encodeURIComponent(data.buildId)}`;
}

function toGzipPath(path) {
  const q = path.indexOf('?');
  if (q === -1) return `${path}.gz`;
  return `${path.slice(0, q)}.gz${path.slice(q)}`;
}

async function fetchJsonData(path, fetchOptions) {
  if (window.DecompressionStream) {
    try {
      const gzRes = await fetch(toGzipPath(path), fetchOptions);
      if (gzRes.ok && gzRes.body) {
        const ds = new DecompressionStream('gzip');
        const decoded = gzRes.body.pipeThrough(ds);
        const text = await new Response(decoded).text();
        return JSON.parse(text);
      }
    } catch (e) {
      // Fallback to uncompressed JSON when gzip decode is unavailable.
    }
  }

  const res = await fetch(path, fetchOptions);
  if (!res.ok) return null;
  return res.json();
}

async function loadBattlebox(bbSlug) {
  if (data.battleboxes[bbSlug]) return data.battleboxes[bbSlug];
  const bb = await fetchJsonData(withCacheBust(`/data/${bbSlug}.json`));
  if (!bb) return null;
  data.battleboxes[bbSlug] = bb;
  return bb;
}

async function loadWinrateMatrix(bbSlug) {
  if (!bbSlug) return null;
  if (Object.prototype.hasOwnProperty.call(data.matrices, bbSlug)) {
    return data.matrices[bbSlug];
  }
  const matrix = await fetchJsonData(withCacheBust(`/data/${bbSlug}/mtgdecks-winrate-matrix.json`));
  data.matrices[bbSlug] = matrix || null;
  return data.matrices[bbSlug];
}

async function renderMatrixPane(bbSlug) {
  if (!ui.matrixPane || !data.index) return;

  const battlebox = data.index.battleboxes.find((b) => b.slug === bbSlug);
  if (!battlebox) {
    ui.matrixPane.innerHTML = '<div class="matrix-empty">Open a battlebox to view its winrate matrix.</div>';
    return;
  }

  const matrix = await loadWinrateMatrix(battlebox.slug);
  if (!matrix || !matrix.matchups) {
    ui.matrixPane.innerHTML = `<div class="matrix-empty">No winrate matrix found for ${battlebox.name || capitalize(battlebox.slug)}.</div>`;
    return;
  }

  const orderedDecks = [...battlebox.decks].sort((a, b) => {
    const nameA = normalizeName(a.name || a.slug);
    const nameB = normalizeName(b.name || b.slug);
    return nameA.localeCompare(nameB);
  });

  const colHeadHtml = orderedDecks.map((deck) => (
    `<th scope="col" class="matrix-col-head"><span class="matrix-col-head-text">${deck.name}</span></th>`
  )).join('');

  const rowHtml = orderedDecks.map((rowDeck) => {
    const cellHtml = orderedDecks.map((colDeck) => {
      const result = matrix.matchups?.[rowDeck.slug]?.[colDeck.slug];
      if (!result || !Number.isFinite(result.wr)) {
        return '<td class="matrix-cell matrix-cell-empty">-</td>';
      }
      const matches = Number.isFinite(result.matches) ? result.matches : 0;
      const won = Math.max(0, Math.min(matches, Math.round(matches * result.wr)));
      const percent = Math.round(result.wr * 100);
      const title = `${percent}% WR (${won}/${matches})`;
      return `
        <td class="matrix-cell" title="${title}">
          <div class="matrix-cell-main">${percent}%</div>
          <div class="matrix-cell-record">${won}/${matches}</div>
        </td>
      `;
    }).join('');
    return `
      <tr>
        <th scope="row" class="matrix-row-head">${rowDeck.name}</th>
        ${cellHtml}
      </tr>
    `;
  }).join('');

  ui.matrixPane.innerHTML = `
    <div class="matrix-panel">
      <div class="matrix-scroll">
        <table class="winrate-matrix">
          <thead>
            <tr>
              <th class="matrix-corner"></th>
              ${colHeadHtml}
            </tr>
          </thead>
          <tbody>
            ${rowHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function route() {
  preview.hidePreview();
  const {
    parts,
    sortMode,
    sortDirection,
    matchupSlug,
    collapsedMask,
    applySideboard,
  } = parseHashRoute(location.hash.slice(1) || '/');
  const currentBattleboxSlug = parts.length > 0 ? normalizeName(parts[0]) : '';

  if (parts.length === 0) {
    renderHome();
  } else if (parts.length === 1) {
    renderBattlebox(parts[0], sortMode, sortDirection);
  } else if (parts.length === 2) {
    await renderDeck(
      parts[0],
      parts[1],
      matchupSlug || undefined,
      sortMode,
      sortDirection,
      collapsedMask,
      applySideboard
    );
  } else {
    renderNotFound();
  }

  await renderMatrixPane(currentBattleboxSlug);

  if (ui.battleboxPane) {
    ui.battleboxPane.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
}

function renderHome() {
  const headerHtml = `
    <h1 class="breadcrumbs">
      <span class="breadcrumbs-trail">Battlebox</span>
      <button type="button" class="qr-breadcrumb-button" title="Show QR code" aria-label="Show QR code for this page">
        <img class="qr-breadcrumb-icon" src="/assets/qrcode.svg" alt="">
      </button>
    </h1>
  `;
  const bodyHtml = `
    <ul class="deck-list">
      ${data.index.battleboxes.map(bb => `
        <li>
          <a href="#/${bb.slug}" class="battlebox-link">
            <div class="battlebox-title">
              <span>${bb.name || capitalize(bb.slug)}</span>
              <span class="colors">(${bb.decks.length} decks)</span>
            </div>
            ${bb.description ? `<div class="battlebox-desc">${bb.description}</div>` : ''}
          </a>
        </li>
      `).join('')}
    </ul>
  `;
  renderBattleboxPane(headerHtml, bodyHtml);
}

function renderBattlebox(bbSlug, initialSortMode, initialSortDirection) {
  const bb = data.index.battleboxes.find(b => b.slug === bbSlug);
  if (!bb) return renderNotFound();
  const initialSort = normalizeSortMode(initialSortMode);
  const initialDirection = normalizeSortDirection(initialSortDirection);

  const headerHtml = `
    <h1 class="breadcrumbs">
      <span class="breadcrumbs-trail">
        <a href="#/">Battlebox</a>
        <span class="crumb-sep">/</span>
        <span>${capitalize(bb.slug)}</span>
      </span>
      <button type="button" class="qr-breadcrumb-button" title="Show QR code" aria-label="Show QR code for this page">
        <img class="qr-breadcrumb-icon" src="/assets/qrcode.svg" alt="">
      </button>
    </h1>
  `;
  const bodyHtml = `
    <div class="randomizer-controls">
      <div class="randomizer-roll-controls">
        <button type="button" class="randomizer-roll action-button" data-count="1" title="Roll 1 deck" aria-label="Roll 1 deck">🎲</button>
        <button type="button" class="randomizer-roll action-button" data-count="2" title="Roll 2 decks" aria-label="Roll 2 decks">🎲🎲</button>
      </div>
      <div class="randomizer-sort-controls" role="group" aria-label="Sort decks">
        <button type="button" class="randomizer-sort action-button" data-sort="name" title="Sort by name" aria-label="Sort by name">🔤</button>
        <button type="button" class="randomizer-sort action-button" data-sort="types" title="Sort by types" aria-label="Sort by types">🧬</button>
        <button type="button" class="randomizer-sort action-button" data-sort="difficulty" title="Sort by difficulty" aria-label="Sort by difficulty">🧠</button>
      </div>
    </div>
    <ul class="deck-list">
      ${bb.decks.map(d => `
        <li class="deck-item" data-slug="${d.slug}"><a class="deck-link" href="${buildDeckHash(bb.slug, d.slug, initialSort, initialDirection, undefined, 4)}">
          <span class="deck-link-name">${d.icon ? `<span class="deck-link-icon">${d.icon}</span>` : ''}${d.name}</span>
          <div class="deck-link-tags">${renderDeckSelectionTags(d.tags, d.difficulty_tags)}</div>
          <span class="colors">${formatColors(d.colors)}</span>
        </a></li>
      `).join('')}
    </ul>
  `;
  renderBattleboxPane(headerHtml, bodyHtml);

  const deckList = ui.battleboxPane.querySelector('.deck-list');
  const difficultyOrder = {
    beginner: 0,
    intermediate: 1,
    expert: 2,
  };
  const resolveDifficultyRank = (tags) => {
    const sorted = sortDifficultyTags(tags).map(normalizeName);
    for (const tag of sorted) {
      if (Object.prototype.hasOwnProperty.call(difficultyOrder, tag)) {
        return difficultyOrder[tag];
      }
    }
    return Number.MAX_SAFE_INTEGER;
  };
  const deckBySlug = new Map(
    [...deckList.querySelectorAll('.deck-item')].map(item => [item.dataset.slug, item.querySelector('.deck-link')])
  );
  const deckMetaBySlug = new Map(
    bb.decks.map(deck => [deck.slug, {
      nameKey: normalizeName(deck.name || deck.slug),
      typeKey: sortArchetypeTags(deck.tags).map(normalizeName).join('|'),
      difficultyRank: resolveDifficultyRank(deck.difficulty_tags),
    }])
  );
  const rollButtons = [...ui.battleboxPane.querySelectorAll('.randomizer-roll')];
  const sortButtons = [...ui.battleboxPane.querySelectorAll('.randomizer-sort')];
  let sortMode = null;
  let sortDirection = initialDirection;

  const updateBattleboxHash = () => {
    const nextHash = buildBattleboxHash(bb.slug, sortMode, sortDirection);
    if (location.hash !== nextHash) {
      replaceHashPreserveSearch(nextHash);
    }
  };

  const updateDeckLinks = () => {
    deckBySlug.forEach((link, slug) => {
      if (!link) return;
      link.href = buildDeckHash(bb.slug, slug, sortMode, sortDirection, undefined, 4);
    });
  };

  const compareDeckItems = (a, b, mode) => {
    const metaA = deckMetaBySlug.get(a.dataset.slug) || {
      nameKey: normalizeName(a.dataset.slug || ''),
      typeKey: '',
      difficultyRank: Number.MAX_SAFE_INTEGER,
    };
    const metaB = deckMetaBySlug.get(b.dataset.slug) || {
      nameKey: normalizeName(b.dataset.slug || ''),
      typeKey: '',
      difficultyRank: Number.MAX_SAFE_INTEGER,
    };
    const nameCmp = metaA.nameKey.localeCompare(metaB.nameKey);
    if (mode === 'types') {
      const typeCmp = metaA.typeKey.localeCompare(metaB.typeKey);
      if (typeCmp !== 0) return typeCmp;
      return nameCmp;
    }
    if (mode === 'difficulty') {
      const diffCmp = metaA.difficultyRank - metaB.difficultyRank;
      if (diffCmp !== 0) return diffCmp;
      return nameCmp;
    }
    return nameCmp;
  };

  const applySort = (mode, isInitial = false) => {
    const nextMode = normalizeSortMode(mode);
    if (!isInitial && nextMode === sortMode) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortMode = nextMode;
      if (!isInitial) {
        sortDirection = 'asc';
      }
    }
    const items = [...deckList.querySelectorAll('.deck-item')];
    const direction = sortDirection === 'desc' ? -1 : 1;
    items.sort((a, b) => compareDeckItems(a, b, sortMode) * direction);
    items.forEach(item => deckList.appendChild(item));
    sortButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === sortMode);
    });
    updateDeckLinks();
    updateBattleboxHash();
  };

  const clearHighlights = () => {
    ui.battleboxPane.querySelectorAll('.deck-link.deck-highlight').forEach(link => link.classList.remove('deck-highlight'));
  };

  const applyRandomMatchupLinks = (pickedSlugs) => {
    updateDeckLinks();
    if (pickedSlugs.length !== 2) return;
    const [deckA, deckB] = pickedSlugs;
    const linkA = deckBySlug.get(deckA);
    const linkB = deckBySlug.get(deckB);
    if (linkA) {
      linkA.href = buildDeckHash(bb.slug, deckA, sortMode, sortDirection, deckB, 4);
    }
    if (linkB) {
      linkB.href = buildDeckHash(bb.slug, deckB, sortMode, sortDirection, deckA, 4);
    }
  };

  const setActiveRollButton = (count) => {
    rollButtons.forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.count) === count);
    });
  };

  const roll = (count) => {
    const deckItems = [...deckList.querySelectorAll('.deck-item')];
    if (deckItems.length === 0) return;
    clearHighlights();
    const target = Math.min(count, deckItems.length);
    const picked = new Set();
    while (picked.size < target) {
      const idx = Math.floor(Math.random() * deckItems.length);
      const slug = deckItems[idx].dataset.slug;
      picked.add(slug);
    }
    applyRandomMatchupLinks([...picked]);
    picked.forEach(slug => {
      const link = deckBySlug.get(slug);
      if (link) link.classList.add('deck-highlight');
    });

    let scrollLink = null;
    for (let idx = deckItems.length - 1; idx >= 0; idx--) {
      const item = deckItems[idx];
      if (picked.has(item.dataset.slug)) {
        scrollLink = item.querySelector('.deck-link');
        break;
      }
    }
    if (scrollLink) {
      scrollLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  rollButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const count = Number(btn.dataset.count);
      setActiveRollButton(count);
      roll(count);
    });
  });
  sortButtons.forEach(btn => {
    btn.addEventListener('click', () => applySort(btn.dataset.sort));
  });
  applySort(initialSort, true);
}

async function renderDeck(bbSlug, deckSlug, selectedGuide, sortMode, sortDirection, collapsedMask, applySideboard) {
  const bb = await loadBattlebox(bbSlug);
  if (!bb) return renderNotFound();
  const deck = bb.decks.find(d => d.slug === deckSlug);
  if (!deck) return renderNotFound();
  const currentSortMode = normalizeSortMode(sortMode);
  const currentSortDirection = normalizeSortDirection(sortDirection);
  let currentCollapsedMask = normalizeCollapsedMask(collapsedMask);

  const deckPrintings = deck.printings || {};
  const deckDoubleFaced = buildDoubleFacedMap(deck);
  const mdSelf = createMarkdownRenderer([deckPrintings], [deckDoubleFaced]);
  const primerHtml = deck.primer ? mdSelf.render(deck.primer) : '<em>No primer yet</em>';
  const bannedNames = Array.isArray(bb.banned) ? bb.banned : [];
  const bannedSet = new Set(bannedNames.map(normalizeName));
  const guideKeys = Object.keys(deck.guides || {});
  const initialGuide = guideKeys.length
    ? (selectedGuide && guideKeys.includes(selectedGuide) ? selectedGuide : guideKeys[0])
    : '';
  let currentMatchupSlug = initialGuide;
  let currentApplySideboard = guideKeys.length ? normalizeApplySideboard(applySideboard) : false;
  let deckView = computeDeckView(
    deck,
    currentMatchupSlug ? deck.guides[currentMatchupSlug] : null,
    currentApplySideboard
  );
  const guideOptions = guideKeys.map(k => {
    const opponent = bb.decks.find(d => d.slug === k);
    const name = opponent ? opponent.name : k;
    return `<option value="${k}">${name}</option>`;
  }).join('');

  const hasSideboard = deckView.sideCards && deckView.sideCards.length;
  const landColumnHtml = !hasSideboard ? `
    <div class="decklist-col">
      <div class="card-list">
        ${renderCardsByType(deckView.mainCards, bannedSet, ['land'], deckView.mainboardAdded, 'sb-added')}
      </div>
    </div>
  ` : '';
  const sideboardHtml = hasSideboard ? `
    <div class="decklist-col">
      <div class="card-list">
        ${renderCardGroup(deckView.sideCards, 'Sideboard', bannedSet, deckView.sideboardFromMain, 'sb-removed')}
      </div>
    </div>
  ` : '';
  const hasLandColumn = !hasSideboard && deckView.mainCards.some(c => (c.type || 'spell') === 'land');
  const hasSecondColumn = hasSideboard || hasLandColumn;
  const mainTypes = hasSideboard ? undefined : ['creature', 'spell', 'artifact'];
  const decklistOpenAttr = (currentCollapsedMask & 1) === 0 ? ' open' : '';
  const primerOpenAttr = (currentCollapsedMask & 2) === 0 ? ' open' : '';
  const matchupOpenAttr = (currentCollapsedMask & 4) === 0 ? ' open' : '';
  const matchupGuidesHtml = guideKeys.length ? `
    <details id="matchup-details" class="collapsible matchup-guides"${matchupOpenAttr}>
      <summary>Matchup Guides</summary>
      <div class="collapsible-body guide-panel">
        <div class="guide-select">
          <select id="guide-select" aria-label="Matchup guide">
            ${guideOptions}
          </select>
          <a class="guide-opponent-link action-button" id="guide-opponent-link" href="#">Go to</a>
          <button type="button" class="action-button apply-sideboard-button${currentApplySideboard ? ' active' : ''}" id="apply-sideboard-button">
            Sideboard
          </button>
        </div>
        <div class="guide-box" id="guide-box"></div>
      </div>
    </details>
  ` : '';

  const headerHtml = `
    <h1 class="breadcrumbs">
      <span class="breadcrumbs-trail">
        <a href="#/">Battlebox</a>
        <span class="crumb-sep">/</span>
        <a href="${buildBattleboxHash(bb.slug, currentSortMode, currentSortDirection)}">${capitalize(bb.slug)}</a>
        <span class="crumb-sep">/</span>
        <span>${deck.name}</span>
      </span>
      <button type="button" class="qr-breadcrumb-button" title="Show QR code" aria-label="Show QR code for this page">
        <img class="qr-breadcrumb-icon" src="/assets/qrcode.svg" alt="">
      </button>
    </h1>
  `;
  const bodyHtml = `
    <div class="deck-info-pane">
      <div class="deck-colors">${formatColors(deck.colors)}</div>
      <div class="deck-tags">${renderDeckTags(deck.tags)}${renderDifficultyTags(deck.difficulty_tags)}</div>
    </div>

    ${matchupGuidesHtml}

    <details id="decklist-details" class="collapsible"${decklistOpenAttr}>
      <summary>Decklist</summary>
      <div class="collapsible-body" id="decklist-body">
        <div class="decklist-grid${hasSecondColumn ? '' : ' single'}">
          <div class="decklist-col">
            <div class="card-list">
              ${renderCardsByType(deckView.mainCards, bannedSet, mainTypes, deckView.mainboardAdded, 'sb-added')}
            </div>
          </div>
          ${sideboardHtml || landColumnHtml}
        </div>
      </div>
    </details>

    <details id="primer-details" class="collapsible"${primerOpenAttr}>
      <summary>Primer</summary>
      <div class="collapsible-body">
        <div class="primer">${primerHtml}</div>
      </div>
    </details>
  `;
  renderBattleboxPane(headerHtml, bodyHtml);

  const decklistDetails = ui.battleboxPane.querySelector('#decklist-details');
  const primerDetails = ui.battleboxPane.querySelector('#primer-details');
  const matchupDetails = ui.battleboxPane.querySelector('#matchup-details');
  const decklistBody = ui.battleboxPane.querySelector('#decklist-body');

  const computeCollapsedMask = () => {
    let mask = 0;
    if (decklistDetails && !decklistDetails.open) mask |= 1;
    if (primerDetails && !primerDetails.open) mask |= 2;
    if (matchupDetails && !matchupDetails.open) mask |= 4;
    return mask;
  };

  const updateDeckHashFromState = () => {
    const nextHash = buildDeckHash(
      bb.slug,
      deck.slug,
      currentSortMode,
      currentSortDirection,
      currentMatchupSlug || undefined,
      currentCollapsedMask,
      currentApplySideboard
    );
    if (location.hash !== nextHash) {
      replaceHashPreserveSearch(nextHash);
    }
  };

  const renderDecklistBody = () => {
    if (!decklistBody) return;
    const guideData = currentMatchupSlug ? deck.guides[currentMatchupSlug] : null;
    deckView = computeDeckView(deck, guideData, currentApplySideboard);
    const hasCurrentSideboard = deckView.sideCards && deckView.sideCards.length;
    const currentLandColumnHtml = !hasCurrentSideboard ? `
      <div class="decklist-col">
        <div class="card-list">
          ${renderCardsByType(deckView.mainCards, bannedSet, ['land'], deckView.mainboardAdded, 'sb-added')}
        </div>
      </div>
    ` : '';
    const currentSideboardHtml = hasCurrentSideboard ? `
      <div class="decklist-col">
        <div class="card-list">
          ${renderCardGroup(deckView.sideCards, 'Sideboard', bannedSet, deckView.sideboardFromMain, 'sb-removed')}
        </div>
      </div>
    ` : '';
    const hasCurrentLandColumn = !hasCurrentSideboard && deckView.mainCards.some(c => (c.type || 'spell') === 'land');
    const hasCurrentSecondColumn = hasCurrentSideboard || hasCurrentLandColumn;
    const currentMainTypes = hasCurrentSideboard ? undefined : ['creature', 'spell', 'artifact'];
    decklistBody.innerHTML = `
      <div class="decklist-grid${hasCurrentSecondColumn ? '' : ' single'}">
        <div class="decklist-col">
          <div class="card-list">
            ${renderCardsByType(deckView.mainCards, bannedSet, currentMainTypes, deckView.mainboardAdded, 'sb-added')}
          </div>
        </div>
        ${currentSideboardHtml || currentLandColumnHtml}
      </div>
    `;
  };

  if (guideKeys.length) {
    const select = ui.battleboxPane.querySelector('#guide-select');
    const guideBox = ui.battleboxPane.querySelector('#guide-box');
    const opponentLink = ui.battleboxPane.querySelector('#guide-opponent-link');
    const applyButton = ui.battleboxPane.querySelector('#apply-sideboard-button');
    const updateOpponentLink = (key) => {
      if (!opponentLink) return;
      const opponent = bb.decks.find(d => d.slug === key);
      const opponentHasGuide = opponent
        && opponent.guides
        && Object.prototype.hasOwnProperty.call(opponent.guides, deck.slug);
      opponentLink.href = opponentHasGuide
        ? buildDeckHash(bb.slug, key, currentSortMode, currentSortDirection, deck.slug, 0, false)
        : buildDeckHash(bb.slug, key, currentSortMode, currentSortDirection, undefined, 0, false);
      opponentLink.textContent = 'Go to';
    };
    const syncApplyButton = () => {
      if (!applyButton) return;
      applyButton.classList.toggle('active', currentApplySideboard);
      applyButton.textContent = 'Sideboard';
    };
    const renderGuide = (key) => {
      const guideData = deck.guides[key] || '';
      const opponent = bb.decks.find(d => d.slug === key);
      const opponentPrintings = opponent ? opponent.printings || {} : {};
      const opponentDoubleFaced = opponent ? buildDoubleFacedMap(opponent) : {};
      const mdProse = createMarkdownRenderer(
        [opponentPrintings, deckPrintings],
        [opponentDoubleFaced, deckDoubleFaced]
      );
      guideBox.innerHTML = renderGuideContent(mdSelf, mdProse, guideData);
      updateOpponentLink(key);
    };
    select.value = initialGuide;
    renderGuide(initialGuide);
    syncApplyButton();
    select.addEventListener('change', () => {
      const key = select.value;
      currentMatchupSlug = key;
      renderGuide(key);
      renderDecklistBody();
      updateDeckHashFromState();
    });
    if (applyButton) {
      applyButton.addEventListener('click', () => {
        currentApplySideboard = !currentApplySideboard;
        syncApplyButton();
        renderDecklistBody();
        updateOpponentLink(select.value);
        updateDeckHashFromState();
      });
    }

    const syncCollapsedAndUrl = () => {
      currentCollapsedMask = computeCollapsedMask();
      updateOpponentLink(select.value);
      updateDeckHashFromState();
    };
    [decklistDetails, primerDetails, matchupDetails].forEach((details) => {
      if (!details) return;
      details.addEventListener('toggle', syncCollapsedAndUrl);
    });
  } else {
    const syncCollapsedAndUrl = () => {
      currentCollapsedMask = computeCollapsedMask();
      updateDeckHashFromState();
    };
    [decklistDetails, primerDetails].forEach((details) => {
      if (!details) return;
      details.addEventListener('toggle', syncCollapsedAndUrl);
    });
  }

  renderDecklistBody();
  currentCollapsedMask = computeCollapsedMask();
  updateDeckHashFromState();
}

function renderNotFound() {
  const bodyHtml = `
    <a href="#/" class="back">← Home</a>
    <h1>Not Found</h1>
  `;
  renderBattleboxPane('', bodyHtml);
}

async function init() {
  app.innerHTML = '<div class="loading">Loading...</div>';
  ensureQrOverlay();

  data.index = await fetchJsonData('/data/index.json', { cache: 'no-store' });
  if (!data.index) {
    app.innerHTML = '<div class="loading">Failed to load data.</div>';
    return;
  }
  data.buildId = data.index.build_id || '';

  preview.setupCardHover();
  window.addEventListener('hashchange', async () => {
    await route();
    setActiveTab(TAB_BATTLEBOX);
  });
  window.addEventListener('popstate', async () => {
    await route();
    setActiveTab(TAB_BATTLEBOX);
  });
  await route();
  setActiveTab(TAB_BATTLEBOX);
}

init();
