// src/ui/shell/icons.js
// Single Task: Encapsulated Lucide Icon Rendering Utility

import { createIcons, icons } from 'lucide';

/**
 * Refreshes Lucide icons in the specified root or the whole document.
 * @param {HTMLElement|Document} [root]
 */
export function refreshIcons(root) {
    if (root) {
        createIcons({ icons, root });
    } else {
        createIcons({ icons });
    }
}
