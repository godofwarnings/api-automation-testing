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


You have encountered a very common and important issue in API test automation. The problem is almost certainly not with the code's ability to traverse a nested path, but with **what object it's traversing.**

When you make a POST request to a service like `httpbin.org/post`, the service doesn't return your payload directly. It wraps your payload inside its own response structure.

Let's break this down.

### The Root Cause: The Response Structure

Imagine your `createQuote_base.json` looks like this:
```json
{
  "customerName": "Test Customer",
  "details": {
    "id1": {
      "id2": "some_value"
    }
  }
}
```

When you POST this to `httpbin.org/post`, the response body from httpbin looks like this:
```json
{
  "args": {},
  "data": "...",
  "files": {},
  "form": {},
  "headers": { ... },
  "json": {  // <--- YOUR PAYLOAD IS WRAPPED INSIDE THIS 'json' KEY
    "customerName": "Test Customer",
    "details": {
      "id1": {
        "id2": "some_value"
      }
    }
  },
  "origin": "...",
  "url": "..."
}
```

Therefore, if your YAML `save_from_response` block looks like this:```yaml
# This is INCORRECT
save_from_response:
  myId: "details.id1.id2"
```
The framework will look for a `details` key at the *top level* of the response, fail to find it, and report "path not found".

The **correct path** must start from the top of the response body, which means it needs to include the `json` key:
```yaml
# This is CORRECT
save_from_response:
  myId: "json.details.id1.id2"
```

### The Solution: Improved Logging and Correct YAML

While the core `getValueFromObject` function is likely correct, we can significantly improve the framework by adding **better debugging information** when a path is not found. This will make it immediately obvious what the problem is in the future.

We will update the `processSaveFromResponse` function to log the available top-level keys from the response body whenever it fails to find a path.

---

Here is the updated `test-executor.ts` with enhanced debugging.

📁 **`src/core/test-executor.ts`** (Updated `processSaveFromResponse` function)
```typescript
// ... (All other code in the file remains the same) ...
// ... (imports, interfaces, executeApiFlows, resolveStepPlaceholders, etc.) ...

/**
 * Extracts values from a response and saves them to the flow context.
 * THIS FUNCTION IS NOW UPDATED WITH BETTER DEBUGGING.
 */
function processSaveFromResponse(responseBody: any, rules: Record<string, string>, flowContext: Record<string, any>) {
  if (!responseBody || typeof responseBody !== 'object') {
    console.warn(`[Chaining] Cannot save from response because the response body is not a valid object.`);
    return;
  }
  
  allure.step('[Chaining] Saving variables from response', async () => {
    for (const [variableName, jsonPath] of Object.entries(rules)) {
      const value = getValueFromObject(responseBody, jsonPath);
      
      if (value !== undefined) {
        // Successfully found the value
        flowContext[variableName] = value;
        await allure.attachment(`${variableName} Saved`, String(value), { contentType: 'text/plain' });
        console.log(`[Chaining] Saved '${variableName}' with value: ${String(value)}`);
      } else {
        // --- NEW DEBUGGING LOGIC ---
        // Failed to find the value, provide helpful debug info
        const availableKeys = Object.keys(responseBody).join(', ');
        const warningMessage = `[Chaining] Could not find path '${jsonPath}' in response body to save as '${variableName}'.`;
        const debugMessage = `Available top-level keys in the response body are: [${availableKeys}]. Make sure your path starts with one of these.`;
        
        console.warn(warningMessage);
        console.warn(debugMessage);
        
        // Attach the full response body to the Allure report for easy debugging
        await allure.attachment(
          `DEBUG - Failed to find path '${jsonPath}'`,
          JSON.stringify({
            warning: warningMessage,
            debugHint: debugMessage,
            responseBody: responseBody,
          }, null, 2),
          { contentType: 'application/json' }
        );
      }
    }
  });
}

/**
 * Utility to extract a value from an object using a dot-notation string path.
 * This function is robust and does not need to be changed.
 */
function getValueFromObject(obj: any, path: string): any {
  // Ensure we are working with an actual object
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }
  return path.split('.').reduce((o, key) => (o && o[key] !== undefined ? o[key] : undefined), obj);
}

// Ensure the rest of the test-executor.ts file (executeApiFlows, sendRequest, etc.)
// is present. The only change needed is in processSaveFromResponse.
```

