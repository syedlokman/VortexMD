// src/ui/shell/dom-utils.js
// Single Task: Reusable DOM Event Binding, Drop Zone Setup & Active State Helpers

/**
 * Resolves a DOM element by ID safely.
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export const $id = (id) => typeof document !== 'undefined' ? document.getElementById(id) : null;

/**
 * Toggles one or more CSS classes on an element or element ID.
 * @param {Element|string|null} idOrEl
 * @param {string|string[]} cls
 * @param {boolean} [force]
 */
export const toggleClass = (idOrEl, cls, force) => {
    const el = typeof idOrEl === 'string' ? $id(idOrEl) : idOrEl;
    if (!el || !el.classList) return;
    const classes = Array.isArray(cls) ? cls : (typeof cls === 'string' ? cls.trim().split(/\s+/) : []);
    for (const c of classes) {
        if (!c) continue;
        if (force === undefined) {
            el.classList.toggle(c);
        } else {
            el.classList.toggle(c, Boolean(force));
        }
    }
};

/**
 * Resolves a DOM element reference or element ID safely.
 * @param {Element|string|null} elementOrId 
 * @param {Document|ShadowRoot|Element} parent 
 * @returns {Element|null}
 */
export function getElement(elementOrId, parent = document) {
    if (!elementOrId) return null;
    if (typeof elementOrId === 'string') {
        const root = parent || document;
        return root.getElementById ? root.getElementById(elementOrId) : root.querySelector(`#${elementOrId}`);
    }
    return elementOrId;
}

/**
 * Formats byte counts into human-readable size strings.
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '';
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

/**
 * Binds a dropdown select element to a target display label element.
 * Updates label on initial load and listens to selection change events via boundary listen helper.
 * 
 * @param {Element|string} selectOrId 
 * @param {Element|string} labelOrId 
 * @param {function(string): string} transformFn Formats or maps value to label text
 * @param {function(string, Event): void} [onChangeCallback] Optional change handler
 * @param {Document|ShadowRoot|function} [parentOrListen=document]
 * @param {function(Element, string, function): function} [listen] Boundary event listener
 * @returns {function(): void} Cleanup unbind function
 */
export function bindSelectToLabel(selectOrId, labelOrId, transformFn, onChangeCallback = null, parentOrListen = document, listen = null) {
    let parent = document;
    if (typeof parentOrListen === 'function' && !listen) {
        listen = parentOrListen;
    } else if (parentOrListen && typeof parentOrListen !== 'function') {
        parent = parentOrListen;
    }

    const select = getElement(selectOrId, parent);
    const label = getElement(labelOrId, parent);

    const update = (e) => {
        const val = select ? select.value : '';
        if (label && typeof transformFn === 'function') {
            const formatted = transformFn(val);
            if (formatted !== undefined && formatted !== null) {
                label.innerText = formatted;
            }
        }
        if (typeof onChangeCallback === 'function') {
            onChangeCallback(val, e);
        }
    };

    if (select) {
        update();
        if (typeof listen === 'function') {
            return listen(select, 'change', update);
        }
    }

    return () => {};
}

/**
 * Standardizes drag-and-drop zone events and file input handling across UI components.
 * 
 * @param {Element|string} zoneOrId Target drop zone container
 * @param {Element|string|null} inputOrId File input element
 * @param {function(File): void} onFileCallback Handler when a file is selected or dropped
 * @param {Object} [options]
 * @param {Array<string>|string} [options.activeClasses=['border-blue-500', 'bg-blue-50']] Classes toggled on dragover
 * @param {boolean} [options.checkDisabled=true] Respects pointer-events-none class
 * @param {Document|ShadowRoot|function} [parentOrListen=document]
 * @param {function(Element, string, function): function} [listen] Boundary event listener
 * @returns {function(): void} Cleanup function
 */
export function setupDropZone(zoneOrId, inputOrId, onFileCallback, options = {}, parentOrListen = document, listen = null) {
    let parent = document;
    if (typeof options === 'function' && !listen) {
        listen = options;
        options = {};
    } else if (typeof parentOrListen === 'function' && !listen) {
        listen = parentOrListen;
    } else if (parentOrListen && typeof parentOrListen !== 'function') {
        parent = parentOrListen;
    }

    const zone = getElement(zoneOrId, parent);
    const input = getElement(inputOrId, parent);
    if (!zone) return () => {};

    const activeClasses = Array.isArray(options.activeClasses)
        ? options.activeClasses
        : (typeof options.activeClasses === 'string' ? options.activeClasses.split(' ').filter(Boolean) : ['border-blue-500', 'bg-blue-50']);
    const checkDisabled = options.checkDisabled !== false;

    const isDisabled = () => checkDisabled && zone.classList.contains('pointer-events-none');

    const handleClick = () => {
        if (!isDisabled() && input) {
            input.click();
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
        if (!isDisabled() && activeClasses.length) {
            zone.classList.add(...activeClasses);
        }
    };

    const handleDragLeave = (e) => {
        if (e) e.preventDefault();
        if (activeClasses.length) {
            zone.classList.remove(...activeClasses);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        if (activeClasses.length) {
            zone.classList.remove(...activeClasses);
        }
        if (isDisabled()) return;

        const files = e.dataTransfer ? e.dataTransfer.files : null;
        if (files && files.length && typeof onFileCallback === 'function') {
            if (input) {
                try { input.files = files; } catch (_) {}
            }
            onFileCallback(files[0]);
            if (input) {
                input.value = '';
            }
        }
    };

    const handleInputChange = (e) => {
        if (e.target && e.target.files && e.target.files.length && typeof onFileCallback === 'function') {
            const file = e.target.files[0];
            onFileCallback(file);
            e.target.value = '';
        }
    };

    const unsubs = [];
    if (typeof listen === 'function') {
        unsubs.push(listen(zone, 'click', handleClick));
        unsubs.push(listen(zone, 'dragover', handleDragOver));
        unsubs.push(listen(zone, 'dragleave', handleDragLeave));
        unsubs.push(listen(zone, 'drop', handleDrop));
        if (input) {
            unsubs.push(listen(input, 'change', handleInputChange));
        }
    }

    return () => {
        for (const un of unsubs) {
            if (typeof un === 'function') un();
        }
    };
}

/**
 * Toggles sets of active vs inactive CSS utility classes on an element based on a boolean state.
 * 
 * @param {Element|string} elementOrId 
 * @param {boolean} isActive 
 * @param {Array<string>|string} [activeClasses=[]]
 * @param {Array<string>|string} [inactiveClasses=[]]
 * @param {Document|ShadowRoot} [parent=document]
 */
export function setActiveState(elementOrId, isActive, activeClasses = [], inactiveClasses = [], parent = document) {
    const el = getElement(elementOrId, parent);
    if (!el) return;

    const activeList = Array.isArray(activeClasses) ? activeClasses : (typeof activeClasses === 'string' ? activeClasses.split(' ').filter(Boolean) : []);
    const inactiveList = Array.isArray(inactiveClasses) ? inactiveClasses : (typeof inactiveClasses === 'string' ? inactiveClasses.split(' ').filter(Boolean) : []);

    if (isActive) {
        if (inactiveList.length) el.classList.remove(...inactiveList);
        if (activeList.length) el.classList.add(...activeList);
    } else {
        if (activeList.length) el.classList.remove(...activeList);
        if (inactiveList.length) el.classList.add(...inactiveList);
    }
}

/**
 * Safely escapes HTML entities in a string to prevent XSS.
 * @param {any} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

