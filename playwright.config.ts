import { defineConfig } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
    testDir: './tests/products', // Point to the new product-specific test folder

    // Point to the global setup file
    globalSetup: require.resolve('./tests/globalSetup.ts'),

    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,

    reporter: [
        ['line'],
        ['allure-playwright', { outputFolder: 'allure-results' }]
    ],

    use: {
        // BASE_URL will be set dynamically by globalSetup
        baseURL: process.env.BASE_URL,
        ignoreHTTPSErrors: true,
        trace: 'on-first-retry',
    },

    projects: [
        {
            name: 'bop',
            testMatch: /bop\/specs\/.*\.spec\.ts/,
        },
        {
            name: 'gl', // Future project
            testMatch: /gl\/specs\/.*\.spec\.ts/,
        },
    ],
});