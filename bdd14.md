You are absolutely right. My previous solution was a step backward in terms of test isolation and clarity. Forcing everything through a single spec file is a bad design, and I apologize for proposing it.

Your requirement to have one spec file per feature is the correct, standard, and most manageable approach.

Let's fix this, along with the very astute observation you made about how the orchestrator handles `maps_to_steps`.

---

### **The Correct Game Plan: One Feature -> One Spec -> One Test Plan**

1.  **Scaffolding Script (`scaffold-bdd.ts`):** This script will have **one single purpose**: to find all `.feature` files and, for each one, call our new, more focused single-file parser.
2.  **Parser Script (`parse-and-generate.ts`):** This will be our core utility. It will take a feature file path as input, parse it, and generate **both** the `.spec.json` (the test plan) and the corresponding `.spec.ts` (the test runner glue file).
3.  **Generated Spec Files:** Each generated `.spec.ts` file will be incredibly simple. Its only job will be to load its corresponding `.spec.json` file and pass it to the orchestrator.
4.  **Orchestrator Enhancement:** The orchestrator's `executeBddFromPlan` function will be updated to correctly handle the `maps_to_steps` array, ensuring it executes all steps defined in the group.

---

### **Step 1: The New Scaffolding and Parsing Scripts**

We will have two clean, focused scripts.

#### **A. The Single-File Parser and Generator (`parse-and-generate.ts`)**

This script takes a feature file and generates both the JSON plan and the TS spec file.

📁 **`scripts/parse-and-generate.ts`** (New File)
```typescript
import { GherkinParser } from '../src/helpers/gherkin-parser';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const specTemplate = (testPlanPath: string) => `
// This file is auto-generated. Do not edit.
import { test } from '@playwright/test';
import { executeBddFromPlan } from '../../../src/core/flow-orchestrator';
import * as path from 'path';

const testPlanPath = path.join(process.cwd(), '${testPlanPath}');
executeBddFromPlan(testPlanPath);
`;

async function main() {
  const argv = await yargs(hideBin(process.argv)).options({
    featurePath: { type: 'string', demandOption: true },
    mappingPath: { type: 'string', demandOption: true },
    dataPath: { type: 'string', demandOption: true },
    outputDir: { type: 'string', demandOption: true },
  }).argv;

  // 1. Parse the feature file into a JSON test plan
  const parser = new GherkinParser(argv.featurePath, argv.mappingPath);
  await parser.buildAst();
  const scenarios = parser.parseScenarios();
  const testPlan = {
    featureName: path.basename(argv.featurePath, '.feature'),
    dataPath: argv.dataPath,
    scenarios: scenarios,
  };
  
  const featureName = path.basename(argv.featurePath, '.feature');
  const jsonOutputPath = path.join(argv.outputDir, `${featureName}.spec.json`);
  const specOutputPath = path.join(argv.outputDir, `${featureName}.spec.ts`);
  const relativeJsonPath = path.relative(path.dirname(specOutputPath), jsonOutputPath).replace(/\\/g, '/');

  // 2. Save the JSON Test Plan
  fs.mkdirSync(path.dirname(jsonOutputPath), { recursive: true });
  fs.writeFileSync(jsonOutputPath, JSON.stringify(testPlan, null, 2));

  // 3. Generate the corresponding .spec.ts file
  const specContent = specTemplate(relativeJsonPath);
  fs.writeFileSync(specOutputPath, specContent);

  console.log(`  - SUCCESS: Generated spec and plan for ${featureName}`);
}

main().catch(console.error);
```

#### **B. The Wrapper Script (`scaffold-bdd.ts`)**

This script finds features and calls the generator for each one.

