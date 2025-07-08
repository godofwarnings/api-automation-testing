You have hit on the absolute core of the architectural challenge. You are 100% right. Just using `playwright-bdd` out of the box would mean abandoning our powerful data composition and placeholder resolution engine, which is unacceptable.

The goal is not to have two separate frameworks, but to make our **existing, powerful engine BDD-aware.**

Let's brainstorm a new, truly integrated solution that combines the best of both worlds.

---

### **The Integrated BDD Game Plan: Gherkin as the New "Flow" Definition**

**Core Principle:** A `.feature` file is just another type of `flow.yml`. It defines a sequence of steps. Our orchestrator should be able to parse it and run it through our existing engine.

1.  **New `executeBddFlow` Orchestrator:** We will create a new entry point in our orchestrator, `executeBddFlow`, specifically designed to handle `.feature` files.
2.  **Gherkin Parser:** This orchestrator will use a Gherkin parser library (like `@cucumber/gherkin`) to read the `.feature` file and extract the steps (`Given`, `When`, `Then`) into a structured list.
3.  **Mapping Gherkin Steps to Library Steps:** This is the crucial link. We will create a "mapping" file that connects a Gherkin sentence to a `step_id` in our existing `step_library.yml`.
4.  **Full Engine Reuse:** Once the orchestrator has the list of `step_id`s from the Gherkin file, it will execute them using the **exact same logic** as our current `executeFlow` function. This means every Gherkin step automatically gets the full power of our composable parameters, placeholder resolution, and function registry.

This approach keeps our engine at the center and treats Gherkin as a "user-friendly" front-end for defining test flows.

---

### **How the New Structure and Files Will Look**

#### **1. The Gherkin `.feature` File (The User's View)**

This remains unchanged. It's the business-readable specification.

📁 `features/bop/create_quote.feature`
```gherkin
Feature: BOP Quote Creation

  Scenario: User creates a new quote with valid initial details
    Given I navigate to the New Quote page
    When I fill in the initial business details for a "Retail" company
    And I select the standard coverage options
    Then I should see the final quote summary page
```

#### **2. The Gherkin-to-Step-Library Mapping File**

This new file is the "dictionary" that translates human language into a step from our library.

📁 `data/BOP_CREATE_QUOTE/gherkin_step_mapping.yml` (New File Type)
```yaml
# This file maps Gherkin sentences to reusable steps from our library.
# It uses regular expressions for capturing arguments.

- gherkin: "I navigate to the New Quote page"
  step_id: "navigateToNewQuotePage"

- gherkin: "I fill in the initial business details for a \"(.*)\" company"
  step_id: "fillNewQuoteInitialInfo"
  # This maps the captured group from the regex to a parameter
  maps:
    - gherkin_group: 1
      param_path: "test_data.industryType"

- gherkin: "I select the standard coverage options"
  step_id: "selectQuoteCoverages"

- gherkin: "I should see the final quote summary page"
  step_id: "verifyOnQuoteSummaryPage"
```

#### **3. The Step Library (`step_library.yml`)**

This is our existing file. It defines the technical implementation of each step.

📁 `data/BOP_CREATE_QUOTE/step_library.yml`
```yaml
navigateToNewQuotePage:
  function: "ui.pages.NewQuoteInitialPage.navigate"
  parts:
    test_data: "test_data/navigation_data.json"

fillNewQuoteInitialInfo:
  function: "ui.pages.NewQuoteInitialPage.fillAndProceed"
  parts:
    test_data: "test_data/new_quote_initial_data.json"

# ... and so on for other steps
```

#### **4. The "Glue" Spec File for BDD**

This spec file now calls our new `executeBddFlow` orchestrator.

