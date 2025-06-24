Excellent. We've established a solid foundation with architecture, data generation, and logging.

Based on our checklist, the next most logical and high-impact feature to implement is **#10: Tag Support**. This capability is essential for creating different test suites (like `smoke`, `regression`, `sanity`) from your existing test cases without duplicating files, making your test runs more efficient and targeted.

---

### **Next Step: Implement Tag-Based Test Execution**

We will enable users to add tags to their test definitions and then use Playwright's powerful `--grep` command-line flag to filter which tests to run.

**Goals:**
*   Allow tags to be added to entire flows (`*.flow.yml`).
*   Allow tags to be added to individual test cases within a standalone test file (`*.yml`).
*   Provide `npm` scripts for running tagged test suites easily.

---

### **Step 1: Update the YAML Schema**

We will add a new optional property, `tags`, which will be an array of strings.

#### **A. For End-to-End Flows**

You can tag an entire flow. This is useful for marking a whole user journey as `@smoke` or `@critical`.

📁 `tests/products/bop/flows/create_and_get_proposal.flow.yml` (Example with tags)
```yaml
flow_id: "BOP_E2E_PROPOSAL_RETRIEVAL"
description: "Full workflow to create a quote and then retrieve its proposal"
tags: ["@smoke", "@regression", "@proposals"] # <-- TAGS FOR THE ENTIRE FLOW

steps:
  - step_id: "create_quote_step"
    # ...
  - step_id: "get_proposal_step"
    # ...
```

#### **B. For Standalone Test Files (Not Flows)**

You can tag individual test cases. This gives you granular control.

📁 `tests/products/bop/_generated_/createPet.yml` (Example with tags)
```yaml
- test_id: "TC_BOP_CREATE_PET_001"
  description: "Verify pet creation with Fido"
  tags: ["@smoke", "@pets"] # <-- TAGS FOR THIS SPECIFIC TEST CASE
  # ... other properties

- test_id: "TC_BOP_CREATE_PET_002"
  description: "Verify pet creation with Lucy"
  tags: ["@regression", "@pets"] # <-- DIFFERENT TAGS
  # ... other properties
```

---

### **Step 2: Update `test-executor.ts` to Propagate Tags**

The framework needs to take the tags from the YAML and append them to the test title. Playwright's `--grep` flag works by matching against the test title string. This is a simple but powerful mechanism.

📁 **`src/core/test-executor.ts`** (Updated `interfaces` and `executor` functions)
```typescript
// ... (imports remain the same) ...

// --- Type Definitions (Updated) ---
interface TestCase {
  // ... other properties
  tags?: string[]; // <-- Add optional tags array
}
interface ApiFlow {
  // ... other properties
  tags?: string[]; // <-- Add optional tags array
}
// ... other interfaces ...

// --- Main Executor for Flows (Updated) ---
export function executeApiFlows(flowYamlPath: string) {
  // ... (logic to load flow file) ...

  const flowTags = flow.tags?.join(" ") || ""; // Join tags into a string like "@smoke @regression"
  
  // Append the flow's tags to the main describe block title
  test.describe.serial(`API Flow: ${flow.description} ${flowTags}`, () => {
    // ... (rest of the flow logic is unchanged)
    for (const step of flow.steps) {
      // The individual step titles do not need tags, as the whole flow is tagged.
      test(step.description, async ({ request, authedRequest }) => {
        // ...
      });
    }
  });
}

// --- Main Executor for Standalone Tests (Updated) ---
export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) {
  // ... (logic to load test cases) ...

  test.describe(`API Tests for ${path.basename(definitionYamlPath)}`, () => {
    test.describe.configure({ mode: 'parallel' });

    for (const testCase of testCases) {
      // ... (logic for handling malformed test cases) ...

      const testCaseTags = testCase.tags?.join(" ") || ""; // Join tags for this specific test case
      
      // Append the tags to the individual test title
      test(`${testCase.description} ${testCaseTags}`, async ({ request, authedRequest }) => {
        // ... (rest of the test logic is unchanged)
      });
    }
  });
}

// All other helper functions (sendRequest, assertBody, etc.) remain unchanged.
```

### **Step 3: Add New `npm` Scripts for Tagged Runs**

Now we add scripts to `package.json` that pass the `--grep` flag to Playwright.

