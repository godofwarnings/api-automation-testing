You are absolutely right. I have been making too many assumptions about a mandatory authentication flow. A truly generic framework must handle all scenarios gracefully, including:

1.  Flows that require **no authentication** at all.
2.  Configuration that can be defined **directly** in a config file or **indirectly** via environment variables loaded from a `.env` file.
3.  The presence or absence of a `baseURL`.

Let's design a final, definitive, and highly flexible configuration model that handles all these cases. This will be our "source of truth" for how the framework loads its context.

---

### **The Game Plan: A Unified and Hierarchical Configuration Resolver**

The core principle will be a **single, unified configuration object** that is built once at the start of a test run. The `global.setup.ts` script is the perfect place for this. It will be responsible for intelligently loading and merging all configuration sources into one predictable object.

**The Hierarchy of Configuration (Order of Precedence):**

1.  **Direct Value in `env.config.json`:** A value defined directly in the environment config file (e.g., `"host": "https://api.sit.com"`) will be used.
2.  **Environment Variable Pointer in `env.config.json`:** If a value in the config file is a string that looks like a variable pointer (e.g., `"host": "SIT_HOST"`), the framework will look for `SIT_HOST` in `process.env` (which has been populated from `.env`).
3.  **Default `.env` File:** This is the ultimate fallback for secrets and environment-specific variables.

The `global.setup.ts` will perform this resolution and save the **final, resolved values** to our `run_config.json` file. The rest of the framework (fixtures, orchestrator) will then just consume this clean, final config without needing to know how it was assembled.

---

### **Step 1: The Configuration Files**

Let's define our files to illustrate the different ways of providing data.

**A. The `.env` File (The Foundation)**
This contains secrets and environment-specific pointers.
```.env
# Default credentials for unauthenticated context
DEFAULT_APP_ID="default-app-123"
DEFAULT_API_KEY="default-secret-key"

# SIT Environment specific variables
SIT_HOST="https://api.sit.mycompany.com"
SIT_API_KEY="sit-specific-secret-key"

# UAT Environment points to a different host
UAT_HOST="https://api.uat.mycompany.com"
```

**B. The Environment Config Files**
These files define the structure for each environment and can either contain direct values or pointers to the `.env` file.

📁 **`config/environments/sit.config.json`**
```json
{
  "environmentName": "SIT",
  "host": "SIT_HOST",
  "auth": {
    "default": {
      "app_id": "DEFAULT_APP_ID",
      "api_key": "SIT_API_KEY"
    }
  }
}
```

📁 **`config/environments/uat.config.json`**
```json
{
  "environmentName": "UAT",
  "host": "UAT_HOST",
  "auth": {
    "default": {
      "app_id": "DEFAULT_APP_ID",
      "api_key": { "from_env": "UAT_API_KEY" } // An even more explicit way to point
    }
  }
}
```

📁 **`config/environments/prod.config.json`**
```json
{
  "environmentName": "PROD",
  "host": "https://api.mycompany.com", // Direct value, no .env pointer
  "auth": {
    "default": {
      // For prod, we demand secrets ONLY from the CI/CD environment
      "app_id": { "from_env": "PROD_APP_ID" },
      "api_key": { "from_env": "PROD_API_KEY" }
    }
  }
}
```

---

### **Step 2: The New, Intelligent `global.setup.ts`**

This script becomes the "Configuration Resolver." It's the only place that knows about `.env` files and pointers.

