// src/ui/panels/drawer.js
// Single Task: Sliding Drawer Navigation, Minibar Controls & Fullscreen Lifecycle

import { EVENTS } from '../../contracts/events.js';
import { $id } from '../shell/dom-utils.js';

export function initDrawerPanel({ engine, listen }) {
    const drawerEl = $id('drawer');
    const playerEl = engine;
    const drawerTabsContainer = $id('drawer-tabs-container');
    const closeBtn = $id('close-drawer-btn');
    const btnMiniTitleDrawer = $id('btn-mini-title-drawer');
    const miniBrandingBottom = $id('mini-branding-bottom');
    const miniBarTabsContainer = $id('mini-bar-tabs-container');
    const btnMiniQuickFullscreen = $id('btn-mini-quick-fullscreen');
    const iconMiniFullscreen = $id('icon-mini-fullscreen');
    const labelMiniFullscreen = $id('label-mini-fullscreen');

    const switchTab = (targetTab) => {
        if (!targetTab) return;
        const tabButtons = document.querySelectorAll('.drawer-tab-btn');
        const tabPanels = document.querySelectorAll('.drawer-tab-panel');
        const miniTabButtons = document.querySelectorAll('[data-mini-tab]');

        tabButtons.forEach(b => {
            const isActive = b.getAttribute('data-tab') === targetTab;
            b.classList.toggle('active', isActive);
            b.setAttribute('aria-selected', isActive ? 'true' : 'false');
            b.setAttribute('tabindex', isActive ? '0' : '-1');
        });
        tabPanels.forEach(panel => {
            const isMatch = panel.getAttribute('data-panel') === targetTab;
            panel.classList.toggle('active', isMatch);
        });
        miniTabButtons.forEach(mb => {
            const isMatch = mb.getAttribute('data-mini-tab') === targetTab;
            mb.classList.toggle('active', isMatch);
        });
    };

    const handleTabClick = (targetTab) => {
        if (!targetTab) return;
        engine.cancelPick?.();
        switchTab(targetTab);
    };

    if (drawerTabsContainer) {
        listen(drawerTabsContainer, 'click', (e) => {
            const btn = e.target.closest('.drawer-tab-btn');
            if (btn) {
                const targetTab = btn.getAttribute('data-tab');
                handleTabClick(targetTab);
            }
        });

        listen(drawerTabsContainer, 'keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const buttons = Array.from(drawerTabsContainer.querySelectorAll('.drawer-tab-btn'));
                if (buttons.length === 0) return;
                const currentIndex = buttons.findIndex(b => b.getAttribute('aria-selected') === 'true');
                const delta = e.key === 'ArrowRight' ? 1 : -1;
                const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
                const nextBtn = buttons[nextIndex];
                if (nextBtn) {
                    nextBtn.focus();
                    handleTabClick(nextBtn.getAttribute('data-tab'));
                }
            }
        });
    }

    const openDrawer = () => {
        engine.pause();
        drawerEl?.classList.add('open');
        playerEl?.classList.add('drawer-open');
        engine.emit(EVENTS.UI_DRAWER_TOGGLE, { open: true });
    };

    const closeDrawer = () => {
        if (drawerEl?.classList.contains('open')) {
            drawerEl.classList.remove('open');
            playerEl?.classList.remove('drawer-open');
            engine.emit(EVENTS.UI_DRAWER_TOGGLE, { open: false });
            engine.cancelPick?.();
        }
    };

    if (closeBtn) {
        listen(closeBtn, 'click', closeDrawer);
    }

    if (btnMiniTitleDrawer) {
        listen(btnMiniTitleDrawer, 'click', openDrawer);
    }

    if (miniBrandingBottom) {
        listen(miniBrandingBottom, 'click', openDrawer);
    }

    if (miniBarTabsContainer) {
        listen(miniBarTabsContainer, 'click', (e) => {
            const btn = e.target.closest('[data-mini-tab]');
            if (!btn) return;
            const targetTab = btn.getAttribute('data-mini-tab');
            if (targetTab) {
                openDrawer();
                switchTab(targetTab);
            }
        });
    }

    const updateFullscreenUI = () => {
        const isFullscreen = typeof document !== 'undefined' && !!document.fullscreenElement;
        if (labelMiniFullscreen) {
            labelMiniFullscreen.textContent = isFullscreen ? 'Exit' : 'Full';
        }
        if (btnMiniQuickFullscreen) {
            const title = isFullscreen ? 'Exit Fullscreen (F)' : 'Toggle Fullscreen (F)';
            btnMiniQuickFullscreen.title = title;
            btnMiniQuickFullscreen.setAttribute('aria-label', title);
        }
        const useEl = iconMiniFullscreen?.querySelector?.('use');
        if (useEl) {
            useEl.setAttribute('href', isFullscreen ? '#icon-minimize' : '#icon-maximize');
        }
    };

    if (btnMiniQuickFullscreen) {
        listen(btnMiniQuickFullscreen, 'click', () => {
            if (typeof document === 'undefined') return;
            if (!document.fullscreenElement) {
                document.documentElement?.requestFullscreen?.().catch(() => {});
            } else {
                document.exitFullscreen?.().catch(() => {});
            }
        });
    }

    listen(document, 'fullscreenchange', updateFullscreenUI);

    // Escape Key handler for Pick Modes and Drawer
    listen(window, 'keydown', (e) => {
        if (e.key === 'Escape') {
            const videoOverlay = typeof document !== 'undefined' ? document.getElementById('video-export-overlay') : null;
            if (videoOverlay && !videoOverlay.classList.contains('hidden')) {
                return;
            }
            if (engine.cancelPick?.()) {
                return;
            }
            if (drawerEl?.classList.contains('open')) {
                closeDrawer();
            }
        }
    });

    return () => {
        closeDrawer();
    };
}
