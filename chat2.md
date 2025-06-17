This is an excellent and crucial requirement for any serious API testing framework. You've perfectly described the need for **test chaining** and **end-to-end flow testing**. A single API call is rarely useful on its own; value comes from simulating a full business process.

We will achieve this by introducing a new concept in our YAML definitions: a **"flow"**. A flow is a sequence of API calls (steps) that must be executed in order, where data from one step can be used in subsequent steps.

This is a significant enhancement. Here is the plan and the updated code.

---

### **The Architectural Plan: How to Achieve Chaining**

1.  **New YAML Structure (`flow`):** We will create a new way to define tests for end-to-end flows. Instead of a simple list of test cases, a file can now define a `flow` with an array of `steps`.

2.  **`test.describe.serial()`:** To guarantee the execution order, we will wrap the entire flow in Playwright's `test.describe.serial()`. This ensures each step runs sequentially in the same worker process.

3.  **Flow Context:** We'll introduce a `flowContext` object at the start of each flow. This object will act as a temporary storage for data that needs to be passed between steps.

4.  **Enhanced Placeholders:** Our placeholder syntax `{{...}}` will be made more powerful to access this new context:
    *   `{{flow.variableName}}`: To get a value saved from a previous step's **response**.
    *   `{{steps.step_id.request.body.path}}`: A new syntax to access the **request payload** of a previous step.

5.  **New Test Executor:** We will create a new function, `executeApiFlows`, in our `test-executor.ts` to handle this new flow structure. The old `executeApiTests` can remain for simple, non-chained tests.

---

### **Step 1: The New YAML `flow` Schema**

Here is an example of what a new end-to-end test definition file will look like. Imagine this file is named `create_and_retrieve_quote.flow.yml`.

📁 `tests/products/bop/flows/create_and_retrieve_quote.flow.yml` (New file)
```yaml
flow_id: "BOP_E2E_QUOTE_RETRIEVAL"
description: "Full workflow to create a quote and then retrieve it"

steps:
  - step_id: "create_quote_step" # A unique ID to reference this step later
    description: "Step 1: Create a new quote with valid data"
    endpoint: "/post" # Using httpbin.org/post
    method: "POST"
    auth: "bearer"
    headers:
      Content-Type: "application/json"
    payload:
      file://templates/bop/createQuote_base.json # Assume this has {{petName}}
    
    # New section: what to save from the response of this step
    save_from_response:
      # Save the 'id' from the response body into a flow variable called 'createdQuoteId'
      createdQuoteId: "json.id" 
      # Save the name we sent, but from the echoed response, into 'createdPetName'
      createdPetName: "json.name"

  - step_id: "retrieve_quote_step"
    description: "Step 2: Retrieve the newly created quote using its ID"
    # Use the variable saved from the previous step in the URL
    endpoint: "/get?quoteId={{flow.createdQuoteId}}" # Using httpbin.org/get
    method: "GET"
    auth: "bearer"
    # No payload for GET request

  - step_id: "update_quote_step"
    description: "Step 3: Update the quote, reusing data from the original request"
    endpoint: "/put" # Using httpbin.org/put
    method: "PUT"
    auth: "bearer"
    headers:
      Content-Type: "application/json"
    payload:
      quoteId: "{{flow.createdQuoteId}}" # Use a variable from a previous response
      # New concept: Use data from a PREVIOUS REQUEST's payload
      petNameWas: "{{steps.create_quote_step.request.body.name}}"
      newStatus: "sold"
```

### **Step 2: Update the Test Executor with `executeApiFlows`**

This is the core of the new functionality. We will add a new exported function to `test-executor.ts` and several new helper functions.

