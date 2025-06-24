You have found a critical flaw in the previous design. You are absolutely right. The current approach of logging the response body as a text attachment in `sendRequest` and then separately saving the binary file later is incorrect and leads to the problems you described.

Saving a PDF as a text attachment will corrupt it, and separating the attachment from the file-saving logic is messy.

Let's fix this by implementing a much more robust and correct solution.

---

### **The Correct Architectural Solution**

1.  **Centralize Response Handling:** All logic related to processing the response—parsing it, attaching it to Allure, and saving it to a file—should happen in **one place**. This will be in the main test execution loop (`executeApiFlows` or `executeApiTests`), right after the `response` object is received.
2.  **Remove Attachments from `sendRequest`:** The `sendRequest` function's only job should be to send the request and return the raw `APIResponse` object. It should not be responsible for logging or attaching the response. This improves separation of concerns.
3.  **Use Raw Buffers:** We will work with the raw `response.body()` buffer. This is the key to correctly handling both binary files (like PDFs) and text-based files (like JSON/XML).
4.  **Smart Allure Attachments:** We will create a new helper function that determines the correct `contentType` for the Allure attachment based on the response headers, ensuring that PDFs are attached as `application/pdf`, JSON as `application/json`, etc. This makes them downloadable with the correct format from the Allure report.

---

### **The Code: Step-by-Step Implementation**

#### **Step 1: Update `sendRequest` to Simplify It**

We will remove the response handling logic from this function.

📁 **`src/core/test-executor.ts`** (Updated `sendRequest`)
```typescript
/**
 * Prepares and sends the API request. Its only job is to return the raw response.
 */
async function sendRequest(request: APIRequestContext, testCase: TestCase): Promise<APIResponse> {
  // ... (All logic to prepare `finalHeaders` and `options` remains the same) ...

  await allure.step(`[Action] ${testCase.method} ${testCase.endpoint}`, async () => {
    // Log the request details before sending
    await allure.attachment('Request Headers', JSON.stringify(options.headers, null, 2), { contentType: 'application/json' });
    if (options.jsonData) {
      await allure.attachment('Request Payload', JSON.stringify(options.jsonData, null, 2), { contentType: 'application/json' });
    } else if (options.data) {
      await allure.attachment('Request Payload', String(options.data), { contentType: options.headers?.['Content-Type'] || 'text/plain' });
    }
  });

  // Send the request and simply return the response object
  const response = await request[testCase.method.toLowerCase() as 'post'](testCase.endpoint, options);
  
  return response;
}
```

#### **Step 2: Create a New, Smarter Response Handler**

We will create a new helper function that will be the single source of truth for all response processing.

📁 **`src/core/test-executor.ts`** (New Helper Function)
```typescript
/**
 * A utility to get the correct file extension and MIME type from response headers.
 */
function getContentTypeDetails(response: APIResponse): { extension: string, mimeType: string } {
  const contentType = response.headers()['content-type'] || 'application/octet-stream';
  
  if (contentType.includes('json')) return { extension: 'json', mimeType: 'application/json' };
  if (contentType.includes('xml')) return { extension: 'xml', mimeType: 'application/xml' };
  if (contentType.includes('pdf')) return { extension: 'pdf', mimeType: 'application/pdf' };
  if (contentType.includes('png')) return { extension: 'png', mimeType: 'image/png' };
  if (contentType.includes('jpeg')) return { extension: 'jpg', mimeType: 'image/jpeg' };
  if (contentType.includes('text/plain')) return { extension: 'txt', mimeType: 'text/plain' };
  
  return { extension: 'bin', mimeType: 'application/octet-stream' }; // Default for binary data
}

/**
 * Handles all processing of the API response: attaching to Allure,
 * saving to a file, and parsing the body for further use.
 */
async function handleApiResponse(
  response: APIResponse,
  step: FlowStep,
  flowContext: Record<string, any>,
  stepHistory: Record<string, any>
): Promise<any> { // Returns the parsed body
  
  const bodyBuffer = await response.body();
  const { extension, mimeType } = getContentTypeDetails(response);
  let parsedBody: any = null;

  await allure.step(`[Result] Received Response (Status: ${response.status()})`, async () => {
    // 1. Attach headers
    await allure.attachment('Response Headers', JSON.stringify(response.headers(), null, 2), { contentType: 'application/json' });

    // 2. Attach the body with the correct content type for Allure
    if (bodyBuffer.length > 0) {
      await allure.attachment(`Response Body (.${extension})`, bodyBuffer, { contentType: mimeType });
      
      // 3. Try to parse the body for chaining, but only if it's text-based
      if (mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('text')) {
        parsedBody = tryParseJson(bodyBuffer.toString('utf8'));
      } else {
        // For binary files, the "body" for chaining purposes is null
        parsedBody = null; 
        log.info(`Response is binary (${mimeType}), skipping body parsing for chaining.`);
      }
    }
  });

  // 4. Save the file if requested
  if (step.save_response_body) {
    // This helper now gets the correct extension and buffer directly
    await saveResponseBodyToFile(extension, bodyBuffer, step, flowContext, stepHistory);
  }
  
  return parsedBody;
}


// You will also need to update the saveResponseBodyToFile function
// to accept the extension directly.

async function saveResponseBodyToFile(
  extension: string, // <-- Now takes extension as an argument
  bodyBuffer: Buffer,
  step: FlowStep,
  flowContext: Record<string, any>,
  stepHistory: Record<string, any>
) {
  // ... (config and context setup)
  
  // No longer needs to determine extension from headers, it's passed in.
  const finalFilename = `${resolvedFilename}.${extension}`;
  
  // ... (rest of the file writing logic is the same)
}
```

