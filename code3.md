You are absolutely right. My apologies for that oversight. I got ahead of myself and put the logic directly in the orchestrator loop instead of using the proper helper function we designed.

Using a dedicated `prepareStepForExecution` function is a much cleaner design. It encapsulates the "preparation" phase of a step, making the main orchestrator loop easier to read and maintain.

Let's correct this immediately. We will create the `prepareStepForExecution` function and refactor the orchestrator to use it.

---

### **The Corrected Code: Using a Preparation Helper**

The changes will be entirely within **`src/core/flow-orchestrator.ts`**.

📁 **`src/core/flow-orchestrator.ts`** (Corrected and Completed)
```typescript
import { test, expect } from '../helpers/test-fixtures';
import { log } from '../helpers/logger';
import { functionRegistry } from '../helpers/function-registry';
import { resolvePlaceholdersIn } from '../helpers/placeholder-resolver';
import { getValueFromObject, tryParseJson } from '../helpers/utils';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';
import { merge } from 'lodash';

// Interfaces for clarity
interface StepPartFiles { /* ... */ }
interface StepDefinition { /* ... */ }

/**
 * Main entry point for running a test case.
 */
export function executeFlow(flowPath: string, dataPath: string) {
  // --- 1. Initial Setup and Validation ---
  // ... (logic to load flow and step library is unchanged) ...

  // --- 2. Test Suite Definition ---
  test.describe.serial(`Flow: ${flow.description} [${flow.test_case_id}]`, () => {
    // ... (Allure tagging logic) ...

    const flowContext: Record<string, any> = {};
    const stepHistory: Record<string, any> = {};

    for (const stepInfo of flow.steps) {
      // ... (logic to look up stepDefinition from stepMappings) ...
      const step = { ...stepDefinition, step_id: stepInfo.step_id };
      
      test(step.description || `Step: ${step.step_id}`, async ({ request, authedRequest }) => {
        await allure.step(`Executing Step: "${step.description}"`, async () => {
          log.info({ stepId: step.step_id }, "Starting step execution.");

          // --- 3. Prepare the Step for Execution ---
          // This now uses our dedicated helper function.
          const { executionContext, resolvedParams, masterContext } = await prepareStepForExecution(
            step,
            dataPath,
            flowContext,
            stepHistory,
            authedRequest, // Pass the fixture
            request      // Pass the fixture
          );

          // --- 4. Save from Request Body (if configured) ---
          if (resolvedParams.payload && step.save_from_request) {
            await processSaveFromRequest(resolvedParams, step.save_from_request, flowContext);
          }

          // --- 5. Execute the Step ---
          const func = functionRegistry.get(step.function);
          const result = await func(executionContext, resolvedParams, masterContext);

          // --- 6. Process Results ---
          // ... (rest of the logic: saving to history, saving from response, etc.) ...
        });
      });
    }
  });
}


// --- All Helper Functions Below ---

/**
 * A new helper function that encapsulates all preparation logic for a step.
 * It composes parameters, resolves placeholders, and sets up the execution context.
 * @returns An object containing the final contexts and parameters needed for execution.
 */
async function prepareStepForExecution(
  step: StepDefinition & { step_id: string },
  dataPath: string,
  flowContext: Record<string, any>,
  stepHistory: Record<string, any>,
  authedRequest: any, // Playwright's APIRequestContext
  request: any         // Playwright's APIRequestContext
) {
  await allure.step("Prepare Step Parameters", async () => {
    log.debug({ stepId: step.step_id }, "Preparing step for execution.");

    // a. Compose parameters by merging files
    const composedParams = await composeStepParameters(step.parts, dataPath);
    
    // b. Create the master context for placeholder resolution
    const masterContext = { 
      flow: flowContext, 
      steps: stepHistory, 
      testData: composedParams.test_data || {} 
    };
    
    // c. Resolve all placeholders in the composed parameters
    const resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
    await allure.attachment('Resolved Step Parameters', JSON.stringify(resolvedParams, null, 2), { contentType: 'application/json' });

    // d. Select the correct API context based on the 'auth' flag in the resolved parameters
    const apiRequestContextForStep = resolvedParams.auth === 'bearer' ? authedRequest : request;
    if(resolvedParams.auth === 'bearer') log.debug("Using authenticated request context for this step.");
    
    // e. Create the final execution context to pass to the function
    const executionContext = { 
      api: apiRequestContextForStep, 
      log 
    };

    return { executionContext, resolvedParams, masterContext };
  });

  // This is a bit of a hack to satisfy TypeScript's return analysis since the real return
  // is inside the allure step. A real implementation might declare the variables outside the step.
  return {} as any; 
}


/**
 * Loads and merges the parts of a step's configuration.
 */
async function composeStepParameters(parts: StepPartFiles, dataPath: string): Promise<any> {
  // ... (This function's logic is unchanged from the previous version)
}

// ... (All other helpers like processSaveFromRequest, processSaveFromResponse, etc., are unchanged)
```
*Self-correction:* The return from inside an `allure.step` can be tricky for TypeScript's static analysis. The code above shows the conceptual flow. A more robust implementation would declare `executionContext`, `resolvedParams`, etc. outside the `allure.step` block, assign them inside, and then return them at the end of the function. Let's refine `prepareStepForExecution` to be more robust.

**Corrected `prepareStepForExecution`:**
```typescript
async function prepareStepForExecution(
  step: StepDefinition & { step_id: string },
  dataPath: string,
  flowContext: Record<string, any>,
  stepHistory: Record<string, any>,
  authedRequest: any,
  request: any
) {
  let executionContext, resolvedParams, masterContext;

  await allure.step("Prepare Step Parameters", async () => {
    log.debug({ stepId: step.step_id }, "Preparing step for execution.");

    const composedParams = await composeStepParameters(step.parts, dataPath);
    masterContext = { flow: flowContext, steps: stepHistory, testData: composedParams.test_data || {} };
    resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
    await allure.attachment('Resolved Step Parameters', JSON.stringify(resolvedParams, null, 2), { contentType: 'application/json' });

    const apiRequestContextForStep = resolvedParams.auth === 'bearer' ? authedRequest : request;
    if (resolvedParams.auth === 'bearer') log.debug("Using authenticated request context for this step.");
    
    executionContext = { api: apiRequestContextForStep, log };
  });

  return { executionContext, resolvedParams, masterContext };
}
```

### **Summary of the Improvement**

1.  **Encapsulation:** We have created a `prepareStepForExecution` function that neatly bundles all the logic required to get a step ready to run:
    *   It composes the parameters from multiple files.
    *   It builds the context needed for placeholder resolution.
    *   It resolves all placeholders.
    *   It selects the correct API context (authenticated or not).
    *   It bundles everything into a clean return object.
2.  **Cleaner Orchestrator:** The main `for` loop inside `executeFlow` is now much simpler and easier to read. It clearly shows the sequence: `Prepare -> SaveFromRequest -> Execute -> ProcessResult`.
3.  **Maintainability:** If we ever need to change how a step is prepared (e.g., add a new type of context), we only need to modify `prepareStepForExecution`. The main orchestrator loop remains untouched.

This brings us back to the clean, modular design we planned. The core logic is now correctly abstracted into dedicated helper functions.