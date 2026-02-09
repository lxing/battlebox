const LIFE_STORAGE_KEY = 'battlebox.life.v1'; // Do not bump version unless explicitly requested.
const HOLD_DELAY_MS = 1000;
const HOLD_REPEAT_MS = 500;
const HOLD_DELTA_MULTIPLIER = 10;

function parseLifeTotal(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function readLifeState(startingLife) {
  const fallback = { p1: startingLife, p2: startingLife };
  try {
    const raw = window.localStorage.getItem(LIFE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      p1: parseLifeTotal(parsed?.p1, startingLife),
      p2: parseLifeTotal(parsed?.p2, startingLife),
    };
  } catch (_) {
    return fallback;
  }
}

function writeLifeState(state) {
  try {
    window.localStorage.setItem(
      LIFE_STORAGE_KEY,
      JSON.stringify({ p1: state.p1, p2: state.p2 })
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

export function createLifeCounter(container, startingLife = 20) {
  const state = readLifeState(startingLife);
  let activeHold = null;

  container.innerHTML = `
    <div class="life-counter" aria-label="Life counter">
      <section class="life-player life-player-top" data-player="p2" aria-label="Player 2 life total">
        <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
        <span class="life-total" data-life-total="p2">${state.p2}</span>
        <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
      </section>
      <section class="life-player life-player-bottom" data-player="p1" aria-label="Player 1 life total">
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

  const render = () => {
    totals.p1.textContent = String(state.p1);
    totals.p2.textContent = String(state.p2);
  };

  const applyDelta = (player, delta) => {
    state[player] += delta;
    render();
    writeLifeState(state);
  };

  const clearActiveHold = () => {
    if (!activeHold) return;
    if (activeHold.delayTimer) window.clearTimeout(activeHold.delayTimer);
    if (activeHold.repeatTimer) window.clearInterval(activeHold.repeatTimer);
    activeHold = null;
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

  render();
}
