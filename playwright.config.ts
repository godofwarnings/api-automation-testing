import { defineConfig } from '@playwright/test';
import { AUTH_FILE } from './tests/auth.setup';

export default defineConfig({
    testDir: './tests', // Point to the root tests directory

    // Fail the build on CI if you accidentally left test.only in the source code.
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,

    reporter: [
        ['line'],
        ['allure-playwright', { outputFolder: 'allure-results' }]
    ],

    // Shared settings for all projects.
    use: {
        // The baseURL will be set dynamically by the auth.setup.ts test
        // and read via process.env.PLAYWRIGHT_BASE_URL in the fixture.
        ignoreHTTPSErrors: true,
        trace: 'on-first-retry',
    },

    projects: [
        // --- Authentication Projects ---
        {
            name: 'BOP Authentication',
            testMatch: '**/products/bop/bop.auth.setup.ts',
            // testMatch: /products\/bop\/bop\.auth\.setup\.ts/ 
        },
        { name: 'GL Authentication', testMatch: /products\/gl\/gl\.auth\.setup\.ts/ },

        // --- API Test Projects ---
        {
            name: 'bop-api-tests',
            testMatch: /products\/bop\/specs\/.*\.spec\.ts/,
            dependencies: ['BOP Authentication'], // <-- BOP tests depend on BOP auth
        },
        {
            name: 'gl-api-tests',
            testMatch: /products\/gl\/specs\/.*\.spec\.ts/,
            dependencies: ['GL Authentication'], // <-- GL tests depend on GL auth
        },
    ],
});