📁 **`tests/global.setup.ts`** (New, Intelligent Version)
```typescript
import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config(); // Load the .env file into process.env

export const GLOBAL_RUN_CONFIG_FILE = path.join(__dirname, '..', '.tmp', 'run_config.json');

/**
 * A recursive helper to resolve pointers in the config object.
 * If a value is a string and exists as a key in process.env, it's replaced.
 */
function resolveConfigValues(config: any): any {
  if (Array.isArray(config)) {
    return config.map(resolveConfigValues);
  }
  if (typeof config === 'object' && config !== null) {
    // Special check for explicit { "from_env": "VAR_NAME" } syntax
    if (config.from_env && typeof config.from_env === 'string') {
      return process.env[config.from_env] || undefined;
    }
    
    const newConfig: { [key: string]: any } = {};
    for (const key in config) {
      newConfig[key] = resolveConfigValues(config[key]);
    }
    return newConfig;
  }
  if (typeof config === 'string' && process.env[config]) {
    // Implicitly replace string if it matches an env var
    return process.env[config];
  }
  return config; // Return numbers, booleans, and non-matching strings as-is
}


async function globalSetup(config: FullConfig) {
  console.log('--- Running Global Setup: Resolving all configurations ---');

  const argv = await yargs(hideBin(process.argv)).options({
    env: { type: 'string', demandOption: true },
  }).argv;
  const { env } = argv;
  
  process.env.ENV = env;

  // 1. Load the raw environment configuration file
  const envConfigPath = path.join(__dirname, '..', 'config', 'environments', `${env}.config.json`);
  if (!fs.existsSync(envConfigPath)) throw new Error(`Config Error: Env config not found at ${envConfigPath}`);
  const rawConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));

  // 2. Resolve all values by looking them up in process.env
  const resolvedConfig = resolveConfigValues(rawConfig);

  // 3. Create the final, clean run configuration.
  // The rest of the framework will ONLY use this file.
  const runConfig = {
    currentEnv: env,
    // The host is now guaranteed to be the final, resolved value.
    baseURL: resolvedConfig.host, 
    // Pass the entire resolved config for other parts of the framework to use.
    configDetails: resolvedConfig,
  };

  if (!runConfig.baseURL) {
    console.warn("Warning: No 'baseURL' found in the final resolved configuration. API calls will require a full URL.");
  }

  // 4. Save the final config to a temporary file
  fs.mkdirSync(path.dirname(GLOBAL_RUN_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(GLOBAL_RUN_CONFIG_FILE, JSON.stringify(runConfig, null, 2));

  console.log("Global setup complete. Final, resolved configuration has been saved.");
}

export default globalSetup;
```

---

### **How This Solves All Problems**

1.  **No Auth Required? No Problem.**
    *   If a flow doesn't need authentication, it simply won't have an auth step.
    *   Its steps won't specify an `api_context`.
    *   The orchestrator will fall back to using Playwright's default `request` object. This object **can still have a `baseURL`** if it's configured in `playwright.config.ts` by reading from our `run_config.json`.
    *   **The `playwright.config.ts` can be updated:**
        ```typescript
        // In playwright.config.ts
        import { GLOBAL_RUN_CONFIG_FILE } from './tests/global.setup';
        const runConfig = require(GLOBAL_RUN_CONFIG_FILE);

        export default defineConfig({
          use: {
            baseURL: runConfig.baseURL || undefined, // Use the globally resolved baseURL
          },
          // ...
        });
        ```
        This means even unauthenticated requests will go to the correct base URL for the environment.

2.  **Flexible Configuration (Direct vs. `.env`)**
    *   The `resolveConfigValues` helper handles everything automatically.
    *   A user can put `"host": "https://api.prod.com"` for a direct value.
    *   Or they can put `"host": "PROD_HOST"` and define `PROD_HOST` in their `.env` or Jenkins secrets. The framework doesn't care; it gets the final, resolved value either way.

3.  **Optional `baseURL`**
    *   The `globalSetup` script now checks if a `baseURL` was found after resolution.
    *   If not, it issues a warning. API calls will still work, but the `endpoint` in the parameter files will need to be a full URL. The framework doesn't crash.

This new `global.setup.ts` acts as a powerful "Configuration Pre-processor." It takes all the different ways a user can provide configuration and flattens them into a single, simple, fully-resolved `run_config.json`. The rest of the framework becomes much simpler because it only ever has to deal with this final, clean configuration object, completely abstracting away the complexity of how that configuration was sourced.