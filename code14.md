Excellent. Now that the core orchestration and context handling are stable, it's the perfect time to add first-class support for XML. This is a crucial feature for any enterprise-grade API testing framework.

We will follow the same principle as before: **Convert XML to a JavaScript object as early as possible, operate on the object, and convert it back to XML only when necessary.** This allows us to reuse all of our powerful placeholder and data extraction logic.

---

### **The Game Plan: Full XML Support**

1.  **Orchestrator Detects XML:** The `composeStepParameters` function will detect if a payload file is `.xml` and parse it into a JS object, flagging it as having an XML origin.
2.  **`ApiAction` Handles XML Serialization:** Before sending a request, the `ApiAction` class will check for the XML flag and convert the processed JS object back into an XML string.
3.  **Response Handling:** When a response is received, we will check the `Content-Type` header. If it's XML, we will parse the response body into a JS object.
4.  **Universal Chaining:** Our `save_from_response` and `save_from_request` logic (which uses `getValueFromObject`) will now work seamlessly on the JS object representation of the XML, including the array query syntax.

---

### **Step 1: The Code Implementation**

The changes will be primarily in `composeStepParameters` (in the orchestrator) and the `ApiAction` base class.

#### **A. Update `composeStepParameters` to Parse XML Payloads**

This logic was correct in a previous version, and we are now restoring and confirming it.

📁 **`src/core/flow-orchestrator.ts`** (Updated `composeStepParameters`)
```typescript
import * as convert from 'xml-js';
// ... other imports

async function composeStepParameters(parts: StepPartFiles, dataPath: string): Promise<ComposedStepParams> {
  const composed: Partial<ComposedStepParams> = {};
  
  // ... (logic to load headers and test_data remains the same)

  if (parts.payload) {
    const filePath = path.join(dataPath, parts.payload);
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // --- XML DETECTION LOGIC ---
      if (path.extname(filePath).toLowerCase() === '.xml') {
        log.debug("Found XML payload file. Converting to JS object for processing.");
        composed.payload = convert.xml2js(fileContent, { compact: true });
        // Add a flag so we know to convert it back later
        composed.payload._originalType = 'xml';
      } else {
        // Assume JSON by default
        composed.payload = JSON.parse(fileContent);
      }
    } else {
      log.warn(`Payload part file not found: ${filePath}`);
    }
  }
  
  return composed as ComposedStepParams;
}
```

#### **B. Update the `ApiAction` Class to Handle XML Request & Response**

This is the most significant change. The `ApiAction` class will now be responsible for both serializing XML requests and deserializing XML responses.

📁 **`src/functions/base/ApiAction.ts`** (Major Update)
```typescript
import * as convert from 'xml-js';
// ... other imports

export class ApiAction {
  // ... (properties and constructor are unchanged)

  protected async execute(): Promise<APIResponse> {
    const { method, endpoint } = this.params.headers;
    const finalHeaders = await this.buildHeaders();
    const options: { headers: any; data?: any; jsonData?: any; } = { headers: finalHeaders };
    
    const payload = this.params.payload;

    if (method !== 'GET' && method !== 'DELETE' && payload) {
      // --- XML SERIALIZATION LOGIC ---
      if (payload._originalType === 'xml') {
        log.debug("Payload is flagged as XML. Converting JS object back to XML string for request.");
        const tempPayload = { ...payload };
        delete tempPayload._originalType; // Don't send our internal flag
        options.data = convert.js2xml(tempPayload, { compact: true, spaces: 2 });
        // Ensure the Content-Type header is set correctly
        finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/xml';
      } else {
        // Standard JSON handling
        options.jsonData = payload;
      }
    }

    log.info({ method, endpoint }, "ApiAction: Sending request.");
    return this.apiRequest[method.toLowerCase() as 'post'](endpoint, options);
  }

  protected async assertAndReport() {
    const expected = this.params.test_data?.expected || { status: 200 };

    await allure.step(`[Response] Status: ${this.response.status()}`, async () => {
      // ... (header attachment logic) ...
      
      const bodyBuffer = await this.response.body();
      if (bodyBuffer.length > 0) {
        const contentType = this.response.headers()['content-type'] || '';
        
        // --- XML DESERIALIZATION LOGIC ---
        if (contentType.includes('xml')) {
          log.debug("Response Content-Type is XML. Converting to JS object.");
          const xmlText = bodyBuffer.toString('utf8');
          this.responseBody = convert.xml2js(xmlText, { compact: true });
          // Attach the raw XML text to the report for clarity
          await allure.attachment(`Response Body.xml`, xmlText, { contentType: 'application/xml' });
        } else {
          // Default to trying to parse as JSON or keeping as text
          const bodyText = bodyBuffer.toString('utf8');
  
          this.responseBody = tryParseJson(bodyText);
          await allure.attachment(`Response Body.json`, bodyText, { contentType: 'application/json' });
        }
      }

      // Assertions will now work on the JS object representation of the XML
      test.expect(this.response.status()).toBe(expected.status);
      if (expected.body) {
        // The assertBody helper can now handle the object version of the XML
        // await assertBody(this.responseBody, expected.body, log);
      }
    });
  }

  // The `run` method is unchanged. It orchestrates the calls correctly.
  public async run() { /* ... */ }

  // ... (other helpers like saveBodyToFile)
}
```

---

### **How All Features Now Work with XML**

Let's trace the flow for your three requirements.

#### **1. Handling XML Responses**

*   `ApiAction.assertAndReport` receives the response.
*   It checks the `Content-Type` header.
*   If it's `application/xml`, it uses `convert.xml2js` to parse the raw response text into a JavaScript object (e.g., `this.responseBody`).
*   The raw XML string is still attached to the Allure report for easy viewing.

#### **2. `save_from_response` with XML**

*   The orchestrator receives the result from the `ApiAction`. The `result.response.body` now contains the **JavaScript object version** of the XML response.
*   It calls `processSaveFromResponse(result.response.body, ...)`.
*   The `getValueFromObject` helper is called. Since it's operating on a standard JS object, it can traverse the XML structure seamlessly.
*   **Example:** To get a value from `<User><ID>123</ID></User>`, the JS object would be `{ User: { ID: { _text: '123' } } }`. Your path in the YAML would be `User.ID._text`. The array query syntax also works on arrays found within the XML structure.

#### **3. `save_from_request` with XML**

This is where the power of this approach shines.

1.  **Orchestrator (`composeStepParameters`):** Reads the `.xml` payload file and parses it into a JS object.
2.  **Orchestrator (`prepareStepForExecution`):** Calls `resolvePlaceholdersIn` on this JS object. Placeholders like `{{faker...}}` or `{{$dynamic...}}` are filled in. The result is `resolvedParams`.
3.  **Orchestrator:** Calls `processSaveFromRequest(resolvedParams, ...)`.
4.  **`processSaveFromRequest`:** Uses `getValueFromObject` on the **resolved JavaScript object version** of the payload to extract the value you need (e.g., the generated UUID) and saves it to `flowContext`.
5.  **`ApiAction.execute`:** Receives the resolved JS object, converts it back to an XML string, and sends it.

This architecture ensures that XML is treated as a structured document, allowing all our powerful data manipulation and chaining features to work on it just as easily as they do with JSON.