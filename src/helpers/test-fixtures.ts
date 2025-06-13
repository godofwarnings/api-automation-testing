import { test as baseTest } from '@playwright/test';
import * as fs from 'fs';
import { AUTH_FILE } from '../../tests/auth.setup';

// Define the shape of our custom fixtures
type MyFixtures = {
    authedRequest: typeof baseTest.request;
};

// Extend the base Playwright test object with our custom fixtures
export const test = baseTest.extend<MyFixtures>({
    // Fixture for an authenticated APIRequestContext
    authedRequest: async ({ playwright }, use) => {
        // Read the saved token from the auth setup
        const authState = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
        const token = authState.bearerToken;

        if (!token) {
            throw new Error('Bearer token not found in auth state. Did auth.setup.ts run?');
        }

        // Create a new API context with the Authorization header pre-set
        const context = await playwright.request.newContext({
            baseURL: process.env.PLAYWRIGHT_BASE_URL,
            extraHTTPHeaders: {
                'Authorization': `Bearer ${token}`,
            },
        });

        // Provide the authenticated context to the test
        await use(context);

        // Teardown: dispose of the context after the test is done
        await context.dispose();
    },
});

export { expect } from '@playwright/test';