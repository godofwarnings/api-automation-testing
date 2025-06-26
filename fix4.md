You've hit on a very subtle but critical issue. It's one of the most common problems in frameworks that use dependency injection or context objects: **The context is being created, but it's not being passed down and used by the final action.**

You are absolutely correct. The `authedRequest` fixture is creating a perfectly authenticated `APIRequestContext`, but our `ApiAction` class is not using it. It's using the *unauthenticated* `request` object that the orchestrator is passing down.

Let's fix this by correctly plumbing the authenticated context through the system.

---

### **The Root Cause and The Fix**

1.  **The Problem:** The `flow-orchestrator` receives both the standard `request` and our special `authedRequest` from the test fixture. However, when it creates the `executionContext`, it's not correctly selecting which one to pass to the function based on the step's `auth` property.
2.  **The Solution:** We will modify the `flow-orchestrator` to look at the `step.auth` property.
    *   If `step.auth === 'bearer'`, it will pass the `authedRequest` fixture to the function.
    *   If `step.auth === 'none'`, it will pass the standard, unauthenticated `request` fixture.

---

### **Step 1: Add Debugging to the `test-fixture`**

First, let's add logging to our fixture to be 100% certain that it's being created correctly and has the right data.

📁 **`src/helpers/test-fixtures.ts`** (Updated `authedRequest` fixture)
```typescript
// ... inside the `test.extend` block ...
authedRequest: async ({ playwright }, use, testInfo) => {
  // ... (logic to get productName, env, partner) ...

  log.info(`Fixture INFO: Creating 'authedRequest' for product '${productName}'.`);
  
  // ... (logic to load partner config and get baseUrl) ...
  
  const authFile = getAuthFilePath(productName);
  if (!fs.existsSync(authFile)) throw new Error(`Auth file not found: ${authFile}`);
  
  const authState = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  const token = authState.bearerToken;

  if (!token) {
    log.error({ authFile }, "Token not found in auth state file!");
    throw new Error("Token not found in auth state file!");
  }

  // --- NEW DEBUG LOG ---
  // Log the first few characters of the token to confirm it's loaded.
  log.debug({ token: `${token.substring(0, 15)}...` }, "Auth token loaded successfully.");
  // --- END DEBUG LOG ---

  const context = await playwright.request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      'Authorization': `Bearer ${token}`,
    },
  });

  await use(context);
  await context.dispose();
},
```

---

### **Step 2: Correct the `flow-orchestrator` to Use the Right Context**

This is the most critical fix. We will update the main test block inside `executeFlow` to select the correct request object.

📁 **`src/core/flow-orchestrator.ts`** (Updated `test` block)
```typescript
// ... (inside the `for (const stepInfo of flow.steps)` loop)

      // The test block correctly asks for both fixtures from Playwright.
      test(step.description, async ({ request, authedRequest }) => {
        
        await allure.step(`Executing Step: "${step.description}"`, async () => {
          log.info({ stepId: step.step_id, function: step.function }, "Starting step execution.");

          // --- 1. Select the Correct API Context based on the step's 'auth' property ---
          const apiRequest = step.auth === 'bearer' ? authedRequest : request;
          if (step.auth === 'bearer') {
            log.debug("Using 'authedRequest' fixture for this step.");
          } else {
            log.debug("Using standard 'request' fixture for this step.");
          }
          // --- END OF FIX ---

          // 2. Prepare Contexts
          const masterContext = { flow: flowContext, steps: stepHistory };
          // The executionContext now receives the CORRECTLY selected apiRequest object.
          const executionContext = {
            api: apiRequest, // <-- PASS THE CORRECT ONE
            log: log,
            run: runConfig
          };

          // --- The rest of the logic remains unchanged ---
          
          // 3. Load and Resolve Parameters
          const resolvedParams = /* ... */;

          // 4. Get and Execute the Function
          const func = functionRegistry.get(step.function);
          // The function now receives the context containing the correct request object
          const result = await func(executionContext, resolvedParams, masterContext);

          // ... (process results, chaining, etc.)
        });
      });
// ...
```

---

### **Step 3: Update `ApiAction.ts` to Use the Passed Context**

The final piece is to ensure the `ApiAction` constructor correctly receives and uses the `api` object from the `executionContext` it's given. This part was already correct in our previous design, but it's important to verify it.

📁 **`src/functions/base/ApiAction.ts`** (Verifying the constructor)
```typescript
export class ApiAction {
  protected apiRequest: APIRequestContext;
  // ... other properties

  // This constructor correctly accepts the FULL executionContext now.
  constructor(executionContext: any, params: ApiActionParams, masterContext: any) {
    // It correctly pulls the 'api' object from the context.
    // This 'api' object is the pre-authenticated 'authedRequest' if the orchestrator passed it in.
    this.apiRequest = executionContext.api; 
    this.params = params;
    this.masterContext = masterContext;
  }
  // ... rest of the class
}
```

And the standard function that uses it:

📁 **`src/functions/api/standard/sendRequest.ts`** (Verifying the call)
```typescript
export async function sendRequest(
  executionContext: any,
  params: ApiActionParams,
  masterContext: any
) {
  // This constructor call is what passes the correct context down to the action class.
  const apiAction = new ApiAction(executionContext, params, masterContext);
  return apiAction.run();
}
```

### **Summary of the Fix and Workflow**

1.  **Fixture Creates Context:** The `authedRequest` fixture runs and creates a special `APIRequestContext` with the `Authorization` header already baked in. We added logging to confirm the token is loaded.
2.  **Orchestrator Selects Context:** The `flow-orchestrator`'s test block now has a simple `if` statement: `const apiRequest = step.auth === 'bearer' ? authedRequest : request;`. This is the brain of the operation. It decides which "tool" to use for the API call.
3.  **Orchestrator Injects Context:** It passes this chosen `apiRequest` object into the `executionContext`.
4.  **Function Receives Context:** The `sendRequest` function receives the `executionContext`.
5.  **Action Uses Context:** The `ApiAction` class constructor plucks the `api` object from the context and uses it to make the actual API call.

Now, when a step is marked `auth: "bearer"`, the `ApiAction` will be using the `authedRequest` object, and the Authorization header will be correctly sent with the request. This should resolve the issue entirely.