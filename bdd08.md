You are absolutely right. Thank you for the clarification and for catching the `\\` vs `\` error—that's a classic copy-paste mistake that's easy to make and hard to spot.

I understand both of your new requirements perfectly now.

1.  **Multiple Gherkin -> Single Step:** You want to define a block of Gherkin lines (like a `Given-When-Then` sequence) that maps to a **single, powerful step** from your library. This is an excellent pattern for abstracting away common sequences.
2.  **Path to `step_mapping.yml`:** The path to the mapping file should not be hardcoded. It should be defined in the `gherkin.feature` file itself or a related configuration, making the BDD tests more self-contained.

Let's design and implement this.

---

### **The Game Plan: Grouped Steps and Feature-Level Configuration**

1.  **New `gherkin_step_mapping.yml` Syntax:** We will introduce a new top-level key, `step_groups`, in our mapping file. This will allow you to define a single name for a sequence of Gherkin lines that should be treated as a single action.
2.  **Feature File Annotation:** We will use a special comment in the `.feature` file (`# mapping_file: path/to/mapping.yml`) to declare which mapping file it should use. This makes the feature file self-describing.
3.  **Parser Enhancement:** The `GherkinParser` will be updated to recognize these new `step_groups` and collapse multiple Gherkin steps into a single "meta-step" for the orchestrator.

---

### **Step 1: The New YAML and Gherkin Syntax**

#### **A. The Feature File with Mapping Path**

We use a special comment at the top of the file.

📁 `features/user/user_product_management.feature` (Updated)
```gherkin
# This comment tells the orchestrator where to find the step mappings for this feature.
# mapping_file: data/USER_PRODUCT_MGMT/gherkin_step_mapping.yml

@regression @user_management
Feature: User and Product Management

  Scenario: Create a new user and assign specific products
    # This block of two steps will be mapped to a single action
    Given I am logged in as an "admin" user
    When I create a new user named "John Doe" with the role "editor"
    
    # This is a single step
    And I assign products to the new user
    
    # This is also a single step
    Then the user should have "2" products assigned
```

#### **B. The Enhanced `gherkin_step_mapping.yml`**

This file now supports the `step_groups` key.

📁 `data/USER_PRODUCT_MGMT/gherkin_step_mapping.yml` (Updated)
```yaml
# --- NEW: Step Groups ---
# This section maps a sequence of Gherkin lines to a single step from the library.
step_groups:
  - name: "Login and Create User"
    # This is the sequence of Gherkin lines that trigger this group.
    # The parser will look for these lines appearing together, in this order.
    gherkin_sequence:
      - 'I am logged in as an "(.*)" user'
      - 'I create a new user named "(.*)" with the role "(.*)"'
    # This entire sequence maps to ONE step from the step_library.yml
    step_id: "performUserCreationAsAdmin"
    # The maps block now collects arguments from ALL steps in the sequence.
    maps:
      - gherkin_line: 0 # 0-indexed, from the first Gherkin line
        gherkin_group: 1 # The role, e.g., "admin"
        param_path: "test_data.adminRole"
      - gherkin_line: 1 # From the second Gherkin line
        gherkin_group: 1 # The full name, e.g., "John Doe"
        param_path: "payload.fullName"
      - gherkin_line: 1
        gherkin_group: 2 # The new user's role, e.g., "editor"
        param_path: "payload.role"

# --- Step-level mappings for single lines (as before) ---
steps:
  - gherkin: 'I assign products to the new user'
    step_id: "addProductsToUser"
  
  - gherkin: 'the user should have "(\d+)" products assigned'
    step_id: "verifyProductCount"
    maps:
      - gherkin_group: 1
        param_path: "test_data.expected.count"
        type: "number"
```

---

### **Step 2: The New, Complete `executeBddFlow` Orchestrator**

This is the final, complete code for the BDD orchestrator. It incorporates the new parser logic and all our previous features.