📁 **`package.json`** (Updated `scripts` section)
```json
{
  "name": "playwright-api-framework",
  "version": "1.0.0",
  "scripts": {
    "// --- TEST GENERATION ---": "",
    "generate:tests": "ts-node src/core/test-generator.ts",

    "// --- BOP Product Tests ---": "",
    "test:bop:sit:partner_a": "cross-env ENV=sit PARTNER=partner_a playwright test --project=bop-api-tests",
    
    "// --- NEW: Tagged Test Runs for BOP ---": "",
    "test:bop:sit:smoke": "npm run test:bop:sit:partner_a -- --grep @smoke",
    "test:bop:sit:proposals": "npm run test:bop:sit:partner_a -- --grep @proposals",
    
    "// --- You can also filter out tags ---": "",
    "test:bop:sit:non_smoke": "npm run test:bop:sit:partner_a -- --grep-invert @smoke",

    "// --- AUTH ONLY (for debugging) ---": "",
    "auth:bop:sit:partner_a": "cross-env ENV=sit PARTNER=partner_a playwright test --project='BOP Authentication'",

    "// --- REPORTING ---": "",
    "report:allure": "allure generate allure-results --clean -o allure-report && allure open"
  },
  "//": "Rest of package.json..."
}
```

### **How to Use the New Tagging Feature**

1.  **Add `tags` arrays** to your `*.flow.yml` or standalone `*.yml` files as shown in Step 1.
2.  **Run a tagged suite** using the new npm scripts.

**Example Command:**
```bash
# This command will run all tests for the 'bop' product in the 'sit' environment
# that have the "@smoke" tag in their title.
npm run test:bop:sit:smoke
```

Playwright will now scan all the test titles. Because our code dynamically adds the tags to the titles (e.g., `API Flow: Full workflow... @smoke @regression @proposals`), the `--grep @smoke` filter will match and execute only the tests and flows you've tagged as smoke tests.

This provides a powerful, flexible, and low-maintenance way to organize your testing efforts and execute targeted test suites on demand.







You are absolutely right to question this, and I'm glad you did. Your link is spot on and points to a much better, more native Playwright approach.

My previous answer proposed a common but less elegant solution: modifying the test title. While functional, it's not the true "Playwright way." You are correct—Playwright provides a much cleaner, more structured mechanism for this.

My apologies for not providing the best-practice solution first. Let's correct this now.

### **The "Playwright Way": Using Test Options**

Playwright's `test` function has an overload that accepts an `options` object as a second argument. One of the properties in this object is `tag`, which is the officially supported way to add tags to a test.

`test(title: string, options: { tag: string | string[] }, callback: Function)`

The `grep` command then filters on these tags. This is superior because:
*   It keeps your test titles clean and readable.
*   It's a structured, dedicated feature, not a string-parsing workaround.
*   It's more robust and better for tooling and future maintenance.

Let's implement this correctly.

---

### **Step 1: The YAML (No Change Needed)**

Your YAML files are perfectly fine as they are. The `tags: ["@smoke", "@regression"]` syntax is an excellent, declarative way to define this metadata. The change is in how the *executor* uses this information.

---

### **Step 2: The Corrected `test-executor.ts`**

We will modify both `executeApiFlows` and `executeApiTests` to use the `test` function's options object.

📁 **`src/core/test-executor.ts`** (Corrected `executor` functions)
```typescript
// ... (imports and interfaces with the `tags?: string[]` property remain the same) ...

// --- Main Executor for Flows (Corrected) ---
export function executeApiFlows(flowYamlPath: string) {
  // ... (logic to load flow file) ...

  // NOTE: The `tag` option only exists on `test()`, not `test.describe()`.
  // Therefore, the best way to tag an entire flow is still to append
  // the tags to the describe block, so grep can find the whole suite.
  const flowTags = flow.tags?.join(" ") || "";
  
  test.describe.serial(`API Flow: ${flow.description} ${flowTags}`, () => {
    // ... (rest of the flow logic is unchanged)
    for (const step of flow.steps) {
      // The individual steps don't need tags, as they are part of the tagged flow.
      test(step.description, async ({ request, authedRequest }) => {
        // ...
      });
    }
  });
}


// --- Main Executor for Standalone Tests (Corrected with Native Tagging) ---
export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) {
  // ... (logic to load test cases) ...

  test.describe(`API Tests for ${path.basename(definitionYamlPath)}`, () => {
    test.describe.configure({ mode: 'parallel' });

    for (const testCase of testCases) {
      // ... (logic for handling malformed test cases) ...

      // --- THIS IS THE KEY CHANGE ---
      // We pass the tags to the 'tag' property in the options object.
      // The test title remains clean.
      test(testCase.description, { tag: testCase.tags || [] }, async ({ request, authedRequest }) => {
        // The title is now just `testCase.description`.
        // The tags are metadata, not part of the title.

        // ... (rest of the test logic is unchanged)
        // You would still have your allure reporting, request sending, etc. here
        await allure.id(testCase.test_id);
        // ...
      });
    }
  });
}

// All other helper functions (sendRequest, assertBody, etc.) remain unchanged.
```

