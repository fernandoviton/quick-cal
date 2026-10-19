// Header bar - app title, home button, profile/logout

var Header = (function() {
    function render(container, user) {
        var title = (typeof CONFIG !== 'undefined' && CONFIG.APP_TITLE) || 'Listlet';
        var email = user ? user.email : '';

        container.innerHTML =
            '<div class="header-bar">' +
                '<div class="header-left">' +
                    '<a href="./" class="header-home-btn" title="Home">&#8962;</a>' +
                    '<span class="header-title">' + escapeHtml(title) + '</span>' +
                '</div>' +
                '<div class="header-right">' +
                    '<span class="header-email">' + escapeHtml(email) + '</span>' +
                    '<button class="header-logout-btn" id="logoutBtn">Logout</button>' +
                '</div>' +
            '</div>';

        document.getElementById('logoutBtn').addEventListener('click', function() {
            Auth.signOut();
        });
    }

    return {
        render: render
    };
})();
