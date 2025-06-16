
---

📁 **`src/core/`**
📄 **`test-generator.ts`** (Corrected Version)
```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface ParameterConfig {
  field: string;
  values: (string | number | boolean)[];
}

interface VarianceConfig {
  parameters: ParameterConfig[];
  expected_response: {
    success: {
      status: number;
      body?: any; // Define more strictly if possible
    };
    // Potentially add 'failure' cases or more complex rules later
  };
  endpoint_template?: string; // Optional: if endpoint varies per product/api
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; // Default to POST if not specified
}

// Helper function to compute the Cartesian product of multiple arrays of objects
// Each object will carry its field name and value.
function generateCombinations(parameters: ParameterConfig[]): Record<string, any>[] {
  if (!parameters || parameters.length === 0) {
    return [{}]; // Return a single empty object if no parameters
  }

  const [firstParam, ...restParams] = parameters;
  const restCombinations = generateCombinations(restParams);

  const result: Record<string, any>[] = [];
  for (const value of firstParam.values) {
    for (const combination of restCombinations) {
      result.push({
        [firstParam.field]: value,
        ...combination,
      });
    }
  }
  return result;
}


// --- Main Generator Logic ---
async function generateTests() {
  // 1. Parse CLI arguments
  const argv = await yargs(hideBin(process.argv)).options({
    product: { type: 'string', demandOption: true, description: 'Product code (e.g., bop)' },
    api: { type: 'string', demandOption: true, description: 'API name (e.g., createQuote)' },
  }).argv;

  const { product, api } = argv;
  console.log(`Generating tests for Product: ${product}, API: ${api}`);

  // 2. Define file paths based on arguments
  const rootDir = process.cwd();
  const varianceConfigPath = path.join(rootDir, 'config', 'data-variance', product, `${api}.yml`);
  const baseTemplatePath = path.join(rootDir, 'templates', product, `${api}_base.xml`);

  const generatedPayloadsDir = path.join(rootDir, 'payloads', '_generated_', product, api);
  const generatedTestsDir = path.join(rootDir, 'tests', 'products', product, '_generated_');
  const generatedYamlPath = path.join(generatedTestsDir, `${api}.yml`);
  const generatedExpectedJsonPath = path.join(generatedTestsDir, `${api}.json`);

  // Ensure output directories exist
  fs.mkdirSync(generatedPayloadsDir, { recursive: true });
  fs.mkdirSync(generatedTestsDir, { recursive: true });

  // 3. Load input files
  if (!fs.existsSync(varianceConfigPath)) {
    console.error(`Error: Variance config file not found at ${varianceConfigPath}`);
    process.exit(1);
  }
  const varianceConfig = yaml.load(fs.readFileSync(varianceConfigPath, 'utf8')) as VarianceConfig;

  if (!fs.existsSync(baseTemplatePath)) {
    console.error(`Error: Base template file not found at ${baseTemplatePath}`);
    process.exit(1);
  }
  const baseXmlTemplate = fs.readFileSync(baseTemplatePath, 'utf8');

  // 4. Generate all data combinations
  const combinations = generateCombinations(varianceConfig.parameters);

  const generatedTestCases = [];
  const generatedExpectedOutputs: { [key: string]: any } = {};

  // 5. Loop through each combination to create payloads and test definitions
  for (let i = 0; i < combinations.length; i++) {
    const combinationData = combinations[i]; // This is now an object like { StateCode: "CA", CoverageAmount: 100000 }
    const testId = `TC_${product.toUpperCase()}_${api.replace(/([A-Z])/g, '_$1').toUpperCase()}_${String(i + 1).padStart(3, '0')}`;
    let currentPayload = baseXmlTemplate;

    const combinationDetails: string[] = [];

    // Replace placeholders in the XML template using the combinationData object
    for (const fieldName in combinationData) {
      if (Object.prototype.hasOwnProperty.call(combinationData, fieldName)) {
        const value = combinationData[fieldName];
        const placeholder = new RegExp(`\\{\\{${fieldName}\\}\\}`, 'g');
        currentPayload = currentPayload.replace(placeholder, String(value));
        combinationDetails.push(`${fieldName}: ${value}`);
      }
    }

    // Save the generated XML payload to its own file
    const relativePayloadPath = path.join('payloads', '_generated_', product, api, `payload_${testId}.xml`);
    const payloadFilePath = path.join(rootDir, relativePayloadPath);
    fs.writeFileSync(payloadFilePath, currentPayload);

    // Determine endpoint
    const defaultEndpoint = `/${product.toLowerCase()}/quotes`; // Example default
    const endpoint = varianceConfig.endpoint_template || defaultEndpoint;

    // Determine HTTP method
    const method = varianceConfig.method || 'POST';


    // Create the test case definition for the main YAML file
    generatedTestCases.push({
      test_id: testId,
      description: `Verify ${api} for ${product} with: ${combinationDetails.join('; ')}`,
      endpoint: endpoint,
      method: method,
      auth: 'bearer', // Assuming this endpoint requires auth by default
      headers: { 'Content-Type': 'application/xml' }, // Default for XML
      payload: `file://${relativePayloadPath.replace(/\\/g, '/')}`, // Ensure forward slashes for file URI
      chaining: { // Example: If you need to capture something from this request
        // set_global: {
        //   [`${product}_${api}_quoteId`]: "body.quoteId"
        // }
      }
    });

    // Create the corresponding expected output
    // For now, using the generic success response. Could be more dynamic later.
    generatedExpectedOutputs[testId] = varianceConfig.expected_response.success;
  }

  // 6. Write the final generated files
  fs.writeFileSync(generatedYamlPath, yaml.dump(generatedTestCases));
  fs.writeFileSync(generatedExpectedJsonPath, JSON.stringify(generatedExpectedOutputs, null, 2));

  console.log(`✅ Successfully generated ${combinations.length} test cases!`);
  console.log(`   -> Payloads stored in: ${generatedPayloadsDir}`);
  console.log(`   -> Test YAML definition: ${generatedYamlPath}`);
  console.log(`   -> Expected Outputs JSON: ${generatedExpectedJsonPath}`);
}

