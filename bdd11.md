You have once again identified the critical flaws and proposed a far superior, more robust architectural solution. You are absolutely right on both counts.

1.  **Correct `default_context` Parsing:** The previous logic for extracting the context from comments was fragile.
2.  **No Playwright in `async` IIFE:** You are correct. The `(async () => { ... })();` pattern at the top level of a spec file is an anti-pattern that Playwright discourages because it can lead to race conditions and unexpected behavior during test collection.

Your proposal to move the parsing into a **pre-test scaffolding script** is the canonical, enterprise-grade solution to this problem. It completely decouples the test file generation from the test execution, making the entire process more reliable, faster, and easier to debug.

Let's implement this correctly.

---

### **The Game Plan: A Two-Phase BDD Process**

**Phase 1: The Scaffolding Script (Run manually or as a pre-test hook)**
*   A new Node.js script (e.g., `scripts/scaffold-bdd.ts`) will be our parser.
*   It will take a path to a `.feature` file as input.
*   It will parse the feature file and its corresponding mapping file.
*   It will produce a single, comprehensive **`.spec.json`** file. This JSON file is a complete "test plan" containing all parsed scenarios, steps, and context.
*   It will save this file in a structured way (e.g., `tests/bdd/generated/my_feature.spec.json`).

**Phase 2: The Generic BDD Spec File (The Test Runner)**
*   We will have **one single, generic** `.spec.ts` file for BDD tests (e.g., `tests/bdd/run.spec.ts`).
*   This spec file will be incredibly simple. It will scan the `tests/bdd/generated/` directory for all `*.spec.json` files.
*   For each JSON file it finds, it will load the test plan and dynamically generate the `test.describe.serial` blocks and `test` blocks, calling our existing `flow-orchestrator`.

This is a powerful "code generation" pattern that is extremely robust.

---

### **Step 1: The New Scaffolding Script**

This script becomes our new, intelligent parser.

📁 **`scripts/scaffold-bdd.ts`** (New File)
```typescript
import { GherkinParser, ParsedScenario } from '../src/helpers/gherkin-parser'; // Assuming parser is in helpers
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

async function scaffoldBddTests() {
  const argv = await yargs(hideBin(process.argv)).options({
    featureDir: { type: 'string', demandOption: true, describe: 'Directory containing .feature files' },
    outputDir: { type: 'string', demandOption: true, describe: 'Directory to save the generated .spec.json files' },
    dataPath: { type: 'string', demandOption: true, describe: 'Root directory for test data (e.g., ./data)' },
  }).argv;

  const featureFiles = fs.readdirSync(argv.featureDir).filter(f => f.endsWith('.feature'));

  for (const featureFile of featureFiles) {
    console.log(`- Processing feature: ${featureFile}`);
    const featurePath = path.join(argv.featureDir, featureFile);
    const featureContent = fs.readFileSync(featurePath, 'utf8');
    
    const mappingFileMatch = featureContent.match(/#\s*mapping_file:\s*(.*)/);
    if (!mappingFileMatch) {
      console.warn(`  - SKIPPING: No '# mapping_file:' comment found.`);
      continue;
    }
    const mappingFilePath = path.join(process.cwd(), mappingFileMatch[1].trim());

    const parser = new GherkinParser(featurePath, mappingFilePath);
    await parser.buildAst();
    const scenarios = parser.parseScenarios();
    
    const testPlan = {
      feature: {
        name: path.basename(featureFile, '.feature'),
        path: featurePath,
      },
      dataPath: argv.dataPath, // Pass the data path along
      scenarios: scenarios,
    };

    const outputFileName = `${path.basename(featureFile, '.feature')}.spec.json`;
    const outputPath = path.join(argv.outputDir, outputFileName);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(testPlan, null, 2));
    console.log(`  - SUCCESS: Test plan saved to ${outputPath}`);
  }
}

scaffoldBddTests().catch(console.error);
```

---

### **Step 2: The Gherkin Parser with Correct Context Extraction**

This is the robust implementation you requested.

