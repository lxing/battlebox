import { normalizeName } from './utils.js';

export function createDraftController({ ui, renderBattleboxPane, hidePreview }) {
  const draftUi = {
    socket: null,
    roomId: '',
    seat: 0,
    state: null,
    connected: false,
    status: '',
    pendingPick: false,
  };

  function parseRoute(rawHash) {
    const hash = typeof rawHash === 'string' ? rawHash : (location.hash.slice(1) || '/');
    const [pathPart, queryPart = ''] = hash.split('?');
    const parts = pathPart.split('/').filter(Boolean);
    if (parts.length !== 1 || normalizeName(parts[0]) !== 'draft') return null;

    const params = new URLSearchParams(queryPart);
    const roomId = (params.get('room') || '').trim();
    const seatRaw = Number.parseInt(params.get('seat') || '0', 10);
    const seat = Number.isFinite(seatRaw) && seatRaw >= 0 ? seatRaw : 0;
    if (!roomId) return null;
    return { roomId, seat };
  }

  function buildHash(roomId, seat = 0) {
    const params = new URLSearchParams();
    params.set('room', roomId);
    params.set('seat', String(Math.max(0, Number.parseInt(String(seat), 10) || 0)));
    return `#/draft?${params.toString()}`;
  }

  function teardownSocket() {
    if (draftUi.socket) {
      try {
        draftUi.socket.close();
      } catch (_) {
        // best effort
      }
    }
    draftUi.socket = null;
    draftUi.connected = false;
    draftUi.pendingPick = false;
  }

  function updateUIFromState() {
    if (!ui.battleboxPane) return;
    const statusEl = ui.battleboxPane.querySelector('#draft-status');
    const packInfoEl = ui.battleboxPane.querySelector('#draft-pack-info');
    const packEl = ui.battleboxPane.querySelector('#draft-pack-cards');
    const poolEl = ui.battleboxPane.querySelector('#draft-pool-cards');

    if (statusEl) {
      statusEl.textContent = draftUi.status || (draftUi.connected ? 'Connected' : 'Disconnected');
    }

    const state = draftUi.state;
    if (!state) {
      if (packInfoEl) packInfoEl.textContent = '';
      if (packEl) packEl.innerHTML = '<div class="draft-empty">Waiting for state...</div>';
      if (poolEl) poolEl.innerHTML = '';
      return;
    }

    if (packInfoEl) {
      packInfoEl.textContent = `Pack ${state.pack_no + 1} · Pick ${state.pick_no + 1}`;
    }

    if (poolEl) {
      const rows = (state.pool || []).map((name) => `<li>${name}</li>`).join('');
      poolEl.innerHTML = rows ? `<ul class="draft-pool-list">${rows}</ul>` : '<div class="draft-empty">No picks yet.</div>';
    }

    if (!packEl) return;
    const active = state.active_pack;
    if (!active || !Array.isArray(active.cards) || active.cards.length === 0) {
      packEl.innerHTML = state.state === 'done'
        ? '<div class="draft-empty">Draft complete.</div>'
        : '<div class="draft-empty">Waiting for next pack...</div>';
      return;
    }

    const canPick = Boolean(state.can_pick) && !draftUi.pendingPick;
    packEl.innerHTML = active.cards.map((name, idx) => `
      <button type="button" class="action-button draft-pick-button" data-index="${idx}" ${canPick ? '' : 'disabled'}>
        ${name}
      </button>
    `).join('');

    if (canPick) {
      [...packEl.querySelectorAll('.draft-pick-button')].forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number.parseInt(btn.dataset.index || '-1', 10);
          const chosen = active.cards[i];
          if (!chosen || !draftUi.socket || draftUi.socket.readyState !== WebSocket.OPEN) return;
          const nextSeq = Number.parseInt(String(state.next_seq || 1), 10) || 1;
          draftUi.pendingPick = true;
          updateUIFromState();
          draftUi.socket.send(JSON.stringify({
            type: 'pick',
            seq: nextSeq,
            pack_id: active.pack_id,
            card_name: chosen,
          }));
        });
      });
    }
  }

  function connectSocket(roomId, seat) {
    if (
      draftUi.socket
      && draftUi.socket.readyState === WebSocket.OPEN
      && draftUi.roomId === roomId
      && draftUi.seat === seat
    ) {
      draftUi.socket.send(JSON.stringify({ type: 'state' }));
      return;
    }

    teardownSocket();
    draftUi.roomId = roomId;
    draftUi.seat = seat;
    draftUi.state = null;
    draftUi.pendingPick = false;
    draftUi.status = 'Connecting...';
    updateUIFromState();

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/api/draft/ws?room=${encodeURIComponent(roomId)}&seat=${encodeURIComponent(String(seat))}`;
    const socket = new WebSocket(wsUrl);
    draftUi.socket = socket;

    socket.addEventListener('open', () => {
      draftUi.connected = true;
      draftUi.status = 'Connected';
      updateUIFromState();
    });

    socket.addEventListener('close', () => {
      if (draftUi.socket !== socket) return;
      draftUi.connected = false;
      draftUi.pendingPick = false;
      draftUi.status = 'Disconnected';
      updateUIFromState();
    });

    socket.addEventListener('message', (event) => {
      if (draftUi.socket !== socket) return;
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'state' || msg.type === 'pick_accepted') {
        if (msg.state) {
          draftUi.state = msg.state;
        }
        draftUi.pendingPick = false;
      } else if (msg.type === 'round_advanced') {
        draftUi.status = `Round advanced: pack ${Number(msg.pack_no || 0) + 1}, pick ${Number(msg.pick_no || 0) + 1}`;
      } else if (msg.type === 'draft_completed') {
        draftUi.status = 'Draft complete';
        draftUi.pendingPick = false;
      } else if (msg.type === 'error') {
        draftUi.status = msg.error || 'Draft error';
        draftUi.pendingPick = false;
      }
      updateUIFromState();
    });
  }

  function render(roomId, seat) {
    const headerHtml = `
      <h1 class="breadcrumbs">
        <span class="breadcrumbs-trail">
          <a href="#/">Battlebox</a>
          <span class="crumb-sep">/</span>
          <span>Draft</span>
        </span>
        <button type="button" class="qr-breadcrumb-button" title="Show QR code" aria-label="Show QR code for this page">
          <img class="qr-breadcrumb-icon" src="/assets/qrcode.svg" alt="">
        </button>
      </h1>
    `;
    const bodyHtml = `
      <div class="draft-room">
        <div class="draft-meta">
          <div><strong>Room:</strong> ${roomId}</div>
          <div><strong>Seat:</strong> ${seat}</div>
          <div id="draft-status" class="draft-status">Connecting...</div>
        </div>
        <div id="draft-pack-info" class="draft-pack-info"></div>
        <div class="draft-grid">
          <div class="draft-col">
            <h3>Pack</h3>
            <div id="draft-pack-cards"></div>
          </div>
          <div class="draft-col">
            <h3>Pool</h3>
            <div id="draft-pool-cards"></div>
          </div>
        </div>
      </div>
    `;
    renderBattleboxPane(headerHtml, bodyHtml);
    connectSocket(roomId, seat);
    updateUIFromState();
  }

  function bindSharedDraftButton(button, deck) {
    if (!button) return;
    button.addEventListener('click', async () => {
      if (typeof hidePreview === 'function') {
        hidePreview();
      }
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Starting...';
      try {
        const deckNames = [];
        (Array.isArray(deck.cards) ? deck.cards : []).forEach((card) => {
          const qty = Number.parseInt(String(card?.qty), 10) || 0;
          const name = String(card?.name || '').trim();
          if (!name || qty <= 0) return;
          for (let i = 0; i < qty; i += 1) deckNames.push(name);
        });
        const res = await fetch('/api/draft/shared', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deck: deckNames,
            seat_names: ['Seat 1', 'Seat 2'],
            pack_count: 7,
            pack_size: 8,
          }),
        });
        if (!res.ok) {
          const message = (await res.text()).trim();
          throw new Error(message || `Failed to start draft (${res.status})`);
        }
        const payload = await res.json();
        if (!payload || !payload.room_id) throw new Error('Missing room id');
        location.hash = buildHash(payload.room_id, 0);
      } catch (err) {
        button.disabled = false;
        button.textContent = original;
        window.alert(err && err.message ? err.message : 'Failed to start draft.');
      }
    });
  }

  return {
    parseRoute,
    buildHash,
    teardownSocket,
    render,
    bindSharedDraftButton,
  };
}
