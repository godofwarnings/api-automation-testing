You are absolutely right. I am so sorry. I completely misunderstood the problem and went down the wrong path. The issue is not the regex at all; it's a fundamental flaw in the logic of how I'm handling the context path.

You are 100% correct: **We should not be resolving `api_context` as a placeholder.** We need to treat its value as the literal path to look up.

This is a critical logic error on my part. Let's fix it correctly this time.

---

### **The Root Cause: Resolving Too Early**

The problem is in this block within `prepareStepForExecution`:

```typescript
// --- FLAWED LOGIC ---
// Get the raw placeholder string, e.g., "{{flow.apiSession}}"
const rawContextPath = composedParams.headers?.api_context; 

if (rawContextPath) {
  // THIS IS THE MISTAKE: We are resolving the path itself as a placeholder
  const resolvedContextPath = resolvePlaceholdersInString(rawContextPath, masterContext); 
  // If rawContextPath was "{{flow.apiSession}}", and `flow.apiSession` doesn't exist yet,
  // `resolvedContextPath` becomes "{{flow.apiSession}}" (the same string).
  // Then `getValueFromObject` tries to find a key named "{{flow.apiSession}}" which is wrong.
  
  const foundContext = getValueFromObject(masterContext, resolvedContextPath); 
  // ...
}
```

You are right. The goal is not to resolve `{{flow.apiSession}}` into a value. The goal is to **extract the path `flow.apiSession` from within the braces** and use *that* path to look up the value in the `masterContext`.

---

### **The Correct Solution: Extract, Don't Resolve**

We need to treat the `api_context` value as a special instruction, not just another placeholder string.

Here is the corrected and much simpler logic for the `prepareStepForExecution` function.

📁 **`src/core/flow-orchestrator.ts`** (The Corrected `prepareStepForExecution` function)
```typescript
async function prepareStepForExecution(
  step: any, dataPath: string, flowContext: any, stepHistory: any,
  defaultRequest: APIRequestContext, page: Page, playwright: any
) {
  let executionContext: any, resolvedParams: any, masterContext: any;

  await allure.step("Prepare Step Parameters", async () => {
    // 1. Compose the raw parameters from files. The object contains {{...}} placeholders.
    const composedParams = await composeStepParameters(step.parts, dataPath);
    
    // 2. Create the master context. This is what we will use to look up values.
    masterContext = { 
      flow: flowContext, 
      steps: stepHistory, 
      testData: composedParams.test_data || {},
      process: { env: process.env } 
    };

    // --- 3. THE NEW, CORRECT CONTEXT SELECTION LOGIC ---
    let apiRequestContextForStep = defaultRequest;
    const contextInstruction = composedParams.headers?.api_context; // e.g., "{{flow.apiSession}}"

    if (contextInstruction && typeof contextInstruction === 'string') {
      // Extract the path from inside the braces, e.g., "flow.apiSession"
      const contextPath = contextInstruction.match(/\{\{([^}]+?)\}\}/)?.[1];
      
      if (contextPath) {
        log.debug(`Step requests API context via path: '${contextPath}'`);
        const foundContext = getValueFromObject(masterContext, contextPath.trim());
        
        if (foundContext) {
          apiRequestContextForStep = foundContext;
          log.info("Successfully loaded specified API context from flow state.");
        } else {
          throw new Error(`Orchestrator Error: Specified api_context path '${contextPath}' could not be found in the flow state.`);
        }
      } else {
        // This handles cases where api_context is a non-placeholder string, which is invalid.
        throw new Error(`Orchestrator Error: The api_context value '${contextInstruction}' is not a valid placeholder.`);
      }
    } else {
      log.debug("No specific API context requested. Using default unauthenticated context.");
    }
    // --- END OF NEW LOGIC ---

    // 4. NOW, resolve all other placeholders in the parameters.
    //    We don't need to worry about `api_context` being replaced anymore.
    resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
    await allure.attachment('Resolved Step Parameters', JSON.stringify(resolvedParams, null, 2), { contentType: 'application/json' });

    // 5. Create the final execution context to pass to the function.
    executionContext = { 
      api: apiRequestContextForStep, 
      ui: page,
      playwright: playwright,
      log 
    };
  });

  return { executionContext, resolvedParams };
}
```

### **Why This Fix is Correct**

1.  **No Premature Resolution:** We are no longer calling `resolvePlaceholdersInString` on the `api_context` value.
2.  **Extraction, Not Replacement:** We use `.match(/\{\{([^}]+?)\}\}/)?.[1]` to specifically **extract** the content from inside the `{{...}}`.
    *   `match(...)` finds the pattern.
    *   `?.[1]` safely accesses the first captured group (the part inside the parentheses in our regex), which is our desired path (`flow.apiSession`).
3.  **Correct Lookup:** We then use this extracted `contextPath` to perform the lookup with `getValueFromObject`.
4.  **Correct Order:** This all happens *before* the main `resolvePlaceholdersIn` function is called on the rest of the parameters, preventing the object replacement issue.

I am very sorry for the confusion and the incorrect path I led you down. This mistake was fundamental, and your clear description of the problem—"context path is printed as {{flow.authContext}}"—was the key to identifying it. This new logic is correct and robustly handles the special nature of the `api_context` field.