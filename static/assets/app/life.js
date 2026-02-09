export function createLifeCounter(container, startingLife = 20) {
  const state = {
    p1: startingLife,
    p2: startingLife,
  };

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

  const applyTap = (event) => {
    const panel = event.currentTarget;
    if (!(panel instanceof HTMLElement)) return;
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const rect = panel.getBoundingClientRect();
    if (!rect.width) return;
    const isAdd = (event.clientX - rect.left) >= (rect.width / 2);
    const player = panel.dataset.player === 'p2' ? 'p2' : 'p1';
    state[player] += isAdd ? 1 : -1;
    render();
  };

  container.querySelectorAll('.life-player').forEach((panel) => {
    panel.addEventListener('pointerup', applyTap);
  });

  render();
}
