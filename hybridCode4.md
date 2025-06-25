# 1

Excellent point. Skimping on the historical record is a mistake. For robust debugging and complex chaining scenarios, the `stepHistory` must be a rich, detailed log of exactly what happened.

You are right. We should go back to saving a more structured object that clearly separates the request from the response.

Let's refine the framework to ensure the `stepHistory` is as comprehensive as possible.

---

### **The Code: Enriching the `stepHistory`**

The changes will be in two key places:
1.  The `run()` method of the `ApiAction` base class will now return a more detailed object.
2.  The `flow-orchestrator` will save this richer object directly into the history.

#### **Step 1: Update the `ApiAction` Base Class to Return a Rich Result**

The `run()` method will now collect all the relevant details from the execution and return them.

📁 **`src/functions/base/ApiAction.ts`** (Updated `run` method)
```typescript
// ... (inside the ApiAction class)

  /**
   * The main "run" method that orchestrates the action.
   */
  public async run() {
    // --- Setup ---
    const finalHeaders = await this.buildHeaders();
    const { method, endpoint, payload: rawPayload } = this.params;
    const options: { headers: any; data?: any; jsonData?: any; } = { headers: finalHeaders };
    // ... logic to prepare options.data/jsonData from rawPayload ...
    const finalPayload = options.jsonData ?? options.data;

    // --- Execution ---
    this.response = await this.execute(method, endpoint, options); // Pass options to execute
    await this.assertAndReport();
    await this.saveBody();
    
    // --- Return a Rich, Structured Result Object ---
    return {
      request: {
        endpoint: endpoint,
        method: method,
        headers: finalHeaders,
        payload: finalPayload, // The final, resolved payload that was sent
      },
      response: {
        ok: this.response.ok(),
        status: this.response.status(),
        headers: this.response.headers(),
        body: this.responseBody, // The parsed response body
      }
    };
  }

  // A small update to execute() to accept the prepared options
  protected async execute(method: string, endpoint: string, options: any): Promise<APIResponse> {
    log.info({ method, endpoint }, "Sending API request.");
    return this.apiRequest[method.toLowerCase() as 'post'](endpoint, options);
  }

// ... rest of the class ...
```
*Note: I've also made a small correction to pass the prepared `options` to the `execute` method to avoid redundant logic.*

#### **Step 2: Update the Standard `sendRequest` Function**

This function doesn't need much change, as it just passes through the rich result from `apiAction.run()`.

📁 **`src/functions/api/standard/sendRequest.ts`** (Updated)
```typescript
import { ApiAction, ApiActionParams } from '../../base/ApiAction';

export async function sendRequest(context: any, params: ApiActionParams, masterContext: any) {
  const apiAction = new ApiAction(context.api, params, masterContext);
  // The result of run() is now the rich object we want to save
  return apiAction.run();
}
```

#### **Step 3: Update the `flow-orchestrator.ts`**

The orchestrator's job remains simple. It just takes the rich result object from the function and saves it directly to `stepHistory`.

📁 **`src/core/flow-orchestrator.ts`** (Updated loop)
```typescript
// ... (inside the `test` block of the `for` loop)

  // 4. Get and Execute the Function
  const func = functionRegistry.get(step.function);
  // 'result' is now the rich object: { request: {...}, response: {...} }
  const result = await func(executionContext, resolvedParams, masterContext);

  // 5. Save the entire rich result object to history
  stepHistory[step.step_id] = result;
  log.debug({ stepId: step.step_id, result }, "Saved complete result to step history.");

  // 6. Save from response (now uses the nested response body)
  if (result.response.ok && step.save_from_response) {
    processSaveFromResponse(result.response.body, step.save_from_response, flowContext);
  }

  // 7. Save from request (now uses the nested request payload)
  if (step.save_from_request) {
    // Note: We use result.request.payload, which is the final resolved payload
    processSaveFromRequest(result.request, step.save_from_request, flowContext);
  }
// ...
```

We also need to slightly adjust `processSaveFromRequest` to look inside the new structure.

```typescript
// in flow-orchestrator.ts
function processSaveFromRequest(requestData: any, rules: Record<string, string>, flowContext: Record<string, any>) {
  allure.step('[Chaining] Saving variables from request', async () => {
    // The payload is now at requestData.payload
    const payload = requestData.payload || {};
    // ... (rest of the logic is the same)
  });
}
```

### **The Result: A Comprehensive Historical Record**

Now, after a step like `create_user` runs, the `stepHistory` object will look like this:

```json
{
  "create_user": {
    "request": {
      "endpoint": "/post",
      "method": "POST",
      "headers": {
        "Content-Type": "application/json",
        "X-Transaction-ID": "a1b2-c3d4-...",
        "X-Partner-Name": "Partner A"
      },
      "payload": {
        "profile": {
          "firstName": "John",
          "lastName": "Doe"
        },
        "transaction": {
          "id": "e5f6-g7h8-..."
        }
      }
    },
    "response": {
      "ok": true,
      "status": 200,
      "headers": {
        "content-type": "application/json",
        "access-control-allow-origin": "*"
      },
      "body": {
        "json": {
          "profile": { /*...*/ },
          "transaction": { /*...*/ }
        },
        "url": "https://httpbin.org/post"
      }
    }
  }
}
```

This is exactly what you asked for. The history is no longer just a single piece of data; it's a complete, structured record of both the **final, resolved request** that was sent and the **full response** that was received. This makes the `{{steps.*}}` placeholder incredibly powerful for complex chaining scenarios and provides unparalleled detail for debugging.