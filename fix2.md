That is an excellent and very subtle architectural question. You've correctly identified that in our new, highly abstracted model, the "standard" function (like `standard.api.sendRequest`) has a problem:

**How does a generic function get access to the run-specific context (like `env` and `partnerDetails`) it needs to resolve dynamic headers?**

Passing the entire `masterContext` to every function works, but it's not clean. The function shouldn't have to know about the internal structure of the orchestrator's state.

The solution is to use a **Context Injection** pattern. The orchestrator will be responsible for preparing a rich `executionContext` that includes not just the Playwright objects (`api`, `ui`), but also the resolved configuration for the current run.

---

### **The Solution: A Rich `executionContext`**

1.  **Orchestrator's Responsibility:** The `flow-orchestrator` is the only component that knows about the global `run_config.json`. Before executing a step, it will read this config and inject the relevant parts into the `executionContext` that it passes to the function.
2.  **Function's Responsibility:** The function (`standard.api.sendRequest` or a custom one) can now expect to receive this rich context. It doesn't know *where* the context came from, only that it's available.
3.  **YAML Stays Clean:** The `parameters_file` for the step remains clean. It still contains placeholders like `sourcePath: "run.configDetails.partnerId"`. The function will resolve this against the context it receives.

---

### **Step 1: The Code Implementation**

The changes are primarily in the `flow-orchestrator.ts` and the `ApiAction.ts` base class.

#### **A. Update the `flow-orchestrator.ts` to Inject Context**

The main loop will now create a much richer context object to pass to every function.

📁 **`src/core/flow-orchestrator.ts`** (Updated `test` block)
```typescript
// ... (imports)
import { GLOBAL_RUN_CONFIG_FILE } from '../tests/global.setup';

// ... (inside the `for (const stepInfo of flow.steps)` loop)
test(step.description || `Step: ${step.step_id}`, async ({ request, authedRequest }) => {
  await allure.step(`Executing Step: "${step.description}"`, async () => {
    log.info({ stepId: step.step_id, function: step.function }, "Starting step execution.");

    // --- 1. Prepare Contexts (This is the key change) ---
    
    // Load the global configuration for this run
    const runConfig = JSON.parse(fs.readFileSync(GLOBAL_RUN_CONFIG_FILE, 'utf8'));
    
    // This is the context for resolving placeholders like {{flow.var}}
    const masterContext = { flow: flowContext, steps: stepHistory };
    
    // This is the context for the function to execute with.
    // It contains Playwright objects AND the resolved run configuration.
    const executionContext = {
      api: authedRequest,
      log: log,
      // We inject the entire runConfig under a 'run' key.
      run: runConfig 
    };
    
    // --- 2. Load and Resolve Parameters ---
    const paramsPath = path.join(process.cwd(), step.parameters_file);
    const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
    // The resolver now gets the runConfig as part of its master context
    const resolvedParams = resolvePlaceholdersIn(params, { ...masterContext, run: runConfig });

    // --- 3. Get and Execute the Function ---
    const func = functionRegistry.get(step.function);
    // The function receives the rich execution context
    const result = await func(executionContext, resolvedParams, masterContext);

    // ... (rest of the logic: processing results, chaining, etc.)
  });
});
```

#### **B. Update the `ApiAction.ts` Base Class to Use the Injected Context**

The `ApiAction` class no longer needs to load files. It simply uses the context it's given.

📁 **`src/functions/base/ApiAction.ts`** (Updated `buildHeaders` method)
```typescript
// ... (imports)

export class ApiAction {
  protected apiRequest: APIRequestContext;
  protected params: ApiActionParams;
  protected executionContext: any; // Now stores the rich context

  // The constructor now accepts the executionContext
  constructor(apiRequest: APIRequestContext, params: ApiActionParams, executionContext: any) {
    this.apiRequest = apiRequest;
    this.params = params;
    this.executionContext = executionContext; // Save it for later use
  }

  /**
   * Builds the final headers using the injected run context.
   */
  protected async buildHeaders(): Promise<Record<string, string>> {
    const finalHeaders: Record<string, string> = { ...(this.params.headers || {}) };
    
    if (this.params.contextual_headers) {
      log.debug("Processing contextual headers...");
      // The context for resolving header paths is now the `run` object from the execution context.
      const headerContext = this.executionContext.run;
      
      for (const header of this.params.contextual_headers) {
        let value: any;
        if (header.sourcePath.startsWith('$dynamic.')) {
          value = generateDynamicData(header.sourcePath);
        } else {
          // getValueFromObject now searches within the runConfig object
          value = getValueFromObject(headerContext, header.sourcePath);
        }

        if (value !== undefined) {
          finalHeaders[header.key] = String(value);
        } else {
          log.warn(`[Header Gen] Could not resolve '${header.sourcePath}'. It will be omitted.`);
        }
      }
    }
    return finalHeaders;
  }

  // ... rest of the ApiAction class is unchanged ...
}
```

#### **C. Update the `standard.api.sendRequest.ts` Function**

This function now properly passes the `executionContext` to the `ApiAction` constructor.

📁 **`src/functions/api/standard/sendRequest.ts`** (Updated)
```typescript
import { ApiAction, ApiActionParams } from '../../base/ApiAction';

export async function sendRequest(
  executionContext: any,
  params: ApiActionParams,
  masterContext: any // masterContext is for resolving {{flow.*}} placeholders
) {
  // Pass the rich executionContext to the ApiAction constructor
  const apiAction = new ApiAction(executionContext.api, params, executionContext);
  return apiAction.run();
}
```

---

### **How a User Would Define Dynamic Headers Now**

The user experience in the YAML/JSON is now clean and intuitive. The `sourcePath` is relative to the `run_config.json` that was created by `global.setup.ts`.

📁 `params/api/some_api_params.json`
```json
{
  "endpoint": "/v1/some/endpoint",
  "method": "POST",
  "contextual_headers": [
    {
      "key": "X-Partner-ID",
      // The resolver will look for `runConfig.configDetails.partnerId`
      "sourcePath": "configDetails.partnerId"
    },
    {
      "key": "X-Environment",
      // The resolver will look for `runConfig.currentEnv`
      "sourcePath": "currentEnv"
    },
    {
      "key": "X-Custom-Product-Version",
      // The resolver will look for `runConfig.configDetails.products.bop.version`
      "sourcePath": "configDetails.products.bop.version"
    }
  ],
  "payload": { /* ... */ }
}
```

### **Summary of the Solution**

1.  **Centralized Context Creation:** The `flow-orchestrator` is the **only** component that reads the global `run_config.json` file.
2.  **Context Injection:** It "injects" this configuration into the `executionContext` object that it passes to every function.
3.  **Clean Functions:** The functions (like `sendRequest` and its base class `ApiAction`) are now clean. They don't load files from the disk. They are completely stateless and operate only on the context and parameters they are given.
4.  **Generic and Scalable:** This pattern is extremely scalable. If a new type of context is needed (e.g., a database connection), the orchestrator can create it and add it to the `executionContext` (`{ api, ui, log, db, run }`). All functions will automatically have access to it without any complex refactoring.

This resolves the issue perfectly and makes the entire framework more robust, testable, and easier to reason about.