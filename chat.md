
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