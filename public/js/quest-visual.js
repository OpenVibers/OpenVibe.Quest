'use strict';

(() => {
    const badges = [...document.querySelectorAll('.q-badge')];
    const newest = badges.find((el) => el.dataset.awarded);
    if (newest) {
        const key = `quest-badge-seen:${newest.dataset.badgeId}:${newest.dataset.awarded}`;
        try {
            if (!sessionStorage.getItem(key)) {
                newest.classList.add('is-new');
                sessionStorage.setItem(key, '1');
            }
        } catch { /* animation is optional */ }
    }
    document.addEventListener('click', async (event) => {
        const close = event.target.closest('.q-badge-close');
        if (close) { close.closest('details').open = false; return; }
        const share = event.target.closest('.q-share');
        if (!share) return;
        const url = new URL(share.dataset.share, location.origin).href;
        const title = share.dataset.title;
        try {
            if (navigator.share) await navigator.share({ title, url });
            else if (navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                share.textContent = 'Link copied';
            }
        } catch { /* The View quest link remains available. */ }
    });
    document.addEventListener('toggle', (event) => {
        if (!event.target.matches?.('.q-badge') || !event.target.open) return;
        for (const badge of badges) if (badge !== event.target) badge.open = false;
    }, true);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') for (const badge of badges) badge.open = false;
    });
})();
