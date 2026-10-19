// Config loader - tries config.local.js first (localhost only), falls back to config.js
// Must be loaded synchronously before other scripts that need CONFIG

(function() {
    if (typeof window.CONFIG !== 'undefined') {
        console.log('[Config] Using pre-loaded config');
        return;
    }

    var isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    if (isLocalhost) {
        var foundLocal = false;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'config.local.js', false);
            xhr.send();
            if (xhr.status === 200) {
                var script = document.createElement('script');
                script.textContent = xhr.responseText;
                document.head.appendChild(script);
                console.log('[Config] Loaded config.local.js');
                foundLocal = true;
            }
        } catch (e) {}

        if (!foundLocal) {
            window.CONFIG = {
                SUPABASE_URL: null,
                SUPABASE_PUBLISHABLE_KEY: null,
                APP_TITLE: 'Listlet',
                DB_TABLE: 'listlet_sample',
                DEFAULT_LIST_NAME: 'demo'
            };
            console.log('[Config] Localhost with no config.local.js — using mock mode (localStorage)');
        }
        return;
    }

    // Production — load config.js
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'config.js', false);
        xhr.send();
        if (xhr.status === 200) {
            var script = document.createElement('script');
            script.textContent = xhr.responseText;
            document.head.appendChild(script);
            console.log('[Config] Loaded config.js');
        }
    } catch (e) {
        console.error('[Config] Failed to load any config file');
    }
})();
