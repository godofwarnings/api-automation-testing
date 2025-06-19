Okay, this is a critical optimization and a common requirement for performance and consistency, especially when running tests in parallel.

You've highlighted two key areas:
1.  **Efficient Configuration Loading:** Loading environment and partner configurations *once* per test run, rather than redundantly in every test's fixture.
2.  **Smart Header Generation:** Dynamically injecting common headers (like `PartnerId`, `Api-Version`, `Env`) based on the loaded configuration and runtime context, while still allowing explicit headers.

Let's break down the plan for each and then provide the updated code.

---

### **Part 1: Efficient Configuration Loading (Global Setup for Context)**

The current approach of loading `config/partners/{partner}.json` in *every* `authedRequest` fixture instance (which means once per test) is inefficient. When running tests in parallel, this means many file reads and JSON parses.

**The Solution:** Use Playwright's `globalSetup` to load the configuration *once* at the very start of the entire test runner process and make it available globally.

**How Playwright Global Setup Works:**
*   A `globalSetup.ts` file runs **once** before all tests.
*   It can parse command-line arguments (e.g., `--env`, `--partner`).
*   It can load configuration files.
*   It can perform actions like setting environment variables (`process.env`) or writing a shared context file (like `.auth/state.json`) that can then be accessed by individual test processes.

**Our Approach:**
1.  **`globalSetup.ts`**: This file will be responsible for:
    *   Parsing `--env` and `--partner` CLI arguments (from the `npm run` command).
    *   Loading the specific `config/partners/{partner}.json` file.
    *   **Saving this entire parsed configuration object to a temporary file** (e.g., `.tmp/run_config.json`).
    *   Setting `process.env.PLAYWRIGHT_CURRENT_PARTNER` and `process.env.PLAYWRIGHT_CURRENT_ENV` (for explicit global access).
2.  **`auth.setup.ts`**: This script will **still run per product**, but it will now read the pre-loaded `run_config.json` instead of loading `partner.json` itself. This means it only needs to parse a small file (the `run_config`) and perform the authentication.
3.  **`test-fixtures.ts`**: The `authedRequest` fixture will also read the pre-loaded `run_config.json` to get the `baseURL` and any other config values needed for dynamic headers.

---

### **Part 2: Smart Header Generation**

This is a common pattern: some headers are static (e.g., `Content-Type`), while others need to be dynamically populated from the test's context.

**The Solution:**
1.  **Update `TestCase` Interface:** Modify `TestCase` to allow two types of `headers`:
    *   A simple key-value object (`Record<string, string>`) for static headers.
    *   An array of `ContextualHeader` objects for dynamic headers.
2.  **New `ContextualHeader` Interface:** This object will specify a `key` and a `sourcePath` (e.g., `flow.partnerId`, `env.apiVersion`, `env.currentEnvName`).
3.  **Enhance `sendRequest`:** Before sending the request, `sendRequest` will iterate through the `headers` field.
    *   For static headers, it adds them directly.
    *   For dynamic headers, it uses our existing `getValueFromObject` and the globally loaded `run_config.json` to fetch the correct value and add it to the headers.

---

### **Step-by-Step Code Implementation**

#### **Step 0: New `tmp` Directory and `.gitignore`**

Create a temporary directory for our global config file.
```bash
mkdir .tmp
```
Add it to `.gitignore`:
📁 **`.gitignore`** (add this line)
```
.tmp/
```

#### **Step 1: Create `global.setup.ts` (The Orchestrator)**

This file runs once at the very beginning.

