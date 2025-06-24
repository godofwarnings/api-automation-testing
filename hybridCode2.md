# 1

Of course. This is an excellent point. A truly flexible framework should not force a "partner" concept if it's not needed. It should be able to handle simple, direct API testing just as easily.

We can achieve this by creating a "generic" or "default" configuration that doesn't rely on partner-specific files.

Here is how the framework would look and work without the partner-centric structure.

---

### **The "No Partner" Architecture**

The key change is that instead of loading configuration from `config/partners/{partner}.json`, we will load it from a single, environment-specific file.

#### **1. New Configuration Structure**

We'll simplify the `config` directory.

```
config/
├── environments/               # <-- NEW: For environment-specific files
│   ├── sit.config.json
│   └── uat.config.json
└── credentials/
    └── default_creds.json      # Optional, if auth is needed
```

**Example `sit.config.json`:**
This file contains everything needed for the SIT environment.
```json
{
  "environmentName": "SIT",
  "host": "https://api.sit.mycompany.com",
  "auth": {
    "auth_path": "/v2/authenticate",
    "credential_source": "config/credentials/default_creds.json"
  },
  "products": {
    "bop": {
      "version": "1.2.3"
    }
  }
}
```

**Example `default_creds.json`:**
```json
{
  "api": {
    "app_id_var": "DEFAULT_APP_ID",
    "app_key_var": "DEFAULT_APP_KEY"
  }
}
```

#### **2. Update `global.setup.ts` to Remove Partner Logic**

The global setup no longer needs to parse a `--partner` argument. It only needs `--env`.

📁 **`tests/global.setup.ts`** (Updated for No-Partner model)
```typescript
import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import * as dotenv from 'dotenv';

dotenv.config();
export const GLOBAL_RUN_CONFIG_FILE = path.join(__dirname, '..', '.tmp', 'run_config.json');

async function globalSetup(config: FullConfig) {
  console.log('--- Running Global Setup (No-Partner Mode) ---');

  // 1. Parse ONLY the --env argument
  const argv = await yargs(hideBin(process.argv)).options({
    env: { type: 'string', demandOption: true, description: 'Target environment (e.g., sit, uat)' },
  }).argv;
  const { env } = argv;
  
  process.env.ENV = env; // Set for test workers

  // 2. Load the environment-specific configuration file
  const envConfigPath = path.join(__dirname, '..', 'config', 'environments', `${env}.config.json`);
  if (!fs.existsSync(envConfigPath)) {
    throw new Error(`GlobalSetup Error: Environment config not found at ${envConfigPath}`);
  }
  const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));

  // 3. Create the consolidated run config object
  // Note: There is no 'partner' key anymore.
  const runConfig = {
    currentEnv: env,
    baseURL: envConfig.host,
    configDetails: envConfig, // Store the full config for use in headers, etc.
  };

  // 4. Save the config to the temporary file
  fs.mkdirSync(path.dirname(GLOBAL_RUN_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(GLOBAL_RUN_CONFIG_FILE, JSON.stringify(runConfig, null, 2));

  console.log(`Global setup complete. Config saved for Env: '${env}'.`);
}

export default globalSetup;
```

#### **3. Update `package.json` with Simpler Scripts**

The `npm` scripts no longer need to pass a partner.

📁 **`package.json`** (Updated scripts)
```json
  "scripts": {
    "// --- BOP Product Tests (No Partner) ---": "",
    "test:bop:sit": "cross-env ENV=sit playwright test --project=bop-api-tests",
    "test:bop:uat": "cross-env ENV=uat playwright test --project=bop-api-tests",

    "// --- Tagged Runs ---": "",
    "test:bop:sit:smoke": "npm run test:bop:sit -- --grep @smoke",
    
    "// --- Other scripts ---": "..."
  },
```

---

### **Example: A Flow Without a Partner**

Here is how a simple "Get Product Version" flow would look. Notice how the YAML and parameter files are cleaner and don't mention a partner.

#### **YAML Flow File**

📁 `flows/api/get_product_version.flow.yml`
```yaml
flow_id: "GET_BOP_PRODUCT_VERSION"
description: "Retrieves the current version of the BOP product API"
tags: ["@smoke"]

steps:
  - step_id: "get_version"
    description: "Fetch version info using a dynamic header"
    function: "standard.api.sendRequest"
    parameters_file: "params/api/get_version_params.json"
```

