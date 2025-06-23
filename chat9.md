Of course. Those are excellent, practical features that will significantly improve the framework's utility for debugging and data validation.

Let's tackle this step-by-step, starting with your first requirement.

---

### **Part 1: Downloading Response Bodies with Custom Filenames**

This feature is incredibly useful for saving evidence of a test run, especially for complex responses like PDF files, images, or large JSON/XML payloads that you want to inspect later.

**The Architectural Plan:**

1.  **New YAML Block (`save_response_body`):** We will introduce a new, optional block in our test case/step definition called `save_response_body`.
2.  **Flexible Filename Configuration:** This block will be an object that allows the user to specify a filename template. This template can use placeholders to make the filename dynamic and meaningful.
3.  **Update the Test Executor:** We'll enhance the main test execution logic to check for this block after a response is received and, if present, save the response body to a file.

---

### **Step 1: The New YAML Syntax**

Here is how you would use the new `save_response_body` block in your YAML files.

📁 `tests/products/bop/flows/create_and_get_proposal.flow.yml` (Example)
```yaml
# ... inside a step ...
- step_id: "get_proposal_pdf"
  description: "Step 3: Download the proposal as a PDF"
  endpoint: "/your/api/v1/proposals/{{flow.savedProposalId}}/download"
  method: "GET"
  auth: "bearer"
  expected:
    status: 200
  
  # --- NEW BLOCK ---
  save_response_body:
    # 'enabled' is a simple flag to turn this feature on/off for a step.
    enabled: true
    # 'filename' uses placeholders to build a dynamic name.
    # The framework will automatically handle the file extension.
    filename: "proposal_{{flow.savedProposalId}}_{{$dynamic.timestamp}}"
    # Optional: specify a directory relative to the project root.
    # Defaults to a central 'downloads' directory if omitted.
    output_dir: "test-results/downloads/bop"
```

**Available Placeholders for `filename`:**
*   `{{flow.*}}` and `{{steps.*}}` to use variables from your test flow.
*   `{{$dynamic.uuid}}` and `{{$dynamic.timestamp}}` for unique identifiers.
*   We can also add special ones like `{{testCase.test_id}}`.

---

### **Step 2: The Code Implementation**

We will add a new helper function to `test-executor.ts` and call it from the main test execution loop.

📁 **`src/core/test-executor.ts`** (Updated `interfaces` and new helper)
```typescript
import { test, expect } from '@/helpers/test-fixtures';
import { APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
// ... other imports ...

// --- Type Definitions (Updated) ---
interface SaveResponseBodyConfig {
  enabled: boolean;
  filename: string;
  output_dir?: string;
}

interface TestCase {
  // ... other properties
  save_response_body?: SaveResponseBodyConfig; // <-- NEW
}

// FlowStep will automatically inherit this new property
interface FlowStep extends TestCase { /* ... */ }

// ... other interfaces ...


// --- Inside `executeApiFlows` or `executeApiTests` test block ---
// After the request is made and the response is received:

// ...
const response = await sendRequest(apiRequest, resolvedStep);
const responseBodyBuffer = await response.body(); // <-- Get the raw body as a Buffer

// ... after assertions ...

// --- NEW LOGIC ---
// Conditionally save the response body to a file
if (resolvedStep.save_response_body?.enabled) {
  // We pass the raw response buffer to the save function
  await saveResponseBodyToFile(response, responseBodyBuffer, resolvedStep, flowContext, stepHistory);
}
// ...
// ...


// --- NEW HELPER FUNCTION (add this to the bottom of the file) ---

/**
 * Saves the raw response body to a file with a user-defined filename.
 * @param response The Playwright APIResponse object to get headers from.
 * @param bodyBuffer The response body as a Buffer.
 * @param step The resolved test step containing the save configuration.
 * @param flowContext The context for resolving placeholders in the filename.
 * @param stepHistory The history for resolving placeholders in the filename.
 */
async function saveResponseBodyToFile(
  response: APIResponse,
  bodyBuffer: Buffer,
  step: FlowStep,
  flowContext: Record<string, any>,
  stepHistory: Record<string, any>
) {
  const config = step.save_response_body!;
  const context = { flow: flowContext, steps: stepHistory, testCase: step };

  await allure.step(`[SAVE] Saving response body to file`, async () => {
    // 1. Resolve any placeholders in the filename
    let resolvedFilename = resolvePlaceholdersInString(config.filename, context);

    // 2. Determine the file extension from the response's Content-Type header
    const contentType = response.headers()['content-type'] || 'application/octet-stream';
    let extension = 'bin'; // default extension
    if (contentType.includes('json')) extension = 'json';
    else if (contentType.includes('xml')) extension = 'xml';
    else if (contentType.includes('pdf')) extension = 'pdf';
    else if (contentType.includes('png')) extension = 'png';
    else if (contentType.includes('jpeg')) extension = 'jpg';
    else if (contentType.includes('text/plain')) extension = 'txt';
    
    // Sanitize filename to prevent path traversal issues
    resolvedFilename = resolvedFilename.replace(/[\/\\]/g, '_'); // Replace slashes
    const finalFilename = `${resolvedFilename}.${extension}`;

    // 3. Determine the output directory
    const outputDir = config.output_dir ? path.join(process.cwd(), config.output_dir) : path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const finalPath = path.join(outputDir, finalFilename);

    // 4. Write the file
    fs.writeFileSync(finalPath, bodyBuffer);

    // 5. Add an attachment to the Allure report linking to the saved file
    allure.attachment('Saved Response File', `File saved at: ${finalPath}`, 'text/plain');
    log.info({ path: finalPath }, `Response body saved to file.`);
  });
}

// Ensure you have a 'log' instance created with createLogger('TestExecutor')
// and that `resolvePlaceholdersInString` is available in this file.
```

