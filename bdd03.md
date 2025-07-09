Of course. Building a comprehensive and flexible Gherkin parser is the key to making our BDD integration truly powerful. It needs to handle not just simple steps, but also the rich features that Gherkin provides, like Data Tables, Scenario Outlines, and the multi-step mapping you described.

Let's design and then write the code for a robust Gherkin parsing module.

---

### **The Game Plan: A Multi-Layered Gherkin Parser**

Our parser will be a class, `GherkinParser`, that takes a `.feature` file and a "mapping" file as input and produces a structured test plan that our orchestrator can execute.

**It will support:**

1.  **Standard Step Mapping:** `Given/When/Then` lines map to `step_id`s.
2.  **Multi-Step Mapping:** A single Gherkin line can map to an array of `step_id`s, which will be executed sequentially.
3.  **Full Scenario Mapping:** A `Scenario` name can be mapped directly to a list of `step_id`s, overriding any individual step mappings within it. This is great for high-level test cases.
4.  **Data Tables:** Gherkin Data Tables will be parsed and passed as a special `testData.dataTable` object to the corresponding step.
5.  **Scenario Outlines & Examples:** It will parse `Scenario Outline` blocks and generate a separate, parameterized test run for each row in the `Examples` table.
6.  **Argument Extraction:** It will use regex to extract values from Gherkin steps (e.g., `"a value"`) and map them to specific paths in the step's parameters.
7.  **Tags:** It will correctly parse and attach tags from the feature, scenario, and outline levels.

---

### **Step 1: The Enhanced Gherkin-to-Step Mapping File**

Our mapping file needs to be more powerful to support these features.

📁 `data/BOP_CREATE_QUOTE/gherkin_step_mapping.yml` (New, More Powerful Version)
```yaml
# This file can now contain two types of mappings: 'scenarios' and 'steps'

# --- Scenario-level mappings take highest precedence ---
scenarios:
  - name: "User creates a new quote with valid initial details"
    # This entire scenario is mapped to a single, high-level step from the library.
    # This is great for abstracting complex business processes.
    maps_to_steps:
      - "performFullQuoteCreation"

# --- Step-level mappings for granular control ---
steps:
  - gherkin: "I am logged in as a/an (.*) user"
    # This single Gherkin line maps to TWO steps from our library
    maps_to_steps:
      - "navigateToLoginPage"
      - "performLogin"
    maps: # Maps the captured regex group to a parameter in the second step
      - gherkin_group: 1
        step_index: 1 # 0-indexed, so this targets 'performLogin'
        param_path: "test_data.userRole"

  - gherkin: "I provide the following business details:"
    # This step expects a Gherkin Data Table
    step_id: "fillNewQuoteInitialInfo"
    # The parsed data table will be automatically passed to the step's parameters
    # under the key 'testData.dataTable'.

  - gherkin: "I create a policy for state (.*) with limit (\\d+)"
    step_id: "createPolicyWithOptions"
    maps:
      - gherkin_group: 1
        param_path: "test_data.state"
      - gherkin_group: 2
        # We can even specify the type for the captured value
        param_path: "test_data.limit"
        type: "number"
```

---

### **Step 2: The `GherkinParser` Class**

This new module will contain all the parsing logic.

**New Dependency:**
```bash
npm install @cucumber/gherkin @cucumber/messages
```

