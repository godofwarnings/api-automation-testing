
Of course. Let's focus solely on that requirement and integrate it into the stable architecture we just reverted to.

To achieve dynamic headers, we will introduce a new, optional key in our YAML called `contextual_headers`. This keeps it separate and clear from the simple, static `headers` block.

---

### **The YAML Syntax for Dynamic Headers**

In any test case or flow step within your YAML files, you can now add a `contextual_headers` block.

**How it works:**
*   **`key`**: The name of the HTTP header you want to send (e.g., `X-Partner-ID`).
*   **`sourcePath`**: The dot-notation path to the value you want to inject. The framework will look for this path inside a special "context" object that contains the partner configuration and runtime environment details.

Here is a complete example for a single step:

```yaml
# Inside a flow step or a standalone test case definition

step_id: "create_quote_with_dynamic_headers"
description: "Create a quote using dynamically generated headers"
endpoint: "/your/api/v1/quotes"
method: "POST"
auth: "bearer"

# --- Static Headers ---
# For simple, unchanging headers
headers:
  Content-Type: "application/json"
  Accept: "application/json"

# --- Dynamic Headers ---
# For headers that need to be populated from configuration at runtime
contextual_headers:
  - key: "X-Partner-ID"
    # This path will look inside your loaded partner.json file
    sourcePath: "partnerDetails.partnerId" 

  - key: "X-API-Version"
    # This path will find the specific version for the 'bop' product
    sourcePath: "partnerDetails.products.bop.version" 

  - key: "X-Environment-Name"
    # This path will use the simplified 'env' context for the current run
    sourcePath: "env.name"

  - key: "X-Request-ID"
    # You can even use dynamic data generation here
    sourcePath: "$dynamic.uuid"

payload:
  file://templates/bop/createQuote_base.json

expected:
  status: 201
```

### **Summary of `sourcePath` Prefixes**

The `sourcePath` tells the framework where to look for the value:

*   **`partnerDetails.*`**: Looks inside the entire loaded `partner.json` file. This lets you access any custom field you add, like `partnerId` or `products.bop.version`.
*   **`env.*`**: Looks inside a convenience object that has details about the current run, like `env.name` (e.g., "sit") or `env.partner` (e.g., "partner_a").
*   **`$dynamic.*`**: Triggers the runtime data generator for values like `uuid` or `timestamp`.

This approach gives you a clean and powerful way to separate your static and dynamic header definitions directly within your test files, making them easy to read and maintain. No other part of your YAML needs to change.

Yes. You are correct. The YAML syntax I described requires corresponding code changes to work. The logic for handling `contextual_headers` needs to be implemented within the `sendRequest` function.

Here are the precise code changes required. The only file that needs to be modified is **`src/core/test-executor.ts`**.

---

### **The Code: Updating `test-executor.ts`**

We will update the `TestCase` interface to include the new `contextual_headers` property and then enhance the `sendRequest` function to build the headers dynamically.