### **Summary of this Step**

1.  **YAML Enhancement:** We've added a clear, declarative `save_response_body` block to our YAML schema.
2.  **New Helper Function:** A dedicated `saveResponseBodyToFile` function encapsulates the logic for creating the filename, determining the extension, creating directories, and writing the file.
3.  **Dynamic Naming:** The filename is dynamically generated using the same powerful placeholder system we use for everything else.
4.  **Smart Extension:** The file extension is automatically determined from the `Content-Type` header of the response, ensuring `.pdf`s are saved as `.pdf`s and `.json` as `.json`.
5.  **Allure Integration:** An attachment is added to the report, making it clear that a file was saved and where it can be found.
6.  **Raw Buffer Handling:** We correctly use `response.body()` to get the raw `Buffer`, which is essential for correctly saving binary files like images or PDFs without corruption.

This feature is now fully implemented. Shall we proceed to your second requirement: `save_from_body`?

Excellent point. A robust framework should always have sensible defaults to reduce boilerplate configuration and prevent errors. Forgetting a configuration detail should not break the test run.

Let's refactor the `saveResponseBodyToFile` helper function to include these defaults.

### **The Defaulting Strategy**

1.  **If `output_dir` is not provided:** We will default to a root-level directory named `test_downloads/`. This keeps downloaded artifacts separate from reports or other generated code.
2.  **If `filename` is not provided:** We will create a default filename that is still highly useful for debugging. A good default would be: `[test_id]_[timestamp]`. This guarantees uniqueness and traceability.
3.  **If the entire `save_response_body` block is just `enabled: true`:** We will apply all the defaults.

---

### **The Updated `saveResponseBodyToFile` Function**

Here is the updated helper function within `test-executor.ts`. This is the only part of the code that needs to be changed.

📁 **`src/core/test-executor.ts`** (The updated helper function)
```typescript
/**
 * Saves the raw response body to a file with a user-defined filename.
 * Includes sensible defaults if parts of the configuration are omitted.
 */
async function saveResponseBodyToFile(
  response: APIResponse,
  bodyBuffer: Buffer,
  step: FlowStep,
  flowContext: Record<string, any>,
  stepHistory: Record<string, any>
) {
  // Gracefully handle if config is just `true` or an empty object
  const config = typeof step.save_response_body === 'object' ? step.save_response_body : {};
  const context = { flow: flowContext, steps: stepHistory, testCase: step };

  await allure.step(`[SAVE] Saving response body to file`, async () => {
    // --- APPLY DEFAULTS ---
    
    // 1. Default output directory
    const outputDir = config.output_dir 
      ? path.join(process.cwd(), config.output_dir) 
      : path.join(process.cwd(), 'test_downloads'); // Sensible default directory

    // 2. Default filename template
    const filenameTemplate = config.filename || `${step.test_id || step.step_id}_{{$dynamic.timestamp}}`; // Default pattern

    // --- End of Defaults ---

    // 3. Resolve placeholders in the filename template
    let resolvedFilename = resolvePlaceholdersInString(filenameTemplate, context);

    // 4. Determine the file extension from the Content-Type header
    const contentType = response.headers()['content-type'] || 'application/octet-stream';
    let extension = 'bin'; // default extension
    if (contentType.includes('json')) extension = 'json';
    else if (contentType.includes('xml')) extension = 'xml';
    else if (contentType.includes('pdf')) extension = 'pdf';
    else if (contentType.includes('png')) extension = 'png';
    else if (contentType.includes('jpeg')) extension = 'jpg';
    else if (contentType.includes('text/plain')) extension = 'txt';
    
    // Sanitize filename to prevent path traversal issues and ensure it's valid
    resolvedFilename = resolvedFilename.replace(/[<>:"/\\|?*]/g, '_'); // Replace invalid characters
    const finalFilename = `${resolvedFilename}.${extension}`;

    // 5. Create the directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const finalPath = path.join(outputDir, finalFilename);

    // 6. Write the file
    fs.writeFileSync(finalPath, bodyBuffer);

    // 7. Add an Allure attachment and log the action
    allure.attachment('Saved Response File', `File saved at: ${finalPath}`, 'text/plain');
    log.info({ path: finalPath }, `Response body saved to file.`);
  });
}
```

