Excellent question. A major architectural change like this always has ripple effects. Fortunately, because we've designed the components to be modular, the changes are contained and logical.

Here is a comprehensive breakdown of every file that needs to be changed and, just as importantly, the files that **do not** need to change.

---

### **Files That Require Changes**

#### **1. The "Glue" Spec File (`e2e_quote_retrieval.spec.ts`)**

*   **Change:** This is the most direct change. The call to the orchestrator must now provide two arguments: the path to the flow YAML and the path to the test case's data directory.
*   **Reason:** This is the new entry point that links the test execution logic to its specific data set.

**BEFORE:**
```typescript
executeFlow(flowPath);
```

**AFTER:**
📁 `tests/bop/specs/e2e_quote_retrieval.spec.ts`
```typescript
import { executeFlow } from '@/core/flow-orchestrator';
import * as path from 'path';

test.describe('BOP End-to-End Quote Retrieval', () => {
  const flowPath = path.join('tests', 'bop', 'flows', 'e2e_quote_retrieval.flow.yml');
  const dataPath = path.join('data', 'BOP_CREATE_AND_RETRIEVE_QUOTE');
  
  executeFlow(flowPath, dataPath);
});
```

#### **2. The Placeholder Resolver (`placeholder-resolver.ts`)**

*   **Change:** The `resolvePlaceholdersIn` function must be updated to correctly access the new `testData` context.
*   **Reason:** Placeholders like `{{testData.product}}` need to work. The resolver is the central place where this logic lives.

**BEFORE:** The `context` object was just `{ flow, steps }`.

**AFTER:**
📁 `src/helpers/placeholder-resolver.ts`
```typescript
export function resolvePlaceholdersIn(data: any, context: any = {}): any {
  // ... (logic for arrays and objects) ...
  if (typeof data === 'string') {
    const placeholderRegex = /\{\{([\w\$\.]+)\}\}/g;
    return data.replace(placeholderRegex, (match, placeholderPath) => {
      // ... (logic for faker and dynamic) ...
      
      // The `getValueFromObject` call is unchanged, because the orchestrator
      // is now responsible for building the context object correctly.
      // We just need to be aware that the `context` it receives now contains `testData`.
      const value = getValueFromObject(context, placeholderPath);
      return value !== undefined ? String(value) : match;
    });
  }
  return data;
}
```
*(Self-correction: The `placeholder-resolver` itself doesn't need much change, as long as the orchestrator correctly builds the `masterContext` with the `testData` key in it, which it now does. The main change is ensuring the orchestrator does this.)*

#### **3. The `ApiAction` Base Class (Minor)**

*   **Change:** The `ApiAction`'s constructor and helper methods may need slight adjustments to know how to find `test_data` and `expected` blocks within the `params` object it receives.
*   **Reason:** Before, `params` was a flat object. Now, it's a merged object that might have a nested `test_data` key.

**BEFORE:** `params.expected`

**AFTER:**
📁 `src/functions/base/ApiAction.ts`
```typescript
// Inside the `assert` method of ApiAction
async assert(response: APIResponse) {
    // The expected block is now nested inside the test_data part of the params.
    const expected = this.params.test_data?.expected || { status: 200 };
    // ... rest of the assertion logic
  }
```

---

### **Files That DO NOT Require Changes**

This is the most important part, as it demonstrates the success of our modular design.

*   **`playwright.config.ts`:** No changes needed. It's already set up to discover `.spec.ts` files. It doesn't care what those files do.
*   **`bop.auth.setup.ts` & `global.setup.ts`:** No changes needed. The authentication and global setup processes are independent of how individual test cases are structured. They produce artifacts (`.state.json`, `run_config.json`) that the rest of the system consumes.
*   **`test-fixtures.ts`:** No changes needed. The `authedRequest` fixture correctly reads the auth state file and provides an authenticated context. It has no knowledge of individual test case data.
*   **`logger.ts`:** No changes needed. The singleton logger is globally available and doesn't depend on test structure.
*   **`function-registry.ts`:** No changes needed. It simply discovers and registers functions. It doesn't care how or when they are called.
*   **`standard.api.sendRequest.ts`:** No changes needed. This function is a simple wrapper around the `ApiAction` class. As long as the `ApiAction` class knows how to handle the `params` object, this function remains clean.
*   **Constants & Custom Errors:** No changes needed. These are utility modules.

### **Summary of Impact**

The ripple effect of this major architectural change is surprisingly small and very well-contained. We only need to update:
1.  **The Entry Point (`*.spec.ts`):** To tell the orchestrator where to find the data.
2.  **The Orchestrator (`flow-orchestrator.ts`):** To know how to load and compose the data from the new structure.
3.  **The Action (`ApiAction.ts`):** To know where to look for its parameters inside the newly composed `params` object.

This is a testament to the a good, modular design. We have fundamentally changed how test cases are structured without needing to rewrite the entire framework.