📁 **`scripts/scaffold-bdd.ts`** (Updated)
```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const featuresDir = path.join(process.cwd(), 'features');
const outputDir = path.join(process.cwd(), 'tests', 'bdd', 'generated');
// ... findFeatureFiles function ...

function main() {
  // ... clean output directory ...
  for (const featurePath of findFeatureFiles(featuresDir)) {
    const relativeFeaturePath = path.relative(process.cwd(), featurePath);
    const featureName = path.basename(featurePath, '.feature');
    
    // Find the mapping file from the feature's comment
    const featureContent = fs.readFileSync(featurePath, 'utf8');
    const mappingFileMatch = featureContent.match(/#\s*mapping_file:\s*(.*)/);
    if (!mappingFileMatch) continue;
    const relativeMappingPath = mappingFileMatch[1].trim();
    
    // Assume dataPath convention is based on feature name
    const relativeDataPath = `data/${featureName.toUpperCase()}`;
    const outputSubDir = path.dirname(path.relative(featuresDir, featurePath));
    const finalOutputDir = path.join(outputDir, outputSubDir);

    const command = `ts-node scripts/parse-and-generate.ts --featurePath="${relativeFeaturePath}" --mappingPath="${relativeMappingPath}" --dataPath="${relativeDataPath}" --outputDir="${finalOutputDir}"`;
    
    try {
      execSync(command, { stdio: 'inherit' });
    } catch (error) { /* ... */ }
  }
}

main();
```

---

### **Step 2: The Corrected Orchestrator**

Now, we fix the `maps_to_steps` issue. The orchestrator must recognize when a Gherkin step has been mapped to an array of library steps and execute them all sequentially within that single Playwright `test` block.

📁 **`src/core/flow-orchestrator.ts`** (Updated)
```typescript
// The entry point now expects the path to the generated JSON test plan
export function executeBddFromPlan(testPlanPath: string) {
  const testPlan = JSON.parse(fs.readFileSync(testPlanPath, 'utf8'));
  const { featureName, dataPath, scenarios } = testPlan;
  
  for (const scenario of scenarios) {
    test.describe.serial(`Scenario: ${scenario.name}`, () => {
      // ... setup for flowContext, stepHistory, beforeAll/afterAll ...

      for (const parsedStep of scenario.steps) {
        // --- THIS IS THE KEY CHANGE ---
        // A single Gherkin step can map to one or more library steps.
        const stepIdsToRun = parsedStep.step_id ? [parsedStep.step_id] : parsedStep.maps_to_steps || [];
        
        test(parsedStep.description, async ({ request, page, playwright }) => {
          await allure.step(`[Gherkin Step] ${parsedStep.description}`, async () => {

            // Now, loop through the library steps and execute them sequentially
            for (const stepId of stepIdsToRun) {
              await allure.step(`Executing library step: "${stepId}"`, async () => {
                const stepDefinition = stepLibrary[stepId];
                if (!stepDefinition) throw new Error(`Library step '${stepId}' not found!`);

                // We merge the dynamic params from Gherkin into EACH library step's params
                let composedParams = await composeStepParameters(stepDefinition.parts, dataPath);
                composedParams = merge(composedParams, parsedStep.dynamic_params);

                // The rest of the execution logic is the same, but now it's inside a loop
                // ... prepare execution context ...
                // ... execute function ...
                // ... process results ...
              });
            }
          });
        });
      }
    });
  }
}
```

### **Summary of Fixes**

1.  **One Spec per Feature:** The `scaffold-bdd.ts` script now correctly generates a unique `my_feature.spec.ts` and `my_feature.spec.json` for each `.feature` file. This provides perfect test isolation. The `run-bdd.spec.ts` file is deleted.
2.  **Robust `testMatch`:** The `playwright.config.ts` will now correctly discover all the generated spec files under `tests/bdd/generated/`.
3.  **Multi-Step Mapping Corrected:**
    *   The `gherkin-parser` correctly identifies when a Gherkin line maps to an array (`maps_to_steps`).
    *   The **orchestrator** now checks if `step_id` is a single string or if `maps_to_steps` is an array.
    *   It then iterates through this array and executes each library step **sequentially within the same Playwright `test` block**.
    *   This correctly implements your requirement: multiple library steps are executed to fulfill a single Gherkin step, maintaining the clean, high-level structure of the BDD test.

This architecture is now fully aligned with your requests. It provides a clean, one-to-one mapping of features to spec files and correctly handles the complex case of mapping a single Gherkin line to multiple underlying framework actions.