generateTests().catch(error => {
  console.error("❌ Error during test generation:", error);
  process.exit(1);
});
```

**Key Improvements in this Version:**

1.  **Correct `generateCombinations` Function:**
    *   This function is now recursive and correctly builds up an array of objects, where each object represents a unique combination of parameter values.
    *   Example: If `parameters` is `[{ field: "A", values: [1,2] }, { field: "B", values: ["x"] }]`, it will produce:
        ```
        [
          { A: 1, B: "x" },
          { A: 2, B: "x" }
        ]
        ```

2.  **Using `combinationData` for Placeholders:**
    *   The loop now iterates through `combinationData` (which is an object like `{ StateCode: "CA", CoverageAmount: 100000 }`).
    *   It uses `fieldName` (e.g., "StateCode") and its corresponding `value` to replace `{{StateCode}}` in the template.

3.  **Interface for `VarianceConfig`:**
    *   Added a `VarianceConfig` interface for better type safety and clarity of the expected structure of your `createQuote.yml` (or similar) files. You might want to expand on the `body` type within `expected_response`.

4.  **Error Handling for Missing Files:**
    *   Added checks to ensure `varianceConfigPath` and `baseTemplatePath` exist before trying to read them.

5.  **Test ID Generation:**
    *   Slightly modified the Test ID generation to also include the API name in a more readable format (e.g., `CREATE_QUOTE`).

6.  **Relative Path for Payload:**
    *   Ensured the `payload` path in the generated YAML uses forward slashes, which is more standard for URIs (`file://...`).

7.  **Endpoint and Method Configuration:**
    *   Added optional `endpoint_template` and `method` fields to the `VarianceConfig`. This allows you to define these per API/product directly in your data variance YAML if they differ from a common pattern.

**To Use This:**

1.  Replace the content of your `src/core/test-generator.ts` with the code above.
2.  Ensure your `config/data-variance/bop/createQuote.yml` looks something like this:

    📄 **`config/data-variance/bop/createQuote.yml`**
    ```yaml
    # Configuration for generating BOP Create Quote tests
    parameters:
      - field: StateCode
        values: ["CA", "NY"]
      - field: CoverageAmount
        values: [100000, 500000, 1000000]
      - field: IsNewCustomer
        values: [true, false]

    # Optional: Define if the endpoint or method is specific to this API
    endpoint_template: "/bop/v1/quotes/create" # Example if endpoint is very specific
    method: POST # Explicitly setting method

    expected_response:
      success:
        status: 201
        body:
          should_contain_key: "quoteId"
        # Example: if you expect a specific header
        # headers:
        #   X-RateLimit-Remaining: /\d+/ # Regex for a number
    ```

Now, when you run `npm run generate:tests -- --product=bop --api=createQuote`, it should correctly generate the combinations and the associated files without the previous errors related to the `cartesian` product.



You are absolutely right! My apologies. The `yargs` setup in the `test-generator.ts` was indeed missing the part that tells it how to parse arguments when run via `npm run ...` scripts.

When you use `npm run generate:tests -- --product=bop --api=createQuote`, the `--` correctly passes the subsequent arguments to the script. However, `yargs` by default might not process them as expected in this context without a bit more configuration.

Let's fix the `yargs` parsing in `test-generator.ts`.

---

Here's the corrected section in `test-generator.ts`:

📁 **`src/core/`**
📄 **`test-generator.ts`** (Corrected `yargs` setup)
```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import yargs from 'yargs/yargs'; // Changed import slightly
import { hideBin } from 'yargs/helpers';

// ... (interfaces and generateCombinations function remain the same) ...

// --- Main Generator Logic ---
async function generateTests() {
  // 1. Parse CLI arguments
  const argv = await yargs(hideBin(process.argv)) // Use yargs() directly
    .options({
      product: { type: 'string', demandOption: true, description: 'Product code (e.g., bop)' },
      api: { type: 'string', demandOption: true, description: 'API name (e.g., createQuote)' },
    })
    .help() // Add help option
    .alias('h', 'help')
    .strict() // Enforce that only defined options are used
    .parseAsync(); // Use parseAsync for consistency

  const { product, api } = argv; // This should now work correctly
  console.log(`Generating tests for Product: ${product}, API: ${api}`);

  // ... (rest of the generateTests function remains the same) ...
}

// ... (call to generateTests() and error handling remain the same) ...
```

**Key Changes to `yargs` Setup:**

1.  **`import yargs from 'yargs/yargs';`**: Changed the import slightly to `yargs/yargs`. This gives us the function to initialize `yargs` with `process.argv`.
2.  **`yargs(hideBin(process.argv))`**: This is the standard way to initialize `yargs` to correctly parse command-line arguments, including those passed after `--` in an npm script.
3.  **`.help()` and `.alias('h', 'help')`**: Added the standard help option.
4.  **`.strict()`**: This is good practice. It will cause `yargs` to error if unknown options are passed.
5.  **`.parseAsync()`**: Using `parseAsync()` to be consistent if any async validation or coercion were to be added later. For simple parsing, `.parse()` would also work.

**Why the Previous Version Failed with `npm run ... -- ...`:**

The previous `yargs(hideBin(process.argv))` without the direct `yargs()` import might have had a subtle issue with how `npm` forwards arguments when `yargs` is imported as `import yargs from 'yargs'`. Using `yargs/yargs` and initializing it with `hideBin(process.argv)` is the more robust way to handle CLI argument parsing in Node.js scripts, especially when they are invoked through `npm` scripts.

**To Test This Correction:**

1.  Replace the `yargs` import and initialization in your `src/core/test-generator.ts` with the snippet above.
2.  Save the file.
3.  Run the command again:
    ```bash
    npm run generate:tests -- --product=bop --api=createQuote
    ```

This should now correctly parse `product` as "bop" and `api` as "createQuote", and the script should proceed without the "Missing required arguments" error.