### **How to Use the Defaulting Feature**

Your users now have much more flexibility in the YAML definition.

**Scenario 1: Full Configuration (as before)**
This still works perfectly.
```yaml
save_response_body:
  enabled: true
  filename: "proposal_{{flow.savedProposalId}}"
  output_dir: "test-results/downloads/bop"
```
*   **Result:** A file named `proposal_p-456.pdf` will be saved in `test-results/downloads/bop/`.

**Scenario 2: Omitting `output_dir`**
```yaml
save_response_body:
  enabled: true
  filename: "proposal_{{flow.savedProposalId}}"
```
*   **Result:** A file named `proposal_p-456.pdf` will be saved in the default `test_downloads/` directory at the project root.

**Scenario 3: Omitting `filename`**
```yaml
save_response_body:
  enabled: true
  output_dir: "test-results/downloads/bop"
```
*   **Result:** A file with a name like `get_proposal_pdf_1678890000123.pdf` will be saved in `test-results/downloads/bop/`. (Uses the `step_id` and a timestamp).

**Scenario 4: The Simplest Form**
This is for when the user just wants to save the file and doesn't care about the name or location.
```yaml
save_response_body:
  enabled: true
```
*   **Result:** A file with a name like `get_proposal_pdf_1678890000123.pdf` will be saved in the default `test_downloads/` directory.

**A small but important change:**
Inside the `executeApiFlows` (or `executeApiTests`) loop, we should check `if (resolvedStep.save_response_body)`. The check for `.enabled` is now implicitly handled by the presence of the block itself. If the block exists, we assume the user wants to save.

```typescript
// Inside the test executor loop
if (resolvedStep.save_response_body) { // Check for the block's existence
  await saveResponseBodyToFile(response, responseBodyBuffer, resolvedStep, flowContext, stepHistory);
}
```


Excellent. Let's design and implement the `save_from_body` feature.

This feature is the logical counterpart to `save_from_response`. Its purpose is to capture data from the **request body** and save it to the `flowContext` for use in later steps. This is particularly useful for saving the resolved value of a dynamic placeholder, like a `{{$dynamic.uuid}}`, that was sent in a request.

---

### **The Architectural Plan**

1.  **New YAML Block (`save_from_request`):** To avoid ambiguity with the response, we will name the new block `save_from_request`. This makes its purpose explicit. It will live alongside `save_from_response` in the YAML step definition.
2.  **Timing of Execution:** This save operation must happen *after* all placeholders in the payload have been resolved, but *before* the request is sent. The best place for this is right after `resolveStepPlaceholders` is called.
3.  **Update the Test Executor:** We'll add a new helper function, `processSaveFromRequest`, and call it from the main `executeApiFlows` loop.

---

### **Step 1: The New YAML Syntax**

Here is how you would use `save_from_request` in a flow. This example solves the exact "duplicate quote" problem we discussed earlier in a very clear way.

📁 `tests/products/bop/flows/create_duplicate_quote.flow.yml` (Updated)
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
      file://templates/bop/createQuote_base.json # This file contains {{$dynamic.uuid}}
    
    # --- NEW BLOCK ---
    save_from_request:
      # Save the dynamically generated UUID from the resolved request body
      # The path is relative to the payload.
      transactionIdSent: "body.transactionDetails.uniqueId"

    expected:
      status: 201
      body:
        should_contain_key: "quoteId"
    save_from_response:
      newlyCreatedQuoteId: "quoteId"

  - step_id: "create_quote_failure"
    description: "Step 2: Attempt to create a quote with the SAME transaction ID"
    endpoint: "/your/api/v1/quotes"
    method: "POST"
    auth: "bearer"
    headers:
      Content-Type: "application/json"
    payload:
      # This template now uses the variable we just saved from the previous request
      file://templates/bop/createQuote_with_existing_id.json
    expected:
      status: 409
```

And the new template for the second step would be:

📁 `templates/bop/createQuote_with_existing_id.json` (New File)
```json
{
  "customerName": "ACME Corp",
  "transactionDetails": {
    "uniqueId": "{{flow.transactionIdSent}}",
    "source": "API_TEST_FRAMEWORK_DUPLICATE"
  }
}
```

---

### **Step 2: The Code Implementation**

We will add a new helper function to `test-executor.ts` and update the `FlowStep` interface and the main `executeApiFlows` loop.

📁 **`src/core/test-executor.ts`** (Updated `interfaces` and new logic)
```typescript
// ... (imports and other interfaces) ...

