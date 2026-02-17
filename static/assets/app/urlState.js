export const TAB_BATTLEBOX = 'battlebox';
export const TAB_LIFE = 'life';
export const TAB_DRAFT = 'draft';
export const TAB_MATRIX = 'matrix';

const VALID_TABS = new Set([TAB_BATTLEBOX, TAB_LIFE, TAB_DRAFT, TAB_MATRIX]);

function buildSearchString(params) {
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function normalizeDraftRoomId(value) {
  return String(value || '').trim();
}

function normalizeDraftSeat(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizeTab(tab) {
  const raw = String(tab || '').trim();
  return VALID_TABS.has(raw) ? raw : TAB_BATTLEBOX;
}

export function tabFromSearch(search = window.location.search) {
  const params = new URLSearchParams(search || '');
  const raw = params.get('tab');
  if (!raw) return TAB_BATTLEBOX;
  return normalizeTab(raw);
}

export function withTabInSearch(search, tab) {
  const nextTab = normalizeTab(tab);
  const params = new URLSearchParams(search || '');
  if (nextTab === TAB_BATTLEBOX) {
    params.delete('tab');
  } else {
    params.set('tab', nextTab);
  }
  return buildSearchString(params);
}

export function parseDraftRoomSelectionFromSearch(search = window.location.search) {
  const params = new URLSearchParams(search || '');
  const roomId = normalizeDraftRoomId(params.get('room'));
  if (!roomId) return null;
  return {
    roomId,
    seat: normalizeDraftSeat(params.get('seat')),
  };
}

export function withDraftRoomSelectionInSearch(search, roomId, seat) {
  const params = new URLSearchParams(search || '');
  const normalizedRoomId = normalizeDraftRoomId(roomId);
  if (!normalizedRoomId) {
    params.delete('room');
    params.delete('seat');
  } else {
    params.set('room', normalizedRoomId);
    params.set('seat', String(normalizeDraftSeat(seat)));
  }
  return buildSearchString(params);
}

export function replaceSearchPreserveHash(nextSearch, locationObj = window.location, historyObj = window.history) {
  const hash = locationObj.hash || '';
  const nextUrl = `${locationObj.pathname}${nextSearch}${hash}`;
  historyObj.replaceState(null, '', nextUrl);
}

export function replaceHashPreserveSearch(nextHash, locationObj = window.location, historyObj = window.history) {
  const nextUrl = `${locationObj.pathname}${locationObj.search}${nextHash}`;
  historyObj.replaceState(null, '', nextUrl);
}

export function setTabInLocationSearch(tab, locationObj = window.location, historyObj = window.history) {
  const nextSearch = withTabInSearch(locationObj.search, tab);
  if (nextSearch !== locationObj.search) {
    replaceSearchPreserveHash(nextSearch, locationObj, historyObj);
  }
}

export function setDraftRoomSelectionInLocationSearch(roomId, seat, locationObj = window.location, historyObj = window.history) {
  const nextSearch = withDraftRoomSelectionInSearch(locationObj.search, roomId, seat);
  if (nextSearch !== locationObj.search) {
    replaceSearchPreserveHash(nextSearch, locationObj, historyObj);
  }
}
