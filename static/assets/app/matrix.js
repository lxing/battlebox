import { capitalize, normalizeName } from './utils.js';

function fitMatrixHeaderHeight(scope) {
  if (!scope) return;
  const labels = [...scope.querySelectorAll('.matrix-col-head-text')];
  if (labels.length === 0) return;

  const probe = document.createElement('span');
  probe.className = 'matrix-col-head-text';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.height = 'auto';
  probe.style.width = 'auto';
  probe.style.padding = '0';
  probe.style.margin = '0';
  document.body.appendChild(probe);

  let maxWidth = 0;
  for (const label of labels) {
    const text = (label.textContent || '').trim();
    if (!text) continue;
    probe.textContent = text;
    const width = probe.getBoundingClientRect().width;
    if (width > maxWidth) maxWidth = width;
  }
  probe.remove();

  if (maxWidth <= 0) return;
  const headHeight = Math.ceil(maxWidth) + 6;
  scope.style.setProperty('--matrix-header-height', `${headHeight}px`);
}

function getWinrateBand(percent) {
  if (percent <= 30) return 0;
  if (percent <= 40) return 1;
  if (percent <= 50) return 2;
  if (percent <= 60) return 3;
  if (percent <= 70) return 4;
  return 5;
}

export function createMatrixController({
  ui,
  loadWinrateMatrix,
}) {
  const state = {
    lastAutoScrollKey: '',
    pendingAutoScrollKey: '',
  };

  function maybeAutoScrollHighlightedCell() {
    if (!ui.matrixPane || ui.matrixPane.hidden) return false;
    if (!state.pendingAutoScrollKey) return false;
    const highlightedCell = ui.matrixPane.querySelector('.matrix-cell-matchup[data-cell-key]');
    if (!highlightedCell) return false;
    const cellKey = highlightedCell.dataset.cellKey || '';
    if (!cellKey || cellKey !== state.pendingAutoScrollKey) return false;
    highlightedCell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    state.lastAutoScrollKey = cellKey;
    state.pendingAutoScrollKey = '';
    return true;
  }

  async function render(battlebox, battleboxSlug, selectedDeckSlug = '', selectedMatchupSlug = '') {
    if (!ui.matrixPane) return;

    if (!battlebox) {
      ui.matrixPane.innerHTML = '<div class="matrix-empty">Open a battlebox to view its winrate matrix.</div>';
      state.pendingAutoScrollKey = '';
      state.lastAutoScrollKey = '';
      return;
    }

    if (battlebox.matrix_tab_enabled === false) {
      ui.matrixPane.innerHTML = `<div class="matrix-empty">No winrate matrix found for ${battlebox.name || capitalize(battleboxSlug)}.</div>`;
      state.pendingAutoScrollKey = '';
      state.lastAutoScrollKey = '';
      return;
    }

    const matrix = await loadWinrateMatrix(battlebox.slug);
    if (!matrix || !matrix.matchups) {
      ui.matrixPane.innerHTML = `<div class="matrix-empty">No winrate matrix found for ${battlebox.name || capitalize(battleboxSlug)}.</div>`;
      state.pendingAutoScrollKey = '';
      state.lastAutoScrollKey = '';
      return;
    }

    const orderedDecks = [...battlebox.decks].sort((a, b) => {
      const nameA = normalizeName(a.name || a.slug);
      const nameB = normalizeName(b.name || b.slug);
      return nameA.localeCompare(nameB);
    });

    const normalizedSelectedDeckSlug = normalizeName(selectedDeckSlug || '');
    const normalizedSelectedMatchupSlug = normalizeName(selectedMatchupSlug || '');
    const selectedCellKey = (
      normalizedSelectedDeckSlug && normalizedSelectedMatchupSlug
    )
      ? `${battlebox.slug}:${normalizedSelectedDeckSlug}:${normalizedSelectedMatchupSlug}`
      : '';
    const colHeadHtml = orderedDecks.map((deck) => {
      const colSlug = normalizeName(deck.slug);
      const isMatchupCol = normalizedSelectedMatchupSlug && colSlug === normalizedSelectedMatchupSlug;
      const headClass = isMatchupCol ? 'matrix-col-head matrix-col-matchup' : 'matrix-col-head';
      return `<th scope="col" class="${headClass}"><span class="matrix-col-head-text">${deck.name}</span></th>`;
    }).join('');

    const rowHtml = orderedDecks.map((rowDeck) => {
      const rowSlug = normalizeName(rowDeck.slug);
      const isSelectedRow = normalizedSelectedDeckSlug && rowSlug === normalizedSelectedDeckSlug;
      const rowClass = isSelectedRow ? 'matrix-row-selected' : '';
      const total = matrix.totals?.[rowDeck.slug];
      const totalPercent = total && Number.isFinite(total.wr) ? Math.round(total.wr * 100) : null;
      const totalWins = total && Number.isFinite(total.wins) ? total.wins : null;
      const totalMatches = total && Number.isFinite(total.matches) ? total.matches : null;
      const totalBand = totalPercent === null ? null : getWinrateBand(totalPercent);
      const totalCellHtml = (
        totalPercent === null || totalWins === null || totalMatches === null || totalMatches === 0
      )
        ? '<td class="matrix-cell matrix-cell-empty">-</td>'
        : `
          <td class="matrix-cell matrix-cell-band-${totalBand}" title="Total ${totalPercent}% WR (${totalWins}/${totalMatches})">
            <div class="matrix-cell-main">${totalPercent}%</div>
            <div class="matrix-cell-record">${totalWins}/${totalMatches}</div>
          </td>
        `;

      const cellHtml = orderedDecks.map((colDeck) => {
        const colSlug = normalizeName(colDeck.slug);
        const isSelectedMatchupCell = (
          normalizedSelectedDeckSlug &&
          normalizedSelectedMatchupSlug &&
          rowSlug === normalizedSelectedDeckSlug &&
          colSlug === normalizedSelectedMatchupSlug
        );
        const isMatchupCol = normalizedSelectedMatchupSlug && colSlug === normalizedSelectedMatchupSlug;
        const result = matrix.matchups?.[rowDeck.slug]?.[colDeck.slug];
        if (!result || !Number.isFinite(result.wr)) {
          const cellClass = [
            'matrix-cell',
            'matrix-cell-empty',
            isMatchupCol ? 'matrix-cell-col-matchup' : '',
            isSelectedMatchupCell ? 'matrix-cell-matchup' : '',
          ].filter(Boolean).join(' ');
          const selectedCellAttr = isSelectedMatchupCell ? ` data-cell-key="${selectedCellKey}"` : '';
          return `<td class="${cellClass}"${selectedCellAttr}>-</td>`;
        }
        const matches = Number.isFinite(result.matches) ? result.matches : 0;
        const won = Math.max(0, Math.min(matches, Math.round(matches * result.wr)));
        const percent = Math.round(result.wr * 100);
        const band = getWinrateBand(percent);
        const title = `${percent}% WR (${won}/${matches})`;
        const cellClass = [
          'matrix-cell',
          `matrix-cell-band-${band}`,
          isMatchupCol ? 'matrix-cell-col-matchup' : '',
          isSelectedMatchupCell ? 'matrix-cell-matchup' : '',
        ].filter(Boolean).join(' ');
        const selectedCellAttr = isSelectedMatchupCell ? ` data-cell-key="${selectedCellKey}"` : '';
        return `
          <td class="${cellClass}" title="${title}"${selectedCellAttr}>
            <div class="matrix-cell-main">${percent}%</div>
            <div class="matrix-cell-record">${won}/${matches}</div>
          </td>
        `;
      }).join('');
      return `
        <tr class="${rowClass}">
          <th scope="row" class="matrix-row-head">${rowDeck.name}</th>
          ${totalCellHtml}
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
                <th scope="col" class="matrix-col-head"><span class="matrix-col-head-text">Total</span></th>
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
    fitMatrixHeaderHeight(ui.matrixPane.querySelector('.matrix-panel'));
    if (!selectedCellKey) {
      state.pendingAutoScrollKey = '';
      state.lastAutoScrollKey = '';
      return;
    }
    if (state.lastAutoScrollKey !== selectedCellKey) {
      state.pendingAutoScrollKey = selectedCellKey;
      maybeAutoScrollHighlightedCell();
    }
  }

  return {
    render,
    maybeAutoScrollHighlightedCell,
  };
}
