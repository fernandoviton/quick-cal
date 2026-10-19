// Auth module - Google OAuth via Supabase, mock bypass on localhost

var Auth = (function() {
    var currentUser = null;
    var onReadyCallback = null;

    function init(onReady) {
        onReadyCallback = onReady;
        // Mock mode — skip auth
        if (!window.supabaseClient) {
            currentUser = { email: 'local@mock' };
            hideLogin();
            onReady(currentUser);
            return;
        }

        // Check existing session
        window.supabaseClient.auth.getSession().then(function(result) {
            if (result.data.session) {
                currentUser = result.data.session.user;
                hideLogin();
                onReady(currentUser);
            } else {
                showLogin();
            }
        });

        // Listen for auth changes (OAuth redirect)
        window.supabaseClient.auth.onAuthStateChange(function(event, session) {
            if (event === 'SIGNED_IN' && session) {
                currentUser = session.user;
                hideLogin();
                onReady(currentUser);
            }
        });
    }

    function signInWithGoogle() {
        if (!window.supabaseClient) {
            // Mock mode — simulate login
            currentUser = { email: 'local@mock' };
            hideLogin();
            onReadyCallback(currentUser);
            return;
        }
        window.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.href.split('?')[0] }
        });
    }

    function signOut() {
        currentUser = null;
        Sync.stop();
        showLogin();
        if (window.supabaseClient) {
            window.supabaseClient.auth.signOut();
        }
    }

    function getUser() {
        return currentUser;
    }

    function showLogin() {
        document.getElementById('login-page').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
    }

    function hideLogin() {
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('app-container').style.display = 'block';
    }

    return {
        init: init,
        signInWithGoogle: signInWithGoogle,
        signOut: signOut,
        getUser: getUser
    };
})();
