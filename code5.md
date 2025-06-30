You are absolutely right, and I apologize for the oversight. This is a classic case where the "shape" of our data changed, but one of the key functions wasn't updated to handle that new shape.

You've correctly identified the two connected problems:
1.  **`composeStepParameters` is flawed:** My previous implementation merged the files in a way that lost the necessary structure. It created a flat object instead of the nested one our `ComposedStepParams` interface expects.
2.  **`resolvePlaceholdersIn` needs the correct structure:** Because the composed object was wrong, the placeholder resolver couldn't find paths like `testData.product`, because the `testData` key didn't exist at the top level.

Let's fix this with a robust and correct implementation.

---

### **The Fix: Correctly Composing and Resolving the Parameters**

#### **Step 1: Correct the `composeStepParameters` Function**

This is the most critical fix. This function MUST build an object that exactly matches the `ComposedStepParams` interface. It should not be a flat merge.

📁 **`src/core/flow-orchestrator.ts`** (Corrected `composeStepParameters` function)
```typescript
// ... (imports, including the ComposedStepParams interface) ...

/**
 * A new, correct helper function to load and structure the parts of a step's configuration.
 * @param parts - The 'parts' object from the step library definition.
 * @param dataPath - The base path to the current test case's data directory.
 * @returns An object that strictly adheres to the ComposedStepParams interface.
 */
async function composeStepParameters(parts: StepPartFiles, dataPath: string): Promise<ComposedStepParams> {
  log.debug({ parts }, "Composing step parameters from defined parts.");

  // Start with a shell object that matches our target interface structure
  const composed: Partial<ComposedStepParams> = {};

  if (parts.headers) {
    const filePath = path.join(dataPath, parts.headers);
    if (fs.existsSync(filePath)) {
      composed.headers = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      log.warn(`Headers part file not found: ${filePath}`);
    }
  }

  if (parts.payload) {
    const filePath = path.join(dataPath, parts.payload);
    if (fs.existsSync(filePath)) {
      composed.payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      log.warn(`Payload part file not found: ${filePath}`);
    }
  }

  if (parts.test_data) {
    const filePath = path.join(dataPath, parts.test_data);
    if (fs.existsSync(filePath)) {
      composed.test_data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      log.warn(`Test data part file not found: ${filePath}`);
    }
  }

  // Add a final validation to ensure the 'headers' part (which is not optional) was loaded
  if (!composed.headers) {
    throw new Error(`[OrchestratorError] The required 'headers' part was not found or failed to load for a step.`);
  }

  await allure.attachment('Composed Step Parameters (Before Resolution)', JSON.stringify(composed, null, 2), { contentType: 'application/json' });
  
  // Cast to the full type. We've ensured the structure is correct.
  return composed as ComposedStepParams;
}
```
**Why this is correct:** Instead of doing a deep merge (`merge(finalParams, partObject)`), which was creating a flat structure, this new version explicitly builds the nested object. It reads the `headers.json` file and assigns its content to the `headers` key, reads `payload.json` and assigns its content to the `payload` key, and so on. The resulting object now perfectly matches our `ComposedStepParams` interface.

---

#### **Step 2: Correct the `prepareStepForExecution` Function**

Now that `composeStepParameters` is fixed, we need to ensure the `masterContext` we build for the placeholder resolver is also correct.

📁 **`src/core/flow-orchestrator.ts`** (Corrected `prepareStepForExecution` function)
```typescript
async function prepareStepForExecution(
  step: StepDefinition & { step_id: string },
  dataPath: string,
  flowContext: Record<string, any>,
  stepHistory: Record<string, any>,
  authedRequest: any,
  request: any
) {
  let executionContext, resolvedParams, masterContext;

  await allure.step("Prepare Step Parameters", async () => {
    // 1. Compose the parameters. This now returns a correctly structured object.
    const composedParams = await composeStepParameters(step.parts, dataPath);

    // 2. Build the master context for placeholder resolution.
    //    This is the KEY CHANGE. We must pass the 'test_data' object, not the whole composed object.
    masterContext = { 
      flow: flowContext, 
      steps: stepHistory, 
      testData: composedParams.test_data || {} // <-- Use the nested test_data object
    };
    
    // 3. Resolve all placeholders in the composed parameters.
    //    The resolver will now work because the context is correct.
    resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
    await allure.attachment('Resolved Step Parameters', JSON.stringify(resolvedParams, null, 2), { contentType: 'application/json' });

    // 4. Determine auth and create the final execution context
    //    We need to access the 'auth' flag from the resolved 'headers' part.
    const apiRequestContextForStep = resolvedParams.headers.auth === 'bearer' ? authedRequest : request;
    if (resolvedParams.headers.auth === 'bearer') log.debug("Using authenticated request context for this step.");
    
    executionContext = { api: apiRequestContextForStep, log };
  });

  return { executionContext, resolvedParams, masterContext };
}
```
**Why this is correct:** The previous version was passing the entire `composedParams` object as the `testData` context. Now, we correctly extract **only the `test_data` part** (`composedParams.test_data`) and assign it to the `testData` key in our `masterContext`. When the resolver sees a placeholder like `{{testData.product}}`, it will now correctly find the `product` key inside the object that came from your `test_data.json` file.

---

### **How the Data Flows Now (The Corrected Path)**

1.  **`composeStepParameters` runs:** It reads `headers.json`, `payload.json`, and `test_data.json` and assembles them into a single object:
    ```javascript
    const composedParams = {
      headers: { /* content of headers.json */ },
      payload: { /* content of payload.json */ },
      test_data: { /* content of test_data.json */ }
    };
    ```
2.  **`prepareStepForExecution` runs:**
    *   It creates the `masterContext`:
      ```javascript
      const masterContext = {
        flow: { ... },
        steps: { ... },
        testData: { /* content of test_data.json */ } // <-- Correct!
      };
      ```
    *   It calls `resolvePlaceholdersIn` with `composedParams` and the correct `masterContext`.
3.  **`resolvePlaceholdersIn` runs:**
    *   It traverses the `composedParams.payload` object.
    *   It finds the string `{{testData.product}}`.
    *   It looks up the path `testData.product` inside the `masterContext`.
    *   It successfully finds `masterContext.testData.product` and replaces the placeholder.

These corrections ensure that the data structures are built correctly and that the placeholder resolver receives the context in the exact format it expects. This should resolve all the issues you were facing.