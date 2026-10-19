// Home page - lists all lists, create new, open by name

var Home = (function() {
    async function render(container) {
        container.innerHTML =
            '<div class="home-page">' +
                '<div class="home-actions">' +
                    '<button class="btn btn-primary" id="createListBtn">Create New List</button>' +
                    '<div class="home-open">' +
                        '<input type="text" class="input" id="openListInput" placeholder="Open list by name...">' +
                        '<button class="btn btn-secondary" id="openListBtn">Go</button>' +
                    '</div>' +
                '</div>' +
                '<div class="home-lists" id="homeListsContainer">' +
                    '<div class="loading">Loading lists...</div>' +
                '</div>' +
            '</div>';

        document.getElementById('createListBtn').addEventListener('click', function() {
            var id = generateListId();
            window.location.href = './?list=' + id;
        });

        document.getElementById('openListBtn').addEventListener('click', function() {
            openByName();
        });

        document.getElementById('openListInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') openByName();
        });

        function openByName() {
            var name = document.getElementById('openListInput').value.trim();
            if (name) {
                window.location.href = './?list=' + encodeURIComponent(name);
            }
        }

        // Load existing lists
        try {
            var lists = await createApi.getAllLists();
            var listsContainer = document.getElementById('homeListsContainer');

            if (lists.length === 0) {
                listsContainer.innerHTML = '<p class="home-empty">No lists yet. Create one to get started.</p>';
                return;
            }

            var html = '<ul class="home-list-items">';
            for (var i = 0; i < lists.length; i++) {
                var item = lists[i];
                var updated = item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '';
                var countLabel = item.count !== undefined ? ' (' + item.count + (item.count === 1 ? ' item' : ' items') + ')' : '';
                html += '<li class="home-list-item">' +
                    '<a href="./?list=' + encodeURIComponent(item.list_name) + '">' +
                        '<span class="home-list-name">' + escapeHtml(item.list_name) + escapeHtml(countLabel) + '</span>' +
                        (updated ? '<span class="home-list-date">' + escapeHtml(updated) + '</span>' : '') +
                    '</a>' +
                '</li>';
            }
            html += '</ul>';
            listsContainer.innerHTML = html;
        } catch (err) {
            document.getElementById('homeListsContainer').innerHTML =
                '<div class="error">Failed to load lists</div>';
            console.error('Failed to load lists:', err);
        }
    }

    return {
        render: render
    };
})();
