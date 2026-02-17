const localDeviceIDKey = 'battlebox_device_id_v1';
let deviceIDPromise = null;

export function appendDeviceIDToUrl(path, deviceID) {
  const id = String(deviceID || '').trim();
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}device_id=${encodeURIComponent(id)}`;
}

function hashStringFNV1a(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function sha256Hex(value) {
  if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) {
    return hashStringFNV1a(value);
  }
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
    try {
      const existing = String(window.localStorage.getItem(localDeviceIDKey) || '').trim();
      if (existing) return existing;
    } catch (_) {
      // Continue with computed fallback.
    }

    const digest = await sha256Hex(fingerprintSource());
    const stable = `dev_${digest.slice(0, 32)}`;
    try {
      window.localStorage.setItem(localDeviceIDKey, stable);
    } catch (_) {
      // Best effort only.
    }
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
