module.exports = {
    timeout: 600000,
    use: {
        headless: false,
        viewport: { width: 1280, height: 720 },
        video: {
            mode: 'retain-on-failure',
            dir: 'test-results/videos/'
        },
        screenshot: {
            mode: 'only-on-failure',
            dir: 'test-results/screenshots/'
        },
        acceptDownloads: true,
        actionTimeout: 50000,
        navigationTimeout: 40000,
        launchOptions: {
            args: ['--disable-dev-shm-usage']
        }
    },
    reporter: 'list',
}; 