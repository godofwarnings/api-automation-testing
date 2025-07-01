Of course. Supporting XML payloads with the same level of dynamic capability as JSON is a critical requirement for a truly generic API testing framework. This is a challenging but very achievable task.

The most effective way to handle this is to **treat XML as a first-class citizen** by using a dedicated library to parse it into a JavaScript object, perform our replacements, and then build it back into an XML string. We will not use simple string replacement, as that is too brittle for complex XML.

---

### **The Architectural Plan: XML as Data, Not Just Text**

1.  **Install a Robust XML Library:** We will use `xml-js`, a popular and powerful library for converting between XML and JavaScript objects.
2.  **Auto-Detect Content Type:** The `composeStepParameters` function will now inspect the filename of the payload file. If it ends in `.xml`, it will use our new XML processing logic.
3.  **Unified Placeholder Resolution:** Our `resolvePlaceholdersIn` function already works on any JavaScript object. By converting the XML to a JS object first, we can reuse this powerful resolver without any changes.
4.  **Rebuild XML:** After placeholders are resolved, we will convert the modified JavaScript object back into an XML string before passing it to the `ApiAction`.
5.  **Set Correct `Content-Type`:** The `ApiAction` will ensure the `Content-Type` header is set to `application/xml` when sending the final request.

---

### **Step 1: Install the XML Library**

In your terminal, run:
```bash
npm install xml-js
npm install --save-dev @types/xml-js
```

---

### **Step 2: Update the `composeStepParameters` Function**

This is where the magic starts. We will add logic to handle `.xml` files differently from `.json` files.

📁 **`src/core/flow-orchestrator.ts`** (Updated `composeStepParameters`)
```typescript
// Add the new import at the top
import * as convert from 'xml-js';
// ... other imports

async function composeStepParameters(parts: StepPartFiles, dataPath: string): Promise<ComposedStepParams> {
  // ... (setup logic with `composed` object shell)

  if (parts.payload) {
    const filePath = path.join(dataPath, parts.payload);
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // --- NEW LOGIC: Check file extension ---
      if (path.extname(filePath).toLowerCase() === '.xml') {
        log.debug("Found XML payload file. Converting to JSON for processing.");
        // Convert XML text to a JavaScript object.
        const xmlAsJson = convert.xml2js(fileContent, { compact: true, spaces: 4 });
        composed.payload = xmlAsJson;
        // Store the original type so we can convert it back later.
        composed.payload._originalType = 'xml'; 
      } else {
        // Assume JSON for any other file type
        composed.payload = JSON.parse(fileContent);
      }
    } else {
      log.warn(`Payload part file not found: ${filePath}`);
    }
  }

  // ... (logic to load headers and test_data remains the same)

  return composed as ComposedStepParams;
}
```
**Explanation:**
*   We now check the file extension of the payload.
*   If it's `.xml`, we use `convert.xml2js` to parse it into a structured JavaScript object.
*   We add a special property, `_originalType: 'xml'`, to the payload object. This is a flag that tells our `ApiAction` later that this payload needs to be converted *back* to XML before being sent.

---

### **Step 3: Update the `ApiAction` Base Class**

The `ApiAction` class needs to be aware that a payload might have originated as XML and requires special handling before being sent.

📁 **`src/functions/base/ApiAction.ts`** (Updated `execute` method)
```typescript
// Add the new import at the top
import * as convert from 'xml-js';
// ... other imports

export class ApiAction {
  // ... (constructor and other methods) ...

  async execute(): Promise<APIResponse> {
    const { method, endpoint } = this.params.headers;
    const finalHeaders = await this.buildHeaders();
    const options: { headers: any; data?: any; jsonData?: any; } = { headers: finalHeaders };
    
    const payload = this.params.payload;

    if (method !== 'GET' && method !== 'DELETE' && payload) {
      // --- NEW LOGIC: Check for the _originalType flag ---
      if (payload._originalType === 'xml') {
        log.debug("Payload was originally XML. Converting back to XML string.");
        // Remove our temporary flag before conversion
        delete payload._originalType; 
        // Convert the processed JavaScript object back to an XML string.
        options.data = convert.js2xml(payload, { compact: true, spaces: 4 });
        // Ensure the Content-Type header is correct for XML
        finalHeaders['Content-Type'] = 'application/xml';
      } else {
        // Standard JSON handling
        const contentType = finalHeaders['Content-Type'] || '';
        if (contentType.includes('json')) {
          options.jsonData = payload;
        } else {
          // Fallback for other text types
          options.data = String(payload);
        }
      }
    }

    log.info({ method, endpoint }, "Sending API request.");
    return this.apiRequest[method.toLowerCase() as 'post'](endpoint, options);
  }

  // ... (rest of the class)
}
```
**Explanation:**
*   Before sending the request, the `execute` method now checks for the `_originalType === 'xml'` flag on the payload object.
*   If it finds the flag, it uses `convert.js2xml` to serialize the JavaScript object back into a well-formatted XML string.
*   It then assigns this string to `options.data`, which is the correct property for sending raw text/XML bodies.
*   It also ensures the `Content-Type` header is set to `application/xml`.

---

### **How to Use the XML Feature**

Your workflow is now seamless for both JSON and XML.

**1. Create your XML Payload Template**
It can have placeholders just like the JSON files. The structure of the JS object created by `xml-js` with `{ compact: true }` is very intuitive. An element `<name>John</name>` becomes `{ name: { _text: 'John' } }`. Attributes become `_attributes`.

📁 `data/BOP_CREATE_AND_RETRIEVE_QUOTE/payloads/create_quote_payload.xml`
```xml
<QuoteRequest>
    <ProductCode>{{testData.product}}</ProductCode>
    <Customer>
        <FirstName>{{faker.person.firstName}}</FirstName>
    </Customer>
</QuoteRequest>
```

**2. Update your Step Library**
Simply point to the `.xml` file. The framework handles the rest.

📁 `library/api_step_library.yml`
```yaml
create_new_quote_xml:
  function: "standard.api.sendRequest"
  parts:
    headers: "headers/create_quote_headers.json"
    payload: "payloads/create_quote_payload.xml" # <-- Just point to the XML file
    test_data: "test_data/create_quote_data.json"
```

The `composeStepParameters` function will detect the `.xml` extension, parse it into a JS object, the `resolvePlaceholdersIn` function will replace `{{...}}` in that object, and the `ApiAction` will convert it back to an XML string before sending.

This provides a robust, scalable, and highly effective way to support XML payloads with the full power of our dynamic data and placeholder resolution engine.