#### **Parameter File**

This file now uses a simpler `sourcePath` for the dynamic header, as it's reading from the `env.config.json` file.

📁 `params/api/get_version_params.json`
```json
{
  "endpoint": "/v1/bop/version",
  "method": "GET",
  "contextual_headers": [
    {
      "key": "X-API-Version",
      "sourcePath": "config.configDetails.products.bop.version"
    }
  ],
  "expected": {
    "status": 200,
    "body": {
      "should_contain_key": "version"
    }
  }
}
```

#### **How it Works**

1.  **Run Command:** You run `npm run test:bop:sit`.
2.  **`globalSetup`:** It runs, parses `--env=sit`, loads `config/environments/sit.config.json`, and saves it to `.tmp/run_config.json`.
3.  **Authentication (if needed):** The auth setup test would run, reading `run_config.json` to get the `auth_path` and `credential_source`.
4.  **Test Execution:** The `get_version` step runs.
5.  **Header Generation (`sendRequest`):**
    *   It loads `run_config.json`.
    *   It sees the `contextual_headers` block.
    *   It resolves the `sourcePath`: `config.configDetails.products.bop.version`.
    *   `config.configDetails` points to the entire content of `sit.config.json`.
    *   It traverses the path and finds the value `"1.2.3"`.
    *   It creates the header `X-API-Version: 1.2.3`.
6.  The request is sent, and the test completes.

This demonstrates that the framework is fully capable of operating without the partner-centric design. By simply changing the configuration structure and adjusting the `global.setup.ts` to read from a different file structure, the rest of the engine (fixtures, orchestrator, functions) adapts seamlessly. This proves the flexibility of the abstracted design.


# 2

That is the perfect follow-up question. It addresses the core of how to make the framework flexible enough to handle both scenarios: partner-specific and non-partner-specific test runs, without needing two different frameworks.

The solution is to make the "partner" concept a **pluggable configuration layer** that is loaded *on top of* the base environment configuration. The framework will be smart enough to detect whether a partner is specified and merge the configurations accordingly.

---

### **The Hybrid Configuration Architecture**

We will support both modes by introducing a clear hierarchy:

1.  **Base Environment Config:** A file like `config/environments/sit.config.json` provides the default settings for the SIT environment (e.g., the default host, default API versions).
2.  **Partner Override Config:** A file like `config/partners/partner_a.json` provides settings that are **specific to Partner A**. This file can override the base settings or add new ones.

The framework will merge these two configurations at runtime, with **partner-specific values taking precedence.**

---

### **Step 1: The Updated Configuration Structure**

Let's define what these files would look like.

📁 **`config/environments/sit.config.json` (The Base/Default)**
```json
{
  "environmentName": "SIT",
  "host": "https://api.sit.mycompany.com",
  "products": {
    "bop": {
      "version": "1.2.3",
      "auth_path": "/v2/authenticate"
    },
    "gl": {
      "version": "2.5.0",
      "auth_path": "/v2/gl/auth"
    }
  }
}
```

📁 **`config/partners/partner_a.json` (The Override)**
This file only needs to contain what is *different* for Partner A.
```json
{
  "partnerName": "Partner A",
  "partnerId": "P-001",
  "host": "https://partnerA.api.sit.mycompany.com",
  "products": {
    "bop": {
      "version": "1.2.5-beta",
      "credential_source": "config/credentials/partner_a_creds.json"
    }
  }
}
```

---

### **Step 2: Update `global.setup.ts` to Handle Merging**

This is the core of the implementation. `global.setup.ts` will now conditionally load and merge the partner config if a `--partner` argument is provided.