### **How to Apply the Fix in Your Test**

1.  **Update `test-executor.ts`:** Replace your `processSaveFromResponse` function with the improved version above. `getValueFromObject` is also provided for completeness, but its logic is unchanged.
2.  **Correct Your YAML File:** Look at your flow YAML file (`*.flow.yml`). Find the `save_from_response` section for the step that is failing. Modify the path to include the necessary parent key (which is most likely `json` when testing with `httpbin.org/post`).

**Example Correction:**

**BEFORE (Incorrect):**
```yaml
save_from_response:
  myNestedId: "details.id1.id2" 
```

**AFTER (Correct, for httpbin):**
```yaml
save_from_response:
  myNestedId: "json.details.id1.id2"
```

With the updated logging, if you forget to do this, your test output will now clearly tell you:
```
[Chaining] Could not find path 'details.id1.id2' in response body to save as 'myNestedId'.
[Chaining] Available top-level keys in the response body are: [args, data, files, form, headers, json, origin, url]. Make sure your path starts with one of these.
```
This makes the problem immediately obvious and easy to solve.


Of course. I apologize for the previous answers being too tailored to a specific service. You are absolutely right; the framework must be generic to be useful. Your feedback is invaluable, and I will ensure the solutions from now on are built on general principles that you can apply to your own APIs.

Let's address your new requirements for **runtime unique ID generation** and **handling expected error responses** within a chained flow. This is a critical evolution for the framework.

---

### **The Architectural Plan**

1.  **Dynamic Data Generation:** We will introduce a special placeholder syntax, `{{$dynamic.*}}`, in our YAML files. When the test executor encounters this, it won't look for a saved variable; instead, it will generate data at runtime.
    *   `{{$dynamic.uuid}}` will generate a unique Version 4 UUID (e.g., `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`).
    *   `{{$dynamic.timestamp}}` will generate the current Unix timestamp (e.g., `1678886400`).

2.  **Expected Response Handling in Flows:** We will add an `expected` block to each `step` in a flow. This allows you to define the expected `status` and `body` for *any* step, not just successful ones.
    *   If a step meets its `expected` criteria (e.g., it receives the expected 409 Conflict status), the step is considered **passed**, and the flow continues.
    *   The `save_from_response` block will only execute if the response status is a successful one (2xx), preventing attempts to save data from an error response.

---

### **Step 1: Install a New Dependency for UUIDs**

We'll use the standard `uuid` library. Run this command in your project's root directory:```bash
npm install uuid
npm install --save-dev @types/uuid
```

---

### **Step 2: The New, More Powerful Flow YAML**

Here is how you would write a flow that first tries to create a quote with a unique ID, expecting success, and then immediately tries to create the *same* quote again, expecting a conflict.

📁 `tests/products/bop/flows/create_duplicate_quote.flow.yml` (New Example)
```yaml
flow_id: "BOP_E2E_DUPLICATE_CHECK"
description: "Verify that creating a quote with a duplicate transaction ID fails correctly."

steps:
  - step_id: "create_quote_success"
    description: "Step 1: Create a quote with a new, unique transaction ID"
    endpoint: "/your/api/v1/quotes"
    method: "POST"
    auth: "bearer"
    headers:
      Content-Type: "application/json"
    payload:
      file://templates/bop/createQuote_base.json
    
    # NEW: Define what a successful response looks like for this step
    expected:
      status: 201 # Expect "Created"
      body:
        should_contain_key: "quoteId"
    
    # This will only run if the status is 201 (or any 2xx)
    save_from_response:
      newlyCreatedQuoteId: "quoteId"
      # We also save the dynamic ID we sent in the request to reuse it
      # The value is resolved at runtime and stored in the context.
      transactionIdUsed: "request.body.transactionDetails.uniqueId" 

  - step_id: "create_quote_failure"
    description: "Step 2: Attempt to create a quote with the SAME transaction ID"
    endpoint: "/your/api/v1/quotes"
    method: "POST"
    auth: "bearer"
    headers:
      Content-Type: "application/json"
    payload:
      file://templates/bop/createQuote_base.json # Use the same template
    
    # NEW: Define the expected ERROR response for this step
    expected:
      status: 409 # Expect "Conflict"
      body:
        # Assert the structure of the error message from your API
        errorCode: "DUPLICATE_TRANSACTION_ID"
        message: "A quote with this transaction ID already exists."
```
And your template file would use the new dynamic placeholder:

