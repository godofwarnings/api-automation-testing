// import { test as setup, expect } from '@playwright/test';
// import * as fs from 'fs';
// import * as path from 'path';
// import yargs from 'yargs/yargs';
// import { hideBin } from 'yargs/helpers';
// import dotenv from 'dotenv';

// dotenv.config();

// const productName = 'bop';
// export const AUTH_FILE = path.join(__dirname, '..', '..', '..', '.auth', `${productName}.state.json`);

// setup(`authenticate ${productName}`, async ({ request }) => {
//     console.log(`Running authentication setup for product: ${productName}`);

//     // 1. Parse --env and --partner from the CLI
//     const argv = await yargs(hideBin(process.argv)).options({
//         env: { type: 'string', demandOption: true },
//         partner: { type: 'string', demandOption: true },
//     }).argv;
//     const { env, partner } = argv;

//     // 2. Load the correct partner JSON configuration file
//     const partnerConfigPath = path.join(__dirname, '..', '..', '..', 'config', 'partners', `${partner}.json`);
//     if (!fs.existsSync(partnerConfigPath)) {
//         throw new Error(`Partner configuration file not found: ${partnerConfigPath}`);
//     }
//     const partnerConfig = JSON.parse(fs.readFileSync(partnerConfigPath, 'utf8'));

//     // 3. Get environment and product-specific details from the loaded config
//     const envDetails = partnerConfig.environments[env];
//     if (!envDetails) throw new Error(`Environment '${env}' not found in ${partner}.json`);

//     const productAuthConfig = partnerConfig.products[productName];
//     if (!productAuthConfig) throw new Error(`Auth config for product '${productName}' not found in ${partner}.json`);

//     const baseUrl = envDetails.host; // Use the host from the partner config
//     process.env[`PLAYWRIGHT_BASE_URL_${productName.toUpperCase()}`] = baseUrl;

//     // 4. Look up secret values from .env using the variable names from the config
//     const appId = process.env[productAuthConfig.app_id_var];
//     const appKey = process.env[productAuthConfig.app_key_var];
//     const resourceKey = process.env[productAuthConfig.resource_key_var];

//     if (!appId || !appKey || !resourceKey) {
//         throw new Error(`Missing one or more secret environment variables for ${productName} and ${partner}. Check your .env file for ${productAuthConfig.app_id_var}, ${productAuthConfig.app_key_var}, or ${productAuthConfig.resource_key_var}.`);
//     }

//     // 5. Make the authentication request
//     const response = await request.post(`${baseUrl}${productAuthConfig.auth_path}`, {
//         headers: {
//             'App_ID': appId,
//             'App_key': appKey,
//             'Resource_Key': resourceKey,
//         },
//     });

//     await expect(response, `Auth failed for ${productName}: ${await response.text()}`).toBeOK();
//     const responseBody = await response.json();
//     const token = responseBody.access_token; // Or whatever the token field is named

//     // 6. Save the state file
//     fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
//     fs.writeFileSync(AUTH_FILE, JSON.stringify({ bearerToken: token }));
//     console.log(`Authentication for ${productName.toUpperCase()} with ${partner.toUpperCase()} successful. State saved.`);
// });

// import { test as setup, expect } from '@playwright/test';
// import * as fs from 'fs';
// import * as path from 'path';
// import yargs from 'yargs/yargs';
// import { hideBin } from 'yargs/helpers';
// import * as dotenv from 'dotenv';

// dotenv.config();

// const productName = 'bop';
// export const AUTH_FILE = path.join(__dirname, '..', '..', '..', '.auth', `${productName}.state.json`);

// // This "setup" block is what Playwright looks for. If this is missing, the file has "no tests".
// setup(`authenticate ${productName}`, async ({ request }) => {
//     console.log(`Running authentication setup for product: ${productName}`);

//     const argv = await yargs(hideBin(process.argv)).options({
//         env: { type: 'string', demandOption: true },
//         partner: { type: 'string', demandOption: true },
//     }).argv;
//     const { env, partner } = argv;

//     const partnerConfigPath = path.join(__dirname, '..', '..', '..', 'config', 'partners', `${partner}.json`);
//     if (!fs.existsSync(partnerConfigPath)) {
//         throw new Error(`Partner configuration file not found: ${partnerConfigPath}`);
//     }
//     const partnerConfig = JSON.parse(fs.readFileSync(partnerConfigPath, 'utf8'));

