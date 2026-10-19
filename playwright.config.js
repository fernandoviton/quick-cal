module.exports = {
    testDir: './tests/e2e',
    webServer: {
        command: 'python -m http.server 8000 -d .',
        port: 8000,
        reuseExistingServer: true,
        cwd: '.'
    },
    use: {
        baseURL: 'http://localhost:8000'
    }
};
