/*
 * Rendezvous '26 — Gallery page
 * Renders the uploaded photos as a uniform grid with incremental "load more",
 * and opens photos in the shared lightbox.
 */
(function () {
  const DB = window.RV26.DB;
  const UI = window.RV26.UI;
  const esc = UI.escapeHtml;

  const PAGE = 20;
  const contentEl = document.getElementById('content');

  let photos = [];
  let shown = PAGE;

  async function load() {
    UI.showLoading(contentEl, 'Loading gallery…');
    try {
      photos = await DB.getGallery();
      render();
    } catch (e) {
      UI.showError(contentEl, 'Could not load the gallery right now. Please try again.', load);
    }
  }

  function photoCard(p, onOpen) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'photo-card animate-fade-in';
    btn.setAttribute('aria-label', 'Open photo: ' + (p.caption || 'Festival photograph'));
    btn.innerHTML =
      '<img src="' + esc(p.url) + '" alt="' + esc(p.caption || 'Festival photograph') + '" loading="lazy" />' +
      (p.caption
        ? '<span class="photo-caption">' + esc(p.caption) + '</span>'
        : '');
    btn.addEventListener('click', () => onOpen());
    return btn;
  }

  function openLightbox(index) {
    UI.Lightbox.open(photos.slice(0, shown), index, { downloadLabel: 'Save photo' });
  }

  function moreButton() {
    const hasMore = shown < photos.length;
    const old = document.getElementById('load-more');
    if (old) old.remove();
    if (!hasMore) return;
    const more = document.createElement('button');
    more.type = 'button';
    more.id = 'load-more';
    more.className = 'btn btn-outline';
    more.textContent = 'Load more';
    more.style.marginTop = '2.5rem';
    more.addEventListener('click', () => {
      shown += PAGE;
      const grid = contentEl.querySelector('.gallery-grid');
      const prevShown = shown - PAGE;
      const visible = photos.slice(prevShown, shown);
      visible.forEach((p, i) => {
        const idx = prevShown + i;
        grid.appendChild(
          photoCard(p, () => {
            openLightbox(idx);
          })
        );
      });
      moreButton();
    });
    contentEl.appendChild(more);
  }

  function render() {
    contentEl.innerHTML = '';

    if (photos.length === 0) {
      UI.showEmpty(contentEl, {
        title: 'No photos yet',
        hint: 'Photographs from the festival will appear here as they are uploaded.',
        icon: 'photo',
      });
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    const visible = photos.slice(0, shown);
    visible.forEach((p, i) => {
      grid.appendChild(
        photoCard(p, () => {
          openLightbox(i);
        })
      );
    });

    contentEl.appendChild(grid);
    moreButton();
  }

  load();
})();