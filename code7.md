You have identified the final, and perhaps most important, piece of the abstraction puzzle. You are absolutely right. The current `test-fixtures.ts` file is a bottleneck. It has hardcoded logic for `authedRequest` which assumes a single type of authentication (Bearer token).

A truly generic and scalable framework must allow the **user to define their own fixture types** and have the orchestrator use them dynamically.

---

### **The Game Plan: A Dynamic Fixture Model**

The core idea is to move the responsibility of creating the `APIRequestContext` from the fixture file into the **authentication function itself**.

1.  **Authentication Functions Return a Fixture, Not Just a Token:** The job of an authentication function (e.g., `standard.auth.bearerTokenLogin`) will be upgraded. Instead of just returning a token, it will now return a fully configured **`APIRequestContext`** object. This context is the "session" for that authentication type.
2.  **`flowContext` as a Fixture Cache:** The `flowContext` object, which we already use for chaining, will now also act as a **cache for these authenticated contexts**. When the auth flow runs, it will save the created `APIRequestContext` into the `flowContext` with a specific name (e.g., `flow.apiSession`).
3.  **YAML Specifies the Fixture to Use:** In a step's parameter file (`headers.json`), we will add a new key, `api_context`, which names the fixture to use for that step. For example: ` "api_context": "flow.apiSession"`.
4.  **Orchestrator Selects the Fixture:** The orchestrator will read this `api_context` key. It will then look up the requested `APIRequestContext` from the `flowContext` cache and pass that specific context to the function being executed.

This model is incredibly flexible. A user can create an auth function that returns a context authenticated with cookies, another with a bearer token, and a third with mTLS certificates. The subsequent test steps don't care *how* the context was created; they just ask for it by name.

---

### **Illustrative Example: How the New Flow Works**

#### **1. The Authentication Flow & Function**

**The Auth Function's New Job:**

📁 `src/functions/auth/standard/bearerTokenLogin.ts`
```typescript
// It now receives the base 'playwright' object to create new contexts
export async function bearerTokenLogin(executionContext, params) {
  const { playwright } = executionContext;
  // ... logic to make the auth call and get the token ...
  const token = getTheToken();

  // --- THE KEY CHANGE ---
  // It creates and returns the fully configured context object.
  const authedContext = await playwright.request.newContext({
    baseURL: params.baseUrl,
    extraHTTPHeaders: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return {
    // The main result is the context itself
    sessionContext: authedContext,
    // It can also return other data for chaining
    tokenValue: token 
  };
}
```

**The Auth Flow YAML:**

📁 `flows/auth/acme_corp_auth.flow.yml`
```yaml
flow_id: "ACME_CORP_AUTHENTICATION"
steps:
  - step_id: "login_step"
    function: "standard.auth.bearerTokenLogin"
    parameters_file: "config/auth/acme_corp_auth_params.json"
    # It saves the entire sessionContext object into the flow context
    save_from_response:
      apiSession: "sessionContext"
      bearerTokenValue: "tokenValue"
```

#### **2. A Subsequent Business Flow**

**The Parameter File Now Specifies the Context:**

📁 `params/api/bop/create_quote_headers.json`
```json
{
  "endpoint": "/v1/quotes",
  "method": "POST",
  // --- NEW KEY ---
  // This tells the orchestrator: "For this step, use the context that
  // was saved under the name 'apiSession' in the flow context."
  "api_context": "flow.apiSession",
  "headers": { /* ... */ }
}
```

#### **3. The New `flow-orchestrator.ts` Logic**

The orchestrator becomes the intelligent dispatcher.

**Conceptual Orchestrator Logic:**
```typescript
// inside the test block for a step
test(step.description, async ({ playwright, request }) => { // Note: it asks for `playwright` now
  // ...
  // The 'executionContext' now provides the raw playwright object for auth functions
  const executionContext = {
    playwright: playwright, // For creating new contexts
    // ...
  };

  // ... load and resolve parameters ...
  const resolvedParams = resolvePlaceholdersIn(params, masterContext);
  
  // --- THE NEW DISPATCH LOGIC ---
  let apiRequestContextForStep;
  const contextPath = resolvedParams.headers.api_context; // e.g., "flow.apiSession"

  if (contextPath) {
    // If a context is specified, look it up in the flow state
    log.info(`Using specified API context: '${contextPath}'`);
    apiRequestContextForStep = getValueFromObject(masterContext, contextPath);
    if (!apiRequestContextForStep) {
      throw new Error(`The specified api_context '${contextPath}' was not found.`);
    }
  } else {
    // If nothing is specified, fall back to the default, unauthenticated request object
    log.info("Using default unauthenticated API context.");
    apiRequestContextForStep = request;
  }
  
  // We no longer pass the context in the 'executionContext' object.
  // We pass it directly to the function that needs it.
  const func = functionRegistry.get(step.function);
  // A standard API function's signature would now be:
  // func(apiContext, params, masterContext)
  const result = await func(apiRequestContextForStep, resolvedParams, masterContext);
  
  // ...
});
```
*Self-correction:* The `executionContext` passed to a function should be lean. The `apiRequestContextForStep` should be passed as a direct, top-level argument to the function. This makes the function's signature clear and its dependencies explicit.

### **Summary of Benefits**

*   **Truly Generic:** The framework has **zero** hardcoded knowledge of authentication. It only knows how to store and retrieve contexts from the `flowContext` cache.
*   **User-Defined Fixtures:** The user is now in complete control. They can write any number of authentication functions (`bearerTokenLogin`, `cookieLogin`, `mTLSLogin`) that produce different `APIRequestContext` objects.
*   **Step-Level Control:** A single flow could, in theory, use different authenticated contexts for different steps by specifying a different `api_context` in each step's parameter file. This is incredibly powerful for testing scenarios involving multiple user roles or systems.
*   **Fixture File Becomes Obsolete:** The `test-fixtures.ts` file is no longer needed at all, as its job has been completely absorbed by the new, flexible auth function model.

This is the final and most powerful abstraction. It makes the framework a true orchestration engine, completely agnostic to the implementation details of the steps it is running.