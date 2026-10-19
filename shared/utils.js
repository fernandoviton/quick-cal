// Shared utility functions

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function generateListId(length) {
    if (length === undefined) length = 8;
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var result = '';
    for (var i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getListName() {
    var params = new URLSearchParams(window.location.search);
    var list = params.get('list');
    return (list && list.trim()) || CONFIG.DEFAULT_LIST_NAME;
}

function hasExplicitListName() {
    var params = new URLSearchParams(window.location.search);
    var list = params.get('list');
    return !!(list && list.trim());
}
