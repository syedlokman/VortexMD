// src/ui/panels/log-modal.js
// Single Task: System Log Modal UI & Copy Log Handler

import { logger } from '../../shared/logger.js';
import { showToast } from '../shell/toast.js';
import { refreshIcons } from '../shell/icons.js';
import { escapeHtml } from '../shell/dom-utils.js';

export function initLogModal({ engine, listen, onOpen }) {
    const modal = document.getElementById('log-modal');
    const btnOpen = document.getElementById('btn-open-logger');
    const btnClose = document.getElementById('btn-close-logger');
    const btnClear = document.getElementById('btn-clear-logs');
    const btnCopy = document.getElementById('btn-copy-logs');
    const logList = document.getElementById('log-list');

    const handleOpen = () => {
        if (typeof onOpen === 'function') {
            onOpen();
        }
        refreshIcons(modal);
    };

    const openModal = () => {
        modal?.showModal();
        handleOpen();
    };

    if (btnOpen) listen(btnOpen, 'click', openModal);
    const btnOpenMini = document.getElementById('btn-open-logger-mini');
    if (btnOpenMini) listen(btnOpenMini, 'click', openModal);
    
    if (btnClose) listen(btnClose, 'click', () => modal?.close());
    if (modal) {
        listen(modal, 'click', (e) => {
            if (e.target === modal) modal.close();
        });
        listen(modal, 'toggle', () => {
            if (modal.open) {
                handleOpen();
            }
        });
    }
    if (btnClear) listen(btnClear, 'click', () => logger.clear());

    // Copy Log Functionality
    if (btnCopy) {
        listen(btnCopy, 'click', () => {
            const logs = logger.logs;
            if (!logs || logs.length === 0) {
                showToast("No log entries to copy.", "info");
                return;
            }

            const formattedText = logs.map(item => {
                let line = `[${item.timestamp}] [${item.level.toUpperCase()}] [${item.category}] ${item.message}`;
                if (item.data) {
                    try {
                        line += ` | ${JSON.stringify(item.data)}`;
                    } catch(e) {
                        line += ` | ${item.data}`;
                    }
                }
                return line;
            }).join('\n');

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(formattedText).then(() => {
                    showToast("System Log copied to clipboard!", "success");
                }).catch(() => {
                    fallbackCopyText(formattedText);
                });
            } else {
                fallbackCopyText(formattedText);
            }
        });
    }

    function fallbackCopyText(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast("System Log copied to clipboard!", "success");
        } catch (e) {
            showToast("Failed to copy log.", "error");
        }
        document.body.removeChild(textArea);
    }

    // Subscribe to Logger Updates
    const unsub = logger.subscribe((logs) => {
        if (!logList) return;
        if (logs.length === 0) {
            logList.innerHTML = `<div class="text-center text-slate-500 text-xs py-8 font-mono">No logs recorded yet.</div>`;
            return;
        }

        logList.innerHTML = logs.map(item => {
            const badgeBg = item.level === 'error' ? 'bg-red-500' :
                            item.level === 'warn' ? 'bg-amber-500' :
                            item.level === 'perf' ? 'bg-emerald-600' : 'bg-blue-600';

            let dataStr = '';
            if (item.data) {
                try {
                    dataStr = `<span class="text-slate-400 text-[11px] block mt-1 font-mono">${escapeHtml(JSON.stringify(item.data))}</span>`;
                } catch(e) {}
            }

            return `
                <div class="flex flex-col p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50 font-mono text-xs">
                    <div class="flex items-start gap-3">
                        <span class="text-slate-400 text-[10px] shrink-0 min-w-[70px]">${escapeHtml(item.timestamp)}</span>
                        <span class="${badgeBg} text-white px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0">${escapeHtml(item.category)}</span>
                        <span class="text-slate-200 flex-1 break-words">${escapeHtml(item.message)}</span>
                    </div>
                    ${dataStr}
                </div>
            `;
        }).join('');
    });

    return () => unsub();
}