// --- Type Definitions (Updated) ---
interface FlowStep extends TestCase {
  step_id: string;
  save_from_response?: Record<string, string>;
  save_from_request?: Record<string, string>; // <-- NEW
  expected?: ExpectedOutput;
  // ... other properties
}

// ... other interfaces ...


// --- Main Executor for Flows (Updated) ---
export function executeApiFlows(flowYamlPath: string) {
  // ... (setup logic: loading file, test.describe.serial, etc.) ...
  
  test.describe.serial(`API Flow: ${flow.description}`, () => {
    const flowContext: Record<string, any> = {};
    const stepHistory: Record<string, { request: any, response: any }> = {};

    for (const step of flow.steps) {
      test(step.description, async ({ request, authedRequest }) => {
        const apiRequest = step.auth === 'bearer' ? authedRequest : request;

        // 1. Resolve all placeholders (including dynamic ones) in the step
        const resolvedStep = await resolveStepPlaceholders(step, flowContext, stepHistory);
        const resolvedPayload = resolvedStep.payload ? tryParseJson(resolvedStep.payload) : null;

        // 2. --- NEW LOGIC ---
        // Save values from the resolved request body BEFORE sending the request
        if (step.save_from_request) {
          processSaveFromRequest(resolvedPayload, step.save_from_request, flowContext);
        }

        // 3. Send the request
        const response = await sendRequest(apiRequest, resolvedStep);
        const responseBody = response.ok() ? await tryParseJson(await response.text()) : null;

        // 4. Save the full state to history
        stepHistory[step.step_id] = { request: { body: resolvedPayload }, response: responseBody };

        // 5. Assertions
        // ...

        // 6. Save from response (existing logic)
        if (response.ok() && step.save_from_response) {
          processSaveFromResponse(responseBody, step.save_from_response, flowContext);
        }

        // 7. Save response body to file (existing logic)
        // ...
      });
    }
  });
}


// --- NEW HELPER FUNCTION (add this to the bottom of the file) ---

/**
 * Extracts values from a resolved request payload and saves them to the flow context.
 * @param resolvedPayload The final request payload object after all placeholders are resolved.
 * @param rules The rules defining what to save, from the 'save_from_request' block.
 * @param flowContext The context object to save the variables into.
 */
function processSaveFromRequest(
  resolvedPayload: any,
  rules: Record<string, string>,
  flowContext: Record<string, any>
) {
  // The path starts with "body." but our resolvedPayload IS the body, so we strip it.
  const pathPrefix = "body.";
  
  if (!resolvedPayload || typeof resolvedPayload !== 'object') {
    log.warn(`[Chaining] Cannot save from request because the payload is not a valid object.`);
    return;
  }
  
  allure.step('[SAVE] Saving variables from request body', async () => {
    for (const [variableName, dataPath] of Object.entries(rules)) {
      let cleanPath = dataPath;
      if (dataPath.startsWith(pathPrefix)) {
        cleanPath = dataPath.substring(pathPrefix.length);
      } else {
        log.warn(`[Chaining] 'save_from_request' path '${dataPath}' should start with 'body.'. Proceeding with the original path.`);
      }

      const value = getValueFromObject(resolvedPayload, cleanPath);
      
      if (value !== undefined) {
        flowContext[variableName] = value;
        await allure.attachment(`${variableName} Saved (from request)`, String(value), { contentType: 'text/plain' });
        log.info({ variable: variableName, value: String(value) }, `Saved variable from request body.`);
      } else {
        log.warn({ path: dataPath }, `Could not find path in request body to save as '${variableName}'.`);
      }
    }
  });
}

// Ensure the rest of the file (getValueFromObject, processSaveFromResponse, etc.) is present.
```

### **Summary of the Changes**

1.  **YAML Enhancement:** We've added a new `save_from_request` block that is syntactically identical to `save_from_response`, making it intuitive for users.
2.  **New Helper Function:** The `processSaveFromRequest` function encapsulates the logic for extracting data from the resolved payload. It's smart enough to handle the `body.` prefix that users will naturally want to write.
3.  **Correct Execution Order:** In the main `executeApiFlows` loop, we now have a clear and logical sequence:
    1.  Resolve all placeholders.
    2.  **Save data from the resolved request.**
    3.  Send the request.
    4.  Save the response to history.
    5.  Run assertions.
    6.  **Save data from the response.**
    7.  Save the response body to a file.

This new feature makes your framework's chaining capabilities much more powerful and elegantly solves the problem of reusing dynamically generated data in subsequent test steps.

This makes the feature much more user-friendly and robust. The user only needs to provide configuration when they want to override the sensible defaults.