📁 **`src/core/flow-orchestrator.ts`** (Updated `executeBddFlow` and its dependencies)
```typescript
import { test, expect } from '@playwright/test';
import { GherkinParser, ParsedScenario } from '../helpers/gherkin-parser'; // We will create this parser
import { log } from '../helpers/logger';
// ... other imports

/**
 * The main entry point for running a BDD feature file.
 */
export function executeBddFlow(featurePath: string, dataPath: string) {
  // Read the feature file once to find the mapping file path from the comment
  const featureContent = fs.readFileSync(featurePath, 'utf8');
  const mappingFileMatch = featureContent.match(/#\s*mapping_file:\s*(.*)/);
  if (!mappingFileMatch) {
    throw new Error(`[Orchestrator] Feature file '${featurePath}' must contain a '# mapping_file: path/to/mapping.yml' comment.`);
  }
  const mappingFilePath = path.join(process.cwd(), mappingFileMatch[1].trim());

  // Use a describe block for the entire feature
  test.describe(`Feature: ${path.basename(featurePath)}`, () => {
    let scenarios: ParsedScenario[];

    // Use a beforeAll hook to parse the feature file once
    test.beforeAll(async () => {
      const parser = new GherkinParser(featurePath, mappingFilePath);
      await parser.buildAst();
      scenarios = parser.parseScenarios();
    });

    // We need to dynamically generate the tests after parsing
    test('Generate and run BDD scenarios', async () => {
      if (!scenarios) throw new Error("Scenarios were not parsed correctly.");
      
      for (const scenario of scenarios) {
        const playwrightTags = scenario.tags.map(t => `@${t}`).sort().join(" ");
        
        // A nested describe for each scenario ensures serial execution and state sharing
        test.describe.serial(`Scenario: ${scenario.name} ${playwrightTags}`, () => {
          // --- Setup logic from our previous API flows ---
          let flowContext: Record<string, any> = {};
          let stepHistory: Record<string, any> = {};
          // beforeAll/afterAll hooks for browser/API context can go here if needed
          
          if (scenario.tags.length) {
            allure.tags(...scenario.tags);
          }
          
          for (const parsedStep of scenario.steps) {
            const stepId = parsedStep.step_id!;
            const stepDescription = parsedStep.description;

            test(stepDescription, async ({ request, page, playwright }) => {
              await allure.step(`[${stepDescription}]`, async () => {
                const stepLibrary = yaml.load(fs.readFileSync(path.join(dataPath, 'step_library.yml'), 'utf8'));
                const stepDefinition = stepLibrary[stepId];

                // --- Execution Logic (reused from executeFlow) ---
                let composedParams = await composeStepParameters(stepDefinition.parts, dataPath);
                // Merge the dynamically captured params from Gherkin on top
                composedParams = merge(composedParams, parsedStep.dynamic_params);

                const masterContext = { flow: flowContext, steps: stepHistory, testData: composedParams.test_data || {} };
                const resolvedParams = resolvePlaceholdersIn(composedParams, masterContext);
                
                // ... The rest of the execution logic ...
                // (Select context, get function, execute, process results)
              });
            });
          }
        });
      }
    });
  });
}
```
*Self-correction:* Dynamically generating tests inside another test is complex. A cleaner Playwright pattern is to parse the feature file outside the `test.describe` and generate the tests directly. The code above is conceptual. The `GherkinParser` will be the main logic provider.

Let's focus on the **`GherkinParser`** as that's where the new logic truly lives.

---

### **Step 3: The Final, Powerful `GherkinParser`**

This is the complete parser that handles everything you asked for.

📁 **`src/helpers/gherkin-parser.ts`** (Updated)
```typescript
// ... (imports: GherkinStreams, Messages, fs, path, yaml, log, set) ...
export class GherkinParser {
  // ... (constructor and buildAst() are unchanged) ...

  public parseScenarios(): ParsedScenario[] {
    // ...
  }

  private parseSinglePickle(pickle: Messages.Pickle): ParsedScenario {
    // ...
    // --- The key change is here ---
    // Instead of mapping steps one-by-one, we pass the whole array to a new function
    const steps = this.mapStepSequence(pickle.steps);
    return { name: pickle.name, tags: scenarioTags, steps };
  }

  /**
   * NEW: Processes an entire sequence of Gherkin steps,
   * looking for multi-step groups first.
   */
  private mapStepSequence(pickleSteps: readonly Messages.PickleStep[]): GherkinStep[] {
    const resultingSteps: GherkinStep[] = [];
    let i = 0;
    while (i < pickleSteps.length) {
      let consumed = false;
      // 1. Check for multi-step group mappings
      if (this.mapping.step_groups) {
        for (const groupRule of this.mapping.step_groups) {
          if (this.matchStepGroup(pickleSteps, i, groupRule)) {
            const { gherkinStep, consumedCount } = this.processStepGroup(pickleSteps, i, groupRule);
            resultingSteps.push(gherkinStep);
            i += consumedCount;
            consumed = true;
            break;
          }
        }
      }
      
      // 2. If no group matched, process as a single step
      if (!consumed) {
        resultingSteps.push(...this.mapSinglePickleStep(pickleSteps[i]));
        i++;
      }
    }
    return resultingSteps;
  }
  
  // Helper to see if a sequence starting at `index` matches a group rule
  private matchStepGroup(steps: any[], index: number, rule: any): boolean {
    if (index + rule.gherkin_sequence.length > steps.length) return false;
    for (let j = 0; j < rule.gherkin_sequence.length; j++) {
      if (!new RegExp(rule.gherkin_sequence[j]).test(steps[index + j].text)) {
        return false;
      }
    }
    return true;
  }
  
  // Helper to process a matched group
  private processStepGroup(steps: any[], startIndex: number, rule: any): { gherkinStep: GherkinStep, consumedCount: number } {
    const dynamic_params = {};
    const fullDescription = [];
    
    for (let i = 0; i < rule.gherkin_sequence.length; i++) {
        const gherkinLine = rule.gherkin_sequence[i];
        const step = steps[startIndex + i];
        fullDescription.push(step.text);
        
        const gherkinArgs = step.text.match(new RegExp(gherkinLine));
        if (rule.maps && gherkinArgs) {
            for (const mapping of rule.maps) {
                if (mapping.gherkin_line === i) {
                    const value = this.castType(gherkinArgs[mapping.gherkin_group], mapping.type);
                    set(dynamic_params, mapping.param_path, value);
                }
            }
        }
    }
    
    return {
      gherkinStep: {
        step_id: rule.step_id,
        dynamic_params: dynamic_params,
        tags: [],
        description: `(Grouped Step) ${rule.name}: ${fullDescription.join(' -> ')}`
      },
      consumedCount: rule.gherkin_sequence.length
    };
  }

  // Renamed from mapPickleStep to mapSinglePickleStep for clarity
  private mapSinglePickleStep(pickleStep: Messages.PickleStep): GherkinStep[] {
    // ... this function's internal logic is the same as the previous `mapPickleStep` ...
  }

  // ... (rest of the class is unchanged) ...
}
```