You are right. My proposed solution, while trying to be "smart," adds a layer of implicit magic (`if (currentStepIndex > 0)`) that can be confusing. It violates the principle of least surprise.

Your decision to stick with an **explicit, declarative approach** is the correct one. It's more robust, easier to understand, and less prone to edge cases. The user should explicitly state their intent.

Thank you for providing that clear direction. Let's revert to and solidify the simpler, more powerful logic.

---

### **The Final, Correct Logic (Explicit is Better)**

**The Rule:**
*   If a step needs the **default, unauthenticated context** (like a login step or a call to a public API), its `headers.json` file should either **have no `api_context` key at all**, or it should explicitly set it to **`null`**.
*   If a step needs an **authenticated context**, its `headers.json` file **must** contain `api_context: "{{flow.mySession}}"` pointing to a context that a previous step has created.

This puts the user in complete control and makes the YAML file the single source of truth for a step's behavior.

---

### **The Corrected Code**

Let's revert `prepareStepForExecution` to the clean version that supports this explicit logic. This version is simpler and more robust.

📁 **`src/core/flow-orchestrator.ts`** (The Corrected and Final `prepareStepForExecution`)
```typescript
async function prepareStepForExecution(
    step: any, dataPath: string, flow: any, flowContext: any, stepHistory: any,
    defaultRequest: APIRequestContext, page: Page, playwright: any
) {
  let executionContext: any, resolvedParams: any;

  await allure.step("Prepare Step Parameters", async () => {
    // 1. Compose all parameters from files. Placeholders are still intact.
    const composedParams = await composeStepParameters(step.parts, dataPath);
    
    // 2. Create the master context for resolving placeholders.
    const masterContext = { 
      flow: flowContext, 
      steps: stepHistory, 
      testData: composedParams.test_data || {},
      run: getRunConfig(), // getRunConfig is our cached config loader
      process: { env: process.env }
    };

    // 3. Resolve all placeholders throughout the entire parameter object.
    // This is safe because we will select the context AFTER this step.
    resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
    await allure.attachment('Resolved Step Parameters', JSON.stringify(resolvedParams, null, 2), { contentType: 'application/json' });

    // 4. Select the API Context based on the now-resolved parameters.
    let apiRequestContextForStep = defaultRequest;
    
    // Check for the api_context key in the resolved headers.
    const apiContext = resolvedParams.headers?.api_context;

    if (apiContext) {
      // If the resolved value is a Playwright context object, use it.
      if (typeof apiContext === 'object' && apiContext.post) { // Duck-typing to check if it's an APIRequestContext
        apiRequestContextForStep = apiContext;
        log.info("Successfully using resolved API context from flow state.");
      } else {
        // This would happen if {{flow.mySession}} resolved to a string or number, which is an error.
        throw new Error(`[OrchestratorError] The api_context resolved to an invalid type. Expected an APIRequestContext object, but got: ${typeof apiContext}`);
      }
    } else if (apiContext === null) {
      // The user explicitly wants the default, unauthenticated context.
      log.info("Step explicitly requests default (unauthenticated) context.");
      // apiRequestContextForStep is already set to defaultRequest, so we do nothing.
    } else {
      // No api_context key was present at all. Use the default.
      log.info("No API context specified. Using default unauthenticated context.");
    }
    
    // 5. Handle dynamic baseURL for the default context
    if (apiRequestContextForStep === defaultRequest) {
      // ... logic to create a new default context with a dynamic baseURL if needed ...
    }
    
    // 6. Build the final execution context.
    executionContext = { api: apiRequestContextForStep, ui: page, playwright, log };
  });

  return { executionContext, resolvedParams };
}
```

### **Why This Is a Better Solution and How It Works**

1.  **Resolve First, Select Second:** We now resolve **all** placeholders first. This simplifies the logic immensely.
2.  **Type Checking the Result:** After resolution, we check the *type* of the `api_context` value.
    *   **If it's an object with a `.post` method:** We can be very confident it's the `APIRequestContext` object we saved from the auth step. We use it. This is the success path for authenticated steps.
    *   **If it's `null`:** The user explicitly wants the default context. We use it.
    *   **If it's `undefined` (key doesn't exist):** This is the case for the login step itself. We correctly use the default context.
    *   **If it's anything else (a string, a number):** This indicates a user error (e.g., they wrote `save_from_response: { mySession: "responseBody.tokenValue" }` instead of `"responseBody.sessionContext"`). We throw a clear error.

**This approach is superior because:**
*   It's **explicit**. The framework does exactly what the YAML says. No "magic" logic based on the step index.
*   It's **robust**. It correctly handles the case where a placeholder *should* resolve to an object but doesn't, leading to a clear error instead of a crash.
*   It's **maintainable**. The logic is straightforward and easy to follow.

We will proceed with this clear, explicit model. Thank you for guiding us to this much better solution.