// Sync module - Supabase Realtime + polling fallback

var Sync = (function() {
    var lastSyncTime = Date.now();
    var syncInterval = null;
    var syncPaused = false;
    var api = null;
    var onSyncCallback = null;
    var realtimeChannel = null;

    var POLL_INTERVAL = 30000; // 30 seconds (Realtime handles fast updates)
    var PAUSE_AFTER = 5 * 60 * 1000; // 5 minutes

    function init(apiInstance, onSync) {
        api = apiInstance;
        onSyncCallback = onSync;
        startPolling();
        subscribeRealtime();
    }

    function subscribeRealtime() {
        if (!api || api.isMock) return;
        if (typeof window === 'undefined' || !window.supabaseClient) return;

        try {
            realtimeChannel = window.supabaseClient
                .channel(CONFIG.DB_TABLE + '-changes')
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: CONFIG.DB_TABLE,
                    filter: 'list_name=eq.' + api.listName
                }, function() {
                    refreshFromServer();
                })
                .subscribe();
        } catch (e) {
            console.error('Realtime subscription failed:', e);
        }
    }

    function startPolling() {
        lastSyncTime = Date.now();
        syncPaused = false;
        updateStatusUI();

        if (syncInterval) {
            clearInterval(syncInterval);
        }

        syncInterval = setInterval(async function() {
            var elapsed = Date.now() - lastSyncTime;
            if (elapsed > PAUSE_AFTER) {
                pausePolling();
                return;
            }
            await refreshFromServer();
        }, POLL_INTERVAL);
    }

    function pausePolling() {
        syncPaused = true;
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
        updateStatusUI();
    }

    async function refreshFromServer() {
        if (!api) return;
        try {
            var data = await api.fetchItems();
            if (onSyncCallback) {
                onSyncCallback(data);
            }
            updateStatusUI();
        } catch (error) {
            console.error('Sync refresh failed:', error);
        }
    }

    async function manualRefresh() {
        await refreshFromServer();
        resetActivity();
    }

    function resetActivity() {
        lastSyncTime = Date.now();
        if (syncPaused) {
            startPolling();
        }
    }

    function updateStatusUI() {
        var indicator = document.getElementById('syncStatus');
        if (!indicator) return;

        if (syncPaused) {
            indicator.textContent = 'Sync paused';
            indicator.classList.add('paused');
            indicator.title = 'Click to refresh and resume sync';
        } else {
            indicator.textContent = 'Synced';
            indicator.classList.remove('paused');
            indicator.title = 'Auto-syncing every 30s';
        }
    }

    function stop() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
        if (realtimeChannel) {
            try { realtimeChannel.unsubscribe(); } catch (e) {}
            realtimeChannel = null;
        }
        syncPaused = true;
    }

    function isPaused() {
        return syncPaused;
    }

    return {
        init: init,
        startPolling: startPolling,
        pausePolling: pausePolling,
        manualRefresh: manualRefresh,
        resetActivity: resetActivity,
        stop: stop,
        isPaused: isPaused
    };
})();
