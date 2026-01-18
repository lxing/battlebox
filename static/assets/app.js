// Battlebox SPA
(function() {
  const app = document.getElementById('app');
  let data = null;
  let cardImageCache = {};
  let previewEl = null;

  // Color symbols
  const colorSymbols = {
    w: '⚪', u: '🔵', b: '⚫', r: '🔴', g: '🟢'
  };

  function formatColors(colors) {
    return colors.split('').map(c => colorSymbols[c] || c).join('');
  }

  // Transform [[Card Name]] to spans
  function transformCardRefs(text, deck) {
    return text.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
      const card = findCard(deck, name);
      const printing = card ? card.printing : '';
      return `<span class="card" data-name="${name}" data-printing="${printing}">${name}</span>`;
    });
  }

  function findCard(deck, name) {
    return deck.cards.find(c => c.name === name) ||
           (deck.sideboard || []).find(c => c.name === name);
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
        previewEl = document.createElement('img');
        previewEl.className = 'card-preview';
        document.body.appendChild(previewEl);
      }

      previewEl.src = url;
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
    previewEl.style.left = Math.min(x, window.innerWidth - 270) + 'px';
    previewEl.style.top = Math.min(y, window.innerHeight - 370) + 'px';
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
          <li><a href="#/${bb.slug}">${bb.slug} <span class="colors">(${bb.decks.length} decks)</span></a></li>
        `).join('')}
      </ul>
    `;
  }

  function renderBattlebox(bbSlug) {
    const bb = data.battleboxes.find(b => b.slug === bbSlug);
    if (!bb) return renderNotFound();

    app.innerHTML = `
      <a href="#/" class="back">← Battleboxes</a>
      <h1>${bb.slug}</h1>
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

    const primerHtml = deck.primer ? transformCardRefs(deck.primer, deck) : '<em>No primer yet</em>';
    const guideKeys = Object.keys(deck.guides || {});

    app.innerHTML = `
      <a href="#/${bb.slug}" class="back">← ${bb.slug}</a>
      <h1>${deck.name} <span class="colors">${formatColors(deck.colors)}</span></h1>

      <h2>Primer</h2>
      <div class="primer">${primerHtml}</div>

      <h2>Decklist</h2>
      <div class="card-list">
        ${deck.cards.map(c => `
          <div class="card-row">
            <span class="card-qty">${c.qty}</span>
            <span class="card-name card" data-name="${c.name}" data-printing="${c.printing}">${c.name}</span>
          </div>
        `).join('')}
      </div>

      ${deck.sideboard && deck.sideboard.length ? `
        <h2>Sideboard</h2>
        <div class="card-list">
          ${deck.sideboard.map(c => `
            <div class="card-row">
              <span class="card-qty">${c.qty}</span>
              <span class="card-name card" data-name="${c.name}" data-printing="${c.printing}">${c.name}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${guideKeys.length ? `
        <h2>Sideboard Guides</h2>
        <ul class="guide-list">
          ${guideKeys.map(k => {
            const opponent = bb.decks.find(d => d.slug === k);
            const name = opponent ? opponent.name : k;
            return `<li><a href="#/${bb.slug}/${deck.slug}/${k}">vs ${name}</a></li>`;
          }).join('')}
        </ul>
      ` : ''}
    `;
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
    const guideHtml = transformCardRefs(guide, deck);

    app.innerHTML = `
      <a href="#/${bb.slug}/${deck.slug}" class="back">← ${deck.name}</a>
      <h1>vs ${opponentName}</h1>
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