Let me know if this resolves the issue!


Okay, that's frustrating. If it's still giving "Missing required arguments," let's try a slightly different but common approach for `yargs` with npm scripts and also ensure the `package.json` script is definitely passing them correctly.

**Possibility 1: `npm` script argument passing nuance**

Sometimes, depending on the shell or exact npm version, the argument parsing can be tricky.
Let's first ensure your `package.json` script for `generate:tests` is robust.

In your `package.json`, your script is:
```json
"generate:tests": "ts-node src/core/test-generator.ts",
```
When you run `npm run generate:tests -- --product=bop --api=createQuote`, the arguments `--product=bop --api=createQuote` *should* be appended to the `ts-node src/core/test-generator.ts` command.

**Possibility 2: `yargs` configuration depth**

Let's try a very explicit `yargs` setup.

---

**Revised `src/core/test-generator.ts` (Focus on `yargs` Robustness)**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
// Keep this import as it was before, if the yargs/yargs didn't help.
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';


// ... (interfaces and generateCombinations function remain the same) ...

// --- Main Generator Logic ---
async function generateTests() {
  // 1. Parse CLI arguments
  // Let's make yargs configuration very explicit
  const argv = yargs(hideBin(process.argv))
    .command('$0 <product> <api>', 'Generate API tests', (yargsInstance) => {
        // Define positional arguments if we want them, but options are generally better for named args.
        // For now, sticking to options.
    })
    .option('product', {
        alias: 'p',
        describe: 'Product code (e.g., bop)',
        type: 'string',
        demandOption: true, // This is what triggers "Missing required arguments"
    })
    .option('api', {
        alias: 'a',
        describe: 'API name (e.g., createQuote)',
        type: 'string',
        demandOption: true, // This is what triggers "Missing required arguments"
    })
    .help()
    .alias('help', 'h')
    .strict() // Important for catching typos in arguments
    .argv; // Use .argv (synchronous) or .parse() / .parseAsync()


  // Yargs might return a promise if certain middleware is used, or if using parseAsync.
  // Awaiting it is safer if there's any doubt.
  const resolvedArgv = await argv;

  const { product, api } = resolvedArgv;

  if (!product || !api) {
    console.error("Error: Product and API arguments are required.");
    // yargs should handle this with demandOption, but an extra check.
    process.exit(1);
  }

  console.log(`Generating tests for Product: ${product}, API: ${api}`);

  // ... (rest of the generateTests function remains the same) ...
  // Ensure the rest of your function uses `product` and `api` as parsed.
}

// ... (call to generateTests() and error handling remain the same) ...
```

**Key Changes in this Attempt:**

1.  **`import yargs from 'yargs';`**: Went back to the simpler import, as the `yargs/yargs` one might not have been the core issue if the problem persists.
2.  **Explicit `.option()` calls:**
    *   We are explicitly defining `product` and `api` as options.
    *   `demandOption: true` is what causes `yargs` to throw the "Missing required arguments" error if they are not found.
3.  **`.argv` Property:** Using `.argv` to get the parsed arguments. This is often a synchronous property unless specific async middleware or `.parseAsync()` is used. Awaiting `argv` (as `resolvedArgv = await argv;`) handles cases where `argv` might be a promise due to yargs internals or extensions.
4.  **Redundant Check (for debugging):** Added a manual `if (!product || !api)` check after parsing. If `yargs` fails to parse them, these will be undefined, and this check will catch it, confirming `yargs` is the issue.

**Debugging Steps if it Still Fails:**

1.  **Simplify the npm script temporarily:**
    In `package.json`, change:
    ```json
    "generate:tests": "ts-node src/core/test-generator.ts --product=testprod --api=testapi",
    ```
    Then run:
    ```bash
    npm run generate:tests
    ```
    Does this work? If so, the issue is definitely how `npm run ... -- ...` is passing arguments versus how `yargs` expects them when invoked that way.

2.  **Log `process.argv`:**
    At the very beginning of your `test-generator.ts` (before `yargs`), add:
    ```typescript
    console.log("Raw arguments received by script:", process.argv);
    ```
    Run `npm run generate:tests -- --product=bop --api=createQuote`.
    What does this output? It should look something like:
    ```
    Raw arguments received by script: [
      '/path/to/node',
      '/path/to/your/project/node_modules/.bin/ts-node', // or .../ts-node/dist/bin.js
      '/path/to/your/project/src/core/test-generator.ts',
      '--product=bop',  // <-- These are what yargs needs to see
      '--api=createQuote' // <--
    ]
    ```
    If `--product=bop` and `--api=createQuote` are *not* present as separate elements in this array, then npm is not forwarding them as expected, or `hideBin` is somehow misinterpreting them.

3.  **Try without `hideBin` (less likely to be the issue, but worth a quick check):**
    ```typescript
    const argv = yargs(process.argv.slice(2)) // Slice off node and script path manually
      // ... rest of yargs config
      .argv;
    ```
    `hideBin` is just a utility for `process.argv.slice(2)`.

4.  **Double-check typos:** Ensure the arguments you're passing on the command line exactly match what `yargs` expects (`--product`, not `--prod` or similar, unless you defined aliases).

Let's try these and see if we can pinpoint where the argument parsing is going astray. The `console.log(process.argv)` will be very revealing.


Ah, PowerShell! That's a very important piece of information. PowerShell handles arguments, especially those after `--`, differently from `bash` or `cmd`. This is a common source of confusion for Node.js CLI tools.

**The PowerShell Problem with `--` (The "Stop Parsing" Token)**

In PowerShell, the `--` token tells PowerShell to stop parsing arguments itself and pass the rest of the line verbatim *as a single string* to the executable if the executable is a native Windows application. For Node.js scripts (which are not native executables directly), the behavior can be a bit more nuanced and sometimes requires specific quoting or handling by the argument parsing library within Node.js.

Often, `npm` tries to normalize this, but it's not always perfect.

**Let's Try Solutions Tailored for PowerShell:**

**Solution 1: Remove the `--` in your `npm run` command (Most Likely Fix)**

When running `npm` scripts in PowerShell, often you *don't* need the `--` to pass arguments to the underlying script. `npm` itself usually handles forwarding them.

Try this in PowerShell:
```powershell
npm run generate:tests --product=bop --api=createQuote
```
**Notice the removal of the standalone `--` before `--product=bop`.**

Then, in your `test-generator.ts`, the `yargs` setup from my previous "Corrected Version" (the one with `yargs(hideBin(process.argv))` and `.option()`) should work.

**Let's re-paste that yargs setup for clarity:**

```typescript
// In src/core/test-generator.ts