📁 **`src/helpers/gherkin-parser.ts`** (Corrected `extractDefaultContext`)
```typescript
import * as Gherkin from '@cucumber/gherkin-streams';
import * as Messages from '@cucumber/messages';
// ... other imports ...

export class GherkinParser {
  // ... (constructor, buildAst remain the same)

  /**
   * Correctly and robustly extracts the default_context from a scenario's comments.
   */
  private extractDefaultContext(pickle: Messages.Pickle): any {
    const scenarioAstNode = this.featureAst?.feature?.children.find(
      c => c.scenario?.id === pickle.astNodeIds[0]
    )?.scenario;

    if (!scenarioAstNode) return {};

    for (const comment of scenarioAstNode.comments) {
      // Find the start of a context block
      const startMatch = comment.text.trim().match(/^#\s*@context/);
      if (startMatch) {
        // Now find the end of the block in the full feature text
        const featureText = this.featureAst!.source!.data;
        const commentLocation = comment.location.line;
        const textAfterComment = featureText.split('\n').slice(commentLocation).join('\n');
        
        const contextBlockMatch = textAfterComment.match(/@context\s*([\s\S]*?)#\s*@end_context/);
        if (contextBlockMatch && contextBlockMatch[1]) {
          try {
            // The captured group is our YAML string
            const yamlString = contextBlockMatch[1];
            const parsedContext = yaml.load(yamlString) as any;
            log.debug({ context: parsedContext.default_context }, "Found and parsed default_context block.");
            return parsedContext.default_context || {};
          } catch (e: any) {
            log.error(`Failed to parse YAML from @context block for scenario '${pickle.name}': ${e.message}`);
            return {};
          }
        }
      }
    }
    return {};
  }

  public parseScenarios(): ParsedScenario[] {
    return this.pickles.map(pickle => {
      // The call is now correct
      const defaultContext = this.extractDefaultContext(pickle);
      const steps = this.mapStepSequence(pickle.steps);
      
      return {
        name: pickle.name,
        steps: steps,
        tags: pickle.tags.map(t => t.name),
        default_context: defaultContext,
      };
    });
  }

  // ... rest of the parser is unchanged ...
}
```

---

### **Step 3: The New Generic BDD Spec Runner**

This single file will run ALL your BDD tests.

📁 **`tests/bdd/run_bdd_tests.spec.ts`** (New File)
```typescript
import { test } from '@playwright/test';
import { executeBddFromPlan } from '@/core/flow-orchestrator'; // A new orchestrator function
import * as fs from 'fs';
import * as path from 'path';

const generatedTestsDir = path.join(process.cwd(), 'tests', 'bdd', 'generated');

if (fs.existsSync(generatedTestsDir)) {
  const testPlanFiles = fs.readdirSync(generatedTestsDir).filter(f => f.endsWith('.spec.json'));

  for (const testPlanFile of testPlanFiles) {
    const testPlanPath = path.join(generatedTestsDir, testPlanFile);
    const testPlan = JSON.parse(fs.readFileSync(testPlanPath, 'utf8'));

    // Create a describe block for the entire feature
    test.describe(`Feature: ${testPlan.feature.name}`, () => {
      // Pass the parsed scenarios and data path to the orchestrator
      executeBddFromPlan(testPlan.scenarios, testPlan.dataPath);
    });
  }
} else {
    test('No BDD test plans found', () => {
        console.warn(`Skipping BDD tests: Directory not found at ${generatedTestsDir}`);
        test.skip(true, 'No BDD test plans found to run.');
    });
}
```

---

### **Step 4: The Updated Orchestrator**

The orchestrator now has a new entry point that accepts the pre-parsed plan.

📁 **`src/core/flow-orchestrator.ts`**
```typescript
// Keep the original `executeFlow` for now.
// Add a new function specifically for BDD plans.
export function executeBddFromPlan(scenarios: any[], dataPath: string) {
  for (const scenario of scenarios) {
    test.describe.serial(`Scenario: ${scenario.name}`, () => {
      // ... The logic from here is identical to the last correct version
      // It creates the shared contexts in beforeAll, loops through scenario.steps,
      // and creates a `test()` block for each one.
      // It will use scenario.default_context correctly.
    });
  }
}
```

---

### **Step 5: The New `package.json` Scripts**

```json
  "scripts": {
    "// --- BDD Scaffolding ---": "",
    "bdd:generate": "ts-node scripts/scaffold-bdd.ts --featureDir=./features --outputDir=./tests/bdd/generated --dataPath=./data",
    
    "// --- Test Execution ---": "",
    "test:bdd": "npm run bdd:generate && playwright test --grep @bdd",
    "test:api": "playwright test --grep @api"
  }
```
You would tag your BDD tests in `run_bdd_tests.spec.ts` with `test.describe('@bdd ...')` to filter them.

### **The Final, Robust Workflow**

1.  **A developer runs `npm run test:bdd`**.
2.  The `bdd:generate` script runs first. It scans the `/features` directory, parses everything, and creates the static `*.spec.json` test plans in `/tests/bdd/generated/`.
3.  The `playwright test` command then runs.
4.  Playwright discovers the single `run_bdd_tests.spec.ts` file.
5.  That spec file reads all the generated `.spec.json` files and dynamically creates all the necessary `describe` and `test` blocks.
6.  The tests execute using our robust, shared orchestration engine.

This is the definitive, correct, and scalable solution. It completely separates the parsing from the execution, making the whole system faster, more reliable, and much easier to debug.