📁 `templates/bop/createQuote_base.json` (Updated)```json
{
  "customerName": "ACME Corp",
  "transactionDetails": {
    "uniqueId": "{{$dynamic.uuid}}",
    "source": "API_TEST_FRAMEWORK"
  },
  "coverages": [ /* ... */ ]
}
```

---

### **Step 3: The Updated `test-executor.ts`**

This is the heart of the changes. We will add a dynamic data generator and update the flow executor to handle the `expected` block.

📁 **`src/core/test-executor.ts`** (Complete, Updated Code)
```typescript
import { test, expect } from '@/helpers/test-fixtures';
import { APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';
import { v4 as uuidv4 } from 'uuid'; // <-- Import UUID

// --- Type Definitions ---
interface TestCase { /* ... */ }
interface ExpectedOutput { /* ... */ }

interface FlowStep extends TestCase {
  step_id: string;
  save_from_response?: Record<string, string>;
  expected?: ExpectedOutput; // <-- Add expected block to flow steps
}
interface ApiFlow { /* ... */ }

// --- Main Executor for Standalone Tests (Unchanged) ---
export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) { /* ... */ }

// --- Main Executor for Flows (Updated) ---
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

        // 1. Resolve placeholders and dynamic data
        const resolvedStep = await resolveStepPlaceholders(step, flowContext, stepHistory);
        const resolvedPayload = resolvedStep.payload ? tryParseJson(resolvedStep.payload) : null;

        // 2. Send the request
        const response = await sendRequest(apiRequest, resolvedStep);
        const responseBody = await tryParseJson(await response.text());
        
        // 3. Save state to history for subsequent steps
        stepHistory[step.step_id] = { request: { body: resolvedPayload }, response: responseBody };

        // 4. Assert the response based on the 'expected' block for this step
        const expected = resolvedStep.expected || { status: 200 }; // Default to expecting success if not specified
        await allure.step(`[Assert] Status Code - Expected: ${expected.status}`, () => {
          expect(response.status()).toBe(expected.status);
        });
        if (expected.body) {
            await assertBody(responseBody, expected.body);
        }

        // 5. Conditionally save values from the response to the flow context
        if (response.ok() && step.save_from_response) {
            processSaveFromResponse(responseBody, step.save_from_response, stepHistory, flowContext);
        }
      });
    }
  });
}

// --- Helper Functions (Updated) ---

/**
 * Generates data at runtime based on a dynamic command.
 */
function generateDynamicData(command: string): string | number {
  const type = command.replace('$dynamic.', ''); // e.g., 'uuid'
  switch (type) {
    case 'uuid':
      return uuidv4();
    case 'timestamp':
      return Date.now();
    default:
      console.warn(`Unknown dynamic command: '{{${command}}}'. Returning empty string.`);
      return '';
  }
}

/**
 * Resolves placeholders in a string, now with dynamic data support.
 */
function resolvePlaceholdersInString(text: string, context: any): string {
  const placeholderRegex = /\{\{([\w\$\.]+)\}\}/g;
  return text.replace(placeholderRegex, (match, placeholderPath) => {
    if (placeholderPath.startsWith('$dynamic.')) {
      return String(generateDynamicData(placeholderPath));
    }
    const value = getValueFromObject(context, placeholderPath);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Recursively traverses any object/array and resolves placeholders.
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
    const placeholderRegex = /^\{\{([\w\$\.]+)\}\}$/; // Matches if string IS a placeholder
    const match = data.match(placeholderRegex);
    if (match) {
      const placeholderPath = match[1];
      if (placeholderPath.startsWith('$dynamic.')) {
        return generateDynamicData(placeholderPath);
      }
      return getValueFromObject(context, placeholderPath) ?? data;
    } else {
      return resolvePlaceholdersInString(data, context);
    }
  }
  return data;
}

/**
 * Orchestrator function that loads payload from file and resolves all placeholders.
 * Unchanged from the previous version.
 */
async function resolveStepPlaceholders(step: FlowStep, flowContext: Record<string, any>, stepHistory: Record<string, any>): Promise<TestCase> {
    // ... (This function's logic remains the same as the previous step,
    // as it correctly calls the updated resolvePlaceholdersIn... helpers)
    const resolvedStep = JSON.parse(JSON.stringify(step));
    const context = { flow: flowContext, steps: stepHistory };

    if (resolvedStep.endpoint) resolvedStep.endpoint = resolvePlaceholdersInString(resolvedStep.endpoint, context);
    if (resolvedStep.headers) resolvedStep.headers = resolvePlaceholdersInObject(resolvedStep.headers, context);
    
    if (typeof resolvedStep.payload === 'string' && resolvedStep.payload.startsWith('file://')) {
        const filePath = path.join(process.cwd(), resolvedStep.payload.replace('file://', ''));
        if (!fs.existsSync(filePath)) throw new Error(`Payload file not found: ${filePath}`);
        
        let fileContent = fs.readFileSync(filePath, 'utf8');
        resolvedStep.payload = filePath.endsWith('.json')
            ? resolvePlaceholdersInObject(JSON.parse(fileContent), context)
            : resolvePlaceholdersInString(fileContent, context);
    } else if (typeof resolvedStep.payload === 'object' && resolvedStep.payload !== null) {
        resolvedStep.payload = resolvePlaceholdersInObject(resolvedStep.payload, context);
    }
    return resolvedStep;
}

/**
 * Extracts values and saves them to the flow context. Now also looks in stepHistory.
 */
function processSaveFromResponse(responseBody: any, rules: Record<string, string>, stepHistory: Record<string, any>, flowContext: Record<string, any>) {
  if (!responseBody) return;
  const context = { flow: flowContext, steps: stepHistory };
  allure.step('[Chaining] Saving variables', async () => {
    for (const [variableName, dataPath] of Object.entries(rules)) {
      // Allow saving from the current response body directly
      const value = getValueFromObject(responseBody, dataPath) ?? getValueFromObject(context, dataPath);
      if (value !== undefined) {
        flowContext[variableName] = value;
        await allure.attachment(`${variableName} Saved`, String(value), { contentType: 'text/plain' });
      } else {
        // ... (warning logic with improved debugging as before) ...
      }
    }
  });
}

// Ensure the rest of the functions (sendRequest, assertBody, etc.) are present
```



