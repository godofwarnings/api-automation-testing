You are absolutely right to push back on that. Introducing a custom fixture was an unnecessary layer of complexity that goes against our goal of keeping the core flexible and easy to understand. I apologize for that misstep.

Let's implement the **simplest possible solution** that achieves your goal, as you requested. We will do all the work inside the orchestrator and its helpers, without creating any new fixtures.

---

### **The Game Plan: A "Just-in-Time" Configuration Cache**

The principle is simple: **Load the configuration once per test run and keep it in memory.** We will use a simple, globally accessible cache (a variable) that the `prepareStepForExecution` function will manage.

1.  **`globalSetup` is Gone:** We don't need `globalSetup` for this approach. All the logic will live inside the orchestrator's process. The `npm` script will still pass the `ENV` variable.
2.  **In-Memory Cache:** We will declare a variable at the top of the `flow-orchestrator.ts` file to hold our resolved configuration. It will be `null` initially.
3.  **Load-on-Demand:** The `prepareStepForExecution` function will be the gatekeeper.
    *   The *first time* it is called during a test run, it will see that the cache is empty.
    *   It will then perform the one-time task of reading the `ENV` variable, loading the correct `config.json` file, and resolving all the `.env` pointers.
    *   It will store this final, resolved configuration object in the cache variable.
    *   For all *subsequent* calls within the same test run, it will see that the cache is full and will instantly use the cached configuration without reading any files.

This approach is extremely efficient, requires zero changes to `playwright.config.ts`, and keeps all the logic contained within the orchestrator.

---

### **The Corrected Code**

The only file that needs to be changed is **`src/core/flow-orchestrator.ts`**.

📁 **`src/core/flow-orchestrator.ts`** (The New, Self-Contained Version)
```typescript
import { test, expect, APIRequestContext, Page, playwright } from '@playwright/test';
import { log } from '../helpers/logger';
import { functionRegistry } from '../helpers/function-registry';
// ... other imports
import * as dotenv from 'dotenv';

dotenv.config(); // Ensure .env is loaded for the process

// --- NEW: In-Memory Cache for the Run Configuration ---
// This variable will hold our resolved configuration. It's defined once
// at the module level and will persist for the duration of the worker process.
let runConfigCache: any = null;

/**
 * A helper function that loads and resolves the configuration ONCE per run.
 * It uses a simple in-memory cache to prevent re-reading files.
 */
function getRunConfig() {
  if (runConfigCache) {
    log.debug("Using cached run configuration.");
    return runConfigCache;
  }

  log.info("No cached configuration found. Resolving for the first time...");
  
  const env = process.env.ENV;
  if (!env) {
    throw new Error("[Orchestrator] Configuration Error: The 'ENV' environment variable must be set.");
  }

  const envConfigPath = path.join(process.cwd(), 'config', 'environments', `${env}.config.json`);
  if (!fs.existsSync(envConfigPath)) {
    throw new Error(`[Orchestrator] Config file not found for env '${env}': ${envConfigPath}`);
  }

  const rawConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
  
  // The recursive function to resolve env pointers lives here now.
  const resolveValues = (config: any): any => {
    if (typeof config === 'string' && process.env[config]) {
      return process.env[config];
    }
    if (Array.isArray(config)) {
      return config.map(resolveValues);
    }
    if (typeof config === 'object' && config !== null) {
      const newConfig: { [key: string]: any } = {};
      for (const key in config) {
        newConfig[key] = resolveValues(config[key]);
      }
      return newConfig;
    }
    return config;
  };
  
  const resolvedConfig = resolveValues(rawConfig);

  runConfigCache = {
    currentEnv: env,
    baseURL: resolvedConfig.host,
    configDetails: resolvedConfig,
  };

  log.info({ env: runConfigCache.currentEnv }, "Configuration resolved and cached successfully.");
  return runConfigCache;
}


// --- `prepareStepForExecution` now uses the getter function ---
async function prepareStepForExecution(
  step: any, dataPath: string, flowContext: any, stepHistory: any,
  defaultRequest: APIRequestContext, page: Page, playwright: any
) {
  let executionContext: any, resolvedParams: any;

  await allure.step("Prepare Step Parameters", async () => {
    // 1. Get the globally resolved configuration for this run.
    const runConfig = getRunConfig();

    // 2. Compose and resolve parameters as before.
    const composedParams = await composeStepParameters(step.parts, dataPath);
    const masterContext = { 
      flow: flowContext, 
      steps: stepHistory, 
      testData: composedParams.test_data || {},
      run: runConfig, // <-- Make the run config available for placeholders
      process: { env: process.env }
    };
    resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
    
    // ... (logic to select api_context remains the same) ...

    // 3. Build the execution context.
    executionContext = { 
      api: apiRequestContextForStep, 
      ui: page,
      playwright: playwright,
      log,
      run: runConfig // <-- Pass the run config to the function
    };
  });

  return { executionContext, resolvedParams };
}


// --- `executeFlow` remains the entry point ---
export function executeFlow(flowPath: string, dataPath: string) {
  // ...
  test.describe.serial(`Flow: ${flow.description}`, () => {
    // ...
    for (const stepInfo of flow.steps) {
      // The test block is clean and doesn't know about fixtures.
      test(step.description, async ({ request, page, playwright }) => {
        // ...
        // It calls prepareStepForExecution, which now handles everything.
        const { executionContext, resolvedParams } = await prepareStepForExecution(
          step, dataPath, flowContext, stepHistory, request, page, playwright
        );
        // ...
      });
    }
  });
}
```

### **Summary of this Superior, Fixture-Free Solution**

1.  **No `globalSetup`:** We completely remove the need for `global.setup.ts` and any changes to `playwright.config.ts`. The framework is simpler.
2.  **In-Memory Cache:** The `runConfigCache` variable acts as a simple, effective singleton within each worker process.
3.  **`getRunConfig()` Getter:** This function is the new "brain." The first time it's called, it does the expensive work of reading files and resolving environment variables. Every subsequent time, it instantly returns the cached result.
4.  **`prepareStepForExecution` is the User:** This function is the sole "user" of `getRunConfig()`. It ensures that the configuration is loaded and ready before any other part of the step preparation begins.
5.  **Clean and Contained:** All of this complex logic is now neatly contained within the `flow-orchestrator.ts` file, making it easy to understand and maintain. It has zero external dependencies on Playwright's more advanced features like `globalSetup` or custom fixtures, making it highly portable and robust.

This is the cleanest and most direct way to solve the problem, exactly as you requested.