📁 **`tests/global.setup.ts`** (New File)
```typescript
import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import * as dotenv from 'dotenv';

dotenv.config(); // Load .env for secrets

// Path to the global config file for this test run
export const GLOBAL_RUN_CONFIG_FILE = path.join(__dirname, '..', '.tmp', 'run_config.json');

async function globalSetup(config: FullConfig) {
  console.log('Running Playwright global setup...');

  // 1. Parse CLI arguments for environment and partner
  const argv = await yargs(hideBin(process.argv)).options({
    env: { type: 'string', demandOption: true, description: 'Target environment (e.g., sit, uat)' },
    partner: { type: 'string', demandOption: true, description: 'Partner code (e.g., partner_a, httpbin_partner)' },
  }).argv;

  const { env, partner } = argv;
  
  // Set these as environment variables for easier access by non-Playwright code if needed
  process.env.PLAYWRIGHT_CURRENT_ENV = env;
  process.env.PLAYWRIGHT_CURRENT_PARTNER = partner;

  // 2. Load the specific partner configuration file
  const partnerConfigPath = path.join(__dirname, '..', 'config', 'partners', `${partner}.json`);
  if (!fs.existsSync(partnerConfigPath)) {
    throw new Error(`Partner config not found: ${partnerConfigPath}`);
  }
  const partnerConfig = JSON.parse(fs.readFileSync(partnerConfigPath, 'utf8'));

  // 3. Extract environment details for the selected environment
  const envDetails = partnerConfig.environments[env];
  if (!envDetails) {
    throw new Error(`Environment '${env}' not found in partner config: ${partnerConfigPath}`);
  }

  // 4. Create a consolidated run config object to save globally
  const runConfig = {
    currentEnv: env,
    currentPartner: partner,
    baseURL: envDetails.host, // This is the host for the current env/partner
    partnerDetails: partnerConfig, // Store the full partner config
  };

  // 5. Save this consolidated config to a temporary file
  fs.mkdirSync(path.dirname(GLOBAL_RUN_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(GLOBAL_RUN_CONFIG_FILE, JSON.stringify(runConfig, null, 2));

  console.log(`Global setup complete. Config saved to ${GLOBAL_RUN_CONFIG_FILE}`);
}

export default globalSetup;
```

#### **Step 2: Update `playwright.config.ts`**

Point to the new `global.setup.ts`.

📁 **`playwright.config.ts`** (Updated)
```typescript
import { defineConfig } from '@playwright/test';
import * as path from 'path';

// --- Interface for custom project options (Unchanged) ---
interface MyProjectOptions {
  productName: string;
}

export default defineConfig<MyProjectOptions>({
  testDir: path.join(__dirname, 'tests'),

  // --- Point to the new global setup file ---
  globalSetup: require.resolve('./tests/global.setup.ts'),

  // ... (reporter, retries, etc. remain the same) ...

  projects: [
    // --- Authentication Projects (No changes needed) ---
    { name: 'BOP Authentication', testMatch: /products\/bop\/bop\.auth\.setup\.ts/ },
    { name: 'GL Authentication', testMatch: /products\/gl\/gl\.auth\.setup\.ts/ },

    // --- API Test Projects (Unchanged) ---
    {
      name: 'bop-api-tests',
      testMatch: /products\/bop\/specs\/.*\.spec\.ts/,
      dependencies: ['BOP Authentication'],
      use: { productName: 'bop' },
    },
    {
      name: 'gl-api-tests',
      testMatch: /products\/gl\/specs\/.*\.spec\.ts/,
      dependencies: ['GL Authentication'],
      use: { productName: 'gl' },
    },
  ],
});
```

#### **Step 3: Update Auth Setup Script**

It will now read the pre-loaded `run_config.json`.

📁 **`tests/products/bop/bop.auth.setup.ts`** (Updated)
```typescript
import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
// No need for yargs or dotenv here if `global.setup.ts` handles it
// import yargs from 'yargs/yargs'; // REMOVE
// import { hideBin } from 'yargs/helpers'; // REMOVE
// import * as dotenv from 'dotenv'; // REMOVE if only used for CLI args parsing

import { GLOBAL_RUN_CONFIG_FILE } from '../../global.setup'; // <-- NEW IMPORT

const productName = 'bop';
export const AUTH_FILE = path.join(__dirname, '..', '..', '..', '.auth', `${productName}.state.json`);

setup(`authenticate ${productName}`, async ({ request }) => {
  console.log(`Running authentication setup for product: ${productName}`);

  // 1. Load the global run configuration (already parsed by globalSetup)
  if (!fs.existsSync(GLOBAL_RUN_CONFIG_FILE)) {
    throw new Error(`Global run config file not found: ${GLOBAL_RUN_CONFIG_FILE}. Was globalSetup successful?`);
  }
  const runConfig = JSON.parse(fs.readFileSync(GLOBAL_RUN_CONFIG_FILE, 'utf8'));

  const env = runConfig.currentEnv;
  const partner = runConfig.currentPartner;
  const partnerConfig = runConfig.partnerDetails; // Access the full partner config

  const envDetails = partnerConfig.environments[env];
  const productAuthConfig = partnerConfig.products[productName];

  if (!envDetails) throw new Error(`Environment '${env}' not found in partner config.`);
  if (!productAuthConfig) throw new Error(`Auth config for product '${productName}' not found.`);

  const baseUrl = envDetails.host;

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
```

#### **Step 4: Update the Fixture to Load Global Config and Generate Smart Headers**

This is where the magic happens for both efficient loading and smart headers.

