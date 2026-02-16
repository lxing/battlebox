import { scryfallImageUrlByPrinting } from './utils.js';

export function createCardPreview(app, getCardTarget) {
  // Preview behavior spec:
  // 1) Open: hover (fine pointer) or tap/click on card links.
  // 2) Anchor: preview is pinned to the source card and repositions on scroll/resize.
  //    It follows both app-container and window scrolling.
  // 3) Close: always on outside document click; additionally on leave for fine-pointer
  //    hover mode, but leave-close is deferred while scrolling and reconciled on scrollend.
  //    This avoids geometry-driven premature closes while the preview is repositioning.
  let previewEl = null;
  let previewImgFront = null;
  let previewImgBack = null;
  let previewImages = null;
  let previewStatus = null;
  let previewToken = 0;
  let previewUrl = '';
  let previewAnchor = null;
  let previewRaf = null;
  let allowLeaveClose = false;
  let isScrolling = false;
  let pendingLeaveClose = false;
  let lastPointerX = null;
  let lastPointerY = null;
  let scrollContainer = null;

  function getImageUrl(printing, face) {
    return scryfallImageUrlByPrinting(printing, face) || null;
  }

  function positionPreviewAtPoint(absX, absY) {
    if (!previewEl) return;
    const margin = 10;

    const viewportW = (window.visualViewport && window.visualViewport.width) || document.documentElement.clientWidth;
    const viewportH = (window.visualViewport && window.visualViewport.height) || document.documentElement.clientHeight;

    let boundsLeft = margin;
    let boundsTop = margin;
    let boundsRight = viewportW - margin;
    let boundsBottom = viewportH - margin;

    // Hard clamp preview bounds to the configured scroll pane to keep it out of
    // header/breadcrumb regions.
    const applyContainerBounds = (container) => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      boundsLeft = Math.max(boundsLeft, rect.left + margin);
      boundsTop = Math.max(boundsTop, rect.top + margin);
      boundsRight = Math.min(boundsRight, rect.right - margin);
      boundsBottom = Math.min(boundsBottom, rect.bottom - margin);
    };

    const battleboxPane = document.getElementById('tab-battlebox');
    const draftPane = document.getElementById('tab-draft');
    const boundedPane = draftPane && !draftPane.hidden ? draftPane : battleboxPane;
    applyContainerBounds(boundedPane);

    const boundsWidth = Math.max(0, boundsRight - boundsLeft);
    if (boundsWidth > 0) {
      const isDouble = previewEl.classList.contains('card-preview-double');
      const desiredWidth = isDouble ? boundsWidth : (boundsWidth / 2);
      previewEl.style.width = `${Math.floor(desiredWidth)}px`;
    }

    const baseWidth = previewEl.offsetWidth || 250;
    const baseHeight = previewEl.offsetHeight || 350;
    const isSplit = previewEl.classList.contains('card-preview-split');
    if (isSplit) {
      previewEl.style.transformOrigin = 'top left';
      previewEl.style.transform = `translateX(${Math.floor(baseHeight)}px) rotate(90deg)`;
    } else {
      previewEl.style.transformOrigin = '';
      previewEl.style.transform = 'none';
    }
    const width = isSplit ? baseHeight : baseWidth;
    const height = isSplit ? baseWidth : baseHeight;

    let x = absX;
    let y = absY;

    const maxX = Math.max(boundsLeft, boundsRight - width);
    const maxY = Math.max(boundsTop, boundsBottom - height);
    x = Math.min(Math.max(x, boundsLeft), maxX);
    y = Math.min(Math.max(y, boundsTop), maxY);

    previewEl.style.left = `${x}px`;
    previewEl.style.top = `${y}px`;
  }

  function updatePreviewAnchor() {
    if (!previewEl || !previewAnchor) return;
    const rect = previewAnchor.el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const absX = rect.left + (previewAnchor.relX * rect.width);
    const absY = rect.top + (previewAnchor.relY * rect.height);
    positionPreviewAtPoint(absX, absY);
  }

  function schedulePreviewAnchorUpdate() {
    if (!previewAnchor) return;
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = null;
      updatePreviewAnchor();
    });
  }

  function recordPointerPosition(e) {
    if (!allowLeaveClose) return;
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    if (!isScrolling) return;
    isScrolling = false;
    if (!pendingLeaveClose) return;
    requestCloseFromLeave();
  }

  function pointerIsOverAnchorOrPreview() {
    if (!previewAnchor || lastPointerX === null || lastPointerY === null) return false;
    const target = document.elementFromPoint(lastPointerX, lastPointerY);
    if (!target) return false;
    if (previewEl && (target === previewEl || previewEl.contains(target))) return true;
    const cardEl = previewAnchor.el;
    if (!cardEl) return false;
    return target === cardEl || cardEl.contains(target);
  }

  function requestCloseFromLeave() {
    if (!allowLeaveClose || !previewAnchor) return;
    if (isScrolling) {
      pendingLeaveClose = true;
      return;
    }
    pendingLeaveClose = false;
    if (pointerIsOverAnchorOrPreview()) return;
    hidePreview();
  }

  function handleScroll() {
    isScrolling = true;
    schedulePreviewAnchorUpdate();
  }

  function handleScrollEnd() {
    if (!allowLeaveClose) return;
    isScrolling = false;
    if (!pendingLeaveClose) return;
    requestCloseFromLeave();
  }

  function ensurePreviewEl() {
    if (previewEl) return;
    previewEl = document.createElement('div');
    previewEl.className = 'card-preview';
    previewStatus = document.createElement('div');
    previewStatus.className = 'card-preview-loading';
    previewStatus.textContent = 'Loading...';
    previewImages = document.createElement('div');
    previewImages.className = 'card-preview-images';
    previewImgFront = document.createElement('img');
    previewImgBack = document.createElement('img');
    previewImages.appendChild(previewImgFront);
    previewImages.appendChild(previewImgBack);
    previewEl.appendChild(previewStatus);
    previewEl.appendChild(previewImages);
    previewEl.addEventListener('mouseleave', (e) => {
      recordPointerPosition(e);
      if (!previewAnchor) return;
      const cardEl = previewAnchor.el;
      if (cardEl && e.relatedTarget && (cardEl === e.relatedTarget || cardEl.contains(e.relatedTarget))) {
        return;
      }
      requestCloseFromLeave();
    });
  }

  function openPreview(cardEl, e) {
    const printing = cardEl.dataset.printing;
    if (!printing) return;
    const isDoubleFaced = cardEl.dataset.doubleFaced === '1';
    const cardName = String(cardEl.dataset.name || '');
    const isSplit = !isDoubleFaced && cardName.includes('/');
    const frontUrl = getImageUrl(printing, 'front');
    if (!frontUrl) return;
    const backUrl = isDoubleFaced ? getImageUrl(printing, 'back') : null;
    const urlKey = isDoubleFaced ? `${frontUrl}|${backUrl}` : frontUrl;
    if (previewAnchor && previewAnchor.el === cardEl && previewEl && previewEl.style.display !== 'none' && previewUrl === urlKey) {
      positionPreviewAtPoint(e.clientX, e.clientY);
      return;
    }
    previewUrl = urlKey;
    ensurePreviewEl();
    previewEl.classList.toggle('card-preview-double', isDoubleFaced);
    previewEl.classList.toggle('card-preview-split', isSplit);
    if (previewEl.parentNode !== document.body) {
      document.body.appendChild(previewEl);
    }
    previewStatus.textContent = 'Loading...';
    previewStatus.style.display = 'block';
    previewImgFront.style.display = 'none';
    previewImgBack.style.display = 'none';
    previewImages.style.display = 'none';

    const token = ++previewToken;
    let pending = isDoubleFaced ? 2 : 1;
    let loaded = 0;

    const finish = (ok) => {
      pending -= 1;
      if (ok) loaded += 1;
      if (pending > 0) return;
      if (token !== previewToken || previewUrl !== urlKey) return;
      if (loaded === 0) {
        previewStatus.textContent = 'Image unavailable';
        previewStatus.style.display = 'block';
      } else {
        previewStatus.style.display = 'none';
        previewImages.style.display = 'flex';
      }
    };

    const loadImage = (slot, url, isBack) => {
      const img = new Image();
      img.className = slot.className;
      img.alt = slot.alt || '';
      img.onload = () => {
        if (token !== previewToken || previewUrl !== urlKey) return;
        img.style.display = 'block';
        previewImages.replaceChild(img, slot);
        if (isBack) {
          previewImgBack = img;
        } else {
          previewImgFront = img;
        }
        finish(true);
      };
      img.onerror = () => {
        if (token !== previewToken || previewUrl !== urlKey) return;
        finish(false);
      };
      img.src = url;
    };

    loadImage(previewImgFront, frontUrl, false);
    if (isDoubleFaced && backUrl) {
      loadImage(previewImgBack, backUrl, true);
    } else {
      previewImgBack.style.display = 'none';
    }
    previewEl.style.display = 'block';
    positionPreviewAtPoint(e.clientX, e.clientY);
    const rect = cardEl.getBoundingClientRect();
    previewAnchor = {
      el: cardEl,
      relX: rect.width ? (e.clientX - rect.left) / rect.width : 0.5,
      relY: rect.height ? (e.clientY - rect.top) / rect.height : 0.5,
    };
  }

  function setupCardHover() {
    const prefersHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    allowLeaveClose = prefersHover;

    document.addEventListener('click', (e) => {
      if (!previewEl || previewEl.style.display === 'none') return;
      const cardEl = getCardTarget(e);
      e.preventDefault();
      e.stopPropagation();
      if (cardEl) {
        openPreview(cardEl, e);
        return;
      }
      hidePreview();
    }, true);

    if (prefersHover) {
      app.addEventListener('pointermove', recordPointerPosition, true);
      window.addEventListener('pointermove', recordPointerPosition, true);

      app.addEventListener('pointerenter', (e) => {
        recordPointerPosition(e);
        const cardEl = getCardTarget(e);
        if (!cardEl) return;
        if (e.relatedTarget && cardEl.contains(e.relatedTarget)) return;
        openPreview(cardEl, e);
      }, true);

      app.addEventListener('pointerleave', (e) => {
        recordPointerPosition(e);
        const cardEl = getCardTarget(e);
        if (!cardEl || !previewEl) return;
        if (e.relatedTarget && cardEl.contains(e.relatedTarget)) return;
        if (e.relatedTarget && previewEl.contains(e.relatedTarget)) return;
        requestCloseFromLeave();
      }, true);

    } else {
      app.addEventListener('click', (e) => {
        const cardEl = getCardTarget(e);
        if (!cardEl) return;
        e.preventDefault();
        e.stopPropagation();
        openPreview(cardEl, e);
      });
    }

    setScrollContainer(app);
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('scrollend', handleScrollEnd);
    window.addEventListener('resize', schedulePreviewAnchorUpdate);
  }

  function setScrollContainer(containerEl) {
    const next = containerEl || app;
    if (scrollContainer === next) return;

    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', handleScroll, true);
      scrollContainer.removeEventListener('scrollend', handleScrollEnd, true);
    }

    scrollContainer = next;
    // Capture descendant scrolls so nested horizontal scrollers (cube decklist)
    // drive preview anchor updates without parallel listeners.
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    scrollContainer.addEventListener('scrollend', handleScrollEnd, { capture: true });
  }

  function hidePreview() {
    if (previewEl) {
      previewEl.style.display = 'none';
    }
    pendingLeaveClose = false;
    previewAnchor = null;
    previewToken += 1;
  }

  return {
    setupCardHover,
    hidePreview,
    setScrollContainer,
  };
}