//     const envDetails = partnerConfig.environments[env];
//     if (!envDetails) throw new Error(`Environment '${env}' not found in ${partner}.json`);

//     const productAuthConfig = partnerConfig.products[productName];
//     if (!productAuthConfig) throw new Error(`Auth config for product '${productName}' not found in ${partner}.json`);

//     const baseUrl = envDetails.host;
//     process.env[`PLAYWRIGHT_BASE_URL_${productName.toUpperCase()}`] = baseUrl;

//     const appId = process.env[productAuthConfig.app_id_var];
//     const appKey = process.env[productAuthConfig.app_key_var];
//     const resourceKey = process.env[productAuthConfig.resource_key_var];

//     if (!appId || !appKey || !resourceKey) {
//         throw new Error(`Missing secret environment variables for ${productName} and ${partner}.`);
//     }

//     const response = await request.post(`${baseUrl}${productAuthConfig.auth_path}`, {
//         headers: {
//             'App_ID': appId,
//             'App_key': appKey,
//             'Resource_Key': resourceKey,
//         },
//     });

//     await expect(response, `Auth failed for ${productName}: ${await response.text()}`).toBeOK();
//     const responseBody = await response.json();
//     const token = responseBody.access_token;

//     fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
//     fs.writeFileSync(AUTH_FILE, JSON.stringify({ bearerToken: token }));
//     console.log(`Authentication for ${productName.toUpperCase()} with ${partner.toUpperCase()} successful. State saved.`);
// });

import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
// YARGS IS NO LONGER NEEDED HERE
import * as dotenv from 'dotenv';

dotenv.config();

const productName = 'bop';
export const AUTH_FILE = path.join(__dirname, '..', '..', '..', '.auth', `${productName}.state.json`);

setup(`authenticate ${productName}`, async ({ request }) => {
    console.log(`Running authentication setup for product: ${productName}`);

    // 1. Read configuration from environment variables
    const env = process.env.ENV;
    const partner = process.env.PARTNER;

    // Add clear error messages if the variables are not set
    if (!env || !partner) {
        throw new Error('FATAL: The ENV and PARTNER environment variables must be set. Example: ENV=test PARTNER=httpbin_partner');
    }

    console.log(`Using Environment: ${env}, Partner: ${partner}`);

    // 2. Load the correct partner JSON configuration file
    const partnerConfigPath = path.join(__dirname, '..', '..', '..', 'config', 'partners', `${partner}.json`);
    if (!fs.existsSync(partnerConfigPath)) {
        throw new Error(`Partner configuration file not found: ${partnerConfigPath}`);
    }
    const partnerConfig = JSON.parse(fs.readFileSync(partnerConfigPath, 'utf8'));

    // ... (The rest of the logic is exactly the same) ...
    const envDetails = partnerConfig.environments[env];
    if (!envDetails) throw new Error(`Environment '${env}' not found in ${partner}.json`);

    const productAuthConfig = partnerConfig.products[productName];
    if (!productAuthConfig) throw new Error(`Auth config for product '${productName}' not found in ${partner}.json`);

    const baseUrl = envDetails.host;
    process.env[`PLAYWRIGHT_BASE_URL_${productName.toUpperCase()}`] = baseUrl;

    const appId = process.env[productAuthConfig.app_id_var];
    const appKey = process.env[productAuthConfig.app_key_var];
    const resourceKey = process.env[productAuthConfig.resource_key_var];

    if (!appId || !appKey || !resourceKey) {
        throw new Error(`Missing one or more secret environment variables for ${productName} and ${partner}.`);
    }

    const response = await request.post(`${baseUrl}${productAuthConfig.auth_path}`, {
        headers: {
            'App_ID': appId,
            'App_key': appKey,
            'Resource_Key': resourceKey,
        },
    });

    await expect(response, `Auth failed for ${productName}: ${await response.text()}`).toBeOK();
    const responseBody = await response.json();
    const token = responseBody.access_token;

    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ bearerToken: token }));
    console.log(`Authentication for ${productName.toUpperCase()} with ${partner.toUpperCase()} successful. State saved.`);
});