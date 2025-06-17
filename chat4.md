This is an excellent question that reveals a gap in the current `resolveStepPlaceholders` logic. You've correctly identified the dilemma:

*   The first step uses a template file with a `{{$dynamic.uuid}}` placeholder. This works perfectly.
*   The second step needs to use the *exact same UUID* that was generated and sent in the first step's request.

The current framework doesn't have a built-in way to "capture" the resolved value of a dynamic placeholder from a request and make it available to the next step. Let's fix this. This is a crucial feature for testing duplicate scenarios.

### The Solution: Automatically Capturing Resolved Payloads

The most elegant solution is to modify the `test-executor` to automatically understand the state of the world after a request is made. When we resolve the placeholders for `step_1`, we will save the **final, resolved payload** into our `stepHistory`. Then, in `step_2`, we can use a placeholder to reference that saved request body.

The good news is that our `stepHistory` object is already designed to do this. We just need to make sure we're populating it correctly and using it effectively.

Here is the plan:

1.  We will ensure that the **fully resolved payload** from `step 1` (with the generated UUID) is stored in `stepHistory`. The current code already does this.
2.  We will use our existing placeholder syntax (`{{steps.step_id.request.body.path}}`) in the `step 2` template file to pull the UUID from the `step 1` request history.

---

### Step 1: Your Flow YAML (No Changes Needed)

Your flow YAML can remain exactly as you designed it. This is a sign of a good framework—the user's intent is clear, and the framework should handle the mechanics.

📁 `tests/products/bop/flows/create_duplicate_quote.flow.yml`
```yaml
flow_id: "BOP_E2E_DUPLICATE_CHECK"
description: "Verify that creating a quote with a duplicate transaction ID fails."

steps:
  - step_id: "create_quote_first_time" # Give it a clear ID
    description: "Step 1: Create a quote with a new, unique transaction ID"
    endpoint: "/your/api/quotes"
    method: "POST"
    auth: "bearer"
    headers: { "Content-Type": "application/json" }
    payload:
      # This template has the dynamic UUID placeholder
      file://templates/bop/createQuote_base.json
    expected:
      status: 201

  - step_id: "create_quote_second_time"
    description: "Step 2: Attempt to create a quote with the SAME transaction ID"
    endpoint: "/your/api/quotes"
    method: "POST"
    auth: "bearer"
    headers: { "Content-Type": "application/json" }
    payload:
      # This template will reference the first step's request
      file://templates/bop/createQuote_duplicate_base.json
    expected:
      status: 409
```

### Step 2: Your Template Files

You need two template files.

**First template (for the unique request):**

📁 `templates/bop/createQuote_base.json`
```json
{
  "customerName": "ACME Corp",
  "transactionDetails": {
    "uniqueId": "{{$dynamic.uuid}}",
    "source": "API_TEST_FRAMEWORK"
  }
}
```

**Second template (for the duplicate request):**

This is the key part. This template does not generate a *new* UUID. Instead, it has a placeholder that points to the request body of the first step.

📁 `templates/bop/createQuote_duplicate_base.json` (New File)
```json
{
  "customerName": "ACME Corp",
  "transactionDetails": {
    "uniqueId": "{{steps.create_quote_first_time.request.body.transactionDetails.uniqueId}}",
    "source": "API_TEST_FRAMEWORK_DUPLICATE_CHECK"
  }
}
```

### Step 3: The Updated `test-executor.ts`

We need to make one critical adjustment in the `executeApiFlows` function. We were storing the *unresolved* payload in history. We must store the **fully resolved payload** so that the next step can reference it.

📁 **`src/core/test-executor.ts`** (Updated `executeApiFlows` function)
```typescript
// ... (All other code remains the same: imports, interfaces, helper functions) ...

// --- Main Executor for Flows (Updated Logic) ---
export function executeApiFlows(flowYamlPath: string) {
  if (!fs.existsSync(flowYamlPath)) {
    throw new Error(`FATAL: Flow definition file not found: ${flowYamlPath}`);
  }
  
  const flow: ApiFlow = yaml.load(fs.readFileSync(flowYamlPath, 'utf8')) as ApiFlow;

  test.describe.serial(`API Flow: ${flow.description}`, () => {
    const flowContext: Record<string, any> = {};
    const stepHistory: Record<string, { request: any, response: any }> = {};

    for (const step of flow.steps) {
      test(step.description, async ({ request, authedRequest }) => {
        const apiRequest = step.auth === 'bearer' ? authedRequest : request;

        // 1. Resolve placeholders, including dynamic ones like {{$dynamic.uuid}}
        // This 'resolvedStep' now contains the final payload with the generated UUID.
        const resolvedStep = await resolveStepPlaceholders(step, flowContext, stepHistory);

        // 2. Send the request
        const response = await sendRequest(apiRequest, resolvedStep);
        const responseBody = response.ok() ? await tryParseJson(await response.text()) : null;

        // 3. CRITICAL FIX: Save the RESOLVED request payload to history
        // The resolvedStep.payload is the final object/string that was sent.
        stepHistory[step.step_id] = {
            request: { body: resolvedStep.payload }, // <-- This is the corrected line
            response: responseBody
        };

        // 4. Assert the response based on the 'expected' block
        const expected = step.expected || { status: 200 };
        await allure.step(`[Assert] Status Code - Expected: ${expected.status}`, () => {
          expect(response.status()).toBe(expected.status);
        });
        if (expected.body) {
            await assertBody(responseBody, expected.body);
        }

        // 5. Conditionally save values from the response for future steps
        if (response.ok() && step.save_from_response) {
            processSaveFromResponse(responseBody, step.save_from_response, flowContext);
        }
      });
    }
  });
}

// All other helper functions (resolveStepPlaceholders, getValueFromObject,
// sendRequest, assertBody, etc.) DO NOT need to be changed. The logic
// for placeholder resolution is already correct. The only issue was *what* we were saving
// to the history.
```

### How the Flow Works Now

1.  **Test Start:** `flowContext` and `stepHistory` are empty.
2.  **`create_quote_first_time` Step Begins:**
    *   `resolveStepPlaceholders` is called. It loads `createQuote_base.json`.
    *   It sees `{{$dynamic.uuid}}` and replaces it with a new UUID, e.g., `"abc-123"`.
    *   The `resolvedStep.payload` is now the complete JSON object with the real UUID.
    *   The request is sent. Let's assume it passes (status 201).
    *   The executor now saves the state to `stepHistory`:
        ```javascript
        stepHistory["create_quote_first_time"] = {
          request: {
            body: { 
              customerName: "ACME Corp", 
              transactionDetails: { uniqueId: "abc-123", ... } // <-- The real UUID is saved!
            }
          },
          response: { ... }
        };
        ```
3.  **`create_quote_second_time` Step Begins:**
    *   `resolveStepPlaceholders` is called. It loads `createQuote_duplicate_base.json`.
    *   It sees the placeholder `{{steps.create_quote_first_time.request.body.transactionDetails.uniqueId}}`.
    *   It calls `getValueFromObject` with the `stepHistory` context.
    *   `getValueFromObject` navigates through the history and finds the value `"abc-123"`.
    *   The placeholder is replaced. The `resolvedStep.payload` for this step is now a complete JSON object with the *exact same UUID* as the first step.
    *   The request is sent.
    *   The assertion checks for the expected `409 Conflict` status, and the test passes.

This corrected logic ensures that the state of the world after each step (including the final request payload) is accurately recorded and made available for all subsequent steps in the flow.