📁 **`tests/global.setup.ts`** (Updated for Hybrid Mode)
```typescript
import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import * as dotenv from 'dotenv';
import { merge } from 'lodash'; // A powerful library for deep merging objects

dotenv.config();
export const GLOBAL_RUN_CONFIG_FILE = path.join(__dirname, '..', '.tmp', 'run_config.json');

// We need to install lodash for its powerful deep merge capability
// Run: npm install lodash @types/lodash
async function globalSetup(config: FullConfig) {
  console.log('--- Running Global Setup (Hybrid Mode) ---');

  // 1. Parse arguments. --partner is now OPTIONAL.
  const argv = await yargs(hideBin(process.argv)).options({
    env: { type: 'string', demandOption: true },
    partner: { type: 'string' }, // No longer demandOption
  }).argv;
  const { env, partner } = argv;
  
  process.env.ENV = env;
  if (partner) process.env.PARTNER = partner;

  // 2. Load the BASE environment configuration
  const envConfigPath = path.join(__dirname, '..', 'config', 'environments', `${env}.config.json`);
  if (!fs.existsSync(envConfigPath)) {
    throw new Error(`GlobalSetup Error: Base environment config not found at ${envConfigPath}`);
  }
  let finalConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));

  // 3. Conditionally load and MERGE the partner configuration
  if (partner) {
    console.log(`Partner specified: '${partner}'. Loading partner override configuration.`);
    const partnerConfigPath = path.join(__dirname, '..', 'config', 'partners', `${partner}.json`);
    if (fs.existsSync(partnerConfigPath)) {
      const partnerConfig = JSON.parse(fs.readFileSync(partnerConfigPath, 'utf8'));
      
      // Deep merge the partner config on top of the base env config.
      // Partner values will overwrite base values.
      finalConfig = merge(finalConfig, partnerConfig);
    } else {
      console.warn(`Warning: Partner '${partner}' was specified, but config file not found at ${partnerConfigPath}. Using base config only.`);
    }
  } else {
    console.log("No partner specified. Using base environment configuration.");
  }

  // 4. Create the consolidated run config object
  const runConfig = {
    currentEnv: env,
    currentPartner: partner || 'default', // Note the partner name, or 'default'
    baseURL: finalConfig.host, // This will be the partner host if it exists, otherwise the base host
    configDetails: finalConfig, // Store the final, merged config
  };

  // 5. Save the final config to the temporary file
  fs.mkdirSync(path.dirname(GLOBAL_RUN_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(GLOBAL_RUN_CONFIG_FILE, JSON.stringify(runConfig, null, 2));

  console.log(`Global setup complete. Final configuration saved.`);
}

export default globalSetup;
```

**Important:** You will need to install `lodash` for this to work.
```bash
npm install lodash
npm install --save-dev @types/lodash
```

---

### **How it Works in Practice**

Let's see what `runConfig.configDetails` looks like in different scenarios for the `sit` environment.

**Scenario 1: Running WITHOUT a partner**
*   **Command:** `npm run test:bop:sit`
*   **`global.setup.ts`** loads only `sit.config.json`.
*   **Final `baseURL`:** `https://api.sit.mycompany.com`
*   **Final BOP version:** `1.2.3`

**Scenario 2: Running WITH Partner A**
*   **Command:** `npm run test:bop:sit:partner_a`
*   **`global.setup.ts`** first loads `sit.config.json`, then loads `partner_a.json` and deep merges it on top.
*   **The `merge` result:**
    ```json
    {
      "environmentName": "SIT",
      "host": "https://partnerA.api.sit.mycompany.com", // <-- Overridden by partner config
      "partnerName": "Partner A", // <-- Added by partner config
      "partnerId": "P-001",       // <-- Added by partner config
      "products": {
        "bop": {
          "version": "1.2.5-beta", // <-- Overridden by partner config
          "auth_path": "/v2/authenticate", // <-- Inherited from base config
          "credential_source": "config/credentials/partner_a_creds.json" // <-- Added by partner config
        },
        "gl": { // <-- Entire object inherited from base config
          "version": "2.5.0",
          "auth_path": "/v2/gl/auth"
        }
      }
    }
    ```
*   **Final `baseURL`:** `https://partnerA.api.sit.mycompany.com`
*   **Final BOP version:** `1.2.5-beta`

**How does this affect the rest of the framework?**

It doesn't! The beauty of this design is that the rest of the framework (`auth.setup.ts`, fixtures, `test-executor.ts`) only ever reads from the final, merged `run_config.json`. They don't need to know or care whether a partner was specified or not. They just access the final values.

For example, when a dynamic header looks for `config.configDetails.products.bop.version`, it will automatically get `1.2.5-beta` if running with Partner A, and `1.2.3` if running without. The system is completely seamless.
