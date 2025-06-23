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
