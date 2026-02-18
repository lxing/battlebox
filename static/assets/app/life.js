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
const BLOOD_TOKEN_MIN = 0;
const BLOOD_TOKEN_MAX = 20;

function parseLifeTotal(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseMonarchOwner(value) {
  return value === 'p1' || value === 'p2' ? value : null;
}

function clampBloodTotal(value) {
  return Math.max(BLOOD_TOKEN_MIN, Math.min(BLOOD_TOKEN_MAX, value));
}

function parseBloodTotal(value) {
  if (value === null) return null;
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return null;
  return clampBloodTotal(parsed);
}

function parseBloodVisible(value) {
  return value === true;
}

function readLifeState(startingLife) {
  const fallback = {
    p1: startingLife,
    p2: startingLife,
    monarch: null,
    initiative: createInitialInitiativeState(),
    blood: {
      p1: null,
      p2: null,
    },
    bloodVisible: {
      p1: false,
      p2: false,
    },
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
      blood: {
        p1: parseBloodTotal(parsed?.blood?.p1),
        p2: parseBloodTotal(parsed?.blood?.p2),
      },
      bloodVisible: {
        p1: parseBloodVisible(parsed?.bloodVisible?.p1),
        p2: parseBloodVisible(parsed?.bloodVisible?.p2),
      },
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
        blood: {
          p1: state.blood?.p1 ?? null,
          p2: state.blood?.p2 ?? null,
        },
        bloodVisible: {
          p1: state.bloodVisible?.p1 === true,
          p2: state.bloodVisible?.p2 === true,
        },
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
  const physicalX = event.clientX - rect.left;
  // The top panel is rotated 180deg, so horizontal hit zones are mirrored.
  const logicalX = player === 'p2' ? (rect.width - physicalX) : physicalX;
  const isAdd = logicalX >= (rect.width / 2);
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
        <button type="button" class="static-button life-blood-toggle life-blood-toggle-p2" data-life-blood-toggle="p2" data-life-control aria-label="Toggle player 2 blood counter">🩸</button>
        <div class="life-blood-ticker life-blood-ticker-p2" data-life-blood-ticker="p2" data-player="p2" data-life-control aria-label="Player 2 blood counter" hidden>
          <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
          <span class="life-blood-center">
            <span class="life-blood-icon" aria-hidden="true">🩸</span>
            <span class="life-blood-total" data-life-blood-total="p2">1</span>
          </span>
          <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
        </div>
        <span class="life-player-icon life-player-icon-p2" aria-hidden="true">🐭</span>
        <span class="life-monarch life-monarch-p2" data-life-monarch="p2" aria-hidden="true" hidden>👑</span>
        <span class="life-initiative life-initiative-p2" data-life-initiative="p2" aria-hidden="true" hidden>♿️</span>
        <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
        <span class="life-total" data-life-total="p2">${state.p2}</span>
        <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
      </section>
      <section class="life-controls" aria-label="Life controls">
        <button type="button" class="static-button life-control-button" id="life-left-button" aria-label="Toggle monarch">👑</button>
        <button type="button" class="static-button life-control-button" id="life-reset-button" aria-label="Reset life totals">🔄</button>
        <button type="button" class="static-button life-control-button" id="life-right-button" aria-label="Open initiative tracker">♿️</button>
      </section>
      <section class="life-player life-player-bottom" data-player="p1" aria-label="Player 1 life total">
        <button type="button" class="static-button life-blood-toggle life-blood-toggle-p1" data-life-blood-toggle="p1" data-life-control aria-label="Toggle player 1 blood counter">🩸</button>
        <div class="life-blood-ticker life-blood-ticker-p1" data-life-blood-ticker="p1" data-player="p1" data-life-control aria-label="Player 1 blood counter" hidden>
          <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
          <span class="life-blood-center">
            <span class="life-blood-icon" aria-hidden="true">🩸</span>
            <span class="life-blood-total" data-life-blood-total="p1">1</span>
          </span>
          <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
        </div>
        <span class="life-player-icon life-player-icon-p1" aria-hidden="true">🐿️</span>
        <span class="life-monarch life-monarch-p1" data-life-monarch="p1" aria-hidden="true" hidden>👑</span>
        <span class="life-initiative life-initiative-p1" data-life-initiative="p1" aria-hidden="true" hidden>♿️</span>
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
  const initiativeMarkers = {
    p1: container.querySelector('[data-life-initiative="p1"]'),
    p2: container.querySelector('[data-life-initiative="p2"]'),
  };
  const bloodButtons = {
    p1: container.querySelector('[data-life-blood-toggle="p1"]'),
    p2: container.querySelector('[data-life-blood-toggle="p2"]'),
  };
  const bloodTickers = {
    p1: container.querySelector('[data-life-blood-ticker="p1"]'),
    p2: container.querySelector('[data-life-blood-ticker="p2"]'),
  };
  const bloodTotals = {
    p1: container.querySelector('[data-life-blood-total="p1"]'),
    p2: container.querySelector('[data-life-blood-total="p2"]'),
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
  const renderInitiative = () => {
    const owner = state.initiative?.owner === 'p1' || state.initiative?.owner === 'p2'
      ? state.initiative.owner
      : null;
    Object.entries(initiativeMarkers).forEach(([player, marker]) => {
      if (!marker) return;
      marker.hidden = owner !== player;
    });
  };
  const renderBlood = () => {
    ['p1', 'p2'].forEach((player) => {
      const button = bloodButtons[player];
      const ticker = bloodTickers[player];
      const total = bloodTotals[player];
      const visible = state.bloodVisible[player] === true;
      const value = state.blood[player] === null ? 1 : clampBloodTotal(state.blood[player]);
      if (button) {
        button.classList.toggle('active', visible);
      }
      if (ticker) {
        ticker.hidden = !visible;
      }
      if (total) {
        total.textContent = String(value);
      }
    });
  };
  const initiativeOverlay = createInitiativeOverlay(container, state, () => {
    writeLifeState(state);
    renderInitiative();
  });

  const applyDelta = (player, delta) => {
    state[player] += delta;
    render();
    writeLifeState(state);
  };
  const applyBloodDelta = (player, delta) => {
    const current = state.blood[player] === null ? 1 : state.blood[player];
    const next = clampBloodTotal(current + delta);
    state.blood[player] = next;
    renderBlood();
    writeLifeState(state);
  };
  const toggleBloodTicker = (player) => {
    const visible = state.bloodVisible[player] === true;
    if (visible) {
      state.bloodVisible[player] = false;
      renderBlood();
      writeLifeState(state);
      return;
    }
    if (state.blood[player] === null) {
      state.blood[player] = 1;
    }
    state.bloodVisible[player] = true;
    renderBlood();
    writeLifeState(state);
  };

  const resetGameState = () => {
    state.p1 = startingLife;
    state.p2 = startingLife;
    state.monarch = null;
    state.initiative = resetInitiativeState();
    render();
    renderMonarch();
    renderInitiative();
    writeLifeState(state);
    initiativeOverlay.sync();
  };

  const clearActiveHold = () => {
    if (!activeHold) return;
    if (activeHold.delayTimer) window.clearTimeout(activeHold.delayTimer);
    if (activeHold.repeatTimer) window.clearInterval(activeHold.repeatTimer);
    activeHold = null;
  };
  const startHoldInteraction = (event, target, interaction, applyStep) => {
    event.preventDefault();
    clearActiveHold();

    if (target instanceof HTMLElement && target.setPointerCapture) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch (_) {
        // Ignore capture failures and continue with basic press handling.
      }
    }

    const hold = {
      pointerId: event.pointerId,
      tapDelta: interaction.step,
      holdDelta: interaction.step * HOLD_DELTA_MULTIPLIER,
      isHolding: false,
      applyStep,
      delayTimer: null,
      repeatTimer: null,
    };
    activeHold = hold;

    hold.delayTimer = window.setTimeout(() => {
      if (activeHold !== hold) return;
      hold.isHolding = true;
      hold.applyStep(hold.holdDelta);
      hold.repeatTimer = window.setInterval(() => {
        if (activeHold !== hold) return;
        hold.applyStep(hold.holdDelta);
      }, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
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
    if (event.target instanceof Element && event.target.closest('[data-life-control]')) {
      return;
    }
    const interaction = getLifeInteraction(panel, event);
    if (!interaction) return;
    const player = interaction.player;
    startHoldInteraction(event, panel, interaction, (delta) => {
      applyDelta(player, delta);
    });
  };
  const onBloodPointerDown = (event) => {
    const ticker = event.currentTarget;
    const interaction = getLifeInteraction(ticker, event);
    if (!interaction) return;
    const player = interaction.player;
    startHoldInteraction(event, ticker, interaction, (delta) => {
      applyBloodDelta(player, delta);
    });
  };

  const onPointerUp = (event) => {
    if (!activeHold || activeHold.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { tapDelta, isHolding, applyStep } = activeHold;
    clearActiveHold();
    if (!isHolding) {
      applyStep(tapDelta);
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
  Object.values(bloodTickers).forEach((ticker) => {
    if (!ticker) return;
    ticker.addEventListener('pointerdown', onBloodPointerDown);
    ticker.addEventListener('pointerup', onPointerUp);
    ticker.addEventListener('pointercancel', onPointerCancel);
    ticker.addEventListener('lostpointercapture', onPointerCancel);
    ticker.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });
  bindControlAction(bloodButtons.p1, () => {
    toggleBloodTicker('p1');
  });
  bindControlAction(bloodButtons.p2, () => {
    toggleBloodTicker('p2');
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
  renderInitiative();
  renderBlood();
  initiativeOverlay.sync();
}
