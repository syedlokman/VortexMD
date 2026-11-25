// src/ui/panels/hotkeys.js
// Single Task: Viewport & Playback Keyboard Hotkeys (Space, ArrowLeft, ArrowRight)

export function initHotkeysPanel({ engine, listen }) {
    listen(window, 'keydown', (e) => {
        // While video is exporting, progress popup is the only active component.
        const videoOverlay = typeof document !== 'undefined' ? document.getElementById('video-export-overlay') : null;
        if (videoOverlay && !videoOverlay.classList.contains('hidden')) {
            return;
        }

        const activeEl = document.activeElement;
        const isSlider = activeEl && activeEl.id === 'frame-slider';
        const isFormInput = activeEl && !isSlider && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'SELECT' || 
            activeEl.tagName === 'TEXTAREA' || 
            activeEl.isContentEditable
        );

        if (isFormInput) return;

        if (e.code === 'Space' || e.key === ' ') {
            e.preventDefault();
            if (activeEl && activeEl.tagName === 'BUTTON') {
                activeEl.blur();
            }
            if (engine.isPlaying) {
                engine.pause();
            } else {
                engine.play();
            }
        } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            if (typeof document !== 'undefined') {
                if (document.fullscreenElement) {
                    document.exitFullscreen?.().catch(() => {});
                } else {
                    document.documentElement?.requestFullscreen?.().catch(() => {});
                }
            }
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (!isSlider) {
                e.preventDefault();
                const current = engine.currentFrame || 1;
                const min = 1;
                const max = Math.max(1, engine.frameCount || 1);
                const delta = (e.key === 'ArrowLeft') ? -1 : 1;
                const target = Math.max(min, Math.min(max, current + delta));
                engine.jumpToFrame(target);
            }
        }
    });
}
