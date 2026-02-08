export function createCardPreview(app, getCardTarget) {
  let previewEl = null;
  let previewImgFront = null;
  let previewImgBack = null;
  let previewImages = null;
  let previewStatus = null;
  let previewToken = 0;
  let previewUrl = '';
  let previewAnchor = null;
  let previewRaf = null;

  function getImageUrl(printing, face) {
    if (!printing) return null;
    const [set, num] = printing.split('/');
    const faceParam = face === 'back' ? '&face=back' : '';
    return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=normal${faceParam}`;
  }

  function positionPreviewAtPoint(absX, absY) {
    if (!previewEl) return;
    const width = previewEl.offsetWidth || 250;
    const height = previewEl.offsetHeight || 350;
    const margin = 10;
    const viewportW = (window.visualViewport && window.visualViewport.width) || document.documentElement.clientWidth;
    const viewportH = (window.visualViewport && window.visualViewport.height) || document.documentElement.clientHeight;

    let x = absX;
    let y = absY;

    if (x + width + margin > viewportW) {
      x = Math.max(margin, viewportW - width - margin);
    }
    if (x < margin) {
      x = margin;
    }
    if (y + height + margin > viewportH) {
      y = Math.max(margin, viewportH - height - margin);
    }
    if (y < margin) {
      y = margin;
    }

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
      if (!previewAnchor) return;
      const cardEl = previewAnchor.el;
      if (cardEl && e.relatedTarget && (cardEl === e.relatedTarget || cardEl.contains(e.relatedTarget))) {
        return;
      }
      hidePreview();
    });
  }

  function openPreview(cardEl, e) {
    const printing = cardEl.dataset.printing;
    if (!printing) return;
    const isDoubleFaced = cardEl.dataset.doubleFaced === '1';
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

    document.addEventListener('click', (e) => {
      if (!previewEl || previewEl.style.display === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      hidePreview();
    }, true);

    if (prefersHover) {
      app.addEventListener('pointerenter', (e) => {
        const cardEl = getCardTarget(e);
        if (!cardEl) return;
        if (e.relatedTarget && cardEl.contains(e.relatedTarget)) return;
        openPreview(cardEl, e);
      }, true);

      app.addEventListener('pointerleave', (e) => {
        const cardEl = getCardTarget(e);
        if (!cardEl || !previewEl) return;
        if (e.relatedTarget && cardEl.contains(e.relatedTarget)) return;
        if (e.relatedTarget && previewEl.contains(e.relatedTarget)) return;
        hidePreview();
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

    window.addEventListener('scroll', schedulePreviewAnchorUpdate, { passive: true });
    window.addEventListener('resize', schedulePreviewAnchorUpdate);
  }

  function hidePreview() {
    if (previewEl) {
      previewEl.style.display = 'none';
    }
    previewAnchor = null;
    previewToken += 1;
  }

  return {
    setupCardHover,
    hidePreview,
  };
}
