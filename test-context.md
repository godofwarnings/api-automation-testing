You are absolutely right. I apologize for pushing a different architecture. It's crucial that the framework conforms to the design you are comfortable with and find most logical.

Let's revert completely and work from the stable base you requested: **authentication happens per-product, run as a Playwright project, and it exports an auth file.**

Now, let's solve your very valid dilemma—the redundant loading of configuration files—*within that specific architecture*.

### The Solution: A Singleton "Context Provider" (Parallel-Safe)

We can solve the DRY (Don't Repeat Yourself) problem perfectly without `globalSetup` by using a **singleton** pattern. We will create a single module responsible for loading the configuration. The first time it's called *within any given test worker process*, it will read the file from disk and cache the result in memory. All subsequent calls in that same worker will get the cached data instantly.

This is **efficient and parallel-safe** because each parallel worker runs in its own process and will get its own in-memory cache of the configuration.

Here is the complete implementation of this robust and clean solution.

---

### **Step 1: Create the `ContextProvider` Helper**

This is the new single source of truth for configuration.

📁 **`src/helpers/context-provider.ts`** (New File)
```typescript
import * as fs from 'fs';
import * as path from 'path';

// This variable will hold our configuration in memory for a given worker process.
let loadedRunConfig: any = null;

/**
 * The single source of truth for the test run's configuration.
 * It is a singleton per worker process. It determines the context from
 * environment variables and loads the partner config file only once.
 */
export function getRunContext() {
  // If the config hasn't been loaded in this worker process yet...
  if (loadedRunConfig === null) {
    const env = process.env.ENV;
    const partner = process.env.PARTNER;

    if (!env || !partner) {
      throw new Error("FATAL: The ENV and PARTNER environment variables must be set. Run tests via npm scripts.");
    }

    console.log(`[ContextProvider] First call in this worker. Loading config for Env: '${env}', Partner: '${partner}'`);

    const partnerConfigPath = path.join(process.cwd(), 'config', 'partners', `${partner}.json`);
    if (!fs.existsSync(partnerConfigPath)) {
      throw new Error(`Partner configuration file not found: ${partnerConfigPath}`);
    }
    
    const partnerConfig = JSON.parse(fs.readFileSync(partnerConfigPath, 'utf8'));
    const envDetails = partnerConfig.environments[env];
    if (!envDetails) {
      throw new Error(`Environment '${env}' not found in partner config.`);
    }

    // Cache the loaded and resolved configuration in memory
    loadedRunConfig = {
      currentEnv: env,
      currentPartner: partner,
      baseURL: envDetails.host,
      partnerDetails: partnerConfig,
    };
  }
  
  // Return the loaded configuration.
  return loadedRunConfig;
}
```

---

### **Step 2: Update the Per-Product Auth Setup**

This script becomes much cleaner. It no longer reads files itself; it just asks the `ContextProvider` for the config.

📁 **`tests/products/bop/bop.auth.setup.ts`** (Updated)
```typescript
import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { getRunContext } from '../../../src/helpers/context-provider'; // <-- USE THE SINGLE SOURCE OF TRUTH

const productName = 'bop';
export const AUTH_FILE = path.join(__dirname, '..', '..', '..', '.auth', `${productName}.state.json`);

setup(`authenticate ${productName}`, async ({ request }) => {
  // 1. Get the configuration from our singleton context provider
  const runContext = getRunContext();
  const { currentEnv, currentPartner, baseURL, partnerDetails } = runContext;
  
  console.log(`[Auth Setup] Running for Product='${productName}', Env='${currentEnv}', Partner='${currentPartner}'`);

  const productAuthConfig = partnerDetails.products[productName];
  if (!productAuthConfig) throw new Error(`Auth config for '${productName}' not found in partner config.`);

  // 2. Look up secrets
  const appId = process.env[productAuthConfig.app_id_var];
  const appKey = process.env[productAuthConfig.app_key_var];
  const resourceKey = process.env[productAuthConfig.resource_key_var];

  // 3. Authenticate
  const response = await request.post(`${baseURL}${productAuthConfig.auth_path}`, {
    headers: { 'App_ID': appId, 'App_key': appKey, 'Resource_Key': resourceKey },
  });

  // 4. Save state
  await expect(response, `Auth failed for ${productName}: ${await response.text()}`).toBeOK();
  const token = (await response.json()).access_token;
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ bearerToken: token }));
});
```

---

### **Step 3: Update the Test Fixture**

The `authedRequest` fixture also uses the `ContextProvider`.

📁 **`src/helpers/test-fixtures.ts`** (Updated)
```typescript
import { test as baseTest, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { getRunContext } from './context-provider'; // <-- USE THE SINGLE SOURCE OF TRUTH

function getAuthFilePath(productName: string): string {
  return path.join(__dirname, '..', '..', '.auth', `${productName}.state.json`);
}

interface MyProjectOptions { productName: string; }

export const test = baseTest.extend<{ authedRequest: APIRequestContext }, MyProjectOptions>({
  authedRequest: async ({ playwright }, use, testInfo) => {
    // 1. Get the configuration from our singleton context provider
    const runContext = getRunContext();
    const { baseURL } = runContext;

    const productName = testInfo.project.use.productName;
    if (!productName) throw new Error(`Project '${testInfo.project.name}' is missing 'productName'.`);

    // 2. Load the auth token for this specific product
    const authFile = getAuthFilePath(productName);
    if (!fs.existsSync(authFile)) throw new Error(`Auth file not found for '${productName}'.`);
    const authState = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const token = authState.bearerToken;

    // 3. Create the pre-authenticated context
    const context = await playwright.request.newContext({
      baseURL: baseURL,
      extraHTTPHeaders: { 'Authorization': `Bearer ${token}` },
    });

    await use(context);
    await context.dispose();
  },
});

export { expect };
```

---

### **Step 4: Update the Test Executor**

The `sendRequest` function will use the `ContextProvider` to get the necessary data for generating dynamic headers.

📁 **`src/core/test-executor.ts`** (Updated `sendRequest`)
```typescript
import { getRunContext } from '@/helpers/context-provider'; // <-- USE THE SINGLE SOURCE OF TRUTH
// ... other imports ...

async function sendRequest(request: APIRequestContext, testCase: TestCase): Promise<APIResponse> {
  const { method, endpoint, headers: staticHeaders, contextual_headers, payload: rawPayload } = testCase;
  const finalHeaders: Record<string, string> = { ...(staticHeaders || {}) };

  // 1. Process dynamic headers using the single source of truth
  if (contextual_headers) {
    const runContext = getRunContext();
    const { currentEnv, currentPartner, partnerDetails } = runContext;

    const headerContext = {
      partnerDetails: partnerDetails,
      env: { name: currentEnv, partner: currentPartner },
    };

    for (const header of contextual_headers) {
      let value: any;
      if (header.sourcePath.startsWith('$dynamic.')) {
        value = generateDynamicData(header.sourcePath);
      } else {
        value = getValueFromObject(headerContext, header.sourcePath);
      }

      if (value !== undefined) {
        finalHeaders[header.key] = String(value);
      } else {
        console.warn(`[Header Gen] Could not resolve '${header.key}' from path '${header.sourcePath}'.`);
      }
    }
  }

  // ... (The rest of the sendRequest function for handling payloads remains unchanged) ...
}

// Ensure all other helper functions are present in this file.
```

### **Summary of the Solution**

*   **Your Preferred Architecture:** We are still using per-product auth projects with dependencies in `playwright.config.ts`. We are **not** using `globalSetup`.
*   **DRY Principle Solved:** The new `ContextProvider` ensures that the logic for finding and parsing the correct partner configuration file is written only once.
*   **Efficient and Parallel-Safe:** Each of the three different places (`auth.setup`, `test-fixtures`, `test-executor`) now simply calls `getRunContext()`. This is fast and safe because the file is only read once per worker process, and the result is cached in memory for that worker.

This solution provides the efficiency and code quality you're looking for while perfectly respecting your desired project structure.
