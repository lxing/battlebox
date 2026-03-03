import { buildDefaultPassPattern } from './draftRoomContext.js';

const localDeviceIDKey = 'battlebox_device_id_v1';
let deviceIDPromise = null;

export function appendDeviceIDToUrl(path, deviceID) {
  const id = String(deviceID || '').trim();
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}device_id=${encodeURIComponent(id)}`;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fingerprintSource() {
  const nav = window.navigator || {};
  const scr = window.screen || {};
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim();
  const langs = Array.isArray(nav.languages) ? nav.languages.join(',') : '';
  return [
    nav.userAgent || '',
    nav.language || '',
    langs,
    nav.platform || '',
    String(nav.hardwareConcurrency || ''),
    String(nav.deviceMemory || ''),
    `${String(scr.width || '')}x${String(scr.height || '')}`,
    String(scr.colorDepth || ''),
    tz,
    String(new Date().getTimezoneOffset()),
  ].join('|');
}

export async function getStableDeviceID() {
  if (deviceIDPromise) return deviceIDPromise;
  deviceIDPromise = (async () => {
    const existing = String(window.localStorage.getItem(localDeviceIDKey) || '').trim();
    if (existing) return existing;

    const digest = await sha256Hex(fingerprintSource());
    const stable = `dev_${digest.slice(0, 32)}`;
    window.localStorage.setItem(localDeviceIDKey, stable);
    return stable;
  })();
  return deviceIDPromise;
}

export async function fetchDraftRooms(deviceID) {
  const res = await fetch(appendDeviceIDToUrl('/api/draft/rooms', deviceID), {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to load rooms (${res.status})`);
  }
  const payload = await res.json();
  if (!payload || !Array.isArray(payload.rooms)) return [];
  return payload.rooms;
}

function buildDraftDeckNames(deck) {
  const names = [];
  (Array.isArray(deck?.cards) ? deck.cards : []).forEach((card) => {
    const qty = Number.parseInt(String(card?.qty), 10) || 0;
    const name = String(card?.name || '').trim();
    if (!name || qty <= 0) return;
    for (let i = 0; i < qty; i += 1) names.push(name);
  });
  return names;
}

export async function createDraftRoom(deck, preset, deviceID) {
  const deckNames = buildDraftDeckNames(deck);
  const seatCount = Number.parseInt(String(preset?.seat_count), 10) || 0;
  const packCount = Number.parseInt(String(preset?.pack_count), 10) || 0;
  const packSize = Number.parseInt(String(preset?.pack_size), 10) || 0;
  let passPattern = buildDefaultPassPattern(packSize);
  if (Array.isArray(preset?.pass_pattern)) {
    const parsed = preset.pass_pattern.map((value) => Number.parseInt(String(value), 10));
    if (!parsed.every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error('Invalid draft preset');
    }
    passPattern = parsed;
  }
  if (seatCount <= 0 || packCount <= 0 || packSize <= 0) {
    throw new Error('Invalid draft preset');
  }
  if (passPattern.length === 0) {
    throw new Error('Invalid draft preset');
  }
  const res = await fetch(appendDeviceIDToUrl('/api/draft/rooms', deviceID), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': String(deviceID || ''),
    },
    body: JSON.stringify({
      deck: deckNames,
      deck_slug: deck?.slug || '',
      seat_count: seatCount,
      pack_count: packCount,
      pack_size: packSize,
      pass_pattern: passPattern,
    }),
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to create room (${res.status})`);
  }
  const payload = await res.json();
  if (!payload || !payload.room_id) throw new Error('Missing room id');
  return payload;
}

export async function deleteDraftRoom(roomID, deviceID) {
  const id = String(roomID || '').trim();
  if (!id) throw new Error('Missing room id');
  const res = await fetch(appendDeviceIDToUrl(`/api/draft/rooms?room_id=${encodeURIComponent(id)}`, deviceID), {
    method: 'DELETE',
    headers: {
      'X-Device-ID': String(deviceID || ''),
    },
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to delete room (${res.status})`);
  }
}