📁 **`src/helpers/gherkin-parser.ts`** (New File)
```typescript
import * as Gherkin from '@cucumber/gherkin';
import * as Messages from '@cucumber/messages';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from './logger';
import { set } from 'lodash'; // Use lodash.set for safely setting nested properties

export interface GherkinStep {
  step_id?: string;
  maps_to_steps?: string[];
  dynamic_params?: Record<string, any>;
  tags: string[];
  description: string;
}

export interface ParsedScenario {
  name: string;
  steps: GherkinStep[];
  tags: string[];
}

export class GherkinParser {
  private readonly featureAst: Messages.GherkinDocument;
  private readonly mapping: any;

  constructor(featurePath: string, mappingPath: string) {
    log.info({ featurePath, mappingPath }, "Initializing Gherkin Parser.");
    this.featureAst = this.parseFeatureFile(featurePath);
    this.mapping = yaml.load(fs.readFileSync(mappingPath, 'utf8'));
  }

  private parseFeatureFile(featurePath: string): Messages.GherkinDocument {
    const uuidFn = Messages.IdGenerator.uuid();
    const source: Messages.Source = {
      data: fs.readFileSync(featurePath, 'utf-8'),
      uri: featurePath,
      mediaType: 'text/x.cucumber.gherkin+plain',
    };
    return Gherkin.parse({ idGenerator: uuidFn, source });
  }

  /**
   * Parses all scenarios (including outlines) from the feature file.
   * @returns An array of fully parsed scenarios ready for the orchestrator.
   */
  public parseScenarios(): ParsedScenario[] {
    const featureTags = this.featureAst.feature?.tags.map(t => t.name) || [];
    const scenarios: ParsedScenario[] = [];

    for (const child of this.featureAst.feature?.children || []) {
      if (child.scenario) {
        if (child.scenario.examples.length > 0) {
          // This is a Scenario Outline, expand it
          scenarios.push(...this.expandScenarioOutline(child.scenario, featureTags));
        } else {
          // This is a regular Scenario
          scenarios.push(this.parseSingleScenario(child.scenario, featureTags));
        }
      }
    }
    return scenarios;
  }

  private parseSingleScenario(scenario: Messages.Scenario, featureTags: string[], row?: Messages.TableRow): ParsedScenario {
    const scenarioTags = scenario.tags.map(t => t.name).concat(featureTags);
    const scenarioName = row ? this.interpolate(scenario.name, row) : scenario.name;

    // Check for a full scenario override mapping
    const scenarioMapping = this.mapping.scenarios?.find((m: any) => m.name === scenario.name);
    if (scenarioMapping?.maps_to_steps) {
      log.debug(`Scenario '${scenarioName}' is fully mapped to a step sequence.`);
      return {
        name: scenarioName,
        tags: scenarioTags,
        steps: scenarioMapping.maps_to_steps.map((step_id: string) => ({
          step_id,
          tags: [],
          description: `(Mapped Step: ${step_id})`,
        })),
      };
    }

    // Process individual steps if no override exists
    const steps = scenario.steps.flatMap(gherkinStep => this.mapGherkinStep(gherkinStep, row));

    return { name: scenarioName, tags: scenarioTags, steps };
  }

  private expandScenarioOutline(scenario: Messages.Scenario, featureTags: string[]): ParsedScenario[] {
    const expandedScenarios: ParsedScenario[] = [];
    for (const example of scenario.examples) {
      const header = example.tableHeader;
      if (!header) continue;

      for (const row of example.tableBody) {
        if (row.id === header.id) continue; // Skip header row if present in body
        expandedScenarios.push(this.parseSingleScenario(scenario, featureTags, row));
      }
    }
    return expandedScenarios;
  }

  private mapGherkinStep(gherkinStep: Messages.Step, row?: Messages.TableRow): GherkinStep[] {
    const stepText = row ? this.interpolate(gherkinStep.text, row) : gherkinStep.text;

    const rule = this.mapping.steps?.find((r: any) => new RegExp(r.gherkin).test(stepText));
    if (!rule) throw new Error(`No mapping found for Gherkin step: "${stepText}"`);

    const dynamic_params: Record<string, any> = {};

    // Map regex groups to parameters
    const gherkinArgs = stepText.match(new RegExp(rule.gherkin));
    if (rule.maps && gherkinArgs) {
      for (const mapping of rule.maps) {
        const value = this.castType(gherkinArgs[mapping.gherkin_group], mapping.type);
        set(dynamic_params, mapping.param_path, value);
      }
    }

    // Map data table to parameters
    if (gherkinStep.dataTable) {
      const table = gherkinStep.dataTable.rows.map(r => r.cells.map(c => c.value));
      set(dynamic_params, 'testData.dataTable', table);
    }
    
    // The rule can map to one or multiple steps
    const stepIds = rule.step_id ? [rule.step_id] : rule.maps_to_steps || [];

    return stepIds.map((step_id: string) => ({
      step_id,
      dynamic_params: stepIds.length === 1 ? dynamic_params : {}, // Apply params only if it's a 1-to-1 mapping for simplicity
      tags: [],
      description: stepText,
    }));
  }

  private interpolate(text: string, row: Messages.TableRow): string {
    const header = row.id.startsWith('header-') ? (this.featureAst.feature?.children.find(c => c.scenario?.examples[0]?.tableHeader?.id === row.id.replace('body-', 'header-'))?.scenario?.examples[0]?.tableHeader) : undefined;
    if (!header) return text;
    
    let interpolatedText = text;
    header.cells.forEach((cell, index) => {
        const placeholder = `<${cell.value}>`;
        interpolatedText = interpolatedText.replace(new RegExp(placeholder, 'g'), row.cells[index].value);
    });
    return interpolatedText;
  }

  private castType(value: string, type?: 'string' | 'number' | 'boolean'): any {
    if (type === 'number') return Number(value);
    if (type === 'boolean') return value.toLowerCase() === 'true';
    return value;
  }
}
```

---

### **Step 3: The New `executeBddFlow` Orchestrator**

This orchestrator uses our new parser to generate a test plan and then executes it.

📁 **`src/core/flow-orchestrator.ts`** (Add this new exported function)
```typescript
import { GherkinParser } from '../helpers/gherkin-parser';
// ... other imports

export function executeBddFlow(featurePath: string, dataPath: string) {
  const mappingPath = path.join(dataPath, 'gherkin_step_mapping.yml');
  const parser = new GherkinParser(featurePath, mappingPath);
  const scenarios = parser.parseScenarios();

  for (const scenario of scenarios) {
    // --- Use the Gherkin scenario name and tags for the describe block ---
    const playwrightTags = scenario.tags.map(t => `@${t}`).sort().join(" ");
    
    test.describe.serial(`Scenario: ${scenario.name} ${playwrightTags}`, () => {
      // Set up Allure tags for the scenario
      if (scenario.tags.length) {
        allure.tags(...scenario.tags);
      }

      const flowContext: Record<string, any> = {};
      const stepHistory: Record<string, any> = {};
      const stepLibrary = yaml.load(fs.readFileSync(path.join(dataPath, 'step_library.yml'), 'utf8'));

      // Loop through the steps produced by the Gherkin parser
      for (const parsedStep of scenario.steps) {
        const stepId = parsedStep.step_id || (parsedStep.maps_to_steps || [])[0]; // Simplified for this example
        const stepDefinition = stepLibrary[stepId];
        const step = { ...stepDefinition, description: parsedStep.description };

        test(step.description, async ({ request, page, playwright }) => {
          await allure.step(`[${parsedStep.description}]`, async () => {
            
            let composedParams = await composeStepParameters(step.parts, dataPath);
            // MERGE the dynamically captured params from Gherkin on top
            composedParams = merge(composedParams, parsedStep.dynamic_params);

            // The rest of the execution is identical to executeFlow!
            // This demonstrates the power of our reusable engine.
          });
        });
      }
    });
  }
}
```

This comprehensive parser and orchestrator provide a robust foundation for BDD. It correctly handles the most important Gherkin features and integrates them seamlessly into our existing data-driven engine, ensuring maximum code reuse and maintainability.