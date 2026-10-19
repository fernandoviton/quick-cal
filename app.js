// Table viewer/editor - THE REPLACEABLE FILE
// New apps delete this and write their own App.init()

var App = (function() {
    var api = null;
    var container = null;
    var listName = null;
    var savingTimeout = null;

    function init(el, name) {
        container = el;
        listName = name;
        api = createApi(name);

        Sync.init(api, function(items) {
            renderTable(items);
        });

        loadAndRender();
    }

    async function loadAndRender() {
        container.innerHTML = '<div class="loading">Loading...</div>';
        try {
            var items = await api.fetchItems();
            renderTable(items);
        } catch (err) {
            container.innerHTML = '<div class="error">Failed to load: ' + escapeHtml(err.message) + '</div>';
        }
    }

    function formatTimestamp(ts) {
        if (!ts) return '';
        return new Date(ts).toLocaleString();
    }

    function renderTable(items) {
        if (!items) items = [];

        var html = '<div class="table-editor">' +
            '<div class="table-toolbar">' +
                '<button class="btn btn-primary" id="addRowBtn">Add Row</button>' +
                '<span id="syncStatus" title="Sync status"></span>' +
            '</div>' +
            '<table class="data-table">' +
                '<thead><tr>' +
                    '<th class="col-id">ID</th>' +
                    '<th>Content</th>' +
                    '<th class="col-timestamp">Created</th>' +
                    '<th class="col-timestamp">Updated</th>' +
                    '<th class="col-actions">Actions</th>' +
                '</tr></thead>' +
                '<tbody>';

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var shortId = item.id ? item.id.substring(0, 8) : '';
            html += '<tr data-id="' + escapeHtml(item.id) + '">' +
                '<td class="col-id"><span class="id-display">' + escapeHtml(shortId) + '</span></td>' +
                '<td>' +
                    '<input type="text" class="table-input" value="' + escapeHtml(item.content || '') + '" data-id="' + escapeHtml(item.id) + '">' +
                '</td>' +
                '<td class="col-timestamp">' + escapeHtml(formatTimestamp(item.created_at)) + '</td>' +
                '<td class="col-timestamp cell-updated-at">' + escapeHtml(formatTimestamp(item.updated_at)) + '</td>' +
                '<td class="col-actions">' +
                    '<button class="btn-icon delete-btn" data-id="' + escapeHtml(item.id) + '" title="Delete">&#10005;</button>' +
                '</td>' +
            '</tr>';
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;

        // Bind events
        document.getElementById('addRowBtn').addEventListener('click', addRow);

        var inputs = container.querySelectorAll('.table-input');
        for (var j = 0; j < inputs.length; j++) {
            inputs[j].addEventListener('input', handleEdit);
        }

        var deletes = container.querySelectorAll('.delete-btn');
        for (var k = 0; k < deletes.length; k++) {
            deletes[k].addEventListener('click', handleDelete);
        }

        // Re-init sync status click
        var syncEl = document.getElementById('syncStatus');
        if (syncEl) {
            syncEl.addEventListener('click', function() {
                Sync.manualRefresh();
            });
        }
    }

    async function addRow() {
        Sync.resetActivity();
        showSaving();
        try {
            await api.createItem({ content: '' });
            var items = await api.fetchItems();
            renderTable(items);
            // Focus the new row's input
            var inputs = container.querySelectorAll('.table-input');
            if (inputs.length > 0) {
                inputs[inputs.length - 1].focus();
            }
        } catch (err) {
            console.error('Failed to add row:', err);
        }
        hideSaving();
    }

    function handleEdit(e) {
        Sync.resetActivity();
        var id = e.target.dataset.id;
        var value = e.target.value;

        // Debounce save
        clearTimeout(savingTimeout);
        savingTimeout = setTimeout(async function() {
            showSaving();
            try {
                var updated = await api.updateItem(id, { content: value });
                // Update the timestamp cell without re-rendering (keeps cursor)
                if (updated) {
                    var tr = container.querySelector('tr[data-id="' + id + '"]');
                    if (tr) {
                        var tsCell = tr.querySelector('.cell-updated-at');
                        if (tsCell) tsCell.textContent = formatTimestamp(updated.updated_at);
                    }
                }
            } catch (err) {
                console.error('Failed to save:', err);
            }
            hideSaving();
        }, 500);
    }

    async function handleDelete(e) {
        Sync.resetActivity();
        var id = e.target.dataset.id;
        showSaving();
        try {
            await api.deleteItem(id);
            var items = await api.fetchItems();
            renderTable(items);
        } catch (err) {
            console.error('Failed to delete:', err);
        }
        hideSaving();
    }

    function showSaving() {
        var el = document.getElementById('savingIndicator');
        if (el) el.classList.add('visible');
    }

    function hideSaving() {
        var el = document.getElementById('savingIndicator');
        if (el) {
            setTimeout(function() { el.classList.remove('visible'); }, 300);
        }
    }

    return {
        init: init
    };
})();
