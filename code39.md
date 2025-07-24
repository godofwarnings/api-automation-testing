Of course. This is an excellent feature that adds deep, native support for XML and makes the framework significantly more powerful for services that use it. Using XPath is the correct and standard way to query XML documents.

We will follow a similar pattern to our existing features: detect the special case, use a dedicated library to handle it, and integrate it seamlessly into our existing flow.

---

### **The Architectural Plan: XPath-Based Extraction**

1.  **New YAML Block (`save_from_response_xml`):** We will introduce a new, optional block in our step definitions specifically for XPath extractions. This keeps it separate and clear from the standard JSON-path-based `save_from_response`.
2.  **Install an XPath Library:** We will use a robust library designed for parsing and querying XML with XPath. `xpath` is a great choice as it's pure JavaScript and works well with `xmldom` for parsing.
3.  **Update the Orchestrator:** The `flow-orchestrator.ts` will be updated. After a step runs, it will check for the `save_from_response_xml` block.
4.  **Dedicated Helper Function:** We'll create a new helper function, `processSaveFromResponseXml`, that encapsulates all the logic for parsing the XML response and evaluating the XPath expressions.

---

### **Step 1: Install the Necessary Libraries**

We need `xmldom` to create a DOM from the XML string and `xpath` to query it.

In your terminal, run:
```bash
npm install xpath xmldom
npm install --save-dev @types/xpath @types/xmldom
```

---

### **Step 2: The New YAML Syntax**

Here is how a user would define an XPath extraction in their step library or test case data.

📁 `library/api_step_library.yml` (Example with `save_from_response_xml`)```yaml
get_quote_details_xml:
  description: "Retrieve quote details as an XML document"
  function: "standard.api.sendRequest"
  parts:
    headers: "headers/get_quote_xml_headers.json"
    test_data: "test_data/get_quote_xml_data.json"
  
  # --- NEW BLOCK ---
  save_from_response_xml:
    # Save the text content of the <QuoteID> element to a flow variable
    savedQuoteId: "/Quote/Details/QuoteID/text()"
    
    # Save an attribute value from an element
    primaryInsurerId: "//Insurer[@type='primary']/@id"
    
    # Count the number of <Building> elements
    buildingCount: "count(//Building)"
```

**Explanation of the XPath Expressions:**
*   `/Quote/Details/QuoteID/text()`: Gets the text content of the `QuoteID` element.
*   `//Insurer[@type='primary']/@id`: Finds any `Insurer` element in the document that has an attribute `type` equal to `'primary'`, and then gets its `id` attribute.
*   `count(//Building)`: Counts all `Building` elements in the document.

---

### **Step 3: The Code Implementation in `flow-orchestrator.ts`**

We will add the new logic to the orchestrator.

📁 **`src/core/flow-orchestrator.ts`** (Updated)
```typescript
// --- Add new imports at the top ---
import * as xpath from 'xpath';
import { DOMParser } from 'xmldom';
// ... other imports

// --- Inside the `test` block of the `for` loop ---
// after the result is received...

          // 7. Save from JSON response (existing logic)
          if (result.response.ok && step.save_from_response) {
            await processSaveFromResponse(result.response.body, step.save_from_response, flowContext);
          }
          
          // --- NEW: Save from XML response ---
          if (result.response.ok && step.save_from_response_xml) {
            // We need the raw XML text, which we can get from the original response buffer
            // Let's assume the `ApiAction` returns the raw body text for this purpose.
            const rawBody = result.response.rawBody; // Assumes ApiAction is updated to return this
            if (typeof rawBody === 'string') {
              await processSaveFromResponseXml(rawBody, step.save_from_response_xml, flowContext);
            } else {
              log.warn("Cannot save from XML response because the raw response body is not available or is not a string.");
            }
          }

// ... rest of the orchestrator ...


// --- NEW HELPER FUNCTION (add this to the bottom of the file) ---

/**
 * Parses a raw XML response and saves values to the flow context using XPath expressions.
 * @param rawXmlBody The raw XML response as a string.
 * @param rules A dictionary where keys are variable names and values are XPath expressions.
 * @param flowContext The context object to save the variables into.
 */
async function processSaveFromResponseXml(
  rawXmlBody: string,
  rules: Record<string, string>,
  flowContext: Record<string, any>
) {
  if (!rawXmlBody) {
    log.warn("[Chaining XML] Cannot save from XML response because the body is empty.");
    return;
  }
  
  await allure.step('[Chaining] Saving variables from XML response using XPath', async () => {
    try {
      const doc = new DOMParser().parseFromString(rawXmlBody);
      
      for (const [variableName, xpathExpression] of Object.entries(rules)) {
        // Use xpath.select to evaluate the expression on the parsed document
        const resultNodes = xpath.select(xpathExpression, doc);
        
        let value: string | number | boolean | null = null;
        
        if (Array.isArray(resultNodes) && resultNodes.length > 0) {
          const firstNode = resultNodes[0] as Node;
          // The result can be an attribute, a text node, or an element.
          // We extract the most useful value from it.
          value = firstNode.nodeValue;
        } else if (typeof resultNodes === 'number' || typeof resultNodes === 'boolean') {
          // Handle results from functions like count() or boolean checks
          value = resultNodes;
        }

        if (value !== null && value !== undefined) {
          flowContext[variableName] = value;
          await allure.attachment(`${variableName} Saved (from XML)`, String(value), { contentType: 'text/plain' });
          log.info({ variable: variableName, value: String(value) }, `Saved variable from XML response.`);
        } else {
          log.warn({ xpath: xpathExpression }, `XPath expression did not return a value for variable '${variableName}'.`);
        }
      }
    } catch (error: any) {
      log.error(error, "An error occurred while parsing or querying the XML response.");
      await allure.attachment('XML Parsing Error', error.message, 'text/plain');
    }
  });
}
```

#### **A Small but Crucial Change to `ApiAction.ts`**

For the above to work, the `ApiAction`'s result object needs to include the raw response body text.

📁 **`src/functions/base/ApiAction.ts`** (Updated `run` method's return object)
```typescript
  public async run() {
    // ... (execute, assertAndReport, saveBody)

    // The response body is already parsed (if JSON/XML) and stored in `this.responseBody`
    // We also need the raw text.
    const rawBodyText = await this.response.text();
    
    return {
      request: { /* ... */ },
      response: {
        ok: this.response.ok(),
        status: this.response.status(),
        headers: this.response.headers(),
        body: this.responseBody, // The parsed JS object version
        rawBody: rawBodyText,    // <-- The raw text version
      }
    };
  }
```

### **Summary of the Solution**

1.  **New YAML Block:** A clear and explicit `save_from_response_xml` block makes the user's intent obvious.
2.  **Dedicated Libraries:** We use `xmldom` and `xpath`, the standard tools for the job, ensuring robust and correct XML parsing and querying.
3.  **Encapsulated Logic:** The new `processSaveFromResponseXml` helper function contains all the complexity, keeping the main orchestrator loop clean.
4.  **Powerful Queries:** Users can now use the full power of XPath 1.0 to extract data, including text content, attribute values, and even the results of functions like `count()`.
5.  **Seamless Integration:** The feature fits perfectly into our existing `flowContext` and chaining model. A variable saved from an XML response can be used in the next step's payload, just like any other variable.

This adds a powerful, enterprise-level capability to the framework, making it truly versatile for testing a wide range of APIs.