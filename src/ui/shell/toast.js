// src/ui/shell/toast.js
// Single Task: Floating Non-Blocking Toast Notifications with Manual Close and Type-Aware Auto-Dismiss

export function showToast(message, type = 'warning', timeoutMs = null) {
    if (typeof document === 'undefined') {
        return;
    }
    const resolvedTimeout = timeoutMs !== null && timeoutMs !== undefined
        ? timeoutMs
        : (type === 'info' || type === 'success' ? 4000 : (type === 'warning' ? 8000 : 15000));
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-6 right-6 z-50 flex flex-col gap-2 pointer-events-none max-w-sm';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-600' :
                    type === 'success' ? 'bg-emerald-600' :
                    type === 'info' ? 'bg-blue-600' : 'bg-amber-600';

    toast.className = `${bgColor} text-white px-3.5 py-2.5 rounded-xl shadow-xl text-xs font-medium opacity-0 transition-opacity duration-300 flex items-center justify-between gap-3 pointer-events-auto border border-white/20`;

    const textSpan = document.createElement('span');
    textSpan.className = 'leading-relaxed break-words flex-1';
    textSpan.innerText = message;
    toast.appendChild(textSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'shrink-0 p-1 hover:bg-black/20 active:bg-black/30 rounded-md transition-colors text-white/80 hover:text-white font-bold text-sm leading-none focus:outline-none';
    closeBtn.setAttribute('aria-label', 'Close toast notification');
    closeBtn.innerHTML = '&times;';

    let autoDismissTimer = null;

    const dismiss = () => {
        if (autoDismissTimer) {
            clearTimeout(autoDismissTimer);
            autoDismissTimer = null;
        }
        toast.classList.add('opacity-0');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    };

    closeBtn.addEventListener('click', dismiss);
    toast.appendChild(closeBtn);

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('opacity-0'));

    if (resolvedTimeout && resolvedTimeout > 0) {
        autoDismissTimer = setTimeout(() => {
            dismiss();
        }, resolvedTimeout);
    }
}