📁 **`src/helpers/test-fixtures.ts`** (Updated `authedRequest` fixture)
```typescript
import { test as baseTest, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { GLOBAL_RUN_CONFIG_FILE } from '../../tests/global.setup'; // <-- NEW IMPORT
import { AUTH_FILE } from '../../tests/products/bop/bop.auth.setup'; // Example: Need to import AUTH_FILE paths for each product or define generically

// It's better to make AUTH_FILE path dynamic based on productName
function getAuthFilePath(productName: string): string {
  // Assuming .auth is at project root
  return path.join(__dirname, '..', '..', '.auth', `${productName}.state.json`);
}

// Interface for custom project options (unchanged)
interface MyProjectOptions {
  productName: string;
}

// Extend the base Playwright test object
export const test = baseTest.extend<
  { authedRequest: APIRequestContext }, // MyFixtures
  MyProjectOptions // MyProjectOptions
>({
  authedRequest: async ({ playwright }, use, testInfo) => {
    // 1. Get configuration context
    const productName = testInfo.project.use.productName;
    if (!productName) {
      throw new Error(`Project '${testInfo.project.name}' is missing 'productName' in playwright.config.ts.`);
    }

    // 2. Load the global run configuration (once per test worker, but from a file)
    if (!fs.existsSync(GLOBAL_RUN_CONFIG_FILE)) {
      throw new Error(`Global run config file not found: ${GLOBAL_RUN_CONFIG_FILE}. Was globalSetup successful?`);
    }
    const runConfig = JSON.parse(fs.readFileSync(GLOBAL_RUN_CONFIG_FILE, 'utf8'));

    const baseUrl = runConfig.baseURL;
    const currentEnv = runConfig.currentEnv;
    const currentPartner = runConfig.currentPartner;
    const partnerDetails = runConfig.partnerDetails; // Full partner config available

    // 3. Load Authentication State for the specific product
    const authFile = getAuthFilePath(productName); // Dynamically get path
    if (!fs.existsSync(authFile)) {
      throw new Error(`Auth file not found for product '${productName}': ${authFile}. Did its auth setup project run?`);
    }
    const authState = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const token = authState.bearerToken;

    // 4. Create an enhanced context object for header resolution
    const headerContext = {
      config: runConfig, // Access to full run config, including partnerDetails
      env: { // Provide direct access to env/partner details for convenience
        name: currentEnv,
        partner: currentPartner,
        host: baseUrl,
        // Add other common properties here if needed, e.g., current timestamp
      },
      product: { // Product-specific config can also be passed if desired
        name: productName,
        // e.g., productSpecificVersion: partnerDetails.products[productName].version,
      },
    };

    // 5. Extend baseTest.request with our custom headers function
    const customRequest = playwright.request.extend({
      baseURL: baseUrl,
      extraHTTPHeaders: {
        'Authorization': `Bearer ${token}`,
      },
      // You can add other global headers here if they apply to ALL requests from this fixture.
      // E.g., 'Accept': 'application/json',
    });

    // Provide the extended request context
    await use(customRequest);
  },
});

export { expect };
```

#### **Step 5: Update `TestCase` Interface and `sendRequest` in `test-executor.ts`**

This is where we handle the new header formats.

