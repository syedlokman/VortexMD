// src/controls.js
// Single Task: Camera Trackball Controls, Mouse Scheme Switching & Viewport Keyboard Hotkeys

import * as NGL from 'ngl';

let currentMouseScheme = 'default';

export function setMouseScheme(stage, schemeName = 'default') {
    if (!stage) return;
    currentMouseScheme = schemeName;
    try {
        if (stage.mouseControls && typeof stage.mouseControls.preset === 'function') {
            stage.mouseControls.preset(schemeName);
        }
    } catch (err) {
        console.warn("Failed setting NGL mouse preset:", err);
    }
}

export function setupCameraControls(viewportElement, stage) {
    setMouseScheme(stage, 'default');
    viewportElement.style.cursor = 'grab';

    // 1. WHEEL ZOOM INTERCEPT (Smooth Pointer-Centered Zoom)
    viewportElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!stage || !stage.trackballControls || !stage.viewer) return;

        const tb = stage.trackballControls;
        const canvas = stage.viewer.renderer ? stage.viewer.renderer.domElement : viewportElement;
        const rect = canvas.getBoundingClientRect();

        // 5x increased zoom response across delta modes
        let delta = 0;
        if (e.deltaMode === 1) { // Line delta
            delta = -e.deltaY * 4.0;
        } else if (e.deltaMode === 0) { // Pixel delta (trackpads / high-res mice)
            delta = -Math.min(Math.max(e.deltaY, -120), 120) * 0.175;
        } else {
            delta = -Math.sign(e.deltaY) * 10.0;
        }

        // Clamp delta to prevent sudden overflow
        delta = Math.max(-20.0, Math.min(20.0, delta));
        if (Math.abs(delta) < 0.001) return;

        // Mouse pointer offset relative to viewport center in pixels
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const offsetX = mouseX - rect.width / 2;
        const offsetY = mouseY - rect.height / 2;

        // Effective zoom scale ratio applied by trackballControls
        const zoomSpeed = tb.zoomSpeed || 1.2;
        const zoomRatio = zoomSpeed * delta * 0.02;

        // Pan toward pointer position during zoom (corrected directional alignment)
        if (typeof tb.pan === 'function') {
            const panX = offsetX * zoomRatio;
            const panY = offsetY * zoomRatio;
            tb.pan(panX, panY);
        }

        // Apply smooth zoom step
        if (typeof tb.zoom === 'function') {
            tb.zoom(delta);
        }

        stage.viewer.requestRender();
    }, { passive: false });

    // 2. POINTER DRAG INTERCEPT
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let dragButton = 0;

    viewportElement.addEventListener('contextmenu', (e) => e.preventDefault());

    viewportElement.addEventListener('pointerdown', (e) => {
        isDragging = true;
        prevX = e.clientX;
        prevY = e.clientY;
        dragButton = e.button;
        viewportElement.style.cursor = 'grabbing';
        try { viewportElement.setPointerCapture(e.pointerId); } catch(err) {}
    });

    viewportElement.addEventListener('pointermove', (e) => {
        if (!isDragging || !stage) return;

        const deltaX = e.clientX - prevX;
        const deltaY = e.clientY - prevY;
        prevX = e.clientX;
        prevY = e.clientY;

        const tb = stage.trackballControls;
        const vc = stage.viewerControls;

        if (currentMouseScheme === 'pymol') {
            // PyMOL: Left (0) = Rotate, Middle (1) = Pan, Right (2) = Zoom
            if (dragButton === 0) {
                if (tb) tb.rotate(-deltaX * 0.12, -deltaY * 0.12);
                else if (vc) vc.rotate([-deltaX * 0.005, -deltaY * 0.005]);
            } else if (dragButton === 1) {
                if (tb) tb.pan(-deltaX * 0.85, deltaY * 0.85);
            } else if (dragButton === 2) {
                if (tb) tb.zoom(-deltaY * 0.5);
            }
        } else if (currentMouseScheme === 'coot') {
            // Coot: Middle (1) = Rotate, Left (0) = Pan, Right (2) = Zoom
            if (dragButton === 1) {
                if (tb) tb.rotate(-deltaX * 0.12, -deltaY * 0.12);
                else if (vc) vc.rotate([-deltaX * 0.005, -deltaY * 0.005]);
            } else if (dragButton === 0) {
                if (tb) tb.pan(-deltaX * 0.85, deltaY * 0.85);
            } else if (dragButton === 2) {
                if (tb) tb.zoom(-deltaY * 0.5);
            }
        } else {
            // Default WebGL: Left (0) = Rotate, Right (2) or Shift+Left = Pan, Middle (1) = Zoom
            if (dragButton === 0 && !e.shiftKey) {
                if (tb) tb.rotate(-deltaX * 0.12, -deltaY * 0.12);
                else if (vc) vc.rotate([-deltaX * 0.005, -deltaY * 0.005]);
            } else if (dragButton === 2 || (dragButton === 0 && e.shiftKey)) {
                if (tb) tb.pan(-deltaX * 0.85, deltaY * 0.85);
            } else if (dragButton === 1) {
                if (tb) tb.zoom(-deltaY * 0.5);
            }
        }
        stage.viewer.requestRender();
    });

    const stopDrag = (e) => {
        if (isDragging) {
            isDragging = false;
            viewportElement.style.cursor = 'grab';
            try { viewportElement.releasePointerCapture(e.pointerId); } catch(err) {}
        }
    };

    viewportElement.addEventListener('pointerup', stopDrag);
    viewportElement.addEventListener('pointercancel', stopDrag);
}