import yargs from 'yargs'; // Or yargs/yargs
import { hideBin } from 'yargs/helpers';

// ... other imports and interfaces ...

async function generateTests() {
  console.log("Raw process.argv:", process.argv); // Keep this for debugging

  const argv = await yargs(hideBin(process.argv))
    .options({
      product: {
        alias: 'p',
        describe: 'Product code (e.g., bop)',
        type: 'string',
        demandOption: true,
      },
      api: {
        alias: 'a',
        describe: 'API name (e.g., createQuote)',
        type: 'string',
        demandOption: true,
      },
    })
    .help()
    .alias('help', 'h')
    .strict()
    .parseAsync(); // .argv would also be fine if no async middleware

  const { product, api } = argv;

  if (!product || !api) { // This check might be redundant if demandOption works
    console.error("Error: Product and API arguments are required. Yargs parsing might have failed.");
    console.error("Parsed argv:", argv);
    process.exit(1);
  }

  console.log(`Generating tests for Product: ${product}, API: ${api}`);
  // ... rest of your function
}

generateTests().catch(error => {
  console.error("❌ Error during test generation:", error);
  process.exit(1);
});
```

**What `console.log("Raw process.argv:", process.argv);` should show (with Solution 1):**
When you run `npm run generate:tests --product=bop --api=createQuote` in PowerShell, `process.argv` inside your script should look like:
```
Raw process.argv: [
  'C:\\Program Files\\nodejs\\node.exe', // Path to Node
  'C:\\path\\to\\your\\project\\node_modules\\ts-node\\dist\\bin.js', // Path to ts-node runner
  'C:\\path\\to\\your\\project\\src\\core\\test-generator.ts', // Path to your script
  '--product=bop',
  '--api=createQuote'
]
```
This is what `yargs(hideBin(process.argv))` is designed to parse correctly.

**Solution 2: If Solution 1 doesn't work, try quoting the arguments (Less Common for npm)**

Sometimes, PowerShell might still interfere. You could try quoting the arguments passed to npm, though this is less common for `npm run` scripts.
```powershell
npm run generate:tests "--product=bop" "--api=createQuote"
```
Or even:
```powershell
npm run generate:tests -- "--product=bop" "--api=createQuote"
```
(Keeping the `--` but quoting the arguments after it).

**Solution 3: Modifying the npm script to explicitly handle arguments (More Complex)**

If neither of the above works, you can modify the `package.json` script to explicitly take arguments, though this makes the script less flexible.
```json
// In package.json
"scripts": {
  "generate:tests": "ts-node src/core/test-generator.ts"
  // If you wanted to pass them as script args to npm itself, it's more complex
  // and usually not necessary.
},
```
Then call it like this and have `yargs` parse `$1`, `$2`, etc. if you were directly invoking the script without `npm run`. But with `npm run`, the arguments are usually just appended.

**Let's start with Solution 1 as it's the most common fix for PowerShell + npm + argument parsing issues.**

1.  Ensure your `test-generator.ts` has the `yargs` setup as shown above (with the `console.log(process.argv)` for debugging).
2.  In PowerShell, run:
    ```powershell
    npm run generate:tests --product=bop --api=createQuote
    ```

Check the output of `console.log("Raw process.argv:", process.argv);`. If it shows `--product=bop` and `--api=createQuote` as separate array elements, `yargs` should work. If it's still failing, share that `process.argv` output.


You're right to point that out. The `test-executor.ts` needs some type guarding to satisfy TypeScript's strict null checks, especially around optional properties like `expected.body` or `expected.headers`.

When you have a type like:
```typescript
interface ExpectedOutput {
  status: number;
  body?: { // body is optional
    should_contain_key?: string;
    [key: string]: any;
  };
  headers?: { [key: string]: string | RegExp }; // headers is optional
}
```
And then you try to access `expected.body.should_contain_key` without first checking if `expected.body` exists, TypeScript will (correctly) warn you that `expected.body` could be `undefined`.

Let's refine the `test-executor.ts` to handle these optional properties gracefully.

---
📁 **`src/core/`**
📄 **`test-executor.ts`** (Improved Type Safety)
```typescript
import { test, expect, APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';
import { getAuthHeaders, setGlobalVariable, getGlobalVariable } from '@/helpers/auth-handler';

interface TestCase {
  test_id: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: { [key: string]: string };
  payload?: any;
  auth: 'none' | 'bearer' | 'cookie';
  chaining?: {
    set_global?: { [key: string]: string };
    use_global?: { [key: string]: string };
  };
  // pre_hooks?: string[]; // Future
  // post_hooks?: string[];// Future
}

interface ExpectedOutput {
  status: number;
  body?: null | { // body can be explicitly null if no body is expected, or an object
    should_contain_key?: string;
    [key: string]: any;
  } | string; // Or a string for exact text match (non-JSON)
  headers?: { [key: string]: string | RegExp };
  // Add more assertion types as needed
}

export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) {
  const definitionFilePath = path.join(process.cwd(), definitionYamlPath);
  const expectedOutputFilePath = path.join(process.cwd(), expectedJsonPath);

  if (!fs.existsSync(definitionFilePath)) {
    console.warn(`Skipping tests: Definition file not found at ${definitionFilePath}`);
    test.describe(`Skipped API Tests for ${path.basename(definitionYamlPath)}`, () => {
      test('Definition file missing', () => {
        expect(true).toBe(false, `Definition file missing: ${definitionFilePath}`);
      });
    });
    return;
  }
  if (!fs.existsSync(expectedOutputFilePath)) {
    console.warn(`Skipping tests: Expected output file not found at ${expectedOutputFilePath}`);
    test.describe(`Skipped API Tests for ${path.basename(definitionYamlPath)}`, () => {
      test('Expected output file missing', () => {
        expect(true).toBe(false, `Expected output file missing: ${expectedOutputFilePath}`);
      });
    });
    return;
  }

  const testCases = yaml.load(fs.readFileSync(definitionFilePath, 'utf8')) as TestCase[];
  const allExpectedOutputs = JSON.parse(fs.readFileSync(expectedOutputFilePath, 'utf8'));

  test.describe(`API Tests for ${path.basename(definitionYamlPath)}`, () => {
    test.describe.configure({ mode: 'parallel' });

    for (const testCase of testCases) {
      test(testCase.description, async ({ request }) => {
        const expected: ExpectedOutput | undefined = allExpectedOutputs[testCase.test_id];
        if (!expected) {
          // Make the test fail clearly if expected output is missing
          expect(true, `No expected output found for test_id: ${testCase.test_id} in ${expectedOutputFilePath}`).toBe(false);
          return; // Stop execution for this test case
        }

        await allure.id(testCase.test_id);
        await allure.epic(path.dirname(definitionYamlPath).split(path.sep).pop() || 'API Tests');
        await allure.feature(path.basename(definitionYamlPath, '.yml'));
        await allure.story(testCase.description);

        await allure.step(`[Setup] Test ID: ${testCase.test_id}`, async () => {
          allure.parameter('Method', testCase.method);
          allure.parameter('Endpoint Original', testCase.endpoint);
          allure.parameter('Auth Type', testCase.auth);
        });

        let finalEndpoint = testCase.endpoint;
        let finalPayload = testCase.payload;

        if (testCase.chaining?.use_global) {
          for (const [placeholder, globalVarKey] of Object.entries(testCase.chaining.use_global)) {
            const value = getGlobalVariable(globalVarKey);
            if (value === undefined) {
              console.warn(`[Chaining] Global variable '${globalVarKey}' not found for placeholder '{{${placeholder}}}' in test ${testCase.test_id}`);
              // Decide if this should be a failure or just a warning
              // For now, it continues, and placeholder might not be replaced.
            } else {
              const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
              finalEndpoint = finalEndpoint.replace(regex, String(value));
              if (typeof finalPayload === 'string') {
                finalPayload = finalPayload.replace(regex, String(value));
              } else if (typeof finalPayload === 'object' && finalPayload !== null) {
                // Deep replace in payload (if payload is an object or stringified object)
                let tempPayloadStr = JSON.stringify(finalPayload);
                tempPayloadStr = tempPayloadStr.replace(regex, String(value).replace(/"/g, '\\"')); // Escape quotes in value
                try {
                  finalPayload = JSON.parse(tempPayloadStr);
                } catch(e) {
                  console.error(`[Chaining] Error parsing payload after replacing placeholder {{${placeholder}}} for test ${testCase.test_id}`, e)
                  // Potentially fail the test here or use original payload
                }
              }
            }
          }
           allure.parameter('Endpoint Final', finalEndpoint);
        }

        const response = await sendRequest(request, { ...testCase, endpoint: finalEndpoint, payload: finalPayload });

        await allure.step(`[Assert] Status Code - Expected: ${expected.status}`, async () => {
          expect(response.status()).toBe(expected.status);
        });

        const responseBodyText = await response.text();
        let actualBody: any;
        let isJsonResponseBody = false;
        if (responseBodyText) {
          try {
            actualBody = JSON.parse(responseBodyText);
            isJsonResponseBody = true;
          } catch (e) {
            actualBody = responseBodyText; // If not JSON, keep as text
          }
        } else {
          actualBody = null; // Explicitly null if response body is empty
        }

        // --- Body Assertions ---
        if (expected.body !== undefined) { // Check if 'body' key exists in expected output
          await allure.step('[Assert] Response Body', async () => {
            if (expected.body === null) {
              // Expecting no body or an explicitly null body
              expect(actualBody, "Expected response body to be null or empty").toBeNull();
            } else if (typeof expected.body === 'string') {
              // Expecting an exact string match (for non-JSON responses)
              expect(actualBody, "Expected response body to be an exact string match").toBe(expected.body);
            } else if (isJsonResponseBody && typeof expected.body === 'object' && actualBody !== null) {
              // Expecting a JSON object
              if (expected.body.should_contain_key) {
                 expect(actualBody, `Expected response body to have key: ${expected.body.should_contain_key}`).toHaveProperty(expected.body.should_contain_key);
              } else {
                // Using toMatchObject for partial matching of JSON structures
                expect(actualBody, "Expected response body to match object structure").toMatchObject(expected.body);
              }
            } else if (typeof expected.body === 'object' && !isJsonResponseBody) {
              // Expected JSON object but received non-JSON or empty body
              expect.fail(`Expected a JSON object body, but received: ${isJsonResponseBody ? 'null' : 'non-JSON content'}. Actual body: ${actualBody}`);
            } else if (typeof expected.body === 'object' && actualBody === null) {
                expect.fail(`Expected a JSON object body, but received an empty or null body.`);
            }
            // Add more specific assertions for XML or other types if needed
          });
        }


        // --- Header Assertions ---
        if (expected.headers) { // Check if 'headers' key exists
          await allure.step('[Assert] Response Headers', async () => {
            const actualHeaders = response.headers();
            for (const [key, expectedValue] of Object.entries(expected.headers)) {
              const actualHeaderValue = actualHeaders[key.toLowerCase()]; // Headers are case-insensitive
              expect(actualHeaderValue, `Expected header '${key}' to be defined.`).toBeDefined();
              if (actualHeaderValue !== undefined) { // Check to satisfy TypeScript
                if (typeof expectedValue === 'string') {
                  expect(actualHeaderValue, `Value for header '${key}' did not match.`).toContain(expectedValue); // Or .toBe() for exact match
                } else if (expectedValue instanceof RegExp) {
                  expect(actualHeaderValue, `Value for header '${key}' did not match regex.`).toMatch(expectedValue);
                }
              }
            }
          });
        }

        if (response.ok() && testCase.chaining?.set_global) {
          // Pass actualBody (which could be parsed JSON or raw text)
          await handleResponseChaining(actualBody, isJsonResponseBody, testCase.chaining.set_global);
        }
      });
    }
  });
}

// ... (sendRequest function - check for potential improvements there too regarding payload stringification or parsing) ...

async function sendRequest(request: APIRequestContext, testCase: TestCase): Promise<APIResponse> {
  // ... (previous sendRequest logic)
  let payloadData: any = testCase.payload;
  const requestHeaders = { ...(testCase.headers || {}) };
  let payloadContentType = requestHeaders['Content-Type'] || requestHeaders['content-type']; // Keep original case if present

  if (!payloadContentType && typeof payloadData === 'object' && payloadData !== null) {
    payloadContentType = 'application/json'; // Default to JSON if object and no content type
  } else if (!payloadContentType) {
    payloadContentType = 'text/plain'; // Default for other string payloads
  }
  requestHeaders['Content-Type'] = payloadContentType; // Standardize Content-Type key


  if (testCase.auth === 'bearer' || testCase.auth === 'cookie') {
    Object.assign(requestHeaders, getAuthHeaders());
  }

  if (typeof testCase.payload === 'string' && testCase.payload.startsWith('file://')) {
    const filePath = path.join(process.cwd(), testCase.payload.replace('file://', ''));
    if (!fs.existsSync(filePath)) {
      throw new Error(`Payload file not found: ${filePath}`);
    }
    payloadData = fs.readFileSync(filePath, 'utf-8');
    await allure.attachment('Request Payload (from file)', payloadData, {
      contentType: payloadContentType
    });
  } else if (payloadData !== undefined && payloadData !== null) {
      if (payloadContentType.toLowerCase().includes('json') && typeof payloadData === 'object') {
          payloadData = JSON.stringify(payloadData); // Stringify if JSON and object
      }
      // For XML or other text, if payloadData is already a string, it's fine.
      // If it's an object intended for XML, it must be pre-formatted string or converted.
      await allure.attachment('Request Payload (inline)', String(payloadData), { contentType: payloadContentType });
  }


  const options: any = {
    headers: requestHeaders,
    // Playwright's `data` is for 'application/x-www-form-urlencoded' (object or string)
    // `form` is for 'multipart/form-data' (object)
    // `jsonData` is for 'application/json' (object)
    // For other types like XML or plain text, pass the string directly as the body.
    // Playwright `request.post(url, { data: stringBody, headers: {'Content-Type': 'application/xml'}})`
  };

  if (payloadData !== undefined) {
    if (payloadContentType.toLowerCase().includes('json')) {
        try {
            // Ensure payloadData is an object if it was a JSON string
            options.jsonData = (typeof payloadData === 'string') ? JSON.parse(payloadData) : payloadData;
        } catch(e) {
            console.error("Error parsing JSON payload for jsonData option:", e, "Payload:", payloadData);
            // Fallback or throw error. For now, let it proceed, Playwright might error.
            options.data = payloadData; // Fallback to generic data
        }
    } else if (payloadContentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
        options.data = payloadData; // Can be object or string
    } else {
        // For XML, text/plain, etc., send as raw data (string body)
        options.data = String(payloadData);
    }
  }


  await allure.step(`[Action] Sending ${testCase.method} request to ${testCase.endpoint}`, async () => {
    const dataToLog = options.jsonData ? JSON.stringify(options.jsonData, null, 2) :
                      options.data ? (typeof options.data === 'object' ? JSON.stringify(options.data, null, 2) : options.data) :
                      'No Body';
    await allure.attachment('Request Data Sent', dataToLog, { contentType: payloadContentType });
    await allure.attachment('Request Headers Sent', JSON.stringify(options.headers, null, 2), { contentType: 'application/json' });
  });

  const response = await request[testCase.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'](
    testCase.endpoint,
    options
  );

  await allure.step(`[Result] Received response (Status: ${response.status()})`, async () => {
    const bodyText = await response.text();
    let attachmentContentType = response.headers()['content-type'] || 'text/plain';
    if (attachmentContentType.includes('json')) attachmentContentType = 'application/json';
    else if (attachmentContentType.includes('xml')) attachmentContentType = 'application/xml';
    else if (attachmentContentType.includes('html')) attachmentContentType = 'text/html';
    else attachmentContentType = 'text/plain';

    await allure.attachment('Response Body', bodyText, { contentType: attachmentContentType });
    await allure.attachment('Response Headers', JSON.stringify(response.headers(), null, 2), { contentType: 'application/json' });
  });

  return response;
}


/**
 * Handles post-response actions, like extracting and storing global variables.
 * @param responseData The actual response data (parsed JSON object or raw text).
 * @param isJsonResponse Indicates if responseData is parsed JSON.
 * @param setGlobalConfig The configuration for setting global variables.
 */
async function handleResponseChaining(responseData: any, isJsonResponse: boolean, setGlobalConfig: { [key: string]: string }) {
  if (!isJsonResponse && typeof responseData !== 'string') { // Allow chaining on raw string responses too if needed
    console.warn('[Chaining] Cannot process chaining: Response data is not a parsable object or a string.');
    return;
  }
  await allure.step('[Chaining] Processing response data for global variables', async () => {
    for (const [globalVarKey, sourcePath] of Object.entries(setGlobalConfig)) {
      let value: any;
      if (isJsonResponse && typeof responseData === 'object' && responseData !== null) {
        value = getValueFromObject(responseData, sourcePath);
      } else if (typeof responseData === 'string' && sourcePath === 'body') { // Special case: "body" means the whole string response
        value = responseData;
      }
      // Add more logic here if you need to extract from non-JSON string using regex, for example

      if (value !== undefined && value !== null) {
        setGlobalVariable(globalVarKey, value);
        await allure.attachment(`${globalVarKey} Captured`, String(value), { contentType: 'text/plain' });
      } else {
        console.warn(`[Chaining] Value for path '${sourcePath}' not found in response for global variable '${globalVarKey}'.`);
      }
    }
  });
}

function getValueFromObject(obj: any, path: string): any {
  if (typeof path !== 'string') return undefined;
  return path.split('.').reduce((o, key) => (o && typeof o === 'object' && o[key] !== undefined ? o[key] : undefined), obj);
}
```

**Key Changes for Type Safety and Robustness:**

1.  **`ExpectedOutput` Interface:**
    *   `body?: null | { ... } | string;`: The `body` can now be explicitly `null` (if you expect no body or a JSON null), an object (for JSON structure matching), or a `string` (for exact text matching of non-JSON responses). This makes your expected JSON files more expressive.

2.  **Missing Expected Output:**
    *   If `allExpectedOutputs[testCase.test_id]` is undefined, the test now fails explicitly with `expect(true, ...).toBe(false);` and returns, preventing further errors.

3.  **Missing Files:**
    *   If definition or expected files are missing, it now creates a skipped/failed test case in Allure to make this visible, instead of just a console warning.

4.  **Body Assertions (`if (expected.body !== undefined)`):**
    *   The entire block for body assertions is now wrapped in `if (expected.body !== undefined)`. This ensures you only try to assert the body if `body` is actually a key in your `expected[test_id]` object.
    *   **`expected.body === null`**: Checks if you explicitly expect no body or a JSON null.
    *   **`typeof expected.body === 'string'`**: Checks if you expect an exact string match (for XML, plain text, etc.).
    *   **`isJsonResponseBody && typeof expected.body === 'object' ...`**: Handles JSON object matching.
    *   **Error messages**: Added more descriptive failure messages if types don't match (e.g., expected JSON, got text).

5.  **Header Assertions (`if (expected.headers)`):**
    *   Wrapped in a check for `expected.headers`.
    *   `actualHeaders[key.toLowerCase()]`: Accessing actual headers case-insensitively.
    *   `actualHeaderValue !== undefined`: TypeScript guard before using `actualHeaderValue`.

6.  **`sendRequest` Function Payload Handling:**
    *   **Playwright `request` options:** The `sendRequest` function is significantly updated to use Playwright's specific request options more correctly:
        *   `jsonData`: For `application/json` payloads (expects an object).
        *   `data`: For `application/x-www-form-urlencoded` (can be object or string) or for raw string bodies like XML, text/plain.
    *   It now tries to determine if the payload is JSON and use `jsonData`, otherwise falls back to `data`.
    *   This makes it more robust in how it sends different payload types.
    *   Default `Content-Type` is set if not provided and payload is an object.

7.  **`handleResponseChaining`:**
    *   Now takes `isJsonResponse` as an argument.
    *   Allows chaining on the entire string body if `sourcePath` is simply `"body"`. This is useful if you get a plain text token or ID back.

8.  **Placeholder Replacement in Payloads:**
    *   Improved the logic for replacing placeholders in JSON payloads to better handle escaping quotes within the replacement values.

**How to Update Your Expected JSON Files:**

*   **If you expect no response body:**
    ```json
    "TC_XYZ": {
      "status": 204,
      "body": null // Explicitly null
    }
    ```
*   **If you expect a JSON body with a specific key:**
    ```json
    "TC_ABC": {
      "status": 200,
      "body": {
        "should_contain_key": "userId"
      }
    }
    ```
*   **If you expect a JSON body matching a structu


```typescript
import { test, expect } from '@/helpers/test-fixtures';
import { APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';

// --- Type Definitions (Unchanged) ---
interface TestCase { /* ... */ }
interface ExpectedOutput { /* ... */ }

// --- Main Executor Function (Unchanged) ---
export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) {
  // ... (All logic for file checks and looping through test cases remains the same)
  // Inside the loop:
  test(testCase.description || `Test ID: ${testCase.test_id}`, async ({ request, authedRequest }) => {
    // ...
    const apiRequest = testCase.auth === 'bearer' ? authedRequest : request;
    const response = await sendRequest(apiRequest, testCase);
    // ... (All assertion logic remains the same)
  });
}

// --- Helper Functions ---

/**
 * Prepares and sends the API request based on the test case definition.
 * THIS FUNCTION IS NOW CORRECTED AND COMPLETE.
 */
async function sendRequest(request: APIRequestContext, testCase: TestCase): Promise<APIResponse> {
  const requestHeaders = { ...(testCase.headers || {}) };
  let payload: any = testCase.payload;

  // 1. Load payload from file if specified
  if (typeof payload === 'string' && payload.startsWith('file://')) {
    const filePath = path.join(process.cwd(), payload.replace('file://', ''));
    if (!fs.existsSync(filePath)) throw new Error(`Payload file not found: ${filePath}`);
    payload = fs.readFileSync(filePath, 'utf-8');
  }

  // 2. Prepare request options, including headers
  const options: {
    headers: any;
    data?: any;
    jsonData?: any;
    form?: any; // For multipart/form-data
  } = {
    headers: requestHeaders,
  };

  // 3. Attach the payload to the options object based on its type and Content-Type header
  if (payload !== undefined && payload !== null) {
    const contentType = requestHeaders['Content-Type'] || requestHeaders['content-type'] || '';
    let payloadForAttachment: string;

    if (contentType.includes('json')) {
      // For JSON, Playwright expects a serializable object in `jsonData`.
      options.jsonData = (typeof payload === 'string') ? JSON.parse(payload) : payload;
      payloadForAttachment = JSON.stringify(options.jsonData, null, 2);
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      // For form data, Playwright expects an object in `data`.
      options.data = (typeof payload === 'string') ? new URLSearchParams(payload).toString() : payload;
      payloadForAttachment = typeof options.data === 'object' ? JSON.stringify(options.data) : options.data;
    } else {
      // For all other types (XML, text/plain, etc.), send the payload as a raw string in `data`.
      options.data = String(payload);
      payloadForAttachment = options.data;
    }

    // Add Allure attachment for the payload being sent
    await allure.attachment('Request Payload', payloadForAttachment, { contentType: contentType || 'text/plain' });
  }

  // 4. Log and send the request
  await allure.step(`[Action] Sending ${testCase.method} request to ${testCase.endpoint}`, async () => {
    await allure.attachment('Request Headers', JSON.stringify(options.headers, null, 2), { contentType: 'application/json' });
  });

  const response = await request[testCase.method.toLowerCase() as 'post'](testCase.endpoint, options);

  // 5. Log the response
  await allure.step(`[Result] Received Response (Status: ${response.status()})`, async () => {
    const contentType = response.headers()['content-type'] || 'text/plain';
    await allure.attachment('Response Body', await response.text(), { contentType });
    await allure.attachment('Response Headers', JSON.stringify(response.headers(), null, 2), { contentType: 'application/json' });
  });

  return response;
}


// --- Other Helper Functions (Unchanged) ---
function tryParseJson(text: string): any { /* ... */ }
async function assertBody(actualBody: any, expectedBody: ExpectedOutput['body']) { /* ... */ }
async function assertHeaders(actualHeaders: Record<string, string>, expectedHeaders?: ExpectedOutput['headers']) { /* ... */ }

// --- Re-pasting the full file content for clarity ---

export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) {
  if (!fs.existsSync(definitionYamlPath)) {
    throw new Error(`FATAL: Definition file not found: ${definitionYamlPath}`);
  }
  if (!fs.existsSync(expectedJsonPath)) {
    throw new Error(`FATAL: Expected output file not found: ${expectedJsonPath}`);
  }

  let testCases: TestCase[];
  let allExpectedOutputs: Record<string, ExpectedOutput>;

  try {
    testCases = yaml.load(fs.readFileSync(definitionYamlPath, 'utf8')) as TestCase[];
    if (!Array.isArray(testCases)) {
      throw new Error(`YAML file ${definitionYamlPath} must parse to an array.`);
    }
  } catch (e: any) {
    throw new Error(`FATAL: Error parsing YAML file ${definitionYamlPath}: ${e.message}`);
  }

  try {
    allExpectedOutputs = JSON.parse(fs.readFileSync(expectedJsonPath, 'utf8'));
  } catch (e: any) {
    throw new Error(`FATAL: Error parsing JSON file ${expectedJsonPath}: ${e.message}`);
  }

  test.describe(`API Tests for ${path.basename(definitionYamlPath)}`, () => {
    test.describe.configure({ mode: 'parallel' });

    for (const testCase of testCases) {
      if (!testCase || !testCase.test_id) {
        test(`Malformed Test Case in ${path.basename(definitionYamlPath)}`, () => {
          throw new Error(`Malformed test case entry found (missing test_id): ${JSON.stringify(testCase)}`);
        });
        continue;
      }

      test(testCase.description || `Test ID: ${testCase.test_id}`, async ({ request, authedRequest }) => {
        const expected = allExpectedOutputs[testCase.test_id];
        if (!expected) {
          throw new Error(`No expected output found for test_id: ${testCase.test_id}`);
        }

        await allure.id(testCase.test_id);
        await allure.epic(path.dirname(definitionYamlPath).split(path.sep).pop() || 'API Tests');
        await allure.feature(path.basename(definitionYamlPath, '.yml'));
        await allure.story(testCase.description);

        const apiRequest = testCase.auth === 'bearer' ? authedRequest : request;
        const response = await sendRequest(apiRequest, testCase);

        await allure.step(`[Assert] Status Code - Expected: ${expected.status}`, () => {
          expect(response.status()).toBe(expected.status);
        });

        const responseBodyText = await response.text();
        const actualBody = responseBodyText ? tryParseJson(responseBodyText) : null;
        
        await assertBody(actualBody, expected.body);
        await assertHeaders(response.headers(), expected.headers);
      });
    }
  });
}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function assertBody(actualBody: any, expectedBody: ExpectedOutput['body']) {
  if (expectedBody === undefined) return;

  await allure.step('[Assert] Response Body', async () => {
    if (expectedBody === null) {
      expect(actualBody, "Expected response body to be null or empty.").toBeNull();
    } else if (typeof expectedBody === 'string') {
      expect(actualBody, "Expected an exact string match.").toBe(expectedBody);
    } else if (typeof actualBody === 'object' && actualBody !== null) {
      if (expectedBody.should_contain_key) {
        expect(actualBody, `Expected key not found: ${expectedBody.should_contain_key}`).toHaveProperty(expectedBody.should_contain_key);
      } else {
        expect(actualBody, "Expected JSON body to match structure.").toMatchObject(expectedBody);
      }
    } else {
      throw new Error(`Type mismatch: Expected body to be an object, but received type '${typeof actualBody}'. Actual Body: ${actualBody}`);
    }
  });
}

async function assertHeaders(actualHeaders: Record<string, string>, expectedHeaders?: ExpectedOutput['headers']) {
  if (!expectedHeaders) return;

  await allure.step('[Assert] Response Headers', async () => {
    for (const [key, expectedValue] of Object.entries(expectedHeaders)) {
      const actualValue = actualHeaders[key.toLowerCase()];
      expect(actualValue, `Header '${key}' not found.`).toBeDefined();
      if (typeof expectedValue === 'string') {
        expect(actualValue, `Header '${key}' did not match.`).toContain(expectedValue);
      } else {
        expect(actualValue, `Header '${key}' did not match regex.`).toMatch(expectedValue as RegExp);
      }
    }
  });
}
```