That's an excellent and very important question. You've correctly identified a potential ambiguity in how `should_contain_key` works.

To give you a direct and generic answer: **No, the current implementation of `should_contain_key` does not recursively search the entire object.**

It checks for a property at a specific path from the root of the object using dot notation. For example, `user.profile.id` checks if the `actualBody` has a `user` property, which has a `profile` property, which has an `id` property.

This is powerful, but it doesn't solve the use case where you want to know if a key exists *anywhere* in a nested structure.

Let's enhance the framework to give you both capabilities:
1.  **Check for a specific nested key path (the current behavior).**
2.  **Check if a key exists anywhere, recursively.**
3.  **Check for the *value* of a nested key.**

---

### **The Solution: Clarifying and Expanding Our Assertion Logic**

We will introduce a new keyword, `should_recursively_contain_key`, to handle the deep search, and clarify how to check for nested values using `toMatchObject`.

#### **How to Use the Different Assertion Methods**

**Use Case 1: Asserting a specific nested key *path* exists (Current behavior)**
This is the best way to validate the structure of your response.

**YAML:**
```yaml
expected:
  status: 200
  body:
    should_contain_key: "transaction.details.transactionId"
```
This checks that the response looks like `{ "transaction": { "details": { "transactionId": "some-value" } } }`.

**Use Case 2: Asserting the *value* of a nested key**
This is the most common use case for validation. You use the standard `body` object, mirroring the structure you expect. `toMatchObject` handles this perfectly.

**YAML:**
```yaml
expected:
  status: 200
  body:
    # Mirror the nested structure of the expected response
    transaction:
      status: "COMPLETED"
      details:
        transactionId: "{{flow.transactionIdUsed}}" # Can even use variables
```

