You are absolutely correct. This is the right direction. My apologies for over-engineering the solution with partner-specific logic and for the confusion around CLI arguments.

Your feedback is crystal clear, and it leads to a much simpler, more robust, and more idiomatic Playwright architecture. Let's implement this correctly, from the ground up.

**The New Principles:**
1.  **Environment is King:** The *only* runtime context we will provide is the target environment (e.g., `sit`, `uat`). There is no `--partner`.
2.  **`cross-env` is the Source of Truth:** We will not use `yargs` or any other CLI parser in our code. The code will *only* read configuration from `process.env` variables set by `npm` scripts using `cross-env`. This is the most reliable method.
3.  **Generic and Independent Fixtures:** The fixtures will be simplified. They will not be coupled to any specific product or partner logic. They will read the environment context and provide the necessary tools (`APIRequestContext`, etc.).
4.  **No Parsing in `globalSetup`:** `globalSetup`'s job is minimal: prepare directories. It will no longer parse arguments.

---

### **The Full Implementation: A Simpler, More Powerful Framework**

#### **Step 1: The New `package.json` Scripts**

This is now the single source of truth for how a test run is configured.

📁 **`package.json`** (Updated `scripts`)
```json
  "scripts": {
    "// --- MAIN TEST COMMANDS ---": "",
    "test:sit": "cross-env ENV=sit playwright test",
    "test:uat": "cross-env ENV=uat playwright test",

    "// --- TAGGED RUNS ---": "",
    "test:sit:smoke": "npm run test:sit -- --grep @smoke",
    "test:uat:regression": "npm run test:uat -- --grep @regression",

    "// --- DEBUGGING: RUN AUTH ONLY ---": "",
    "auth:sit": "cross-env ENV=sit playwright test --project=Authentication",
    "auth:uat": "cross-env ENV=uat playwright test --project=Authentication",
    
    "// --- OTHER SCRIPTS ---": "",
    "generate:datafile": "ts-node scripts/generate-datafile.ts",
    "generate:tests": "ts-node src/core/test-generator.ts",
    "report:allure": "allure generate allure-results --clean -o allure-report && allure open"
  },
```

#### **Step 2: The New Configuration Structure**

We completely eliminate the `/partners` directory.

```
config/
├── environments/
│   ├── sit.config.json
│   └── uat.config.json
└── credentials/
    └── default_creds.json
```

📁 **`config/environments/sit.config.json`**
```json
{
  "environmentName": "SIT",
  "host": "https://api.sit.mycompany.com",
  "auth": {
    "path": "/v2/authenticate",
    "credential_source": "config/credentials/default_creds.json"
  },
  "versions": {
    "bop": "1.2.3",
    "gl": "2.5.0"
  }
}
```

#### **Step 3: The Lean `global.setup.ts`**

This script now has one simple job.

📁 **`tests/global.setup.ts`** (Simplified)
```typescript
import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../src/helpers/logger';

async function globalSetup(config: FullConfig) {
  log.info('--- Running Global Setup ---');
  
  // Create a unique, timestamped directory for this run's artifacts
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  process.env.RUN_TIMESTAMP = runTimestamp; // Make available to logger
  
  const logsDir = path.join(process.cwd(), 'logs', runTimestamp);
  fs.mkdirSync(logsDir, { recursive: true });
  log.info(`Log directory created: ${logsDir}`);
}

export default globalSetup;
```

#### **Step 4: The Generic Authentication Test**

We no longer need product-specific auth setups. One generic authentication project is enough.

📁 **`tests/auth.setup.ts`** (New/Replaces `bop.auth.setup.ts`)
```typescript
import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { log } from '../src/helpers/logger';

dotenv.config();

// The state file is now generic, not tied to a product
export const AUTH_STATE_FILE = path.join(__dirname, '..', '.auth', 'session.state.json');

setup('Global Authentication', async ({ request }) => {
  log.info('--- Starting Global Authentication Test ---');
  
  const env = process.env.ENV;
  if (!env) throw new Error('AuthSetup Error: ENV environment variable must be set.');

  const envConfigPath = path.join(__dirname, '..', 'config', 'environments', `${env}.config.json`);
  if (!fs.existsSync(envConfigPath)) throw new Error(`AuthSetup Error: Env config not found: ${envConfigPath}`);
  
  const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
  const baseUrl = envConfig.host;
  const authConfig = envConfig.auth;

  const credsPath = path.join(__dirname, '..', authConfig.credential_source);
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

  const appId = process.env[creds.api.app_id_var];
  const appKey = process.env[creds.api.app_key_var];

  const response = await request.post(`${baseUrl}${authConfig.path}`, {
    data: { app_id: appId, app_key: appKey },
  });

  await expect(response, `Authentication failed: ${await response.text()}`).toBeOK();
  const token = (await response.json()).access_token;

  fs.mkdirSync(path.dirname(AUTH_STATE_FILE), { recursive: true });
  fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify({ bearerToken: token }));
  log.info('Global authentication successful. Session state saved.');
});
```

#### **Step 5: The New `playwright.config.ts`**

This orchestrates the new, simpler structure.

📁 **`playwright.config.ts`** (Updated)
```typescript
import { defineConfig } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  globalSetup: require.resolve('./tests/global.setup.ts'),

  // ... reporter, workers, use ...

  projects: [
    // A single, generic Authentication project
    {
      name: 'Authentication',
      testMatch: /auth\.setup\.ts/,
    },

    // Main test project. It depends on the generic auth.
    // We run all API tests together now. We can filter by folder path if needed.
    {
      name: 'api-tests',
      testMatch: /products\/.*\/specs\/.*\.spec\.ts/,
      dependencies: ['Authentication'],
    },
  ],
});
```

#### **Step 6: The New Generic `test-fixtures.ts`**

This is the final piece. The fixture is now clean, generic, and self-reliant.

📁 **`src/helpers/test-fixtures.ts`** (Updated and Simplified)
```typescript
import { test as baseTest, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { log } from './logger';

dotenv.config();

const AUTH_STATE_FILE = path.join(__dirname, '..', '..', '.auth', 'session.state.json');

// No more MyProjectOptions, as we don't need to pass productName
export const test = baseTest.extend<{ authedRequest: APIRequestContext }>({
  authedRequest: async ({ playwright }, use) => {
    const env = process.env.ENV!;
    if (!env) throw new Error("Fixture Error: ENV environment variable is not set.");

    // Load the config file to get the correct baseURL for this test run
    const envConfigPath = path.join(__dirname, '..', '..', 'config', 'environments', `${env}.config.json`);
    const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
    const baseUrl = envConfig.host;

    // Load the generic authentication token
    if (!fs.existsSync(AUTH_STATE_FILE)) {
      throw new Error(`Fixture Error: Auth state file not found at ${AUTH_STATE_FILE}. Did the 'Authentication' project run?`);
    }
    const authState = JSON.parse(fs.readFileSync(AUTH_STATE_FILE, 'utf8'));
    const token = authState.bearerToken;

    log.debug({ env, baseUrl }, "Creating authenticated API context for test.");
    
    // Create the pre-authenticated context
    const context = await playwright.request.newContext({
      baseURL: baseUrl,
      extraHTTPHeaders: {
        'Authorization': `Bearer ${token}`,
      },
    });

    await use(context);
    await context.dispose();
  },
});

export { expect };
```

This architecture is now free of any hard-coded "partner" logic. It is driven purely by the `ENV` variable set in your `npm` scripts, making it leaner, more generic, and easier to understand and maintain. All previous features like dynamic headers can still work by reading from the loaded `envConfig` object.
