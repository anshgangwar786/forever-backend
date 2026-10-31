const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

/**
 * Escape user-supplied text before interpolating it into server-rendered HTML (pages & emails).
 */
export const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