📁 **`src/core/test-executor.ts`** (Additions and new functions)
```typescript
// --- Add these imports at the top ---
import { test, expect } from '@/helpers/test-fixtures';
import { get } from 'http';
// ... other imports

// --- Keep all existing code (interfaces, executeApiTests, sendRequest, etc.) ---
// ...

// --- NEW: Type Definitions for Flows ---
interface FlowStep extends TestCase {
  step_id: string;
  save_from_response?: Record<string, string>;
}

interface ApiFlow {
  flow_id: string;
  description: string;
  steps: FlowStep[];
}

// --- NEW: Main Executor for Flows ---
export function executeApiFlows(flowYamlPath: string) {
  if (!fs.existsSync(flowYamlPath)) {
    throw new Error(`FATAL: Flow definition file not found: ${flowYamlPath}`);
  }
  
  const flow: ApiFlow = yaml.load(fs.readFileSync(flowYamlPath, 'utf8')) as ApiFlow;
  if (!flow || !flow.flow_id || !Array.isArray(flow.steps)) {
    throw new Error(`Invalid flow structure in ${flowYamlPath}`);
  }

  // Use test.describe.serial to GUARANTEE sequential execution
  test.describe.serial(`API Flow: ${flow.description}`, () => {
    const flowContext: Record<string, any> = {}; // Holds variables like {{flow.createdQuoteId}}
    const stepHistory: Record<string, { request: any, response: any }> = {}; // Holds past request/response bodies

    for (const step of flow.steps) {
      test(step.description, async ({ request, authedRequest }) => {
        const apiRequest = step.auth === 'bearer' ? authedRequest : request;

        // 1. Resolve placeholders in the current step's definition
        const resolvedStep = resolvePlaceholders(step, flowContext, stepHistory);

        // 2. Send the request using the existing helper
        const response = await sendRequest(apiRequest, resolvedStep);
        const responseBody = response.ok() ? await tryParseJson(await response.text()) : null;

        // 3. Save the request and response to history for future steps
        stepHistory[step.step_id] = {
            request: (resolvedStep.payload) ? await tryParseJson(resolvedStep.payload) : null,
            response: responseBody
        };

        // 4. Save values from the response to the flow context for the next step
        if (response.ok() && step.save_from_response) {
            processSaveFromResponse(responseBody, step.save_from_response, flowContext);
        }

        // 5. Run assertions (if you add an 'expected' block to your flow steps)
        // For now, we just check that the request was successful
        expect(response.ok(), `API call for step '${step.description}' failed with status ${response.status()}`).toBeTruthy();
      });
    }
  });
}

// --- NEW: Helper Functions for Chaining ---

/**
 * Replaces all placeholders in a step's endpoint and payload.
 */
function resolvePlaceholders(step: FlowStep, flowContext: Record<string, any>, stepHistory: Record<string, any>): FlowStep {
  const resolvedStep = JSON.parse(JSON.stringify(step)); // Deep copy to avoid modifying original
  let stepString = JSON.stringify(resolvedStep);

  const placeholderRegex = /\{\{([\w\.]*)\}\}/g;
  stepString = stepString.replace(placeholderRegex, (match, placeholderPath) => {
    let value: any;
    if (placeholderPath.startsWith('flow.')) {
      value = getValueFromObject(flowContext, placeholderPath.substring(5));
    } else if (placeholderPath.startsWith('steps.')) {
      value = getValueFromObject(stepHistory, placeholderPath.substring(6));
    }
    
    if (value === undefined) {
      console.warn(`Placeholder '{{${placeholderPath}}}' could not be resolved. It will be replaced with an empty string.`);
      return "";
    }

    // If we're replacing a value in a JSON string, we need to be careful.
    // If the placeholder was the *entire* value (e.g., "payload": "{{flow.someObject}}"),
    // we don't want to wrap the resolved object in quotes. This is a complex problem.
    // For now, we'll just do a simple string replacement.
    // A more robust solution might use a recursive object traversal.
    return String(value);
  });
  
  return JSON.parse(stepString);
}

/**
 * Extracts values from a response and saves them to the flow context.
 */
function processSaveFromResponse(responseBody: any, rules: Record<string, string>, flowContext: Record<string, any>) {
  if (!responseBody) return;
  allure.step('[Chaining] Saving variables from response', async () => {
    for (const [variableName, jsonPath] of Object.entries(rules)) {
      const value = getValueFromObject(responseBody, jsonPath);
      if (value !== undefined) {
        flowContext[variableName] = value;
        await allure.attachment(`${variableName} Saved`, String(value), { contentType: 'text/plain' });
      } else {
        console.warn(`Could not find path '${jsonPath}' in response to save as '${variableName}'.`);
      }
    }
  });
}

// You will also need this helper if it's not already in the file
function getValueFromObject(obj: any, path: string): any {
  return path.split('.').reduce((o, key) => (o && o[key] !== undefined ? o[key] : undefined), obj);
}
```
*Note: The `resolvePlaceholders` function provided uses a simple string replace. This works well for URLs and simple values but can be tricky if you try to substitute an entire JSON object into a payload. A more advanced version would recursively traverse the payload object.*

### **Step 3: Create a "Glue" Spec File for the Flow**

Finally, create a new spec file that calls our new `executeApiFlows` function.

📁 `tests/products/bop/specs/e2e_quote.spec.ts` (New file)
```typescript
import { executeApiFlows } from '@/core/test-executor';
import * as path from 'path';

const flowPath = path.join('tests', 'products', 'bop', 'flows', 'create_and_retrieve_quote.flow.yml');

executeApiFlows(flowPath);
```

### **How to Run It**