📁 `tests/bop/specs/bdd_create_quote.spec.ts` (New BDD Spec)
```typescript
import { executeBddFlow } from '@/core/flow-orchestrator';
import * as path from 'path';

test.describe('BOP Quote Creation BDD', () => {
  
  // The path to the business-readable feature file
  const featurePath = path.join('features', 'bop', 'create_quote.feature');

  // The path to the data directory for this test case
  const dataPath = path.join('data', 'BOP_CREATE_QUOTE');

  executeBddFlow(featurePath, dataPath);
});```

---

### **How the New `executeBddFlow` Orchestrator Will Work**

**New Dependency:**
```bash
npm install @cucumber/gherkin
```

**Conceptual Logic:**
```typescript
// src/core/flow_orchestrator.ts

import * as Gherkin from '@cucumber/gherkin';
// ...

export function executeBddFlow(featurePath: string, dataPath: string) {
  // 1. Parse the Gherkin .feature file
  const featureAst = Gherkin.parse(fs.readFileSync(featurePath, 'utf8'));
  const scenario = featureAst.feature.children[0].scenario; // Assuming one scenario for now

  // 2. Load the Gherkin-to-Step mapping file
  const gherkinMapping = yaml.load(fs.readFileSync(path.join(dataPath, 'gherkin_step_mapping.yml'), 'utf8'));

  // 3. Convert Gherkin steps into our framework's step list
  const flowSteps = scenario.steps.map(gherkinStep => {
    // Find the matching rule in our mapping file
    const rule = gherkinMapping.find(r => new RegExp(r.gherkin).test(gherkinStep.text));
    if (!rule) throw new Error(`No step definition found for: "${gherkinStep.text}"`);

    // Extract arguments from the Gherkin step using the regex
    const gherkinArgs = gherkinStep.text.match(new RegExp(rule.gherkin));
    
    // Create a "dynamic parameters" object that will be merged later
    const dynamicParams = {};
    if (rule.maps && gherkinArgs) {
      for (const mapping of rule.maps) {
        // Use lodash.set or a similar utility to set a nested property
        // _.set(dynamicParams, mapping.param_path, gherkinArgs[mapping.gherkin_group])
      }
    }
    
    return {
      step_id: rule.step_id,
      dynamic_params: dynamicParams, // Pass these captured values to the next stage
    };
  });

  // 4. Load the regular step library
  const stepLibrary = yaml.load(fs.readFileSync(path.join(dataPath, 'step_library.yml'), 'utf8'));

  // 5. Execute the flow using our EXISTING logic
  test.describe.serial(`BDD Feature: ${featureAst.feature.name}`, () => {
    // ... beforeAll, afterAll hooks ...
    const flowContext = {};
    const stepHistory = {};

    for (const stepInfo of flowSteps) {
      const stepDefinition = stepLibrary[stepInfo.step_id];
      // ...
      test(stepDefinition.description, async ({...}) => {
        // ...
        // CRITICAL: Merge the `dynamic_params` from Gherkin into the params loaded from files
        const composedParams = await composeStepParameters(stepDefinition.parts, dataPath);
        const finalParams = merge(composedParams, stepInfo.dynamic_params);

        // The rest of the execution is identical!
        // It resolves placeholders, executes the function, etc.
      });
    }
  });
}
```

### **Summary of Benefits**

*   **100% Engine Reuse:** This approach leverages our entire existing engine. Placeholder resolution, data composition, function registration, logging, and Allure reporting will **all work automatically** for BDD tests.
*   **Separation of Concerns:**
    *   **`.feature` file:** Pure business specification.
    *   **`gherkin_step_mapping.yml`:** The "dictionary" that translates business language to technical steps.
    *   **`step_library.yml`:** The reusable library of technical step implementations.
    *   **Page Actions (`.ts`):** The low-level code that interacts with the UI.
*   **Data-Driven BDD:** You can pass arguments directly from your Gherkin steps into your parameter files, making your BDD scenarios incredibly powerful and data-driven.

This is a truly integrated solution that doesn't waste any of the powerful features we've built. It treats BDD as a first-class citizen and a powerful way to define test flows for our existing engine.