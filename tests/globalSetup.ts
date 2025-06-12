// Playwright global setup for auth
import { FullConfig } from '@playwright/test';
import { request } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as dotenv from 'dotenv';

dotenv.config(); // Load secrets from .env file

async function globalSetup(config: FullConfig) {
    // 1. Parse Command-Line Arguments
    const argv = await yargs(hideBin(process.argv)).options({
        env: { type: 'string', demandOption: true, description: 'Target environment (sit, uat, etc.)' },
        partner: { type: 'string', demandOption: true, description: 'Partner code (partner_a, etc.)' },
    }).argv;

    const { env, partner } = argv;

    // 2. Load Environment Configuration
    const envConfigPath = path.join(__dirname, '..', 'config', 'environments.yml');
    const envs = yaml.load(fs.readFileSync(envConfigPath, 'utf8')) as any;
    const targetEnv = envs[env];

    if (!targetEnv) {
        throw new Error(`Environment '${env}' not found in environments.yml`);
    }

    const partnerConfig = targetEnv.partners[partner];
    if (!partnerConfig) {
        throw new Error(`Partner '${partner}' not found for environment '${env}'`);
    }

    // 3. Authenticate and Get Token
    const authUrl = `${targetEnv.baseUrl}${targetEnv.authUrl}`;
    const requestContext = await request.newContext();
    const response = await requestContext.post(authUrl, {
        data: {
            app_id: partnerConfig.app_id,
            app_key: process.env[partnerConfig.app_key] || partnerConfig.app_key, // Support for env vars
        },
    });

    if (!response.ok()) {
        throw new Error(`Failed to authenticate: ${response.status()} ${await response.text()}`);
    }

    const responseBody = await response.json();
    const token = responseBody.token; // Adjust this based on your actual auth response

    if (!token) {
        throw new Error('Authentication successful, but no token was found in the response.');
    }

    // 4. Save the Token to a State File
    const authDir = path.join(__dirname, '..', '.auth');
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir);
    }
    fs.writeFileSync(path.join(authDir, 'state.json'), JSON.stringify({ bearerToken: token }));

    // 5. Set Base URL for Playwright tests
    process.env.BASE_URL = targetEnv.baseUrl;
}

export default globalSetup;