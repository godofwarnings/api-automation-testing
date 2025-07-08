You have asked the two most critical questions that turn this from a good idea into a truly robust and error-proof implementation.

1.  How do we handle a dynamic `baseURL`?
2.  How do we prevent the framework from crashing when it tries to use a context (`api_context`) that hasn't been created yet?

Let's address both with a detailed and robust plan.

---

### **1. Handling a Dynamic `baseURL`**

You are absolutely right. The `baseURL` should not be a static string; it needs to be fully dynamic and support placeholders.

**The Solution:**

The `prepareStepForExecution` function is the perfect place to handle this. When it determines the `baseURL` to use (from the flow's `default_context` or a step-level override), it will immediately run it through our `resolvePlaceholdersInString` helper before using it.

**The Logic:**
The YAML `default_context` block will now look like this:
```yaml
default_context:
  api_context: "{{flow.acmeApiSession}}"
  # The baseURL itself is now a placeholder.
  baseURL: "{{run.configDetails.host}}" # Gets the host from the global run config
```
or even more simply, if the auth function sets it:
```yaml
default_context:
  # The acmeApiSession object already has its baseURL baked in.
  # We don't even need a separate baseURL key here.
  api_context: "{{flow.acmeApiSession}}"
```

The cleanest design is that **an `APIRequestContext` object is always treated as a complete session, with its `baseURL` baked in.** When our auth function creates this context, it will use the dynamic `host` from the partner/environment config file.

**Example `bearerTokenLogin` function:**
```typescript
// in src/functions/auth/bearerTokenLogin.ts
export async function bearerTokenLogin(executionContext, params) {
  const { playwright } = executionContext;
  // `params` will contain the resolved `baseURL` and `authPath`
  const { baseURL, authPath, credentialSource } = params;
  
  // ... get token ...
  
  const authedContext = await playwright.request.newContext({
    baseURL: baseURL, // The dynamic baseURL is baked into the context here.
    extraHTTPHeaders: { 'Authorization': `Bearer ${token}` },
  });

  return { sessionContext: authedContext };
}
```
This means the orchestrator's only job is to select the correct, pre-configured context object. It doesn't need to manage the `baseURL` separately, which is much cleaner.

---

### **2. The "Context Missing" Problem**

This is the most critical issue to solve for a stable framework. A step cannot use `{{flow.apiSession}}` if the login step hasn't created it yet.

**The Solution: Lazy Evaluation and Context Validation**

The orchestrator must be smart enough to differentiate between a placeholder that *should* exist and one that can't possibly exist yet.

**The New Orchestrator Logic in `prepareStepForExecution`:**

1.  **Compose Raw Parameters:** Load all the `parts` files for the step. The `params` object still contains unresolved `{{...}}` placeholders.
2.  **Identify the Context Instruction:** Look at `params.headers.api_context`. Let's say its value is the string `"{{flow.apiSession}}"`.
3.  **Check the Context's Prerequisite:** Before resolving anything, perform a crucial check: **Does the path `flow.apiSession` point to a variable from a step that has already run?**
    *   The orchestrator knows which steps have run (`stepHistory`).
    *   It can parse the placeholder `flow.apiSession` and know that `apiSession` is expected to be saved by a previous step.
    *   If `apiSession` is not in the `flowContext` yet, **and the `api_context` key was present**, it must throw a clear error.
4.  **Resolve and Execute:** If the context exists, proceed with selecting it and resolving all other placeholders.

**The "Lazy Evaluation" Twist:**

What about the very first step of a flow (the login step)? It doesn't have a context yet. This is where our hierarchy comes in.

**Refined Hierarchical Lookup in the Orchestrator:**
```typescript
// Inside prepareStepForExecution

// 1. Get the context instruction string from the step's params, OR the flow's default.
const contextInstruction = resolvedParams.headers.api_context || flow.default_context?.api_context;

let apiRequestContextForStep = defaultRequest; // Fallback to unauthenticated

if (contextInstruction) {
    // It's a placeholder string like "{{flow.apiSession}}"
    const contextPath = contextInstruction.match(/\{\{([^}]+?)\}\}/)?.[1];
    
    if (contextPath) {
        // --- THE CRITICAL CHECK ---
        // Look for the requested context in the state of already completed steps.
        const foundContext = getValueFromObject(masterContext, contextPath);
        
        if (foundContext) {
            // Success! We found the context created by a previous step.
            apiRequestContextForStep = foundContext;
            log.info(`Using API context found at path: '${contextPath}'`);
        } else {
            // This is not a "not found" error. It's a "prerequisite not met" error.
            // This happens if step 2 tries to use a context from step 1, but step 1 failed.
            throw new Error(`[OrchestratorError] Prerequisite failed: The context '${contextPath}' was expected to be available but was not found in the current flow state.`);
        }
    } else {
        throw new Error(`[OrchestratorError] Invalid api_context instruction: '${contextInstruction}'`);
    }
} else {
    // No context was specified at the step or flow level. This is a valid scenario
    // for a login step or a call to a public API. Use the default context.
    log.info("No specific API context requested. Using default unauthenticated context.");
}

// ... return the chosen apiRequestContextForStep
```

**How this handles the "first step" problem:**

*   **Login Step:** The `login_step` in your `auth.flow.yml` will **not** have an `api_context` key in its parameters.
*   **The orchestrator sees `contextInstruction` is `undefined`**.
*   It logs "No specific API context requested" and correctly passes the **default, unauthenticated `request` object** to the `bearerTokenLogin` function.
*   The `bearerTokenLogin` function uses this unauthenticated context to perform the login, creates a *new* authenticated context, and returns it.
*   The orchestrator saves this new context to `flowContext.apiSession`.
*   **Subsequent Steps:** When the next step runs, its `api_context` will be `{{flow.apiSession}}`. The orchestrator will now successfully find it in the `flowContext` and use it.

### **Summary of the Robust Solution**

1.  **Dynamic `baseURL` is Baked In:** The `baseURL` is resolved and baked into the `APIRequestContext` by the authentication function. This is the cleanest approach.
2.  **`api_context` is an Explicit Instruction:** The presence of the `api_context` key in a step's (or flow's) configuration is a direct instruction to the orchestrator to find and use a pre-existing session.
3.  **No Instruction = Default Context:** If `api_context` is missing, the orchestrator correctly assumes it should use the default, unauthenticated context. This is the expected behavior for a login step.
4.  **Prerequisite Check:** The orchestrator will now throw a clear, helpful error if a step requests a context that *should* have been created by a previous step but wasn't (likely because the previous step failed).

This two-pronged solution makes the framework both flexible enough to handle dynamic URLs and robust enough to prevent crashes from missing context, guiding the user with clear error messages.