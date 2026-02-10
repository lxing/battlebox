import {
  createInitialInitiativeState,
  resetInitiativeState,
  createInitiativeOverlay,
} from './initiative.js';

const LIFE_STORAGE_KEY = 'battlebox.life.v1'; // Do not bump version unless explicitly requested.
const HOLD_DELAY_MS = 500;
const HOLD_REPEAT_MS = 500;
const HOLD_DELTA_MULTIPLIER = 10;
const RESET_HIGHLIGHT_MS = 10000;
const RESET_CONFIRM_WINDOW_MS = 2500;

function parseLifeTotal(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseMonarchOwner(value) {
  return value === 'p1' || value === 'p2' ? value : null;
}

function readLifeState(startingLife) {
  const fallback = {
    p1: startingLife,
    p2: startingLife,
    monarch: null,
    initiative: createInitialInitiativeState(),
  };
  try {
    const raw = window.localStorage.getItem(LIFE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      p1: parseLifeTotal(parsed?.p1, startingLife),
      p2: parseLifeTotal(parsed?.p2, startingLife),
      monarch: parseMonarchOwner(parsed?.monarch),
      initiative: createInitialInitiativeState(parsed?.initiative),
    };
  } catch (_) {
    return fallback;
  }
}

function writeLifeState(state) {
  try {
    window.localStorage.setItem(
      LIFE_STORAGE_KEY,
      JSON.stringify({
        p1: state.p1,
        p2: state.p2,
        monarch: parseMonarchOwner(state.monarch),
        initiative: createInitialInitiativeState(state.initiative),
      })
    );
  } catch (_) {
    // Ignore storage failures (e.g., private mode restrictions).
  }
}

function getLifeInteraction(panel, event) {
  if (!(panel instanceof HTMLElement)) return null;
  if (!event.isPrimary) return null;
  if (event.pointerType === 'mouse' && event.button !== 0) return null;

  const rect = panel.getBoundingClientRect();
  if (!rect.width) return null;

  const player = panel.dataset.player === 'p2' ? 'p2' : 'p1';
  const isAdd = (event.clientX - rect.left) >= (rect.width / 2);
  const step = isAdd ? 1 : -1;

  return { player, step };
}

function bindControlAction(button, onActivate) {
  if (!(button instanceof HTMLElement) || typeof onActivate !== 'function') return;

  button.addEventListener('click', onActivate);
}

export function createLifeCounter(container, startingLife = 20) {
  const state = readLifeState(startingLife);
  let activeHold = null;
  let resetHighlightTimer = null;
  let resetConfirmTimer = null;
  let resetArmed = false;

  container.innerHTML = `
    <div class="life-counter" aria-label="Life counter">
      <section class="life-player life-player-top" data-player="p2" aria-label="Player 2 life total">
        <span class="life-player-icon life-player-icon-p2" aria-hidden="true">🐭</span>
        <span class="life-monarch life-monarch-p2" data-life-monarch="p2" aria-hidden="true" hidden>👑</span>
        <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
        <span class="life-total" data-life-total="p2">${state.p2}</span>
        <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
      </section>
      <section class="life-controls" aria-label="Life controls">
        <button type="button" class="static-button life-control-button" id="life-left-button" aria-label="Toggle monarch">👑</button>
        <button type="button" class="static-button life-control-button" id="life-reset-button" aria-label="Reset life totals">🔄</button>
        <button type="button" class="static-button life-control-button" id="life-right-button" aria-label="Open initiative tracker">⚔️</button>
      </section>
      <section class="life-player life-player-bottom" data-player="p1" aria-label="Player 1 life total">
        <span class="life-player-icon life-player-icon-p1" aria-hidden="true">🐿️</span>
        <span class="life-monarch life-monarch-p1" data-life-monarch="p1" aria-hidden="true" hidden>👑</span>
        <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
        <span class="life-total" data-life-total="p1">${state.p1}</span>
        <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
      </section>
    </div>
  `;

  const totals = {
    p1: container.querySelector('[data-life-total="p1"]'),
    p2: container.querySelector('[data-life-total="p2"]'),
  };
  const players = {
    p1: container.querySelector('.life-player[data-player="p1"]'),
    p2: container.querySelector('.life-player[data-player="p2"]'),
  };
  const resetButton = container.querySelector('#life-reset-button');
  const leftButton = container.querySelector('#life-left-button');
  const rightButton = container.querySelector('#life-right-button');
  const monarchMarkers = {
    p1: container.querySelector('[data-life-monarch="p1"]'),
    p2: container.querySelector('[data-life-monarch="p2"]'),
  };

  const render = () => {
    totals.p1.textContent = String(state.p1);
    totals.p2.textContent = String(state.p2);
  };

  const renderMonarch = () => {
    Object.entries(monarchMarkers).forEach(([player, marker]) => {
      if (!marker) return;
      marker.hidden = state.monarch !== player;
    });
    Object.entries(players).forEach(([player, panel]) => {
      if (!panel) return;
      panel.classList.toggle('life-player-has-monarch', state.monarch === player);
    });
  };
  const initiativeOverlay = createInitiativeOverlay(container, state, () => {
    writeLifeState(state);
  });

  const applyDelta = (player, delta) => {
    state[player] += delta;
    render();
    writeLifeState(state);
  };

  const resetGameState = () => {
    state.p1 = startingLife;
    state.p2 = startingLife;
    state.monarch = null;
    state.initiative = resetInitiativeState();
    render();
    renderMonarch();
    writeLifeState(state);
    initiativeOverlay.sync();
  };

  const clearActiveHold = () => {
    if (!activeHold) return;
    if (activeHold.delayTimer) window.clearTimeout(activeHold.delayTimer);
    if (activeHold.repeatTimer) window.clearInterval(activeHold.repeatTimer);
    activeHold = null;
  };

  const clearResetHighlight = () => {
    if (resetHighlightTimer) {
      window.clearTimeout(resetHighlightTimer);
      resetHighlightTimer = null;
    }
    Object.values(players).forEach((panel) => {
      if (panel) {
        panel.classList.remove('life-player-random-highlight');
      }
    });
  };

  const disarmReset = () => {
    resetArmed = false;
    if (resetConfirmTimer) {
      window.clearTimeout(resetConfirmTimer);
      resetConfirmTimer = null;
    }
    if (resetButton) {
      resetButton.textContent = '🔄';
      resetButton.setAttribute('aria-label', 'Reset life totals');
    }
  };

  const armReset = () => {
    disarmReset();
    resetArmed = true;
    if (resetButton) {
      resetButton.textContent = 'Reset?';
      resetButton.setAttribute('aria-label', 'Confirm reset');
    }
    resetConfirmTimer = window.setTimeout(() => {
      disarmReset();
    }, RESET_CONFIRM_WINDOW_MS);
  };

  const highlightRandomPlayer = () => {
    clearResetHighlight();
    const chosenPlayer = Math.random() < 0.5 ? 'p1' : 'p2';
    const chosenPanel = players[chosenPlayer];
    if (!chosenPanel) return;
    chosenPanel.classList.add('life-player-random-highlight');
    resetHighlightTimer = window.setTimeout(() => {
      chosenPanel.classList.remove('life-player-random-highlight');
      resetHighlightTimer = null;
    }, RESET_HIGHLIGHT_MS);
  };

  const onPointerDown = (event) => {
    const panel = event.currentTarget;
    const interaction = getLifeInteraction(panel, event);
    if (!interaction) return;

    event.preventDefault();
    clearActiveHold();

    if (panel instanceof HTMLElement && panel.setPointerCapture) {
      try {
        panel.setPointerCapture(event.pointerId);
      } catch (_) {
        // Ignore capture failures and continue with basic press handling.
      }
    }

    const hold = {
      pointerId: event.pointerId,
      player: interaction.player,
      tapDelta: interaction.step,
      holdDelta: interaction.step * HOLD_DELTA_MULTIPLIER,
      isHolding: false,
      delayTimer: null,
      repeatTimer: null,
    };
    activeHold = hold;

    hold.delayTimer = window.setTimeout(() => {
      if (activeHold !== hold) return;
      hold.isHolding = true;
      applyDelta(hold.player, hold.holdDelta);
      hold.repeatTimer = window.setInterval(() => {
        if (activeHold !== hold) return;
        applyDelta(hold.player, hold.holdDelta);
      }, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  const onPointerUp = (event) => {
    if (!activeHold || activeHold.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { player, tapDelta, isHolding } = activeHold;
    clearActiveHold();
    if (!isHolding) {
      applyDelta(player, tapDelta);
    }
  };

  const onPointerCancel = (event) => {
    if (!activeHold || activeHold.pointerId !== event.pointerId) return;
    event.preventDefault();
    clearActiveHold();
  };

  container.querySelectorAll('.life-player').forEach((panel) => {
    panel.addEventListener('pointerdown', onPointerDown);
    panel.addEventListener('pointerup', onPointerUp);
    panel.addEventListener('pointercancel', onPointerCancel);
    panel.addEventListener('lostpointercapture', onPointerCancel);
    panel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  bindControlAction(resetButton, () => {
    clearActiveHold();
    if (!resetArmed) {
      armReset();
      return;
    }
    disarmReset();
    resetGameState();
    highlightRandomPlayer();
  });

  bindControlAction(leftButton, () => {
    state.monarch = state.monarch === 'p1' ? 'p2' : 'p1';
    renderMonarch();
    writeLifeState(state);
  });

  bindControlAction(rightButton, () => {
    initiativeOverlay.toggle();
  });

  render();
  renderMonarch();
  initiativeOverlay.sync();
}
