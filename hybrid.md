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


Excellent. This is the perfect time to make that conceptual leap. By designing the core executor to be agnostic of the test *type* (UI vs. API), we create the truly hybrid engine you envisioned.

The key is that the executor's job is not to *do* the work, but to **prepare the context** and **delegate to the correct function**.

Here is the conceptual design for the new, unified `executeFlow` function.

---

### **The Hybrid Engine: `executeFlow`**

This function will be the single entry point for running any flow defined in a YAML file. It doesn't care if the steps are UI, API, or a mix of both.

#### **1. The Hybrid YAML Flow File**

The YAML structure we designed in the last step is already 99% of the way there. The `type` key is the critical switch that the hybrid engine will use.

📁 `tests/flows/hybrid_quote_validation.flow.yml` (New Hybrid Example)
```yaml
flow_id: "HYBRID_E2E_QUOTE_TO_UI"
description: "Create a quote via API and validate its details on the UI"

steps:
  - step_id: "create_quote_api"
    description: "Step 1 (API): Create a new quote"
    type: "api" # <-- The engine uses this to select the right context
    function: "standard.sendRequest"
    parameters_file: "tests/products/bop/params/create_quote_api_params.json"
    save_from_response:
      createdQuoteId: "quoteId"
      quotePageUrl: "links.ui_url" # Assume the API response gives a direct link

  - step_id: "navigate_to_quote_page_ui"
    description: "Step 2 (UI): Navigate to the quote page"
    type: "ui" # <-- The engine sees this and provides a 'page' object
    function: "standard.navigateToUrl" # A standard, reusable UI function
    parameters_file: "tests/ui/params/navigate_to_quote_params.json"

  - step_id: "validate_quote_details_ui"
    description: "Step 3 (UI): Validate quote details on the page"
    type: "ui"
    # A custom UI function that knows how to interact with the quote page
    function: "custom.validateQuoteDetails" 
    parameters_file: "tests/ui/params/validate_quote_details_params.json"
```

#### **2. The Unified `executeFlow` Function**

This function will replace `executeApiFlows`. It uses a simple `switch` statement based on the step `type` to provide the correct "context" (e.g., `authedRequest` for API, `page` for UI) to the function being called.

📁 **`src/core/test-executor.ts`** (The new `executeFlow` function)
```typescript
// At the top, you would import your page objects for UI tests
// import { QuotePage } from '@/pages/quote-page';

// The new unified executor
export function executeFlow(flowYamlPath: string) {
  // ... (logic to load and validate the flow YAML file) ...
  const flow: ApiFlow = yaml.load(/* ... */) as ApiFlow;

  test.describe.serial(`Hybrid Flow: ${flow.description}`, () => {
    // --- Context Setup ---
    // These contexts persist for the entire duration of the flow.
    const flowContext: Record<string, any> = {}; // For saved variables
    const stepHistory: Record<string, any> = {}; // For historical data

    // --- Function Registry ---
    // In a real implementation, this would dynamically load all functions from `src/functions`
    const functionRegistry = {
      'api.standard.sendRequest': sendRequest, // An API function
      'ui.standard.navigateToUrl': navigateToUrl, // A standard UI function
      'ui.custom.validateQuoteDetails': validateQuoteDetails, // A custom UI function
    };

    // --- Test Execution Loop ---
    for (const step of flow.steps) {
      // For UI tests, we need the 'page' fixture. For API, 'authedRequest'.
      // We pass all available contexts to the test block.
      test(step.description, async ({ page, authedRequest }) => {
        // 1. Load and resolve parameters for the current step
        const params = loadAndResolveParameters(step.parameters_file, { flow: flowContext, steps: stepHistory });
        
        // 2. Look up the function to execute
        const functionToExecute = functionRegistry[step.function];
        if (!functionToExecute) {
          throw new Error(`Function '${step.function}' is not registered.`);
        }

        let result: any; // To store the result of the step (API response or UI data)

        // 3. --- The Hybrid Switch ---
        // Delegate to the function with the correct context based on the step 'type'.
        allure.step(`[${step.type.toUpperCase()}] ${step.description}`, async () => {
          switch (step.type) {
            case 'api':
              log.info({ function: step.function }, "Executing API step.");
              result = await functionToExecute({
                apiRequest: authedRequest,
                params: params,
                flowContext: flowContext
              });
              break;

            case 'ui':
              log.info({ function: step.function }, "Executing UI step.");
              result = await functionToExecute({
                page: page, // Pass the Playwright page object
                params: params,
                flowContext: flowContext
              });
              break;
            
            // You could add other types here in the future, e.g., 'database', 'ssh'
            default:
              throw new Error(`Unsupported step type: '${step.type}'`);
          }
        });

        // 4. Post-execution processing (same for all types)
        const responseData = (result && result.json) ? await result.json() : result;
        stepHistory[step.step_id] = { request: params, response: responseData };
        
        // 5. Assertions and saving variables
        if (params.expected) {
          await assertResponse(result, params.expected);
        }
        if (result && result.ok && step.save_from_response) {
          processSaveFromResponse(responseData, step.save_from_response, flowContext);
        }
      });
    }
  });
}
```

#### **3. The Universal Function Signature**

To make this work seamlessly, all registered functions (both UI and API) should adhere to a similar signature. They will accept a single object containing their required context.

**API Function Signature:**
📁 `src/functions/api/standard/sendRequest.ts`
```typescript
export async function sendRequest({ apiRequest, params }) {
  // `apiRequest` is the pre-authenticated Playwright APIRequestContext
  // `params` contains the resolved endpoint, method, payload, etc.
  // ...
  return await apiRequest[params.method.toLowerCase()]...;
}
```

**UI Function Signature:**
📁 `src/functions/ui/custom/validateQuoteDetails.ts`
```typescript
import { QuotePage } from '@/pages/quote-page';

export async function validateQuoteDetails({ page, params, flowContext }) {
  // `page` is the Playwright Page object
  // `params` might contain expected values (e.g., from the API response)
  // `flowContext` contains variables saved from previous steps

  const quotePage = new QuotePage(page);
  const expectedQuoteId = flowContext.createdQuoteId; // Get ID from previous API step

  await expect(quotePage.quoteIdHeader).toHaveText(expectedQuoteId);
  // ... more UI validations
  
  // A UI function might not return anything, or it might scrape data from the page.
  return { status: 'validated' }; 
}
```

### **Summary of the Hybrid Design**

*   **Agnostic Core (`executeFlow`):** The main executor doesn't know how to send an API request or click a button. It only knows how to read the YAML, load parameters, and call the correct registered function with the correct context (`page` or `authedRequest`).
*   **`type` is the Switch:** The `type` field in the YAML step is the critical piece of metadata that controls which context is passed to the function.
*   **Universal Function Registry:** The `functionRegistry` is the heart of the plug-and-play system. To add a new capability, you simply write a new function that expects the appropriate context (`{ page, params }` or `{ apiRequest, params }`) and register it.
*   **Seamless Chaining:** The `flowContext` and `stepHistory` are shared across *all* steps, regardless of their type. This means a UI step can easily access data saved from a previous API step, and vice-versa, enabling true end-to-end hybrid testing.

This design fully abstracts the execution logic, creating a powerful, scalable, and maintainable engine ready for any type of test you want to support in the future.