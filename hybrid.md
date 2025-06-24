This is a superb and forward-thinking directive. You are moving from building a great *tool* to designing a true *platform*. The abstraction you're describing is the key to long-term scalability, maintainability, and achieving your ultimate goal of a hybrid UI/API engine.

Let's conceptualize this together, focusing entirely on **Phase 1: API Test Abstraction**.

---

### **The Core Concept: Shifting from a Declarative to an Orchestrated Model**

Currently, our framework is **declarative**. The YAML file describes *what* an API call looks like, and the `test-executor` knows how to perform that single, specific task.

The new model will be **orchestrated**.
*   The **YAML Flow File** becomes the high-level orchestrator or "Director." It only knows the sequence of steps and which "Actor" is responsible for each step.
*   The **Function** becomes the "Actor." It's a self-contained unit of work that knows how to perform a specific task.
*   The **Parameters File** is the "Script" given to the Actor for a specific step.
*   The **Core Engine** is the "Stage Manager," responsible for calling the right Actor, giving them their Script, and managing the state (context) between scenes.

This clear separation of roles is the essence of the abstraction we're aiming for.

---

### **Design for Phase 1: The New Abstracted API Framework**

#### **1. The New YAML Flow File Structure (The Orchestrator)**

The flow file becomes extremely simple and readable. Its only job is to define the sequence and delegate the work.

**BEFORE (Current `flow.yml`):**
```yaml
# Highly specific, contains all details
flow_id: "BOP_E2E_QUOTE_UPDATE"
steps:
  - step_id: "create_quote_step"
    endpoint: "/post"
    method: "POST"
    headers: { ... }
    payload: file://...
    save_from_response: { ... }
```

**AFTER (New `flow.yml`):**
```yaml
# Abstracted, high-level flow
flow_id: "BOP_E2E_QUOTE_UPDATE"
description: "Full workflow to create a quote and then update it"

steps:
  - step_id: "create_quote_step"
    description: "Step 1: Create a new quote"
    type: "api"  # Essential for the future hybrid engine
    # Points to the function to execute from our function registry
    function: "standard.sendRequest" 
    # Points to the file containing all parameters for this step
    parameters_file: "tests/products/bop/params/create_quote_params.json"
    # Chaining logic can remain here, as it's part of the flow's orchestration
    save_from_response:
      createdQuoteId: "quoteId"

  - step_id: "update_quote_step"
    description: "Step 2: Update the quote with special logic"
    type: "api"
    # This step uses a PLUGGED-IN CUSTOM function
    function: "custom.updateQuoteWithStatusCheck"
    parameters_file: "tests/products/bop/params/update_quote_params.json"
```

#### **2. The External Parameters File (The "Script" for a Step)**

All the details that used to be in the step definition now move to a dedicated file. This completely decouples the flow's logic from the step's data.

📁 `tests/products/bop/params/update_quote_params.json` (New file type)
```json
{
  "endpoint": "/your/api/quotes/{{flow.createdQuoteId}}",
  "method": "PUT",
  "headers": {
    "Content-Type": "application/json"
  },
  "payload": {
    "file": "templates/bop/updateQuote_base.json"
  },
  "expected": {
    "status": 200
  }
}
```

#### **3. The Function Registry (The "Actors")**

This is the new "plug-and-play" heart of the framework. We will create a directory where all executable functions live. The core engine will read from this directory to create a map of available functions.

**New Directory Structure:**
```
src/
├── functions/
│   ├── api/
│   │   ├── standard/
│   │   │   └── sendRequest.ts  # The default API call function
│   │   └── custom/
│   │       └── updateQuoteWithStatusCheck.ts # A user-defined function
│   └── ui/ # (Placeholder for Phase 2)
└── ...
```

**Example Standard Function:**
This function will look very similar to our current `sendRequest` helper. It's the generic workhorse.

📁 `src/functions/api/standard/sendRequest.ts`
```typescript
import { APIRequestContext } from '@playwright/test';
// ... other imports

interface SendRequestParams {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  payload?: any;
}

export async function sendRequest(apiRequest: APIRequestContext, params: SendRequestParams) {
  // Logic to prepare options from params (e.g., options.jsonData, options.data)
  // ...
  const response = await apiRequest[params.method.toLowerCase() as 'post'](params.endpoint, options);
  return response;
}
```

**Example Custom Function (Plug-and-Play):**
A user can easily create this file to handle a special case.

📁 `src/functions/api/custom/updateQuoteWithStatusCheck.ts`
```typescript
export async function updateQuoteWithStatusCheck(apiRequest: APIRequestContext, params: any, flowContext: any) {
  // Maybe this function needs to check a value from a previous step
  // before deciding what payload to send.
  if (flowContext.somePreviousStatus === 'PENDING') {
    params.payload.status = 'APPROVED';
  }

  // It can then call the standard function or perform its own request
  const response = await apiRequest.put(params.endpoint, {
    headers: params.headers,
    data: params.payload,
  });

  // It can even have its own custom assertion logic
  if (response.status() !== 200) {
    // ... custom error handling ...
  }
  
  return response;
}
```

#### **4. The New Core Engine (`executeApiFlows`)**

The `test-executor`'s main loop will be refactored to be a true orchestrator.

**Conceptual Logic:**
```typescript
// Inside the new executeApiFlows...

const functionRegistry = await loadFunctionsFromDirectory('src/functions/api');

test.describe.serial(`API Flow: ${flow.description}`, () => {
  const flowContext = {};
  const stepHistory = {};

  for (const step of flow.steps) {
    test(step.description, async ({ authedRequest }) => {
      // 1. Load the step's parameters from its file
      const params = loadParametersFile(step.parameters_file);

      // 2. Resolve all placeholders within the loaded parameters
      const resolvedParams = resolvePlaceholdersIn(params, { flow: flowContext, steps: stepHistory });
      
      // 3. Look up the function to execute from the registry
      const functionToExecute = functionRegistry[step.function];
      if (!functionToExecute) {
        throw new Error(`Function '${step.function}' not found in registry.`);
      }

      // 4. Execute the function, passing in the necessary context
      const response = await functionToExecute(authedRequest, resolvedParams, flowContext);
      
      // 5. The engine handles the post-execution tasks
      const responseBody = await tryParseJson(await response.text());
      stepHistory[step.step_id] = { request: resolvedParams, response: responseBody };

      // 6. Assert and save from response, as before
      await assertResponse(response, resolvedParams.expected);
      if (response.ok() && step.save_from_response) {
        processSaveFromResponse(responseBody, step.save_from_response, flowContext);
      }
    });
  }
});
```

This new design achieves all your goals for Phase 1. It creates a powerful abstraction layer where the flow is cleanly separated from the implementation details. Most importantly, by creating the `functionRegistry`, it provides a clear, scalable "plug-and-play" system for users to inject custom logic without ever touching the core engine, perfectly setting the stage for future UI integration.