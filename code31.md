Of course. That is a crucial final touch to the logic. You are right—if a user specifies a `baseURL` at the flow or step level but doesn't specify a custom authenticated context, their intent is clearly to make an unauthenticated call to that specific `baseURL`.

Our default `request` object doesn't have this dynamic `baseURL` baked in, so we must create a new context on the fly.

Let's implement this final piece of the puzzle.

---

### **The Code: Updating `prepareStepForExecution`**

The change is small and localized entirely within our intelligent preparation function. It adds a final check right after the context selection logic.

📁 **`src/core/flow-orchestrator.ts`** (Updated `prepareStepForExecution` function)
```typescript
// ... (imports) ...

async function prepareStepForExecution(
    step: any, dataPath: string, flow: any, flowContext: any, stepHistory: any,
    defaultRequest: APIRequestContext, page: Page, playwright: any
) {
  // ... (getRunConfig, composeStepParameters, masterContext setup are all unchanged) ...
  const runConfig = getRunConfig();
  const composedParams = await composeStepParameters(step.parts, dataPath);
  const masterContext = { /* ... */ };
  
  // --- Hierarchical Context & baseURL Resolution (Unchanged) ---
  let finalBaseURL = runConfig.baseURL;
  if (flow.default_context?.baseURL) {
    finalBaseURL = resolvePlaceholdersInString(flow.default_context.baseURL, masterContext);
  }
  let contextInstruction = flow.default_context?.api_context;

  if (composedParams.headers?.baseURL) {
    finalBaseURL = resolvePlaceholdersInString(composedParams.headers.baseURL, masterContext);
  }
  if (composedParams.headers?.api_context !== undefined) {
    contextInstruction = composedParams.headers.api_context;
  }
  
  // --- Resolve the final API context (Unchanged) ---
  let apiRequestContextForStep = defaultRequest;
  let usingCustomContext = false;
  
  if (contextInstruction) {
    if (contextInstruction === null) {
      log.info("Step explicitly requested default context.");
    } else {
      const contextPath = resolvePlaceholdersInString(contextInstruction, masterContext);
      const foundContext = getValueFromObject(masterContext, contextPath);
      if (foundContext) {
        apiRequestContextForStep = foundContext;
        usingCustomContext = true; // Flag that we are using a pre-built context
        log.info(`Using specified API context: '${contextPath}'`);
      } else {
        throw new Error(`Prerequisite failed: The context '${contextPath}' was not found.`);
      }
    }
  } else {
    log.info("No API context specified. Using default context.");
  }

  // --- NEW LOGIC: Update Default Context with baseURL if needed ---
  // This block runs only if we are using the default unauthenticated context
  // AND a dynamic baseURL has been determined.
  if (!usingCustomContext && finalBaseURL) {
    log.debug({ baseURL: finalBaseURL }, "Creating new default context instance with dynamic baseURL.");
    // Dispose of the original default context to be clean
    await defaultRequest.dispose(); 
    // Create a new, unauthenticated context but with the correct baseURL
    apiRequestContextForStep = await playwright.request.newContext({
      baseURL: finalBaseURL,
    });
  }
  // --- END OF NEW LOGIC ---

  // --- The rest of the function is unchanged ---
  const resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
  const executionContext = { api: apiRequestContextForStep, ui: page, playwright, log, run: runConfig };

  return { executionContext, resolvedParams };
}

// All other functions in the file remain the same.
```

### **How the New Logic Works**

1.  **Hierarchy as Before:** The function first determines the `finalBaseURL` by checking the step, then the flow, then the global config. It also determines if a custom `api_context` (like `{{flow.apiSession}}`) was requested.
2.  **`usingCustomContext` Flag:** We introduce a boolean flag. This flag becomes `true` only if we successfully find and select a pre-authenticated context from the `flowContext`.
3.  **The Critical `if` Block:** After the selection logic, we have a new check: `if (!usingCustomContext && finalBaseURL)`. This translates to:
    *   "If we are about to use the default, unauthenticated `request` object..."
    *   "...AND our hierarchical lookup found a specific `baseURL` that is different from Playwright's global default..."
4.  **Create New Context:**
    *   "...then we must create a **new, fresh `APIRequestContext` on the fly**."
    *   `playwright.request.newContext({ baseURL: finalBaseURL })` creates this new context. It's still unauthenticated (no `extraHTTPHeaders`), but it now has the correct `baseURL` baked in.
    *   We assign this new context to `apiRequestContextForStep`, overwriting the original `defaultRequest`.

### **Example Scenario**

Consider this flow, which calls a public API with a specific base URL.

**`flow.yml`:**
```yaml
flow_id: "PUBLIC_API_TEST"
default_context:
  # NO api_context is specified, so it will be unauthenticated
  baseURL: "https://api.publicapis.org"

steps:
  - step_id: "get_cats_api"
```

**`headers.json` for the step:**
```json
{
  "endpoint": "/entries?title=cat"
}
```

**Execution Flow:**

1.  `prepareStepForExecution` runs.
2.  `finalBaseURL` is determined to be `https://api.publicapis.org`.
3.  `contextInstruction` is `undefined`.
4.  `usingCustomContext` remains `false`.
5.  The new `if (!usingCustomContext && finalBaseURL)` block is **true**.
6.  A new `APIRequestContext` is created with `baseURL: "https://api.publicapis.org"`.
7.  The `sendRequest` function receives this new context.
8.  It makes a `GET` request to `/entries?title=cat`.
9.  The final URL called will correctly be `https://api.publicapis.org/entries?title=cat`.

This final piece of logic makes the framework's context management complete and highly intuitive for the end-user. It handles every combination of authenticated/unauthenticated and global/flow/step-level `baseURL` overrides correctly.