#### **Step 3: Update the Main `executeApiFlows` Loop**

Now, the main loop becomes cleaner and calls our new handler.

📁 **`src/core/test-executor.ts`** (Updated `executeApiFlows` loop)
```typescript
// Inside executeApiFlows...
for (const step of flow.steps) {
  test(step.description, async ({ request, authedRequest }) => {
    // ... (logic to resolve placeholders and save from request)
    const resolvedStep = await resolveStepPlaceholders(step, flowContext, stepHistory);
    // ... save from request ...

    // 1. Send the request
    const response = await sendRequest(apiRequest, resolvedStep);

    // 2. Handle the entire response in one go
    const responseBody = await handleApiResponse(response, resolvedStep, flowContext, stepHistory);
    
    // 3. Save state to history
    stepHistory[step.step_id] = { request: { body: tryParseJson(resolvedStep.payload) }, response: responseBody };

    // 4. Assertions
    const expected = step.expected || { status: 200 };
    await allure.step(`[Assert] Status Code - Expected: ${expected.status}`, () => {
      expect(response.status()).toBe(expected.status);
    });
    if (expected.body) {
      await assertBody(responseBody, expected.body);
    }
    
    // 5. Save from response (now uses the parsed body from the handler)
    if (response.ok() && step.save_from_response) {
      processSaveFromResponse(responseBody, step.save_from_response, flowContext);
    }
  });
}
```

### **Summary of the Fix**

1.  **`sendRequest` is Clean:** It now only sends the request and returns the response object.
2.  **`handleApiResponse` is the New Core:** This function is now the single point of control for processing a response.
3.  **Correct Allure Attachments:** It reads the raw `response.body()` as a buffer and attaches it to Allure with the **correct MIME type** (e.g., `application/pdf`). This ensures that when you click the attachment in the Allure report, your browser knows to download it as a PDF, not a text file.
4.  **Safe Body Parsing:** It only attempts to parse the response body for chaining (`save_from_response`) if the content type is text-based. It correctly avoids trying to parse a PDF as JSON.
5.  **File Saving is Correct:** The `saveResponseBodyToFile` logic is now called from the central handler, ensuring it has access to the raw buffer and correct file extension.

This new structure is much more robust, correct, and aligns perfectly with your requirement to handle various response types properly in both Allure reports and file downloads.


You are absolutely right. That is a small but very annoying issue that detracts from the professional feel of the framework. My apologies for that oversight.

The problem lies in the `allure.attachment()` call for the response body, where I included the parentheses in the filename.

Here is the simple and direct fix.

---

### **The Fix: Correcting the Attachment Name**

The only function that needs to be changed is the `handleApiResponse` helper in `test-executor.ts`. We will simply adjust the string used for the attachment name.

📁 **`src/core/test-executor.ts`** (The corrected part of the `handleApiResponse` function)
```typescript
async function handleApiResponse(
  response: APIResponse,
  step: FlowStep,
  flowContext: Record<string, any>,
  stepHistory: Record<string, any>
): Promise<any> {
  
  const bodyBuffer = await response.body();
  const { extension, mimeType } = getContentTypeDetails(response);
  let parsedBody: any = null;

  await allure.step(`[Result] Received Response (Status: ${response.status()})`, async () => {
    // Attach headers (no change here)
    await allure.attachment('Response Headers', JSON.stringify(response.headers(), null, 2), { contentType: 'application/json' });

    if (bodyBuffer.length > 0) {
      // --- THIS IS THE CORRECTED LINE ---
      // The name of the attachment is just "Response Body", and Playwright/Allure
      // will use the `contentType` to suggest the correct filename on download.
      // By default, many browsers will use the name of the attachment as the base filename.
      const attachmentName = `Response Body.${extension}`;
      await allure.attachment(attachmentName, bodyBuffer, { contentType: mimeType });
      // --- END OF FIX ---
      
      // ... (rest of the function: parsing body, etc.) ...
    }
  });

  // ... (rest of the function: saving file) ...
  
  return parsedBody;
}
```

### **Why This Fix Works**

*   **Before:** The attachment name was `Response Body (.pdf)`. When you clicked "Download," the browser would suggest saving the file with that literal name, including the parentheses.
*   **After:** The attachment name is now `Response Body.pdf`. When you click "Download," the browser will correctly suggest saving a file named `Response Body.pdf`.

This is a small change, but it's crucial for user experience and correctness. The framework should handle file naming conventions properly without requiring manual cleanup from the user.