Your existing npm scripts will work perfectly. When you run `npm run test:bop:httpbin`, Playwright will now pick up `e2e_quote.spec.ts`, which will execute the new flow logic.

1.  It will run the `create_quote_step`.
2.  The `processSaveFromResponse` function will see `save_from_response`, extract the ID from the response body, and save it to `flowContext.createdQuoteId`.
3.  On the second step, `resolvePlaceholders` will see `{{flow.createdQuoteId}}` in the endpoint URL, look it up in the `flowContext`, and substitute it into the URL before making the request.
4.  On the third step, it will resolve both `{{flow.createdQuoteId}}` and `{{steps.create_quote_step.request.body.name}}` to build the new payload.

This creates a powerful, declarative way to define and execute complex end-to-end API scenarios.



Of course. You've hit on the exact limitation of the previous design. A truly powerful flow-testing engine must allow every step to be as flexible as the first one, including using template files for payloads.

You are correct. The logic needs to be enhanced so that for *any* step in a flow, we can:
1.  Point to a base template file (JSON or XML).
2.  Fill in placeholders in that template using data from previous steps.

Let's implement this. The core change will be a much smarter `resolvePlaceholders` function that operates on the actual payload content, not just strings in the YAML definition.

---

### **Step 1: The Enhanced YAML Flow**

The YAML structure remains the same, but now we can use file-based payloads in any step.

📁 `tests/products/bop/flows/create_and_update_quote.flow.yml` (Example)
```yaml
flow_id: "BOP_E2E_QUOTE_UPDATE"
description: "Full workflow to create a quote and then update it"

steps:
  - step_id: "create_quote_step"
    description: "Step 1: Create a new quote"
    endpoint: "/post" # Using httpbin.org/post
    method: "POST"
    auth: "bearer"
    headers:
      Content-Type: "application/json"
    payload:
      # Use a template for the initial creation
      file://templates/bop/createQuote_base.json
    save_from_response:
      createdQuoteId: "json.id" # Assume httpbin gives us back an "id"
      requestHeaders: "headers" # Save the entire headers object from the response

  - step_id: "update_quote_step"
    description: "Step 2: Update the newly created quote"
    endpoint: "/put" # Using httpbin.org/put
    method: "PUT"
    auth: "bearer"
    headers:
      Content-Type: "application/json"
      # You can even use saved variables in headers
      X-Original-Request-ID: "{{flow.requestHeaders.X-Amzn-Trace-Id}}"
    payload:
      # CRUCIAL: Step 2 now ALSO uses a template file
      file://templates/bop/updateQuote_base.json
```

---

### **Step 2: Create the New Template File for the Second Step**

This template contains placeholders that will be filled by the flow executor.

📁 `templates/bop/updateQuote_base.json` (New File)
```json
{
  "quoteId": "{{flow.createdQuoteId}}",
  "status": "updated",
  "updatedBy": "AutomationFlow"
}
```

---

### **Step 3: The Smarter `test-executor.ts`**

This is where the magic happens. We will completely replace the old, simple `resolvePlaceholders` function with a more robust system that can handle file loading and recursive object traversal.