📁 **`src/core/test-executor.ts`** (Updated `TestCase` and `sendRequest`)
```typescript
import { test, expect } from '@/helpers/test-fixtures';
import { APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';
import { v4 as uuidv4 } from 'uuid';

// --- NEW INTERFACES FOR HEADERS ---
interface ContextualHeader {
  key: string;
  sourcePath: string; // e.g., "config.partnerDetails.products.bop.version" or "env.name"
}

interface TestCase {
  test_id: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  // Headers can now be a simple object OR an array of ContextualHeader objects
  headers?: Record<string, string> | ContextualHeader[];
  payload?: any;
  auth: 'none' | 'bearer';
}
interface ExpectedOutput { /* ... */ }
interface FlowStep extends TestCase { /* ... */ }
interface ApiFlow { /* ... */ }

// ... (All other functions like executeApiTests, executeApiFlows, tryParseJson,
// assertBody, assertHeaders, etc. remain the same) ...

// --- Helper Functions (Updated) ---
// Add the getValueFromObject function here again (it's crucial for headers too)
function getValueFromObject(obj: any, path: string): any {
  // ... (The robust getValueFromObject with array querying support) ...
  // (Paste the complete function from the previous good version here)
  const segmentRegex = /^(\w+\[\w+=\w+\]|\[\w+=\w+\])|(\w+)/;
  const arrayQueryParser = /(\w+)\[(\w+)=(\w+)\]/;
  
  let currentContext = obj;
  let remainingPath = path;

  while (remainingPath.length > 0 && currentContext !== undefined) {
    const match = remainingPath.match(segmentRegex);
    if (!match) {
      return undefined;
    }

    const [fullMatch, arrayQuerySegment, simpleKeySegment] = match;

    if (arrayQuerySegment) {
      const queryParts = arrayQuerySegment.match(arrayQueryParser);
      if (!queryParts) return undefined;
      
      const [, arrayKey, queryField, queryValue] = queryParts;
      
      const targetArray = currentContext[arrayKey];
      if (!Array.isArray(targetArray)) {
        console.warn(`[getValueFromObject] Path '${arrayKey}' did not resolve to an array for query.`);
        return undefined;
      }

      currentContext = targetArray.find(item => 
        item && typeof item === 'object' && String(item[queryField]) === queryValue
      );
      
      if (!currentContext) { // If object not found in array
          return undefined;
      }

    } else if (simpleKeySegment) {
      currentContext = currentContext[simpleKeySegment];
    }
    
    remainingPath = remainingPath.substring(fullMatch.length).replace(/^\./, '');
  }

  return currentContext;
}

/**
 * Prepares and sends the API request, now with smart header generation.
 */
async function sendRequest(request: APIRequestContext, testCase: TestCase): Promise<APIResponse> {
  const { method, endpoint, headers: rawHeaders, payload: rawPayload } = testCase;
  const finalHeaders: Record<string, string> = {}; // Collect all headers here

  // 1. Retrieve the global run configuration
  if (!fs.existsSync(GLOBAL_RUN_CONFIG_FILE)) {
    throw new Error(`Global run config file not found for header generation: ${GLOBAL_RUN_CONFIG_FILE}`);
  }
  const runConfig = JSON.parse(fs.readFileSync(GLOBAL_RUN_CONFIG_FILE, 'utf8'));
  const headerContext = {
    config: runConfig,
    env: {
      name: runConfig.currentEnv,
      partner: runConfig.currentPartner,
      host: runConfig.baseURL,
    },
    product: {
      name: testCase.productName, // If product name is available on testCase
    },
  };

  // 2. Process headers
  if (rawHeaders) {
    if (Array.isArray(rawHeaders)) {
      // Headers are defined as an array of ContextualHeader
      for (const header of rawHeaders) {
        const value = getValueFromObject(headerContext, header.sourcePath);
        if (value !== undefined) {
          finalHeaders[header.key] = String(value);
        } else {
          console.warn(`[Header Gen] Could not resolve header '${header.key}' from path '${header.sourcePath}'.`);
          // Decide if this should throw an error or just omit the header
          // For now, it will be omitted.
        }
      }
    } else {
      // Headers are a simple key-value object (Record<string, string>)
      Object.assign(finalHeaders, rawHeaders);
    }
  }

  // 3. Process payload (unchanged)
  let payload = rawPayload;
  if (typeof payload === 'string' && payload.startsWith('file://')) {
    const filePath = path.join(process.cwd(), payload.replace('file://', ''));
    if (!fs.existsSync(filePath)) throw new Error(`Payload file not found: ${filePath}`);
    payload = fs.readFileSync(filePath, 'utf-8');
  }

  const options: { headers: any; data?: any; jsonData?: any; } = { headers: finalHeaders };
  const contentType = finalHeaders['Content-Type'] || finalHeaders['content-type'] || '';

  // ... (rest of sendRequest logic, unchanged for payload processing) ...
  if (method === 'GET' || method === 'DELETE') { /* ... */ }
  else if (payload !== undefined && payload !== null) { /* ... */ }

  await allure.step(`[Action] Sending ${method} request to ${endpoint}`, async () => { /* ... */ });
  const response = await request[method.toLowerCase() as 'post'](endpoint, options);
  await allure.step(`[Result] Received Response (Status: ${response.status()})`, async () => { /* ... */ });

  return response;
}
```

### **How to Use Smart Headers in Your YAML**

Now, in your YAML files, you can define headers like this:

**Option A: Static Headers Only**
```yaml
headers:
  Content-Type: "application/json"
  X-Request-Source: "Automation Framework"
```

**Option B: Dynamic Headers Only**
```yaml
headers:
  - key: "X-Partner-ID"
    sourcePath: "config.partnerDetails.id" # Assuming partnerDetails.id exists in your partner JSON
  - key: "X-API-Version"
    sourcePath: "config.partnerDetails.products.bop.apiVersion" # Example: API version in partner JSON
  - key: "X-Environment"
    sourcePath: "env.name" # Using the simplified 'env' context
  - key: "Content-Type"
    sourcePath: "product.contentType" # Or define directly as "application/json"
```

**Option C: Mixed (Not directly supported by `TestCase` type, requires manual merge)**
The