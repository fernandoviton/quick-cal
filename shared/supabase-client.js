// Creates window.supabaseClient from CONFIG

(function() {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) {
        window.supabaseClient = null;
        console.log('[Supabase] Mock mode — no client created');
        return;
    }

    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
        window.supabaseClient = null;
        console.warn('[Supabase] CDN not loaded — no client created');
        return;
    }

    window.supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
    console.log('[Supabase] Client created');
})();
