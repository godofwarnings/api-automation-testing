Of course. This is a fundamental requirement for any end-to-end flow, and I have great news for you: **the framework is already built to handle this perfectly. You do not need to change any code.**

The placeholder resolution mechanism we've built is designed to work on any string within a step's definition, including the `endpoint`.

Let me show you exactly how to achieve this using the correct YAML syntax and then explain *why* it already works by referencing the existing code.

---

### **The Solution: Using Placeholders in the `endpoint` Key**

You will use the exact same `{{flow.variableName}}` placeholder syntax that you use in payloads, but you'll place it directly in the `endpoint` string of your YAML file.

#### **The YAML Implementation**

Let's write a complete flow that demonstrates this.

1.  **Step 1 (`create_quote_step`):** This step creates the quote and, crucially, uses `save_from_response` to capture both the `quoteId` and `proposalId` from the response body.
2.  **Step 2 (`get_proposal_step`):** This step constructs its endpoint URL dynamically by embedding the saved `proposalId` at the end of the string.

Here is what the complete flow file would look like:

📁 `tests/products/bop/flows/create_and_get_proposal.flow.yml` (New Example)
```yaml
flow_id: "BOP_E2E_PROPOSAL_RETRIEVAL"
description: "Full workflow to create a quote and then retrieve its proposal using the ID"

steps:
  - step_id: "create_quote_step"
    description: "Step 1: Create a quote to get a proposal ID"
    endpoint: "/your/api/v1/quotes"
    method: "POST"
    auth: "bearer"
    headers:
      Content-Type: "application/json"
    payload:
      # Assume this payload creates a quote that results in a proposal
      file://templates/bop/createQuote_base.json
    expected:
      status: 201
    
    # Save the necessary IDs from the response body into the flow context
    save_from_response:
      # Assuming your response looks like: { "data": { "quoteId": "q-123", "proposalId": "p-456" } }
      savedQuoteId: "data.quoteId"
      savedProposalId: "data.proposalId"

  - step_id: "get_proposal_step"
    description: "Step 2: Retrieve the specific proposal using its ID"
    #
    # --- THIS IS THE KEY PART ---
    # Construct the endpoint by appending the saved variable.
    #
    endpoint: "/your/api/v1/proposals/{{flow.savedProposalId}}"
    method: "GET"
    auth: "bearer"
    # No payload for a GET request
    expected:
      status: 200
      body:
        # Assert that the retrieved proposal has the correct corresponding quoteId
        quoteIdentifier: "{{flow.savedQuoteId}}"
```

---

### **How This Works (The Code Explanation)**

You don't need to change any code because the `resolveStepPlaceholders` function in `test-executor.ts` is already designed to process the `endpoint` string.

Let's trace the execution for the **`get_proposal_step`**:

1.  The `executeApiFlows` function gets to this step in its loop. The `flowContext` already contains `{ savedQuoteId: 'q-123', savedProposalId: 'p-456' }` from the first step.

2.  It calls `resolveStepPlaceholders` with the step's definition.

3.  Inside `resolveStepPlaceholders`, this specific line is executed:
    📁 **`src/core/test-executor.ts`**
    ```typescript
    // ... inside resolveStepPlaceholders
    const context = { flow: flowContext, steps: stepHistory };

    // This line processes the endpoint string before anything else
    if (resolvedStep.endpoint) {
        resolvedStep.endpoint = resolvePlaceholdersInString(resolvedStep.endpoint, context);
    }
    // ...
    ```

4.  The `resolvePlaceholdersInString` helper function is called with the string `"/your/api/v1/proposals/{{flow.savedProposalId}}"` and the master `context`.

5.  The function's regex finds the placeholder `{{flow.savedProposalId}}`.

6.  It calls `getValueFromObject` with the `context` and the path `"flow.savedProposalId"`.

7.  `getValueFromObject` successfully navigates the `context` and retrieves the value `"p-456"`.

8.  The string replacement occurs, and the `resolvedStep.endpoint` becomes `"/your/api/v1/proposals/p-456"`.

9.  Finally, this fully resolved endpoint is passed to the `sendRequest` function, which makes the correct API call.

### **Summary of the Mechanism**

*   **Universal Placeholders:** The `{{...}}` placeholder system is universal. It works on the `endpoint`, `headers`, and `payload` properties of a step.
*   **Order of Operations:** The framework resolves all placeholders *before* it attempts to send the request, ensuring the API call is made with the final, correct data.
*   **No Code Changes Needed:** Your intuition to ask for this feature was perfect, and the framework's design anticipated it. You just need to apply the placeholder syntax to the `endpoint` key in your YAML files.