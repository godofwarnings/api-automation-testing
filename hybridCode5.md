Of course. This is an excellent architectural decision that brings us back to a pure, robust Playwright pattern. You are right to enforce this separation.

Let's implement this correctly.

**The New, Correct Architecture:**
1.  **`globalSetup`:** Its *only* job is to parse CLI arguments (`--env`, `--partner`) and save the resolved configuration to a temporary file (`.tmp/run_config.json`). Nothing more.
2.  **Authentication as a Test Project:** We will have dedicated test files (e.g., `bop.auth.setup.ts`) that are configured as separate Playwright projects. These tests are responsible for performing the actual authentication.
3.  **Dependencies:** The main test projects (e.g., `bop-api-tests`) will declare a `dependency` on their corresponding authentication project. Playwright will enforce this execution order.

This is the cleanest and most scalable model.

---

### **Step 1: The `global.setup.ts` Script (Simplified)**

This script returns to its minimal, correct purpose.

📁 **`tests/global.setup.ts`** (Corrected and Final)
```typescript
import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { merge } from 'lodash';
import { log } from '../src/helpers/logger'; // Use our global logger

export const GLOBAL_RUN_CONFIG_FILE = path.join(__dirname, '..', '.tmp', 'run_config.json');

async function globalSetup(config: FullConfig) {
  log.info('--- Running Global Setup: Parsing environment configuration ---');

  const argv = await yargs(hideBin(process.argv)).options({
    env: { type: 'string', demandOption: true },
    partner: { type: 'string' }, // Partner is optional
  }).argv;
  const { env, partner } = argv;
  
  // Set as process.env for any other part of the test runner to access
  process.env.ENV = env;
  if (partner) process.env.PARTNER = partner;

  // Load base environment config
  const envConfigPath = path.join(__dirname, '..', 'config', 'environments', `${env}.config.json`);
  if (!fs.existsSync(envConfigPath)) throw new Error(`GlobalSetup: Base env config not found at ${envConfigPath}`);
  let finalConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));

  // Conditionally load and merge partner config
  if (partner) {
    log.info({ partner }, "Partner specified. Loading override configuration.");
    const partnerConfigPath = path.join(__dirname, '..', 'config', 'partners', `${partner}.json`);
    if (fs.existsSync(partnerConfigPath)) {
      const partnerConfig = JSON.parse(fs.readFileSync(partnerConfigPath, 'utf8'));
      finalConfig = merge(finalConfig, partnerConfig);
    } else {
      log.warn({ partner }, `Partner specified, but config file not found. Using base config only.`);
    }
  } else {
    log.info("No partner specified. Using base environment configuration.");
  }

  const runConfig = {
    currentEnv: env,
    currentPartner: partner || 'default',
    baseURL: finalConfig.host,
    configDetails: finalConfig,
  };

  fs.mkdirSync(path.dirname(GLOBAL_RUN_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(GLOBAL_RUN_CONFIG_FILE, JSON.stringify(runConfig, null, 2));

  log.info({ env, partner }, "Global setup complete. Run configuration saved.");
}

export default globalSetup;
```

---

### **Step 2: The Authentication Test (`bop.auth.setup.ts`)**

This is now a self-contained test that reads the configuration file produced by `globalSetup`.

📁 **`tests/products/bop/bop.auth.setup.ts`** (Corrected)
```typescript
import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { log } from '../../../src/helpers/logger';
import { GLOBAL_RUN_CONFIG_FILE } from '../../global.setup';

dotenv.config();

const productName = 'bop';
export const AUTH_FILE = path.join(__dirname, '..', '..', '..', '.auth', `${productName}.state.json`);

setup(`authenticate ${productName}`, async ({ request }) => {
  log.info(`--- Starting Authentication Test for Product: '${productName}' ---`);

  // 1. Load the run configuration created by globalSetup
  if (!fs.existsSync(GLOBAL_RUN_CONFIG_FILE)) {
    throw new Error(`AuthSetup Error: Global run config file not found. Was globalSetup successful?`);
  }
  const runConfig = JSON.parse(fs.readFileSync(GLOBAL_RUN_CONFIG_FILE, 'utf8'));

  const { baseURL, configDetails } = runConfig;
  const productAuthConfig = configDetails.products[productName];

  if (!productAuthConfig) {
    throw new Error(`AuthSetup Error: Auth config for product '${productName}' not found in the resolved configuration.`);
  }

  // 2. Get secrets from .env
  const appId = process.env[productAuthConfig.credential_source.app_id_var];
  const appKey = process.env[productAuthConfig.credential_source.app_key_var];
  const resourceKey = process.env[productAuthConfig.credential_source.resource_key_var];

  if (!appId || !appKey || !resourceKey) {
    throw new Error(`AuthSetup Error: Missing one or more secret environment variables for ${productName}.`);
  }

  // 3. Perform authentication call
  const authResponse = await request.post(`${baseURL}${productAuthConfig.auth_path}`, {
    headers: { 'App_ID': appId, 'App_key': appKey, 'Resource_Key': resourceKey },
  });

  await expect(authResponse, `Auth failed for ${productName}: ${await authResponse.text()}`).toBeOK();
  const token = (await authResponse.json()).access_token;

  // 4. Save the product-specific state file
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ bearerToken: token }));
  log.info(`Authentication for ${productName.toUpperCase()} successful. State file created.`);
});
```
*(Self-correction: I've updated this to read a `credential_source` object from the config, which is a cleaner way to handle different secret variable names per product/partner).*

---

### **Step 3: The `playwright.config.ts` (The Orchestrator)**

This file now correctly wires everything together.

📁 **`playwright.config.ts`** (Corrected and Final)
```typescript
import { defineConfig } from '@playwright/test';
import * as path from 'path';

interface MyProjectOptions {
  productName: string;
}

export default defineConfig<MyProjectOptions>({
  testDir: path.join(__dirname, 'tests'),
  
  // Phase 1: Run the global setup script once before any test workers start.
  globalSetup: require.resolve('./tests/global.setup.ts'),

  // ... (reporter, workers, use, etc.) ...

  // Phase 2: Run the test projects with their defined dependencies.
  projects: [
    // Project A: The "BOP Authentication" TEST.
    {
      name: 'BOP Authentication',
      testMatch: /products\/bop\/bop\.auth\.setup\.ts/,
    },

    // Project B: The main API tests for BOP.
    // This project explicitly depends on the authentication project finishing successfully.
    {
      name: 'bop-api-tests',
      testMatch: /products\/bop\/specs\/.*\.spec\.ts/,
      dependencies: ['BOP Authentication'], // This link is critical
      use: {
        productName: 'bop',
      },
    },

    // ... (You would add similar projects for GL, etc.)
  ],
});
```

### **Summary of the Corrected Architecture**

This structure is now perfectly aligned with Playwright's intended design for complex test suites:

1.  **`globalSetup` (Lifecycle Hook):** Runs first and only once. Its job is configuration parsing. It produces the `.tmp/run_config.json` artifact.
2.  **`BOP Authentication` (Test Project):** Runs next. It's a real test. It consumes `run_config.json` and produces the `.auth/bop.state.json` artifact.
3.  **`bop-api-tests` (Test Project):** Runs last. It is guaranteed by the `dependencies` array to only start after the `BOP Authentication` project has succeeded. Its fixtures consume both `run_config.json` (for the `baseURL`) and `bop.state.json` (for the token).

This model is clean, robust, and correctly separates the concerns, just as you requested. All other files (`test-fixtures.ts`, `test-executor.ts`, etc.) can remain as they were in the last stable version, as they correctly consume the artifacts produced by this setup.