📁 **`src/core/test-executor.ts`** (Complete, Updated Code)
```typescript
import { test, expect } from '@/helpers/test-fixtures';
import { APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';
import { v4 as uuidv4 } from 'uuid';

// --- Type Definitions (Updated) ---

// NEW: Interface for a single dynamic header
interface ContextualHeader {
  key: string;
  sourcePath: string;
}

interface TestCase {
  test_id: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>; // For static headers
  contextual_headers?: ContextualHeader[]; // NEW: For dynamic headers
  payload?: any;
  auth: 'none' | 'bearer';
}
// Other interfaces (ExpectedOutput, FlowStep, ApiFlow) remain the same,
// but FlowStep automatically inherits the new header properties from TestCase.
interface ExpectedOutput { /* ... */ }
interface FlowStep extends TestCase { /* ... */ }
interface ApiFlow { /* ... */ }


// --- Main Executors (executeApiTests and executeApiFlows) ---
// No changes are needed in the main executor functions themselves.
// They will just pass the TestCase object with the new properties to sendRequest.
export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) { /* ... */ }
export function executeApiFlows(flowYamlPath:string) { /* ... */ }


// --- Helper Functions ---

/**
 * Prepares and sends the API request, now with dynamic header generation.
 */
async function sendRequest(request: APIRequestContext, testCase: TestCase): Promise<APIResponse> {
  const { method, endpoint, headers: staticHeaders, contextual_headers, payload: rawPayload } = testCase;
  
  // 1. Start with static headers from the 'headers' block
  const finalHeaders: Record<string, string> = { ...(staticHeaders || {}) };

  // 2. Process dynamic headers from the 'contextual_headers' block
  if (contextual_headers) {
    // Load the partner config to resolve paths against
    const partner = process.env.PARTNER!;
    const partnerConfigPath = path.join(process.cwd(), 'config', 'partners', `${partner}.json`);
    const partnerConfig = JSON.parse(fs.readFileSync(partnerConfigPath, 'utf8'));

    // Create the context for placeholder resolution
    const headerContext = {
      partnerDetails: partnerConfig,
      env: {
        name: process.env.ENV!,
        partner: process.env.PARTNER!,
      },
    };

    allure.step('[Prepare] Generating dynamic headers', async () => {
        for (const header of contextual_headers) {
            let value: any;
            if (header.sourcePath.startsWith('$dynamic.')) {
                value = generateDynamicData(header.sourcePath);
            } else {
                value = getValueFromObject(headerContext, header.sourcePath);
            }

            if (value !== undefined) {
                finalHeaders[header.key] = String(value);
            } else {
                console.warn(`[Header Gen] Could not resolve header '${header.key}' from source path '${header.sourcePath}'. It will be omitted.`);
            }
        }
    });
  }

  // 3. Prepare request options and payload (logic remains the same)
  const options: { headers: any; data?: any; jsonData?: any; } = { headers: finalHeaders };
  
  let payload = rawPayload;
  if (typeof payload === 'string' && payload.startsWith('file://')) {
    const filePath = path.join(process.cwd(), payload.replace('file://', ''));
    payload = fs.readFileSync(filePath, 'utf8');
  }

  if (method !== 'GET' && method !== 'DELETE' && payload !== undefined && payload !== null) {
    const contentType = finalHeaders['Content-Type'] || finalHeaders['content-type'] || '';
    if (contentType.includes('json')) {
      options.jsonData = (typeof payload === 'string') ? JSON.parse(payload) : payload;
    } else {
      options.data = String(payload);
    }
  }

  // 4. Send the request
  await allure.step(`[Action] Sending ${method} request to ${endpoint}`, async () => {
    await allure.attachment('Request Headers', JSON.stringify(finalHeaders, null, 2), { contentType: 'application/json' });
  });

  return request[method.toLowerCase() as 'post'](endpoint, options);
}


// --- All other helper functions must be present in the file ---
// (getValueFromObject, generateDynamicData, resolveStepPlaceholders, assertBody, etc.)

function getValueFromObject(obj: any, path: string): any {
  // The robust iterative parser with array query support
  // ... (implementation from previous step)
}

function generateDynamicData(command: string): string | number {
  const type = command.replace('$dynamic.', '');
  switch (type) {
    case 'uuid': return uuidv4();
    case 'timestamp': return Date.now();
    default: return '';
  }
}

// ... and so on for all other necessary helpers from the last stable version.
```

### **Summary of the Changes**

1.  **`TestCase` Interface Update:** The interface now officially includes the optional `contextual_headers?: ContextualHeader[]` property. The `ContextualHeader` interface is also added.
2.  **`sendRequest` Function Enhancement:**
    *   It now accepts both `headers` (for static values) and `contextual_headers` (for dynamic values) from the `testCase` object.
    *   It starts by populating `finalHeaders` with any static headers.
    *   If `contextual_headers` exists, it loads the appropriate partner configuration file based on the `process.env.PARTNER` environment variable.
    *   It creates a `headerContext` object containing the loaded config and runtime environment details.
    *   It loops through the `contextual_headers` array. For each item, it resolves the `sourcePath` against the `headerContext` (or generates dynamic data) and adds the resulting key-value pair to `finalHeaders`.
    *   The `finalHeaders` object, which now contains a merge of static and dynamic headers, is used to make the API call.

This implementation cleanly separates the two types of headers in your YAML and provides a powerful, context-aware mechanism for injecting dynamic values right before a request is sent. No other files need to be changed to support this feature.