**Use Case 3: Asserting a key exists *anywhere* in the response (New Feature)**
This is useful for things like error responses where an `error_code` key might appear at different nesting levels.

**YAML:**
```yaml
expected:
  status: 400
  body:
    should_recursively_contain_key: "error_code"
```
This will find the `error_code` key whether the response is `{"error_code": 123}` or `{"errors": [{"details": {"error_code": 123}}]}`.

---

### **The Code: Updating `test-executor.ts`**

We will add a new helper function, `findKeyRecursively`, and update `assertBody` to use our new keyword.

📁 **`src/core/test-executor.ts`** (Updated `assertBody` and new helper)
```typescript
// ... (All other code in the file remains the same) ...
// ... (imports, interfaces, executeApiFlows, sendRequest, etc.) ...

/**
 * Contains the logic for asserting the response body, now with recursive checking.
 */
async function assertBody(actualBody: any, expectedBody: ExpectedOutput['body']) {
  if (expectedBody === undefined) return;

  await allure.step('[Assert] Response Body', async () => {
    if (expectedBody === null) {
      expect(actualBody, "Expected response body to be null or empty.").toBeNull();
    } else if (typeof expectedBody === 'string') {
      expect(actualBody, "Expected an exact string match.").toBe(expectedBody);
    } else if (typeof actualBody === 'object' && actualBody !== null) {
      // --- NEW LOGIC ORDER ---
      if (expectedBody.should_recursively_contain_key) {
        // Use Case 3: Find a key anywhere in the nested structure
        const targetKey = expectedBody.should_recursively_contain_key;
        const keyFound = findKeyRecursively(actualBody, targetKey);
        expect(keyFound, `Expected key '${targetKey}' to exist anywhere in the response body.`).toBe(true);

      } else if (expectedBody.should_contain_key) {
        // Use Case 1: Check for a specific key path from the root
        const keyPath = expectedBody.should_contain_key;
        expect(actualBody, `Expected key path '${keyPath}' not found in response body.`).toHaveProperty(keyPath);
        
      } else {
        // Use Case 2: Check for structure and values using partial matching
        expect(actualBody, "Expected JSON body to match the provided structure and values.").toMatchObject(expectedBody);
      }
    } else {
      // Handle cases where we expect an object but don't get one
      throw new Error(`Type mismatch: Expected body to be an object, but received type '${typeof actualBody}'. Actual Body: ${actualBody}`);
    }
  });
}

/**
 * A new helper function to recursively search for a key in an object or array.
 * @param data The object or array to search within.
 * @param targetKey The key to search for.
 * @returns True if the key is found, otherwise false.
 */
function findKeyRecursively(data: any, targetKey: string): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  // Check the keys of the current object
  if (targetKey in data) {
    return true;
  }

  // Recurse into the values of the current object/array
  for (const key in data) {
    if (findKeyRecursively(data[key], targetKey)) {
      return true;
    }
  }

  return false;
}

// Ensure the rest of the test-executor.ts file (executeApiFlows, sendRequest, etc.)
// is present. The only changes needed are in `assertBody` and the new `findKeyRecursively` function.
// Also ensure `toHaveProperty` is available via `expect` from Playwright.
```

### **Summary of the Solution**

1.  **No Breaking Changes:** We kept the original behavior of `should_contain_key` because checking a specific path is a precise and valuable assertion. It uses Playwright's built-in `toHaveProperty` which supports dot notation (e.g., `'a.b.c'`).
2.  **New Feature:** We added a new, clearly named property, `should_recursively_contain_key`, for the deep search functionality.
3.  **New Helper Function:** The `findKeyRecursively` function provides the logic for the deep search, handling both nested objects and arrays.
4.  **Clearer `assertBody` Logic:** The `assertBody` function now has a clear `if/else if/else` structure to handle the different assertion types, making it easy to understand and extend in the future.
5.  **Empowerment:** You are now empowered to write assertions that are as strict or as flexible as you need them to be. You can validate entire object structures, check for the existence of a specific nested property, or just confirm that a key is present *somewhere* in the response.