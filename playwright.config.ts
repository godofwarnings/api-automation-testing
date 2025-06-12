import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load default environment variables
dotenv.config();

// Optionally load environment-specific .env files
if (process.env.NODE_ENV) {
    dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
}

export default defineConfig({
    // Look for test files in the "tests" directory, matching the .spec.ts pattern
    testDir: './tests',

    // Run all tests in parallel
    fullyParallel: true,

    // Fail the build on CI if you accidentally left test.only in the source code
    forbidOnly: !!process.env.CI,

    // Retry on CI only
    retries: process.env.CI ? 2 : 0,

    // Use a reasonable number of workers
    workers: process.env.CI ? 1 : undefined,

    reporter: [
        ['line'],
        ['allure-playwright', {
            outputFolder: 'allure-results',
            detail: true,
            suiteTitle: false
        }]
    ],

    use: {
        // Use the base URL from the .env file
        baseURL: process.env.BASE_URL,

        // Ignore HTTPS errors if testing against a self-signed cert
        ignoreHTTPSErrors: true,

        // Collect trace when retrying the failed test
        trace: 'on-first-retry',
    },

    // Configure projects for major browsers
    projects: [
        {
            name: 'api',
            // We can group tests by filename or tags
            testMatch: /.*\.spec\.ts/,
        },
        // Example for future UI projects
        // {
        //   name: 'chromium',
        //   use: { ...devices['Desktop Chrome'] },
        // },
    ],
});