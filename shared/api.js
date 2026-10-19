// API layer - Supabase backed with localStorage mock mode

// Pull a dated row's date out of its JSON content for mock-mode range
// filtering. Mirrors the DB's generated content-date column (see
// sql/setup.sql). Tolerant: a dateless / unparseable row resolves to null
// (and is excluded by any range).
function contentDate(item) {
    try {
        return JSON.parse(item.content).date || null;
    } catch (e) {
        return null;
    }
}

function createApi(listName) {
    var isMock = !CONFIG.SUPABASE_URL;
    var storageKey = 'listlet_' + CONFIG.DB_TABLE + '_' + listName;
    // Generated column backing dated range queries; apps whose schema names it
    // differently set CONFIG.CONTENT_DATE_COLUMN.
    var dateColumn = CONFIG.CONTENT_DATE_COLUMN || 'content_date';

    // Optional default { dateFrom, dateTo } applied when fetchItems is called
    // with no explicit opts — so Sync's arg-less refresh stays bounded too.
    var defaultRange = null;

    return {
        isMock: isMock,
        listName: listName,

        /**
         * Set a default ISO date range (YYYY-MM-DD) for subsequent arg-less
         * fetchItems() calls. Calendar-style views set this to their visible
         * window so the un-paginated ~1000-row fetch cap can't drop recent
         * rows. Pass null to clear. An explicit fetchItems(opts) still
         * overrides per-call.
         * @param {?string} dateFrom
         * @param {?string} dateTo
         */
        setDateRange(dateFrom, dateTo) {
            defaultRange = (dateFrom || dateTo) ? { dateFrom: dateFrom, dateTo: dateTo } : null;
        },

        /**
         * Fetch items for this list, optionally bounded to a content-date range.
         * @param {{dateFrom?: string, dateTo?: string}} [opts] ISO YYYY-MM-DD bounds
         *   (inclusive). Omitted → the instance default range (see setDateRange),
         *   or all rows when none is set.
         * @returns {Promise<Array>}
         */
        async fetchItems(opts) {
            var range = opts || defaultRange || {};

            if (isMock) {
                var saved = localStorage.getItem(storageKey);
                var items = saved ? JSON.parse(saved) : [];
                if (range.dateFrom || range.dateTo) {
                    items = items.filter(function(it) {
                        var d = contentDate(it);
                        if (!d) return false;
                        if (range.dateFrom && d < range.dateFrom) return false;
                        if (range.dateTo && d > range.dateTo) return false;
                        return true;
                    });
                }
                return items;
            }

            var query = window.supabaseClient
                .from(CONFIG.DB_TABLE)
                .select('*')
                .eq('list_name', listName);
            if (range.dateFrom) query = query.gte(dateColumn, range.dateFrom);
            if (range.dateTo) query = query.lte(dateColumn, range.dateTo);
            var result = await query.order('created_at');

            if (result.error) throw new Error(result.error.message);
            return result.data || [];
        },

        /**
         * Create a new item
         * @param {Object} fields - { content }
         * @returns {Promise<Object>} The created item
         */
        async createItem(fields) {
            if (isMock) {
                var items = JSON.parse(localStorage.getItem(storageKey) || '[]');
                var now = new Date().toISOString();
                var item = {
                    id: crypto.randomUUID(),
                    list_name: listName,
                    content: fields.content || '',
                    created_at: now,
                    updated_at: now
                };
                items.push(item);
                localStorage.setItem(storageKey, JSON.stringify(items));
                return item;
            }

            var result = await window.supabaseClient
                .from(CONFIG.DB_TABLE)
                .insert({ list_name: listName, content: fields.content || '' })
                .select()
                .single();

            if (result.error) throw new Error(result.error.message);
            return result.data;
        },

        /**
         * Update an existing item
         * @param {string} id - Item UUID
         * @param {Object} changes - { content }
         * @returns {Promise<Object>} The updated item
         */
        async updateItem(id, changes) {
            if (isMock) {
                var items = JSON.parse(localStorage.getItem(storageKey) || '[]');
                var item = null;
                for (var i = 0; i < items.length; i++) {
                    if (items[i].id === id) {
                        if (changes.content !== undefined) items[i].content = changes.content;
                        items[i].updated_at = new Date().toISOString();
                        item = items[i];
                        break;
                    }
                }
                localStorage.setItem(storageKey, JSON.stringify(items));
                return item;
            }

            var result = await window.supabaseClient
                .from(CONFIG.DB_TABLE)
                .update({ content: changes.content })
                .eq('id', id)
                .select()
                .single();

            if (result.error) throw new Error(result.error.message);
            return result.data;
        },

        /**
         * Delete an item
         * @param {string} id - Item UUID
         * @returns {Promise<void>}
         */
        async deleteItem(id) {
            if (isMock) {
                var items = JSON.parse(localStorage.getItem(storageKey) || '[]');
                items = items.filter(function(item) { return item.id !== id; });
                localStorage.setItem(storageKey, JSON.stringify(items));
                return;
            }

            var result = await window.supabaseClient
                .from(CONFIG.DB_TABLE)
                .delete()
                .eq('id', id);

            if (result.error) throw new Error(result.error.message);
        }
    };
}

/**
 * Get all lists with counts
 * @returns {Promise<Array>} [{list_name, count, updated_at}]
 */
createApi.getAllLists = async function() {
    var isMock = !CONFIG.SUPABASE_URL;

    if (isMock) {
        var prefix = 'listlet_' + CONFIG.DB_TABLE + '_';
        var lists = [];
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && key.indexOf(prefix) === 0) {
                var listName = key.substring(prefix.length);
                var items = JSON.parse(localStorage.getItem(key));
                var maxUpdated = null;
                for (var j = 0; j < items.length; j++) {
                    if (!maxUpdated || items[j].updated_at > maxUpdated) {
                        maxUpdated = items[j].updated_at;
                    }
                }
                lists.push({ list_name: listName, count: items.length, updated_at: maxUpdated });
            }
        }
        return lists;
    }

    var result = await window.supabaseClient
        .from(CONFIG.DB_TABLE)
        .select('list_name, updated_at')
        .order('updated_at', { ascending: false });

    if (result.error) throw new Error(result.error.message);

    // Group by list_name
    var groups = {};
    var rows = result.data || [];
    for (var k = 0; k < rows.length; k++) {
        var row = rows[k];
        if (!groups[row.list_name]) {
            groups[row.list_name] = { list_name: row.list_name, count: 0, updated_at: row.updated_at };
        }
        groups[row.list_name].count++;
        if (row.updated_at > groups[row.list_name].updated_at) {
            groups[row.list_name].updated_at = row.updated_at;
        }
    }

    var listArr = [];
    for (var name in groups) {
        listArr.push(groups[name]);
    }
    listArr.sort(function(a, b) {
        return (b.updated_at || '') > (a.updated_at || '') ? 1 : -1;
    });
    return listArr;
};
