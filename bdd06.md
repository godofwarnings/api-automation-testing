Of course. A complete, end-to-end example is the best way to see how all the new BDD components fit together. This showcase will demonstrate multiple features, including argument passing, multi-step mapping, and data tables.

---

### **The BDD Showcase: A User and Product Management Flow**

**Business Goal:** We want to verify that we can create a new user, and then, as that user, add a specific product to their profile.

**Gherkin Specification:**
*   First, we log in. This is a common prerequisite, so we want it to be a single, reusable Gherkin step.
*   Next, we create a new user using a name and role passed from the Gherkin step.
*   Finally, we add specific products to this new user's profile using a Gherkin Data Table.

---

### **Step 1: The `.feature` File**

This is the high-level business specification.

📁 `features/user/user_product_management.feature`
```gherkin
@regression @user_management
Feature: User and Product Management

  Scenario: Create a new user and assign specific products
    Given I am logged in as an "admin" user
    When I create a new user named "John Doe" with the role "editor"
    And I assign the following products to the new user:
      | productId | licenseType |
      | BOP-PREM  | perpetual   |
      | GL-BASIC  | subscription|
    Then the user should have "2" products assigned
```

---

### **Step 2: The Test Case Data Directory (`/data`)**

This directory contains all the configuration for this specific test case.

**Directory Structure:**
```
data/
└── USER_PRODUCT_MGMT/
    ├── gherkin_step_mapping.yml
    ├── step_library.yml
    ├── request_params/
    │   ├── login_request.json
    │   ├── create_user_request.json
    │   └── add_products_request.json
    └── test_data/
        ├── login_data.json
        └── create_user_data.json
```

---

### **Step 3: The File Contents**

#### **A. The Gherkin-to-Step Mapping File**

This is the "dictionary" that translates Gherkin to our framework's steps.

📁 `data/USER_PRODUCT_MGMT/gherkin_step_mapping.yml`
```yaml
steps:
  - gherkin: 'I am logged in as an "(.*)" user'
    # This single Gherkin step maps to TWO steps from our library
    maps_to_steps:
      - "doLogin"
      - "verifyLogin"
    maps:
      - gherkin_group: 1 # The captured role, e.g., "admin"
        step_index: 0 # Apply this to the 'doLogin' step
        param_path: "test_data.userRole"

  - gherkin: 'I create a new user named "(.*)" with the role "(.*)"'
    step_id: "createNewUser"
    maps:
      - gherkin_group: 1 # "John Doe"
        param_path: "payload.fullName"
      - gherkin_group: 2 # "editor"
        param_path: "payload.role"

  - gherkin: 'I assign the following products to the new user:'
    # This step uses a Data Table
    step_id: "addProductsToUser"

  - gherkin: 'the user should have "(\\d+)" products assigned'
    step_id: "verifyProductCount"
    maps:
      - gherkin_group: 1 # "2"
        param_path: "test_data.expected.count"
        type: "number"
```

#### **B. The Step Library**

This defines the technical implementation of each reusable step.

📁 `data/USER_PRODUCT_MGMT/step_library.yml`
```yaml
doLogin:
  function: "custom.auth.myPartnerLogin"
  parts:
    request: "request_params/login_request.json"
    test_data: "test_data/login_data.json"
  save_from_response:
    apiSession: "sessionContext"

verifyLogin:
  # This could be a dummy step that just logs, or a real one that checks a "get self" endpoint
  function: "standard.common.logMessage" 
  
createNewUser:
  function: "standard.api.sendRequest"
  parts:
    request: "request_params/create_user_request.json"
    # The payload is defined directly in the params file for this step
  save_from_response:
    newUserId: "data.userId"

addProductsToUser:
  function: "standard.api.sendRequest"
  parts:
    request: "request_params/add_products_request.json"

verifyProductCount:
  function: "standard.api.sendRequest"
  # This might call a GET /users/{id}/products endpoint and assert the length of the array
```

#### **C. The Parameter Files**

**`login_request.json`:**
```json
{
  "endpoint": "/v1/auth",
  "method": "POST",
  "payload": {
    "username": "{{testData.credentials.admin.user}}",
    "password": "{{testData.credentials.admin.pass}}"
  }
}
```

**`create_user_request.json`:**
```json
{
  "api_context": "{{flow.apiSession}}",
  "endpoint": "/v2/users",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "payload": {
    "fullName": null, # This will be filled by the Gherkin step
    "role": null,     # This will also be filled by the Gherkin step
    "status": "active"
  }
}
```

**`add_products_request.json`:**
```json
{
  "api_context": "{{flow.apiSession}}",
  "endpoint": "/v2/users/{{flow.newUserId}}/products",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "payload": {
    # The payload will be constructed dynamically from the Data Table
    "productsToAdd": "{{testData.dataTable}}"
  }
}```

#### **D. The `test_data` Files**

**`login_data.json`:**
```json
{
  "userRole": "admin", # Default role, can be overridden by Gherkin
  "credentials": {
    "admin": {
      "user": "{{process.env.ADMIN_USER}}",
      "pass": "{{process.env.ADMIN_PASS}}"
    }
  }
}
```

---

### **Step 4: The BDD "Glue" Spec File**

This is the entry point that Playwright will run.

📁 `tests/user/specs/bdd_user_management.spec.ts`
```typescript
import { executeBddFlow } from '@/core/flow-orchestrator';
import * as path from 'path';

test.describe('BDD: User Product Management', () => {
  const featurePath = path.join('features', 'user', 'user_product_management.feature');
  const dataPath = path.join('data', 'USER_PRODUCT_MGMT');
  
  executeBddFlow(featurePath, dataPath);
});
```

### **How the `maps` and Data Table Work**

*   **`maps`:** For the step `I create a new user named "John Doe" with the role "editor"`, the parser extracts `"John Doe"` and `"editor"`. The `maps` block tells the orchestrator to dynamically create a `params` object like `{ payload: { fullName: "John Doe", role: "editor" } }`. This object is then merged with the parameters loaded from the files, overwriting the `null` values in `create_user_request.json`.
*   **Data Table:** For the `I assign...` step, the Gherkin parser will convert the data table into a 2D array: `[['productId', 'licenseType'], ['BOP-PREM', 'perpetual'], ['GL-BASIC', 'subscription']]`. It will inject this array into the parameters at the path `testData.dataTable`. The `sendRequest` function (or a custom function) can then see this array in its `params` object and format it as the final request body.

This complete example showcases how the BDD layer acts as a user-friendly "skin" on top of our powerful, data-driven orchestration engine, reusing all of its capabilities seamlessly.