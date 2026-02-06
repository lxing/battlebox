// Battlebox SPA
(function() {
  const app = document.getElementById('app');
  let data = { index: null, battleboxes: {}, buildId: '' };
  let previewEl = null;
  let previewImgFront = null;
  let previewImgBack = null;
  let previewImages = null;
  let previewStatus = null;
  let previewToken = 0;
  let previewUrl = '';

  function formatColors(colors) {
    return colors.split('').map(c =>
      `<span class="mana-symbol mana-${c}"></span>`
    ).join('');
  }

  function sortArchetypeTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return [];
    const rank = {
      aggro: 0,
      tempo: 1,
      midrange: 2,
      control: 3,
      combo: 4,
      tribal: 5,
    };
    return [...tags].sort((a, b) => {
      const ak = normalizeName(a);
      const bk = normalizeName(b);
      const ar = Object.prototype.hasOwnProperty.call(rank, ak) ? rank[ak] : 100;
      const br = Object.prototype.hasOwnProperty.call(rank, bk) ? rank[bk] : 100;
      if (ar !== br) return ar - br;
      return ak.localeCompare(bk);
    });
  }

  function renderDeckTags(tags) {
    const sorted = sortArchetypeTags(tags);
    if (sorted.length === 0) return '';
    return sorted.map(tag => {
      const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
      if (!key) return '';
      return `<span class="deck-tag deck-tag-${key}">${key}</span>`;
    }).join('');
  }

  function sortDifficultyTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return [];
    const rank = {
      beginner: 0,
      intermediate: 1,
      expert: 2,
    };
    return [...tags].sort((a, b) => {
      const ak = normalizeName(a);
      const bk = normalizeName(b);
      const ar = Object.prototype.hasOwnProperty.call(rank, ak) ? rank[ak] : 100;
      const br = Object.prototype.hasOwnProperty.call(rank, bk) ? rank[bk] : 100;
      if (ar !== br) return ar - br;
      return ak.localeCompare(bk);
    });
  }

  function difficultyTagLabel(key) {
    if (key === 'beginner') return '🧠';
    if (key === 'intermediate') return '🧠🧠';
    if (key === 'expert') return '🧠🧠🧠';
    return key;
  }

  function renderDifficultyTags(tags) {
    const sorted = sortDifficultyTags(tags);
    if (sorted.length === 0) return '';
    return sorted.map(tag => {
      const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
      if (!key) return '';
      return `<span class="deck-tag deck-tag-difficulty deck-tag-${key}">${difficultyTagLabel(key)}</span>`;
    }).join('');
  }

  function renderDeckSelectionTags(tags, difficultyTags) {
    const archetype = sortArchetypeTags(tags).map(tag => {
      const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
      if (!key) return '';
      return `<span class="deck-tag deck-tag-${key}">${key}</span>`;
    });
    const difficulty = sortDifficultyTags(difficultyTags).map(tag => {
      const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
      if (!key) return '';
      return `<span class="deck-tag deck-tag-difficulty deck-tag-${key}">${difficultyTagLabel(key)}</span>`;
    });
    return [...archetype, ...difficulty].filter(Boolean).join('');
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function normalizeName(name) {
    return name.toLowerCase().trim();
  }

  function getCardTarget(event) {
    if (!event.target || !event.target.closest) return null;
    return event.target.closest('.card');
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

  function createMarkdownRenderer(printingsList, doubleFacedList) {
    const md = window.markdownit({
      html: false,
      linkify: true,
      breaks: true
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
      return `<span class="card" data-name="${target}" data-printing="${printing}"${doubleFacedAttr}>${md.utils.escapeHtml(display)}</span>`;
    };

    return md;
  }

  function renderGuideContent(mdPlan, mdProse, guide) {
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

  function buildDoubleFacedMap(deck) {
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

  function renderCardRow(card, bannedSet) {
    const banned = bannedSet && bannedSet.has(normalizeName(card.name));
    const bannedTag = banned ? '<span class="banned-inline-tag" title="Banned">🔨 BAN</span>' : '';
    const doubleFacedAttr = card.double_faced ? ' data-double-faced="1"' : '';
    return `<div class="card-row"><span class="card-qty">${card.qty}</span><span class="card" data-name="${card.name}" data-printing="${card.printing}"${doubleFacedAttr}>${card.name}${bannedTag}</span></div>`;
  }

  function renderCardsByType(cards, bannedSet, types) {
    const groups = { creature: [], spell: [], land: [] };
    cards.forEach(c => {
      const type = c.type || 'spell';
      if (groups[type]) groups[type].push(c);
    });

    const labels = { creature: 'Creatures', spell: 'Spells', land: 'Lands' };
    let html = '';

    const order = types && types.length ? types : ['creature', 'spell', 'land'];
    for (const type of order) {
      const group = groups[type];
      if (group.length === 0) continue;
      const count = group.reduce((sum, c) => sum + c.qty, 0);
      html += `<div class="card-group">`;
      html += `<div class="card-group-label">${labels[type]} (${count})</div>`;
      html += group.map(c => renderCardRow(c, bannedSet)).join('');
      html += `</div>`;
    }
    return html;
  }

  function renderCardGroup(cards, label, bannedSet) {
    if (!cards || cards.length === 0) return '';
    const count = cards.reduce((sum, c) => sum + c.qty, 0);
    return `
      <div class="card-group">
        <div class="card-group-label">${label} (${count})</div>
        ${cards.map(c => renderCardRow(c, bannedSet)).join('')}
      </div>
    `;
  }

  // Scryfall image URL
  function getImageUrl(printing, face) {
    if (!printing) return null;
    const [set, num] = printing.split('/');
    const faceParam = face === 'back' ? '&face=back' : '';
    return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=normal${faceParam}`;
  }

  // Card hover preview
  function positionPreviewAtPoint(absX, absY) {
    if (!previewEl) return;
    const width = previewEl.offsetWidth || 250;
    const height = previewEl.offsetHeight || 350;
    const margin = 10;
    const viewportW = (window.visualViewport && window.visualViewport.width) || document.documentElement.clientWidth;
    const viewportH = (window.visualViewport && window.visualViewport.height) || document.documentElement.clientHeight;

    let x = absX;
    let y = absY;

    if (x + width + margin > viewportW) {
      x = Math.max(margin, viewportW - width - margin);
    }
    if (x < margin) {
      x = margin;
    }
    if (y + height + margin > viewportH) {
      y = Math.max(margin, viewportH - height - margin);
    }
    if (y < margin) {
      y = margin;
    }

    previewEl.style.left = `${x}px`;
    previewEl.style.top = `${y}px`;
  }

  let previewAnchor = null;
  let previewRaf = null;

  function updatePreviewAnchor() {
    if (!previewEl || !previewAnchor) return;
    const rect = previewAnchor.el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const absX = rect.left + (previewAnchor.relX * rect.width);
    const absY = rect.top + (previewAnchor.relY * rect.height);
    positionPreviewAtPoint(absX, absY);
  }

  function schedulePreviewAnchorUpdate() {
    if (!previewAnchor) return;
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = null;
      updatePreviewAnchor();
    });
  }

  function ensurePreviewEl() {
    if (previewEl) return;
    previewEl = document.createElement('div');
    previewEl.className = 'card-preview';
    previewStatus = document.createElement('div');
    previewStatus.className = 'card-preview-loading';
    previewStatus.textContent = 'Loading...';
    previewImages = document.createElement('div');
    previewImages.className = 'card-preview-images';
    previewImgFront = document.createElement('img');
    previewImgBack = document.createElement('img');
    previewImages.appendChild(previewImgFront);
    previewImages.appendChild(previewImgBack);
    previewEl.appendChild(previewStatus);
    previewEl.appendChild(previewImages);
    previewEl.addEventListener('mouseleave', (e) => {
      if (!previewAnchor) return;
      const cardEl = previewAnchor.el;
      if (cardEl && e.relatedTarget && (cardEl === e.relatedTarget || cardEl.contains(e.relatedTarget))) {
        return;
      }
      hidePreview();
    });
  }

  function openPreview(cardEl, e) {
    const printing = cardEl.dataset.printing;
    if (!printing) return;
    const isDoubleFaced = cardEl.dataset.doubleFaced === '1';
    const frontUrl = getImageUrl(printing, 'front');
    if (!frontUrl) return;
    const backUrl = isDoubleFaced ? getImageUrl(printing, 'back') : null;
    const urlKey = isDoubleFaced ? `${frontUrl}|${backUrl}` : frontUrl;
    if (previewAnchor && previewAnchor.el === cardEl && previewEl && previewEl.style.display !== 'none' && previewUrl === urlKey) {
      positionPreviewAtPoint(e.clientX, e.clientY);
      return;
    }
    previewUrl = urlKey;
    ensurePreviewEl();
    previewEl.classList.toggle('card-preview-double', isDoubleFaced);
    if (previewEl.parentNode !== document.body) {
      document.body.appendChild(previewEl);
    }
    previewStatus.textContent = 'Loading...';
    previewStatus.style.display = 'block';
    previewImgFront.style.display = 'none';
    previewImgBack.style.display = 'none';
    previewImages.style.display = 'none';
    // Preload to avoid noisy aborted image requests when hover changes quickly.
    const token = ++previewToken;
    let pending = isDoubleFaced ? 2 : 1;
    let loaded = 0;

    const finish = (ok) => {
      pending -= 1;
      if (ok) loaded += 1;
      if (pending > 0) return;
      if (token !== previewToken || previewUrl !== urlKey) return;
      if (loaded === 0) {
        previewStatus.textContent = 'Image unavailable';
        previewStatus.style.display = 'block';
      } else {
        previewStatus.style.display = 'none';
        previewImages.style.display = 'flex';
      }
    };

    const loadImage = (slot, url, isBack) => {
      const img = new Image();
      img.className = slot.className;
      img.alt = slot.alt || '';
      img.onload = () => {
        if (token !== previewToken || previewUrl !== urlKey) return;
        img.style.display = 'block';
        previewImages.replaceChild(img, slot);
        if (isBack) {
          previewImgBack = img;
        } else {
          previewImgFront = img;
        }
        finish(true);
      };
      img.onerror = () => {
        if (token !== previewToken || previewUrl !== urlKey) return;
        finish(false);
      };
      img.src = url;
    };

    loadImage(previewImgFront, frontUrl, false);
    if (isDoubleFaced && backUrl) {
      loadImage(previewImgBack, backUrl, true);
    } else {
      previewImgBack.style.display = 'none';
    }
    previewEl.style.display = 'block';
    positionPreviewAtPoint(e.clientX, e.clientY);
    const rect = cardEl.getBoundingClientRect();
    previewAnchor = {
      el: cardEl,
      relX: rect.width ? (e.clientX - rect.left) / rect.width : 0.5,
      relY: rect.height ? (e.clientY - rect.top) / rect.height : 0.5,
    };
  }

  function setupCardHover() {
    const prefersHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    document.addEventListener('click', (e) => {
      if (!previewEl || previewEl.style.display === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      hidePreview();
    }, true);

    if (prefersHover) {
      app.addEventListener('pointerenter', (e) => {
        const cardEl = getCardTarget(e);
        if (!cardEl) return;
        if (e.relatedTarget && cardEl.contains(e.relatedTarget)) return;
        openPreview(cardEl, e);
      }, true);

      app.addEventListener('pointerleave', (e) => {
        const cardEl = getCardTarget(e);
        if (!cardEl || !previewEl) return;
        if (e.relatedTarget && cardEl.contains(e.relatedTarget)) return;
        if (e.relatedTarget && previewEl.contains(e.relatedTarget)) return;
        hidePreview();
      }, true);
    } else {
      app.addEventListener('click', (e) => {
        const cardEl = getCardTarget(e);
        if (!cardEl) return;
        e.preventDefault();
        e.stopPropagation();
        openPreview(cardEl, e);
      });
    }

    window.addEventListener('scroll', schedulePreviewAnchorUpdate, { passive: true });
    window.addEventListener('resize', schedulePreviewAnchorUpdate);
  }

  function hidePreview() {
    if (previewEl) {
      previewEl.style.display = 'none';
    }
    previewAnchor = null;
    previewToken += 1;
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

  // Router
  async function route() {
    hidePreview();
    const hash = location.hash.slice(1) || '/';
    const parts = hash.split('/').filter(Boolean);

    window.scrollTo(0, 0);

    if (parts.length === 0) {
      renderHome();
    } else if (parts.length === 1) {
      renderBattlebox(parts[0]);
    } else if (parts.length === 2) {
      await renderDeck(parts[0], parts[1]);
    } else if (parts.length === 3) {
      if (parts[2] === 'matchup') {
        await renderDeck(parts[0], parts[1]);
      } else {
        await renderDeck(parts[0], parts[1], parts[2]);
      }
    } else if (parts.length === 4 && parts[2] === 'matchup') {
      await renderDeck(parts[0], parts[1], parts[3]);
    }
  }

  function renderHome() {
    app.innerHTML = `
      <h1 class="breadcrumbs">Battlebox</h1>
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
  }

  function renderBattlebox(bbSlug) {
    const bb = data.index.battleboxes.find(b => b.slug === bbSlug);
    if (!bb) return renderNotFound();

    app.innerHTML = `
      <h1 class="breadcrumbs">
        <a href="#/">Battlebox</a>
        <span class="crumb-sep">/</span>
        <span>${capitalize(bb.slug)}</span>
      </h1>
      <div class="randomizer">
        <div class="randomizer-row">
          <div class="randomizer-title">Random deck</div>
          <div class="randomizer-controls">
            <button type="button" class="randomizer-roll action-button" data-count="1">Roll 1</button>
            <button type="button" class="randomizer-roll action-button" data-count="2">Roll 2</button>
          </div>
        </div>
      </div>
      <ul class="deck-list">
        ${bb.decks.map(d => `
          <li class="deck-item" data-slug="${d.slug}"><a class="deck-link" href="#/${bb.slug}/${d.slug}">
            <span class="deck-link-name">${d.name}</span>
            <div class="deck-link-tags">${renderDeckSelectionTags(d.tags, d.difficulty_tags)}</div>
            <span class="colors">${formatColors(d.colors)}</span>
          </a></li>
        `).join('')}
      </ul>
    `;

    const deckItems = [...app.querySelectorAll('.deck-item')];
    const deckBySlug = new Map(
      deckItems.map(item => [item.dataset.slug, item.querySelector('.deck-link')])
    );
    const deckIndexBySlug = new Map(
      deckItems.map((item, idx) => [item.dataset.slug, idx])
    );

    const rollButtons = [...app.querySelectorAll('.randomizer-roll')];

    const clearHighlights = () => {
      deckBySlug.forEach(link => link.classList.remove('deck-highlight'));
    };

    const roll = (count) => {
      if (deckItems.length === 0) return;
      clearHighlights();
      const target = Math.min(count, deckItems.length);
      const picked = new Set();
      while (picked.size < target) {
        const idx = Math.floor(Math.random() * deckItems.length);
        const slug = deckItems[idx].dataset.slug;
        picked.add(slug);
      }
      let scrollSlug = null;
      let maxPickedIndex = -1;
      picked.forEach(slug => {
        const link = deckBySlug.get(slug);
        if (link) link.classList.add('deck-highlight');
        const itemIndex = deckIndexBySlug.get(slug);
        if (typeof itemIndex === 'number' && itemIndex > maxPickedIndex) {
          maxPickedIndex = itemIndex;
          scrollSlug = slug;
        }
      });
      if (scrollSlug) {
        const link = deckBySlug.get(scrollSlug);
        if (link) {
          link.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    };

    rollButtons.forEach(btn => {
      btn.addEventListener('click', () => roll(Number(btn.dataset.count)));
    });
  }

  async function renderDeck(bbSlug, deckSlug, selectedGuide) {
    const bb = await loadBattlebox(bbSlug);
    if (!bb) return renderNotFound();
    const deck = bb.decks.find(d => d.slug === deckSlug);
    if (!deck) return renderNotFound();

    const deckPrintings = deck.printings || {};
    const deckDoubleFaced = buildDoubleFacedMap(deck);
    const mdSelf = createMarkdownRenderer([deckPrintings], [deckDoubleFaced]);
    const combosHtml = deck.key_combos ? mdSelf.render(deck.key_combos) : '<em>No key combos yet</em>';
    const primerHtml = deck.primer ? mdSelf.render(deck.primer) : '<em>No primer yet</em>';
    const bannedNames = Array.isArray(bb.banned) ? bb.banned : [];
    const bannedSet = new Set(bannedNames.map(normalizeName));
    const guideKeys = Object.keys(deck.guides || {});
    const guideOptions = guideKeys.map(k => {
      const opponent = bb.decks.find(d => d.slug === k);
      const name = opponent ? opponent.name : k;
      return `<option value="${k}">${name}</option>`;
    }).join('');

    const hasSideboard = deck.sideboard && deck.sideboard.length;
    const landColumnHtml = !hasSideboard ? `
      <div class="decklist-col">
        <div class="card-list">
          ${renderCardsByType(deck.cards, bannedSet, ['land'])}
        </div>
      </div>
    ` : '';
    const sideboardHtml = hasSideboard ? `
      <div class="decklist-col">
        <div class="card-list">
          ${renderCardGroup(deck.sideboard, 'Sideboard', bannedSet)}
        </div>
      </div>
    ` : '';
    const hasLandColumn = !hasSideboard && deck.cards.some(c => (c.type || 'spell') === 'land');
    const hasSecondColumn = hasSideboard || hasLandColumn;
    const mainTypes = hasSideboard ? undefined : ['creature', 'spell'];

    app.innerHTML = `
      <h1 class="breadcrumbs">
        <a href="#/">Battlebox</a>
        <span class="crumb-sep">/</span>
        <a href="#/${bb.slug}">${capitalize(bb.slug)}</a>
        <span class="crumb-sep">/</span>
        <span>${deck.name}</span>
      </h1>
      <div class="deck-info-pane">
        <div class="deck-colors">${formatColors(deck.colors)}</div>
        <div class="deck-tags">${renderDeckTags(deck.tags)}${renderDifficultyTags(deck.difficulty_tags)}</div>
      </div>

      <details class="collapsible" open>
        <summary>Decklist</summary>
        <div class="collapsible-body">
          <div class="decklist-grid${hasSecondColumn ? '' : ' single'}">
            <div class="decklist-col">
              <div class="card-list">
                ${renderCardsByType(deck.cards, bannedSet, mainTypes)}
              </div>
            </div>
            ${sideboardHtml || landColumnHtml}
          </div>
        </div>
      </details>

      <details class="collapsible" open>
        <summary>Key Combos</summary>
        <div class="collapsible-body">
          <div class="primer key-combos">${combosHtml}</div>
        </div>
      </details>

      <details class="collapsible" open>
        <summary>Primer</summary>
        <div class="collapsible-body">
          <div class="primer">${primerHtml}</div>
        </div>
      </details>

      ${guideKeys.length ? `
        <details class="collapsible matchup-guides" open>
          <summary>Matchup Guides</summary>
          <div class="collapsible-body guide-panel">
            <div class="guide-select">
              <select id="guide-select" aria-label="Matchup guide">
                ${guideOptions}
              </select>
              <a class="guide-opponent-link action-button" id="guide-opponent-link" href="#">Go to deck</a>
            </div>
            <div class="guide-box" id="guide-box"></div>
          </div>
        </details>
      ` : ''}

      
    `;

    if (guideKeys.length) {
      const select = document.getElementById('guide-select');
      const guideBox = document.getElementById('guide-box');
      const opponentLink = document.getElementById('guide-opponent-link');
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
        if (opponentLink) {
          const opponentHasGuide = opponent
            && opponent.guides
            && Object.prototype.hasOwnProperty.call(opponent.guides, deck.slug);
          opponentLink.href = opponentHasGuide
            ? `#/${bb.slug}/${key}/matchup/${deck.slug}`
            : `#/${bb.slug}/${key}`;
          opponentLink.textContent = opponent ? `Go to ${opponent.name}` : 'Go to deck';
        }
      };
      const initialGuide = selectedGuide && guideKeys.includes(selectedGuide)
        ? selectedGuide
        : (select.value || guideKeys[0]);
      select.value = initialGuide;
      renderGuide(initialGuide);
      select.addEventListener('change', () => {
        const key = select.value;
        renderGuide(key);
        const nextHash = `#/${bb.slug}/${deck.slug}/matchup/${key}`;
        if (location.hash !== nextHash) {
          history.replaceState(null, '', nextHash);
        }
      });
    }
  }

  function renderNotFound() {
    app.innerHTML = `
      <a href="#/" class="back">← Home</a>
      <h1>Not Found</h1>
    `;
  }

  // Init
  async function init() {
    app.innerHTML = '<div class="loading">Loading...</div>';

    data.index = await fetchJsonData('/data/index.json', { cache: 'no-store' });
    if (!data.index) {
      app.innerHTML = '<div class="loading">Failed to load data.</div>';
      return;
    }
    data.buildId = data.index.build_id || '';

    setupCardHover();
    window.addEventListener('hashchange', route);
    await route();
  }

  init();
})();
