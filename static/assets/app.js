// Battlebox SPA
(function() {
  const app = document.getElementById('app');
  let data = null;
  let cardImageCache = {};
  let previewEl = null;
  let previewImg = null;
  let previewStatus = null;

  function formatColors(colors) {
    return colors.split('').map(c =>
      `<span class="mana-symbol mana-${c}"></span>`
    ).join('');
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function createMarkdownRenderer(deck) {
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
      const card = findCard(deck, target);
      const printing = card ? card.printing : '';
      return `<span class="card" data-name="${target}" data-printing="${printing}">${md.utils.escapeHtml(display)}</span>`;
    };

    return md;
  }

  function renderGuideContent(md, guide) {
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

    if (ins.length || outs.length) {
      const renderItems = (items) => items.map(item => `<li>${md.renderInline(item)}</li>`).join('');
      html += `
        <div class="guide-plan">
          <div class="guide-plan-col">
            <div class="guide-plan-title">In</div>
            <ul class="guide-plan-list">${renderItems(ins)}</ul>
          </div>
          <div class="guide-plan-col">
            <div class="guide-plan-title">Out</div>
            <ul class="guide-plan-list">${renderItems(outs)}</ul>
          </div>
        </div>
      `;
    }

    if (prose) {
      html += `<div class="guide-prose">${md.render(prose)}</div>`;
    }

    return html || '<em>No guide yet</em>';
  }

  function findCard(deck, name) {
    const normalize = s => s.toLowerCase().trim();
    const target = normalize(name);
    return deck.cards.find(c => normalize(c.name) === target) ||
           (deck.sideboard || []).find(c => normalize(c.name) === target);
  }

  function renderCardsByType(cards) {
    const groups = { creature: [], spell: [], land: [] };
    cards.forEach(c => {
      const type = c.type || 'spell';
      if (groups[type]) groups[type].push(c);
    });

    const labels = { creature: 'Creatures', spell: 'Spells', land: 'Lands' };
    let html = '';

    for (const type of ['creature', 'spell', 'land']) {
      const group = groups[type];
      if (group.length === 0) continue;
      const count = group.reduce((sum, c) => sum + c.qty, 0);
      html += `<div class="card-group">`;
      html += `<div class="card-group-label">${labels[type]} (${count})</div>`;
      html += group.map(c =>
        `<div class="card-row"><span class="card-qty">${c.qty}</span><span class="card" data-name="${c.name}" data-printing="${c.printing}">${c.name}</span></div>`
      ).join('');
      html += `</div>`;
    }
    return html;
  }

  // Scryfall image URL
  function getImageUrl(printing) {
    if (!printing) return null;
    const [set, num] = printing.split('/');
    return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=normal`;
  }

  // Card hover preview
  function setupCardHover() {
    app.addEventListener('mouseover', (e) => {
      if (!e.target.classList.contains('card')) return;
      const printing = e.target.dataset.printing;
      if (!printing) return;

      const url = getImageUrl(printing);
      if (!url) return;

      if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.className = 'card-preview';
        previewStatus = document.createElement('div');
        previewStatus.className = 'card-preview-loading';
        previewStatus.textContent = 'Loading...';
        previewImg = document.createElement('img');
        previewEl.appendChild(previewStatus);
        previewEl.appendChild(previewImg);
        previewImg.addEventListener('load', () => {
          previewStatus.style.display = 'none';
          previewImg.style.display = 'block';
        });
        previewImg.addEventListener('error', () => {
          previewStatus.textContent = 'Image unavailable';
          previewStatus.style.display = 'block';
          previewImg.style.display = 'none';
        });
        document.body.appendChild(previewEl);
      }

      previewStatus.textContent = 'Loading...';
      previewStatus.style.display = 'block';
      previewImg.style.display = 'none';
      previewImg.src = url;
      previewEl.style.display = 'block';
      positionPreview(e);
    });

    app.addEventListener('mousemove', (e) => {
      if (previewEl && previewEl.style.display === 'block') {
        positionPreview(e);
      }
    });

    app.addEventListener('mouseout', (e) => {
      if (e.target.classList.contains('card') && previewEl) {
        previewEl.style.display = 'none';
      }
    });
  }

  function positionPreview(e) {
    const x = e.clientX + 15;
    const y = e.clientY + 15;
    const width = previewEl.offsetWidth || 250;
    const height = previewEl.offsetHeight || 360;
    previewEl.style.left = Math.min(x, window.innerWidth - width - 20) + 'px';
    previewEl.style.top = Math.min(y, window.innerHeight - height - 20) + 'px';
  }

  // Router
  function route() {
    const hash = location.hash.slice(1) || '/';
    const parts = hash.split('/').filter(Boolean);

    if (parts.length === 0) {
      renderHome();
    } else if (parts.length === 1) {
      renderBattlebox(parts[0]);
    } else if (parts.length === 2) {
      renderDeck(parts[0], parts[1]);
    } else if (parts.length === 3) {
      renderGuide(parts[0], parts[1], parts[2]);
    }
  }

  function renderHome() {
    app.innerHTML = `
      <h1>Battlebox</h1>
      <ul class="deck-list">
        ${data.battleboxes.map(bb => `
          <li><a href="#/${bb.slug}">${capitalize(bb.slug)} <span class="colors">(${bb.decks.length} decks)</span></a></li>
        `).join('')}
      </ul>
    `;
  }

  function renderBattlebox(bbSlug) {
    const bb = data.battleboxes.find(b => b.slug === bbSlug);
    if (!bb) return renderNotFound();

    app.innerHTML = `
      <a href="#/" class="back">← Battleboxes</a>
      <h1>${capitalize(bb.slug)}</h1>
      <ul class="deck-list">
        ${bb.decks.map(d => `
          <li><a href="#/${bb.slug}/${d.slug}">
            ${d.name} <span class="colors">${formatColors(d.colors)}</span>
          </a></li>
        `).join('')}
      </ul>
    `;
  }

  function renderDeck(bbSlug, deckSlug) {
    const bb = data.battleboxes.find(b => b.slug === bbSlug);
    if (!bb) return renderNotFound();
    const deck = bb.decks.find(d => d.slug === deckSlug);
    if (!deck) return renderNotFound();

    const md = createMarkdownRenderer(deck);
    const primerHtml = deck.primer ? md.render(deck.primer) : '<em>No primer yet</em>';
    const guideKeys = Object.keys(deck.guides || {});
    const guideOptions = guideKeys.map(k => {
      const opponent = bb.decks.find(d => d.slug === k);
      const name = opponent ? opponent.name : k;
      return `<option value="${k}">${name}</option>`;
    }).join('');

    app.innerHTML = `
      <a href="#/${bb.slug}" class="back">← ${capitalize(bb.slug)}</a>
      <h1>${deck.name} <span class="colors">${formatColors(deck.colors)}</span></h1>

      <h2>Primer</h2>
      <div class="primer">${primerHtml}</div>

      ${guideKeys.length ? `
        <details class="matchup-guides">
          <summary>Matchup Guides</summary>
          <div class="guide-panel">
            <div class="guide-select">
              <label for="guide-select">Opponent</label>
              <select id="guide-select">
                ${guideOptions}
              </select>
            </div>
            <div class="guide-box" id="guide-box"></div>
          </div>
        </details>
      ` : ''}

      <h2>Decklist</h2>
      <div class="card-list">
        ${renderCardsByType(deck.cards)}
      </div>

      ${deck.sideboard && deck.sideboard.length ? `
        <h2>Sideboard</h2>
        <div class="card-list">
          ${deck.sideboard.map(c => `<div class="card-row"><span class="card-qty">${c.qty}</span><span class="card" data-name="${c.name}" data-printing="${c.printing}">${c.name}</span></div>`).join('')}
        </div>
      ` : ''}

      
    `;

    if (guideKeys.length) {
      const select = document.getElementById('guide-select');
      const guideBox = document.getElementById('guide-box');
      const renderGuide = (key) => {
      const guideData = deck.guides[key] || '';
      guideBox.innerHTML = renderGuideContent(md, guideData);
      };
      renderGuide(select.value || guideKeys[0]);
      select.addEventListener('change', () => renderGuide(select.value));
    }
  }

  function renderGuide(bbSlug, deckSlug, opponentSlug) {
    const bb = data.battleboxes.find(b => b.slug === bbSlug);
    if (!bb) return renderNotFound();
    const deck = bb.decks.find(d => d.slug === deckSlug);
    if (!deck) return renderNotFound();

    const guide = (deck.guides || {})[opponentSlug];
    if (!guide) return renderNotFound();

    const opponent = bb.decks.find(d => d.slug === opponentSlug);
    const opponentName = opponent ? opponent.name : opponentSlug;
    const md = createMarkdownRenderer(deck);
    const guideHtml = renderGuideContent(md, guide);

    app.innerHTML = `
      <a href="#/${bb.slug}/${deck.slug}" class="back">← ${deck.name}</a>
      <h1>${opponentName}</h1>
      <div class="primer">${guideHtml}</div>
    `;
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

    const res = await fetch('/data.json');
    data = await res.json();

    setupCardHover();
    window.addEventListener('hashchange', route);
    route();
  }

  init();
})();