📁 **`src/core/test-executor.ts`** (Updated `executeApiFlows` and new helpers)
```typescript
// --- Keep all existing imports, interfaces, and executeApiTests() ---
// ...

// --- NEW: Type Definitions for Flows (Unchanged) ---
interface FlowStep extends TestCase { /* ... */ }
interface ApiFlow { /* ... */ }

// --- NEW: Main Executor for Flows (Updated Logic) ---
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

        // 1. Resolve placeholders in the current step before sending
        const resolvedStep = await resolveStepPlaceholders(step, flowContext, stepHistory);

        // 2. Send the request with the resolved payload and endpoint
        const response = await sendRequest(apiRequest, resolvedStep);
        const responseBody = response.ok() ? await tryParseJson(await response.text()) : null;

        // 3. Save resolved request and response to history
        stepHistory[step.step_id] = {
            request: resolvedStep.payload ? tryParseJson(resolvedStep.payload) : null,
            response: responseBody
        };

        // 4. Save values from the response to the flow context
        if (response.ok() && step.save_from_response) {
            processSaveFromResponse(responseBody, step.save_from_response, flowContext);
        }

        // 5. Assert success
        expect(response.ok(), `API call for step '${step.description}' failed with status ${response.status()}`).toBeTruthy();
      });
    }
  });
}

// --- NEW & IMPROVED: Helper Functions for Chaining ---

/**
 * Orchestrator function that loads payload from file and resolves all placeholders.
 */
async function resolveStepPlaceholders(step: FlowStep, flowContext: Record<string, any>, stepHistory: Record<string, any>): Promise<TestCase> {
  const resolvedStep = JSON.parse(JSON.stringify(step)); // Deep copy
  const context = { flow: flowContext, steps: stepHistory };

  // Resolve placeholders in endpoint and headers first
  if (resolvedStep.endpoint) {
    resolvedStep.endpoint = resolvePlaceholdersInString(resolvedStep.endpoint, context);
  }
  if (resolvedStep.headers) {
    resolvedStep.headers = resolvePlaceholdersInObject(resolvedStep.headers, context);
  }

  // If payload is a file, load it and then resolve placeholders in its content
  if (typeof resolvedStep.payload === 'string' && resolvedStep.payload.startsWith('file://')) {
    const filePath = path.join(process.cwd(), resolvedStep.payload.replace('file://', ''));
    if (!fs.existsSync(filePath)) throw new Error(`Payload file not found: ${filePath}`);
    
    let fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Check if the file is JSON or XML/text
    if (filePath.endsWith('.json')) {
      const jsonContent = JSON.parse(fileContent);
      resolvedStep.payload = resolvePlaceholdersInObject(jsonContent, context);
    } else {
      resolvedStep.payload = resolvePlaceholdersInString(fileContent, context);
    }
  } else if (typeof resolvedStep.payload === 'object' && resolvedStep.payload !== null) {
    // If payload is an inline object in the YAML
    resolvedStep.payload = resolvePlaceholdersInObject(resolvedStep.payload, context);
  }

  return resolvedStep;
}

/**
 * Resolves placeholders in a simple string.
 */
function resolvePlaceholdersInString(text: string, context: any): string {
  const placeholderRegex = /\{\{([\w\.]+)\}\}/g;
  return text.replace(placeholderRegex, (match, placeholderPath) => {
    const value = getValueFromObject(context, placeholderPath);
    return value !== undefined ? String(value) : match; // Return original placeholder if not found
  });
}

/**
 * Recursively traverses any object/array and resolves placeholders. Preserves types.
 */
function resolvePlaceholdersInObject(data: any, context: any): any {
  if (Array.isArray(data)) {
    return data.map(item => resolvePlaceholdersInObject(item, context));
  }
  if (typeof data === 'object' && data !== null) {
    const newObj: { [key: string]: any } = {};
    for (const key in data) {
      newObj[key] = resolvePlaceholdersInObject(data[key], context);
    }
    return newObj;
  }
  if (typeof data === 'string') {
    const placeholderRegex = /^\{\{([\w\.]+)\}\}$/; // Matches if string IS a placeholder
    const match = data.match(placeholderRegex);
    if (match) {
      // It's an exact match, so return the value with its original type
      const value = getValueFromObject(context, match[1]);
      return value !== undefined ? value : data;
    } else {
      // It's a string with placeholders inside, do simple string replacement
      return resolvePlaceholdersInString(data, context);
    }
  }
  return data; // Return numbers, booleans, null as-is
}

/**
 * Extracts values from a response and saves them to the flow context.
 */
function processSaveFromResponse(responseBody: any, rules: Record<string, string>, flowContext: Record<string, any>) {
  // ... (This function remains unchanged from the previous version)
}

function getValueFromObject(obj: any, path: string): any {
  // ... (This function remains unchanged)
}

// Ensure the rest of the file (sendRequest, assertBody, etc.) is present.
```

### **How This Works**

1.  **Orchestration in `resolveStepPlaceholders`**: This new function is the key. Before executing a step, it's called to prepare the `TestCase` object.
2.  **File Loading First**: It checks if `step.payload` is a file path. If so, it reads the file's content *into memory*.
3.  **Content-Aware Replacement**:
    *   If the file was a `.json` file, it parses the content into a JavaScript object and calls the new `resolvePlaceholdersInObject` function.
    *   If the file was `.xml` or `.txt`, it calls `resolvePlaceholdersInString` to do a simple find-and-replace.
4.  **Recursive and Type-Preserving**: The `resolvePlaceholdersInObject` function is now recursive.
    *   It traverses nested objects and arrays.
    *   Crucially, if a string value is an *exact* match for a placeholder (e.g., `"quoteId": "{{flow.createdQuoteId}}"`), it replaces the placeholder with the *actual value and its type*. If `createdQuoteId` was the number `123`, the final payload will have `"quoteId": 123`, not `"quoteId": "123"`. This is critical for type-sensitive APIs.
5.  **Final `sendRequest`**: The `sendRequest` function receives the fully resolved, final payload object or string and sends it, just as it did before.

This design is much more powerful and aligns perfectly with your requirement to use template files at any stage of an end-to-end flow.