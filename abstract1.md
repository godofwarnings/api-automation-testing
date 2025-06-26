This is a brilliant idea for making your test flows even more modular and reusable. You are proposing to create a **"Step Library"** or **"Step Registry."**

This is a powerful concept that allows you to define a step once (like `create_quote_new`) and then reuse it across many different test flows without duplicating the configuration. This promotes the DRY (Don't Repeat Yourself) principle at the orchestration level.

Let's design and implement this.

---

### **The Architectural Plan**

1.  **New File Type: The Step Definition Library (`*.steps.yml`)**: We will introduce a new type of YAML file. This file will act as a dictionary, mapping a `step_id` to its full definition (function, parameters, etc.).
2.  **Updated Flow YAML:** The main `flow.yml` file will now be much simpler. It will first declare which Step Library file it uses and then list the `step_id`s in the desired order.
3.  **Update the Flow Orchestrator:** The orchestrator will be enhanced to:
    a. Read the main `flow.yml`.
    b. Load the specified Step Library file into memory.
    c. When iterating through the flow's steps, it will use the `step_id` from the flow to look up the full step definition from the loaded library.

---

### **Step 1: The New File Structures**

#### **A. The Step Definition Library File**

This file contains the "reusable" step definitions. Notice the structure is a dictionary (or map) keyed by the `step_id`, not an array.

📁 `tests/products/bop/steps/standard_bop_steps.steps.yml` (New file type)
```yaml
# This file is a library of reusable steps for the BOP product.

create_quote_new:
  description: "Create a new quote with standard data"
  type: "api"
  function: "standard.api.sendRequest"
  parameters_file: "params/api/bop/create_quote_new_params.json"
  expected:
    status: 201
  save_from_response:
    newlyCreatedQuoteId: "data.quoteId"
    proposalIdForLater: "data.proposalId"

get_quote_by_id:
  description: "Retrieve a specific quote using a saved ID"
  type: "api"
  function: "standard.api.sendRequest"
  parameters_file: "params/api/bop/get_quote_params.json"
  expected:
    status: 200

download_proposal_pdf:
  description: "Download the proposal document for a quote"
  type: "api"
  function: "standard.api.sendRequest"
  parameters_file: "params/api/bop/download_proposal_params.json"
  save_response_body:
    enabled: true
    filename: "proposal_{{flow.proposalIdForLater}}"
```

#### **B. The New, Simpler Flow YAML**

The flow file now becomes a simple, high-level sequence.

📁 `flows/api/bop_end_to_end_document.flow.yml` (New, simpler flow)
```yaml
flow_id: "BOP_E2E_DOCUMENT_RETRIEVAL"
description: "A full flow that creates a quote and downloads the proposal PDF"
tags: ["@smoke", "@documents"]
depends_on: "BOP_Authentication"

# --- NEW: Declare which Step Library to use ---
step_library_file: "tests/products/bop/steps/standard_bop_steps.steps.yml"

# The steps are now just a simple list of IDs from the library
steps:
  - step_id: "create_quote_new"
  - step_id: "get_quote_by_id" # This step could be here for validation
  - step_id: "download_proposal_pdf"
```

---

### **Step 2: The Updated `flow-orchestrator.ts`**

The orchestrator is the only place we need to make code changes. It will now have the logic to load the step library.

📁 **`src/core/flow-orchestrator.ts`** (Updated `executeFlow` function)
```typescript
// ... (imports remain the same) ...

export function executeFlow(flowPath: string) {
  if (!fs.existsSync(flowPath)) {
    throw new Error(`[OrchestratorError] Flow file not found: ${flowPath}`);
  }
  const flow = yaml.load(fs.readFileSync(flowPath, 'utf8')) as any;

  // --- NEW: Load the Step Definition Library ---
  if (!flow.step_library_file) {
    throw new Error(`[OrchestratorError] Flow file '${flowPath}' is missing the required 'step_library_file' property.`);
  }
  const stepLibraryPath = path.join(process.cwd(), flow.step_library_file);
  if (!fs.existsSync(stepLibraryPath)) {
    throw new Error(`[OrchestratorError] Step Library file not found: ${stepLibraryPath}`);
  }
  const stepLibrary = yaml.load(fs.readFileSync(stepLibraryPath, 'utf8')) as Record<string, any>;
  log.info({ library: flow.step_library_file }, "Loaded step definition library.");
  // --- END NEW ---


  // ... (describe block and tag setup remains the same) ...
  test.describe.serial(`Flow: ${flow.description} ${playwrightTags}`, () => {
    // ...
    const flowContext: Record<string, any> = {};
    const stepHistory: Record<string, any> = {};

    for (const stepReference of flow.steps) {
      // 1. Look up the full step definition from the library
      const stepId = stepReference.step_id;
      const step = stepLibrary[stepId];

      if (!step) {
        throw new Error(`[OrchestratorError] Step with id '${stepId}' not found in library '${flow.step_library_file}'.`);
      }
      
      // Ensure the step_id from the flow is attached to the definition for history
      step.step_id = stepId;

      // The test title uses the description from the loaded step definition
      test(step.description || `Step: ${stepId}`, async ({ request, authedRequest }) => {
        // --- The rest of the test execution logic is UNCHANGED ---
        // It operates on the `step` object, which is now the full definition
        // that was looked up from the library.
        await allure.step(`Executing Step: "${step.description}"`, async () => {
          // ... (Prepare contexts)
          // ... (Load and resolve parameters from step.parameters_file)
          // ... (Execute step.function)
          // ... (Process results)
        });
      });
    }
  });
}

// All other helper functions (handleApiResponse, processSaveFromResponse, etc.)
// do not need to change.
```

### **Summary of the New Architecture**

1.  **Role of `flow.yml`:** It is now purely an **orchestration script**. It defines the *what* and the *order*, but none of the implementation details. This makes it extremely simple and readable.
2.  **Role of `*.steps.yml`:** This is the **implementation library**. It contains the detailed definitions of reusable test steps. A team can build a comprehensive library of common actions (`login`, `create_user`, `delete_item`).
3.  **Role of the Orchestrator:** The `executeFlow` function is the smart engine that reads the flow script, looks up the necessary steps from the library, and executes them in sequence.

**Benefits of this Design:**

*   **DRY (Don't Repeat Yourself):** A step like `create_quote_new` is defined once and can be used in dozens of different test flows (e.g., a "create and update" flow, a "create and delete" flow, a "create and validate on UI" flow).
*   **Maintainability:** If the `create_quote` API changes (e.g., a new required field in the payload), you only need to update the `create_quote_new` definition in **one place** (`standard_bop_steps.steps.yml`) and all flows that use it are automatically updated.
*   **Readability:** The `flow.yml` file now reads like a high-level business process, making it understandable even to non-technical stakeholders.

This is a powerful abstraction that adds another layer of scalability and maintainability to your framework.
