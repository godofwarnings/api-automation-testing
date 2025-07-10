You are absolutely right. I am so sorry. I completely misunderstood your last instruction and created an insanely stupid and pointless workflow.

My last implementation was just a code generator that generates... more code. It completely **failed to implement the core of your request**, which was to parse the feature into a JSON file and have the spec file read that JSON.

I sincerely apologize for the confusion and the terrible design. Let's burn it down and build the correct, intelligent workflow you actually asked for.

---

### **The Correct Game Plan: Parse to JSON, Run from JSON**

This is the architecture we will now build. It is clean, efficient, and what you originally intended.

1.  **Phase 1: Scaffolding (`bdd:generate`)**
    *   The `scaffold-bdd.ts` script will be the **smart parser**.
    *   For each `.feature` file, it will run our full `GherkinParser`.
    *   It will produce a comprehensive **`.spec.json`** file that contains the entire parsed test plan (scenarios, steps, context, etc.).
    *   This `.spec.json` file will be saved in a `generated` directory that mirrors the `features` directory structure.

2.  **Phase 2: Execution (`playwright test`)**
    *   We will have **one single, generic** `run-bdd.spec.ts` file. This file is the "BDD Test Runner".
    *   This runner script will scan the `generated` directory for all `*.spec.json` files.
    *   For each `.spec.json` it finds, it will dynamically create the `test.describe.serial` blocks and `test` blocks by reading the pre-parsed plan from the JSON file.

This is the robust, "Parse once, run many times" model that you wanted.

---

### **Step 1: The Correct Scaffolding Script**

This script does the heavy lifting of parsing.

📁 **`scripts/scaffold-bdd.ts`** (Correct and Final Version)
```typescript
import { GherkinParser } from '../src/helpers/gherkin-parser';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../src/helpers/logger';

const featuresDir = path.join(process.cwd(), 'features');
const outputDir = path.join(process.cwd(), 'tests', 'bdd', 'generated');
const dataDir = path.join(process.cwd(), 'data');

function findFeatureFiles(dir: string): string[] { /* ... (same as before) ... */ }

async function main() {
  console.log("--- Starting BDD Scaffolding: Parsing feature files to JSON test plans ---");
  const featureFiles = findFeatureFiles(featuresDir);

  if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  for (const featurePath of featureFiles) {
    log.info(`Processing feature: ${featurePath}`);
    try {
      const featureContent = fs.readFileSync(featurePath, 'utf8');
      const mappingFileMatch = featureContent.match(/#\s*mapping_file:\s*(.*)/);
      if (!mappingFileMatch) {
        log.warn(`SKIPPING: No '# mapping_file:' comment found in ${featurePath}.`);
        continue;
      }
      const mappingFilePath = path.join(process.cwd(), mappingFileMatch[1].trim());

      // 1. Use our powerful GherkinParser
      const parser = new GherkinParser(featurePath, mappingFilePath);
      await parser.buildAst();
      const scenarios = parser.parseScenarios();

      // 2. Create the JSON Test Plan
      const featureName = path.basename(featurePath, '.feature');
      const dataPath = path.join(dataDir, featureName.toUpperCase());
      const testPlan = {
        featureName: featureName,
        featurePath: path.relative(process.cwd(), featurePath),
        dataPath: path.relative(process.cwd(), dataPath),
        scenarios: scenarios,
      };

      // 3. Save the parsed JSON object to a file
      const outputFileName = `${featureName}.spec.json`;
      const outputPath = path.join(outputDir, path.dirname(path.relative(featuresDir, featurePath)), outputFileName);
      
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(testPlan, null, 2));
      log.info(`SUCCESS: Test plan saved to ${outputPath}`);
      
    } catch (error) {
      log.error({ err: error, feature: featurePath }, "Failed to process feature file.");
    }
  }
  console.log("--- BDD Scaffolding Complete ---");
}

main();
```

---

### **Step 2: The Generic BDD Test Runner Spec File**

This is the only `.spec.ts` file we need for BDD. It is simple, generic, and just reads the JSON files.

📁 **`tests/bdd/run-bdd.spec.ts`** (New File)
```typescript
import { test } from '@playwright/test';
import { executeBddFromPlan } from '@/core/flow-orchestrator';
import * as fs from 'fs';
import * as path from 'path';

const generatedTestsDir = path.join(process.cwd(), 'tests', 'bdd', 'generated');

// Check if the directory for generated tests exists
if (fs.existsSync(generatedTestsDir)) {
  // Find all generated .spec.json files recursively
  const findJsonFiles = (dir: string): string[] => {
    let results: string[] = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of list) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            results = results.concat(findJsonFiles(fullPath));
        } else if (file.name.endsWith('.spec.json')) {
            results.push(fullPath);
        }
    }
    return results;
  }

  const testPlanFiles = findJsonFiles(generatedTestsDir);

  if (testPlanFiles.length === 0) {
    test('No BDD test plans found in generated directory', () => {
        test.skip(true, `No .spec.json files found in ${generatedTestsDir}. Run 'npm run bdd:generate'.`);
    });
  }

  // Loop through each found test plan and create the test suite
  for (const testPlanFile of testPlanFiles) {
    const testPlan = JSON.parse(fs.readFileSync(testPlanFile, 'utf8'));

    test.describe(`Feature: ${testPlan.featureName}`, () => {
      // Pass the pre-parsed scenarios and data path to the orchestrator
      executeBddFromPlan(testPlan.scenarios, testPlan.dataPath);
    });
  }
} else {
    test('BDD Generated Tests Directory Not Found', () => {
        test.skip(true, `Directory not found: ${generatedTestsDir}. Run 'npm run bdd:generate' first.`);
    });
}
```

---

### **Step 3: The `playwright.config.ts`**

The config now only needs to point to our single BDD runner spec file.

📁 **`playwright.config.ts`** (Updated `projects`)
```typescript
projects: [
  // ... your API projects ...
  {
    name: 'bdd-tests',
    // This now points to our single, generic runner file.
    testMatch: /bdd\/run-bdd\.spec\.ts/,
  },
],
```

---

### **Step 4: The `package.json` Scripts**

The scripts are clean and their purpose is clear.

📁 **`package.json`**
```json
"scripts": {
  "bdd:generate": "ts-node scripts/scaffold-bdd.ts",
  "test:bdd": "npm run bdd:generate && playwright test --project=bdd-tests",
  "test:api": "playwright test --project=bop-api-tests"
}
```

### **The Final, Correct Workflow**

1.  A developer runs `npm run test:bdd`.
2.  The `bdd:generate` script (`scaffold-bdd.ts`) runs first.
    a. It uses our powerful `GherkinParser` to parse `features/bop/login.feature`.
    b. It creates a complete test plan object in memory.
    c. It saves this object as a static file: `tests/bdd/generated/bop/login.spec.json`.
3.  The `playwright test` command runs next.
4.  Playwright discovers the single `tests/bdd/run-bdd.spec.ts` file.
5.  This spec file reads `login.spec.json` (and any others).
6.  It dynamically calls `executeBddFromPlan`, which creates the `test.describe` and `test` blocks based on the pre-parsed data.
7.  The tests execute using our robust orchestration engine.

I am confident this architecture is what you originally envisioned. It is robust, decoupled, and efficient. I sincerely apologize for the confusion and the incorrect paths I led you down. This is the correct way forward.