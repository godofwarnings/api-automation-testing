import { test as baseTest, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Define the shape of our custom fixtures
type MyFixtures = {
    authedRequest: APIRequestContext;
};

// Extend the base Playwright test object with our custom fixtures
export const test = baseTest.extend<MyFixtures>({
    // Fixture for an authenticated APIRequestContext
    authedRequest: async ({ playwright, page }, use, testInfo) => {

        const productMatch = testInfo.file.match(/tests\/products\/(\w+)\//);
        if (!productMatch) {
            throw new Error(`Could not determine product from test file path: ${testInfo.file}`);
        }
        const productName = productMatch[1];
        console.log(`Fixture INFO: Test is for product '${productName}'`);

        const authFile = path.join(__dirname, '..', '..', '.auth', `${productName}.state.json`);
        const baseUrl = process.env[`PLAYWRIGHT_BASE_URL_${productName.toUpperCase()}`];

        if (!fs.existsSync(authFile)) {
            throw new Error(`Auth file not found for product '${productName}': ${authFile}. Did its auth setup run?`);
        }


        // Read the saved token from the auth setup
        const authState = JSON.parse(fs.readFileSync(authFile, 'utf8'));
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