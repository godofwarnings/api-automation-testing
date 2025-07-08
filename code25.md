You have identified two of the most important "quality of life" issues for framework users. These are exactly the kind of problems we need to solve to move from a "functional" framework to a "delightful" one. You are right to connect them; they are two sides of the same coin: **managing persistent context across a flow.**

Let's brainstorm a comprehensive solution that addresses both issues elegantly.

---

### **The Core Problem: Repetitive Configuration**

The root of both problems is that we are forcing the user to re-state the same context (`api_context`) and configuration (`baseURL`) for every single step, even when it's identical for the entire flow. This is verbose, error-prone, and violates the "Don't Repeat Yourself" (DRY) principle.

---

### **The Brainstorming & The Game Plan: A Hierarchical Context Model**

The solution is to introduce a **hierarchy of configuration**. The framework will be smart enough to look for configuration at different levels, from most specific to most general.

**The New Hierarchy:**

1.  **Step-Level Context (Most Specific):** A step can define its own `api_context` or `baseURL`. This is the override level, perfect for a single step that needs to call a different system or use a different user's credentials.
2.  **Flow-Level Context (The New Default):** The main `flow.yml` file will now have an optional `default_context` block. This is where you define the `api_context` and `baseURL` to be used for **all steps in the flow**, unless a step explicitly overrides it.
3.  **Global/Run-Level Context (The Fallback):** The `run_config.json` created by `global.setup.ts` already contains a `baseURL`. This will serve as the ultimate fallback if neither the step nor the flow specifies a `baseURL`.

This model provides the ultimate flexibility. For a simple flow, you define the context once at the flow level. For a complex flow, you can override it for specific, exceptional steps.

---

### **How the New YAML Would Look**

#### **1. The Authentication Flow (No Change)**

The auth flow's job is still to create and save a context.

📁 `flows/auth/acme_corp_auth.flow.yml`
```yaml
# ...
steps:
  - step_id: "login_step"
    function: "standard.auth.bearerTokenLogin"
    parameters_file: "config/auth/acme_corp_auth_params.json"
    save_from_response:
      # We save the created session context with a clear name
      acmeApiSession: "sessionContext"
```

#### **2. The Business Flow (The Big Improvement)**

The main flow file now has a `default_context` block.

📁 `flows/api/bop_quote_reusable.flow.yml`
```yaml
flow_id: "BOP_E2E_REUSABLE_QUOTE"
description: "A flow built from a reusable step library"
depends_on: "ACME_CORP_AUTHENTICATION"

# --- NEW: FLOW-LEVEL CONTEXT BLOCK ---
default_context:
  # This context will be used for ALL steps in this flow by default.
  api_context: "{{flow.acmeApiSession}}" 
  # We can also define a default baseURL for the whole flow here.
  # If omitted, it will fall back to the one from the global run config.
  # baseURL: "https://api.specific-bop-service.com" 

steps:
  - step_id: "create_new_bop_quote" # This will automatically use acmeApiSession
  - step_id: "get_quote_by_saved_id" # This will also use acmeApiSession

  - step_id: "call_external_system" # <-- THE OVERRIDE
    # This specific step needs a different context, so it defines its own.
    # Its parameters file will contain api_context: "{{flow.otherSystemSession}}"
```
Notice how clean this is. You define the context once for the 99% case, and only override it for the 1% exception.

#### **3. The Step Parameter File (`headers.json`)**

The `api_context` key in the `headers.json` file is now considered an **override**. If it's present, it will be used instead of the flow-level default. If it's absent, the flow-level default is used. The `endpoint` can now be a relative path, as the base URL is handled by the context.

📁 `data/BOP_CREATE/.../headers/create_quote_headers.json`
```json
{
  "endpoint": "/v1/quotes",
  "method": "POST"
  // No need to specify `api_context` here if we're using the flow's default.
}
```

---

### **How the Orchestrator's Logic Will Evolve**

The `prepareStepForExecution` function will be updated to implement this new hierarchical lookup.

**Conceptual `prepareStepForExecution` Logic:**
```typescript
async function prepareStepForExecution(step, flow, dataPath, flowContext, ...) {
  // ... compose raw parameters from files ...
  const params = await composeStepParameters(...);

  // --- NEW HIERARCHICAL CONTEXT LOOKUP ---
  
  // 1. Start with the ultimate fallback: the global run config's baseURL.
  let baseUrlForStep = runConfig.baseURL;
  let contextPathForStep = null; // Default to no specific context

  // 2. Check for a flow-level default context.
  if (flow.default_context) {
    if (flow.default_context.baseURL) {
      baseUrlForStep = resolvePlaceholdersInString(flow.default_context.baseURL, masterContext);
    }
    if (flow.default_context.api_context) {
      contextPathForStep = resolvePlaceholdersInString(flow.default_context.api_context, masterContext);
    }
  }

  // 3. Check for a step-level override in the parameters file.
  // This has the highest precedence.
  if (params.headers.baseURL) { // Allow baseURL override at step level
    baseUrlForStep = resolvePlaceholdersInString(params.headers.baseURL, masterContext);
  }
  if (params.headers.api_context) { // Allow api_context override at step level
    contextPathForStep = resolvePlaceholdersInString(params.headers.api_context, masterContext);
  }

  // --- END OF HIERARCHICAL LOOKUP ---
  
  // Now, select the final APIRequestContext based on the resolved path.
  let apiRequestContextForStep = defaultRequest;
  if (contextPathForStep) {
    const foundContext = getValueFromObject(masterContext, contextPathForStep);
    apiRequestContextForStep = foundContext;
  }
  
  // If the chosen context doesn't have a baseURL baked in, we can create a new
  // one with the baseURL we determined from our hierarchy.
  // This part is tricky and needs careful implementation.
  // A better approach is that an auth function ALWAYS returns a context with a baseURL.
  
  // ... prepare execution context ...
}
```
**Self-Correction on `baseURL`:** The cleanest design is to enforce that **any created `APIRequestContext` (from an auth function) is created with a `baseURL`**. The `baseURL` is an intrinsic part of a session. The `default_context` block in the YAML would therefore only need the `api_context` key. The orchestrator would then simply select the correct, pre-configured context object. This avoids the complexity of trying to "add" a `baseURL` to an existing context.

### **Summary of the Solution**

1.  **Introduce `default_context`:** Add a new optional `default_context` block at the top level of the `flow.yml` file. This block will contain the `api_context` to be used for all steps in that flow.
2.  **Prioritize Step-Level Overrides:** The orchestrator will first check if `params.headers.api_context` exists for a given step. If it does, it uses that.
3.  **Use Flow-Level Default:** If no step-level context is found, it will then check for `flow.default_context.api_context` and use that.
4.  **Fallback to Unauthenticated:** If neither a step-level nor a flow-level context is specified, it will fall back to using the default, unauthenticated `request` object.

This solution elegantly solves both problems. It eliminates the need to repeat `api_context` for every step, and it provides a clear, hierarchical model for managing the `baseURL` and authentication state for an entire flow, while still allowing for powerful step-level overrides when needed.