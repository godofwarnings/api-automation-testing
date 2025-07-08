You are absolutely right to push back on that. Storing state in temporary files like `run_config.json` can be brittle and adds complexity. A pure, in-memory solution is far more elegant and robust.

My apologies for suggesting a file-based approach. Let's design the superior, in-memory architecture you're looking for.

---

### **The Game Plan: An In-Memory Configuration Context**

The core principle remains the same: **resolve configuration once and make it available to the entire test run.** But instead of writing to a file, we will leverage Playwright's own architecture to pass this context.

1.  **`globalSetup`'s New Role:** `globalSetup` will still do the heavy lifting of parsing CLI arguments, loading the base environment config, and resolving all the `.env` pointers. However, instead of writing to a file, it will return the final, resolved configuration object directly.
2.  **`playwright.config.ts`'s Role:** The config file will be updated to use a custom fixture that is initialized with the data returned from `globalSetup`. This is the "magic link" that passes data from the global, one-time setup phase into the parallelized test worker processes.
3.  **The `runContext` Fixture:** We will create a new, simple fixture called `runContext`. This fixture's only job is to provide the globally resolved configuration object to any test that asks for it.
4.  **The Orchestrator:** The `prepareStepForExecution` function will now get this `runContext` object via the test's fixtures, giving it all the configuration it needs to proceed.

This is a clean, modern, and file-free approach.

---

### **Step 1: Update `global.setup.ts` to Return a Value**

The `globalSetup` function can return a value, which can then be used to initialize fixtures for the test workers.

📁 **`tests/global.setup.ts`** (Updated to return the config)
```typescript
import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/helpers/logger';

// resolveConfigValues helper remains the same
function resolveConfigValues(config: any): any { /* ... */ }

/**
 * Runs once, resolves all configuration, and RETURNS the final config object.
 * This object will be used to initialize worker fixtures.
 */
async function globalSetup(config: FullConfig): Promise<object> {
  log.info('--- Running Global Setup: Resolving configuration in-memory ---');
  
  const argv = await yargs(hideBin(process.argv)).options({
    env: { type: 'string', demandOption: true },
  }).argv;
  const { env } = argv;
  
  process.env.ENV = env;

  const envConfigPath = path.join(process.cwd(), 'config', 'environments', `${env}.config.json`);
  if (!fs.existsSync(envConfigPath)) throw new Error(`Config Error: Env config not found: ${envConfigPath}`);
  
  const rawConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
  const resolvedConfig = resolveConfigValues(rawConfig);

  const runContext = {
    currentEnv: env,
    baseURL: resolvedConfig.host,
    configDetails: resolvedConfig,
  };
  
  log.info({ env: runContext.currentEnv }, "Global setup complete. Resolved config will be passed to workers.");
  
  // Return the resolved context. This is the key change.
  return runContext;
}

export default globalSetup;
```

---

### **Step 2: Create a New, Smarter `test-fixtures.ts`**

This file will now define how the data from `globalSetup` is provided to each test worker and each test.

📁 **`src/helpers/test-fixtures.ts`** (New, Corrected Version)
```typescript
import { test as baseTest, expect, APIRequestContext, Page } from '@playwright/test';
import { log as globalLogger, AppLogger } from './logger';

// --- Define the shape of our contexts and fixtures ---

interface RunContext {
  currentEnv: string;
  baseURL?: string;
  configDetails: any;
}

interface MyFixtures {
  runContext: RunContext; // Provides the globally resolved config
  log: AppLogger;         // Provides a test-specific child logger
}

// We use worker-scoped fixtures for data that is the same for all tests in a worker process.
export const test = baseTest.extend<MyFixtures>({
  // --- Worker-Scoped Fixture for Run Context ---
  // This fixture is initialized ONCE PER WORKER.
  // It receives the `runContext` object that was returned by `globalSetup`.
  runContext: [ async({}, use, workerInfo) => {
    // We receive the returned value from globalSetup as the `config` property on workerInfo.
    const context = workerInfo.config.globalSetup as RunContext;
    await use(context);
  }, { scope: 'worker' }],
  
  // --- Test-Scoped Fixture for Logger ---
  // This creates a new child logger for every test, embedding the title.
  log: [ async ({}, use, testInfo) => {
    await use(globalLogger.child({ testTitle: testInfo.title }));
  }, { scope: 'test' }],
});

export { expect };
```

---

### **Step 3: Update the Orchestrator to Use the New Fixture**

The `flow-orchestrator` becomes much cleaner. It no longer loads any files. It just asks for the `runContext` fixture.

📁 **`src/core/flow-orchestrator.ts`** (Updated)
```typescript
// Use our new custom test object from the fixtures file
import { test, expect } from '../helpers/test-fixtures';
// ... other imports

export function executeFlow(flowPath: string, dataPath: string) {
  // ... (load flow and step library)

  test.describe.serial(`Flow: ${flow.description}`, () => {
    // ...

    for (const stepInfo of flow.steps) {
      // The test block now asks for the `runContext` fixture
      test(step.description, async ({ request, page, playwright, runContext, log }) => {
        // ...
        
        // Pass the fixture down to the preparation function
        const { executionContext, resolvedParams } = await prepareStepForExecution(
          step, dataPath, flowContext, stepHistory, request, page, playwright, runContext, log
        );

        // ... (execute the function with the prepared context)
      });
    }
  });
}


async function prepareStepForExecution(
  step: any, dataPath: string, flowContext: any, stepHistory: any,
  defaultRequest: APIRequestContext, page: Page, playwright: any,
  runContext: any, // <-- Receives the runContext fixture
  log: any
) {
  // ...
  // It no longer needs to load any files. It just uses the provided context.
  const masterContext = { 
    flow: flowContext, 
    steps: stepHistory, 
    testData: composedParams.test_data || {},
    run: runContext // <-- Make the runContext available for placeholder resolution
  };

  const resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);

  // The logic for selecting the api_context now checks the masterContext
  // which includes the runContext.
  
  const executionContext = { 
      api: apiRequestContextForStep, 
      ui: page,
      playwright: playwright,
      log,
      run: runContext // Pass the run context to the executed function as well
  };

  return { executionContext, resolvedParams };
}
```

### **Summary of the In-Memory Solution**

1.  **`globalSetup` Resolves and Returns:** It does all the heavy lifting of reading files and environment variables, resolves everything into a single `runContext` object, and **returns** it.
2.  **`runContext` Fixture:** A new worker-scoped fixture is defined. Playwright automatically initializes this fixture for each worker process using the object returned by `globalSetup`.
3.  **Clean Orchestrator:** The orchestrator's test block simply asks for the `runContext` fixture: `async ({ runContext, log, ... })`.
4.  **No Temporary Files:** The `.tmp/run_config.json` file is completely gone. All configuration is passed efficiently in memory.
5.  **Handles No-Auth:** This model perfectly handles the no-auth case. If a flow doesn't have an auth step, it will just use the default `request` object, which can still get its `baseURL` from the `runContext` provided by the fixture system.

This is a much cleaner, more robust, and more idiomatic Playwright solution that completely avoids the brittleness of temporary files.