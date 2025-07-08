You are absolutely right. My previous logic has a critical "chicken and egg" problem. I apologize for this oversight. You have correctly diagnosed the flaw:

*   The orchestrator tries to decide whether to use a custom context *before* placeholders are resolved.
*   But the instruction for *which* custom context to use (`{{flow.apiSession}}`) is itself a placeholder that needs to be resolved.
*   But we can't resolve it yet, because if we do, we lose the path!

This is a classic state-dependency problem. The solution is to make the orchestrator **smarter about the *state of the flow***. It needs to know which step it's on and only attempt to find a context if it's logical to do so.

---

### **The Game Plan: Intent-Driven Context Resolution**

The new logic will be driven by the user's intent, as declared in the YAML.

1.  **A Step with an `api_context` is a "Consumer":** If a step's parameter file contains the `api_context` key, it is explicitly stating its intent to *consume* a context created by a previous step.
2.  **An Auth Step is a "Producer":** A step that is designed to perform authentication is a *producer*. Its job is to create the context.
3.  **The First Step Cannot Be a Consumer (Usually):** The very first step of a flow cannot consume a context that doesn't exist yet. The framework must be smart enough to recognize this and not throw an error.

Here is how we will implement this improved logic.

---

### **The Corrected Code: The Final, State-Aware Orchestrator**

The change is entirely within the `prepareStepForExecution` function.

📁 **`src/core/flow-orchestrator.ts`** (Updated `prepareStepForExecution`)
```typescript
async function prepareStepForExecution(
    step: any, dataPath: string, flow: any, flowContext: any, stepHistory: any,
    defaultRequest: APIRequestContext, page: Page, playwright: any,
    currentStepIndex: number // <-- NEW: Pass the index of the current step
) {
  // ... (getRunConfig, composeStepParameters are unchanged) ...
  const runConfig = getRunConfig();
  const composedParams = await composeStepParameters(step.parts, dataPath);
  
  // NOTE: We resolve placeholders AFTER selecting the context.
  // The masterContext for path resolution will be built just-in-time.

  // --- NEW: State-Aware Context Selection Logic ---
  let apiRequestContextForStep = defaultRequest;
  const contextInstruction = composedParams.headers?.api_context;

  if (contextInstruction) {
    // An api_context is specified. This step INTENDS to use a custom context.

    // LAZY EVALUATION CHECK: Only try to find the context if it's not the first step.
    // The first step (index 0) is typically the one that creates the context.
    if (currentStepIndex > 0) {
      const masterContextForPath = { flow: flowContext, steps: stepHistory, run: runConfig };
      const contextPath = resolvePlaceholdersInString(contextInstruction, masterContextForPath);
      
      const foundContext = getValueFromObject(masterContextForPath, contextPath);

      if (foundContext) {
        apiRequestContextForStep = foundContext;
        log.info(`Using specified API context found at: '${contextPath}'`);
      } else {
        // This is a real error. The step expected a context, but it's missing (e.g., login failed).
        throw new Error(`Prerequisite failed: The context '${contextPath}' was expected to exist but was not found in the flow state.`);
      }
    } else if (contextInstruction !== null) {
      // This is a configuration error. The VERY FIRST step is asking for a context that cannot possibly exist.
      // We allow `null` to pass through for the override case.
      throw new Error(`Configuration Error: The first step of a flow cannot request an api_context ('${contextInstruction}') because no context has been created yet.`);
    }
  }

  // Handle the explicit null override for unauthenticated calls
  if (contextInstruction === null) {
    log.info("Step explicitly requested default (unauthenticated) context.");
    apiRequestContextForStep = defaultRequest;
  }
  
  // --- This is where the dynamic baseURL logic for default contexts now lives ---
  // If we are still using the default context object after all checks...
  if (apiRequestContextForStep === defaultRequest) {
    // ...determine the final baseURL from the hierarchy...
    let finalBaseURL = runConfig.baseURL;
    if (flow.default_context?.baseURL) finalBaseURL = resolvePlaceholdersInString(flow.default_context.baseURL, { run: runConfig });
    if (composedParams.headers?.baseURL) finalBaseURL = resolvePlaceholdersInString(composedParams.headers.baseURL, { run: runConfig });
    
    // ...and if it's different, create a new context on the fly.
    if (finalBaseURL) {
        await defaultRequest.dispose();
        apiRequestContextForStep = await playwright.request.newContext({ baseURL: finalBaseURL });
        log.debug({ baseURL: finalBaseURL }, "Created new default context instance with dynamic baseURL.");
    }
  }
  
  // --- Final Placeholder Resolution ---
  const masterContext = { flow: flowContext, steps: stepHistory, testData: composedParams.test_data || {}, run: runConfig, process: { env: process.env } };
  const resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
  
  const executionContext = { api: apiRequestContextForStep, ui: page, playwright, log, run: runConfig };

  return { executionContext, resolvedParams };
}
```

And update the call to it in the main loop:

📁 **`src/core/flow-orchestrator.ts`** (Updated `executeFlow` loop)
```typescript
// ... inside executeFlow
for (const [index, stepInfo] of flow.steps.entries()) { // <-- Use .entries() to get the index
  // ...
  test(step.description, async ({ request, page, playwright }) => {
    // ...
    // Pass the index to the preparation function
    const { executionContext, resolvedParams } = await prepareStepForExecution(
      step, dataPath, flow, flowContext, stepHistory, request, page, playwright, index
    );
    // ...
  });
}
```

### **How This Solves the Problem**

1.  **State Awareness:** By passing the `currentStepIndex` to `prepareStepForExecution`, the function is now aware of its position in the flow.
2.  **Lazy Evaluation for `api_context`:**
    *   **If `currentStepIndex` is `0` (the first step):** The code sees that an `api_context` is requested but knows it can't possibly exist. It will throw a clear **Configuration Error**, telling the user that the first step cannot consume a context. This prevents the bug. The only exception is `api_context: null`, which is allowed.
    *   **If `currentStepIndex` is greater than `0`:** The code now knows it *should* expect the context to exist. It proceeds to resolve the path and look for it in `flowContext`. If it's not there, it throws a **Prerequisite Failed** error, which is also correct (it means the login step probably failed).
3.  **No `api_context` (The Auth Step Case):** If a step (like the login step) has no `api_context` key at all, the `if (contextInstruction)` block is skipped entirely. The code gracefully falls through to using the default unauthenticated `request` object, which is the correct behavior for the step that *produces* the context.
4.  **`null` Override Preserved:** The ability to explicitly set `api_context: null` to override a flow-level default and force an unauthenticated call is still fully supported.

This new, state-aware logic is much more robust. It correctly handles the "producer" step (the login) and the "consumer" steps, preventing the "context not found" error for the first step while correctly enforcing it for all subsequent steps.