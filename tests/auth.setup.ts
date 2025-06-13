import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// The path to the file where we'll store our custom auth state (the bearer token)
export const AUTH_FILE = path.join(__dirname, '..', '.auth', 'state.json');

setup('authenticate', async ({ request }) => {
    // --- This logic is moved from the old globalSetup.ts ---
    console.log('Running authentication setup...');

    // 1. Parse Command-Line Arguments
    // We use yargs here because this setup test needs the args to run.
    const argv = await yargs(hideBin(process.argv)).options({
        env: { type: 'string', demandOption: true },
        partner: { type: 'string', demandOption: true },
    }).argv;

    const { env, partner } = argv;

    // 2. Load Environment Configuration
    const envConfigPath = path.join(__dirname, '..', 'config', 'environments.yml');
    const envs = yaml.load(fs.readFileSync(envConfigPath, 'utf8')) as any;
    const targetEnv = envs[env];
    if (!targetEnv) throw new Error(`Environment '${env}' not found in environments.yml`);

    const partnerConfig = targetEnv.partners[partner];
    if (!partnerConfig) throw new Error(`Partner '${partner}' not found for env '${env}'`);

    // Set base URL for subsequent tests
    process.env.PLAYWRIGHT_BASE_URL = targetEnv.baseUrl;

    // 3. Authenticate and Get Token
    const authUrl = `${targetEnv.baseUrl}${targetEnv.authUrl}`;
    const response = await request.post(authUrl, {
        data: {
            app_id: partnerConfig.app_id,
            app_key: process.env[partnerConfig.app_key] || partnerConfig.app_key,
        },
    });

    await expect(response, `Authentication failed: ${await response.text()}`).toBeOK();

    const responseBody = await response.json();
    const token = responseBody.token;
    if (!token) throw new Error('Authentication response did not contain a token.');

    console.log('Authentication successful. Saving token.');

    // 4. Save the custom state (the token) to our auth file
    const authDir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir);

    fs.writeFileSync(AUTH_FILE, JSON.stringify({ bearerToken: token }));
});