### **Summary of the Correction**

1.  **For Individual Tests (`executeApiTests`):**
    *   We no longer append tags to the test title string.
    *   We use the `test(title, options, callback)` signature.
    *   We pass the `tags` array from your YAML directly to the `tag` property in the `options` object: `test(testCase.description, { tag: testCase.tags }, ...)`. This is the native, correct way.

2.  **For End-to-End Flows (`executeApiFlows`):**
    *   The Playwright `test.describe` function does **not** have a `tag` option.
    *   Therefore, the original method of appending the flow's tags to the `describe` block title remains the best and most effective way to tag an entire suite of tests. This allows `--grep @flow_tag` to select the entire flow for execution.

3.  **No Change to `npm` Scripts:**
    *   The `npm` scripts that use `--grep` will work perfectly with this new, correct implementation. Playwright's `grep` is designed to filter based on both the title (for flows) and the `tag` option (for individual tests).

Thank you for pointing this out and holding the framework to a higher standard. This implementation is much cleaner and properly utilizes the features Playwright provides.



Of course. That is an excellent suggestion for making the Allure reports cleaner and more professional. Using dedicated Allure tags instead of embedding them in the description title is a much better practice.

We will use `allure.tag()` to apply the tags from your YAML file.

---

### **The Code: Updating `test-executor.ts`**

The change is very small and only affects the main test executor functions, `executeApiFlows` and `executeApiTests`.

📁 **`src/core/test-executor.ts`** (Updated `executor` functions)
```typescript
// ... (imports) ...
import { allure } from 'allure-playwright';

// ... (interfaces remain the same, with the `tags?: string[]` property) ...

// --- Main Executor for Flows (Updated) ---
export function executeApiFlows(flowYamlPath: string) {
  // ... (logic to load flow file) ...

  // The describe block title is now clean.
  test.describe.serial(`API Flow: ${flow.description}`, () => {
    
    // --- NEW: Apply Allure Tags for the whole flow ---
    if (flow.tags) {
      // Remove the "@" symbol before applying the tag
      const cleanTags = flow.tags.map(tag => tag.replace(/^@/, ''));
      allure.tags(...cleanTags);
    }
    // --- END NEW ---

    // ... (rest of the flow logic is unchanged) ...
    for (const step of flow.steps) {
      test(step.description, async ({ request, authedRequest }) => {
        // ...
      });
    }
  });
}

// --- Main Executor for Standalone Tests (Updated) ---
export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) {
  // ... (logic to load test cases) ...

  // The describe block title is clean.
  test.describe(`API Tests for ${path.basename(definitionYamlPath)}`, () => {
    test.describe.configure({ mode: 'parallel' });

    for (const testCase of testCases) {
      // ... (logic for handling malformed test cases) ...

      // Pass the tags to the test options object as before.
      // The test title remains clean.
      test(testCase.description, { tag: testCase.tags || [] }, async ({ request, authedRequest }) => {
        
        // --- NEW: Apply Allure Tags for this specific test case ---
        if (testCase.tags) {
          // Remove the "@" symbol before applying the tag
          const cleanTags = testCase.tags.map(tag => tag.replace(/^@/, ''));
          allure.tags(...cleanTags);
        }
        // --- END NEW ---
        
        // ... (rest of the test logic is unchanged)
        await allure.id(testCase.test_id);
        // ...
      });
    }
  });
}

// All other helper functions (sendRequest, assertBody, etc.) remain unchanged.
```

### **Summary of the Improvement**

1.  **`allure.tags(...tags)`:** We now use the dedicated `allure.tags()` function. It accepts one or more strings as arguments, which is why we use the spread operator (`...`) on our array of cleaned tags.
2.  **Clean Tagging:** We use a simple `.map()` and `.replace(/^@/, '')` to remove the leading `@` symbol from each tag before passing it to Allure. This is good practice because the `@` is a convention for `grep`, but the Allure tag itself doesn't need it.
3.  **Clean Test Titles:**
    *   In `executeApiFlows`, the `describe` title is now clean and doesn't have the tags appended.
    *   In `executeApiTests`, we continue to use Playwright's native `tag` option, which also keeps the test title clean.
4.  **Improved Allure Report:** In your generated Allure report, you will now see proper, clickable tag labels in the "Behaviors" tab and on each test case page, separate from the test title. This makes filtering and organizing within the Allure UI much more effective.

This change aligns the framework more closely with Allure's features and provides a much better reporting experience.