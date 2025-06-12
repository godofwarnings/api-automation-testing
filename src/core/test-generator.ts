import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Helper function to compute the Cartesian product of multiple arrays
// This is the magic that creates all combinations.
const cartesian = <T>(...a: T[][]): T[][] => a.reduce((a, b) => a.flatMap(d => b.map(e => [d, e].flat())));

// --- Main Generator Logic ---
async function generateTests() {
    // 1. Parse CLI arguments
    const argv = await yargs(hideBin(process.argv)).options({
        product: { type: 'string', demandOption: true },
        api: { type: 'string', demandOption: true },
    }).argv;

    const { product, api } = argv;
    console.log(Generating tests for Product: ${ product }, API: ${ api });

    // 2. Define file paths based on arguments
    const rootDir = process.cwd();
    const varianceConfigPath = path.join(rootDir, 'config', 'data-variance', product, ${ api }.yml);
    const baseTemplatePath = path.join(rootDir, 'templates', product, ${ api }_base.xml);

    const generatedPayloadsDir = path.join(rootDir, 'payloads', 'generated', product, api);
    const generatedTestsDir = path.join(rootDir, 'tests', 'products', product, 'generated');
    const generatedYamlPath = path.join(generatedTestsDir, ${ api }.yml);
    const generatedExpectedJsonPath = path.join(generatedTestsDir, ${ api }.json);

    // Create output directories if they don't exist
    fs.mkdirSync(generatedPayloadsDir, { recursive: true });
    fs.mkdirSync(generatedTestsDir, { recursive: true });

    // 3. Load input files
    const varianceConfig = yaml.load(fs.readFileSync(varianceConfigPath, 'utf8')) as any;
    const baseXmlTemplate = fs.readFileSync(baseTemplatePath, 'utf8');

    // 4. Generate all data combinations
    const parameterNames = varianceConfig.parameters.map((p: any) => p.field);
    const parameterValues = varianceConfig.parameters.map((p: any) => p.values);
    const combinations = cartesian(...parameterValues);

    const generatedTestCases = [];
    const generatedExpectedOutputs: { [key: string]: any } = {};

    // 5. Loop through each combination to create payloads and test definitions
    for (let i = 0; i < combinations.length; i++) {
        const combination = combinations[i];
        const testId = TC_${ product.toUpperCase()
    }_${ api.toUpperCase() }_${ String(i + 1).padStart(3, '0') };
    let currentPayload = baseXmlTemplate;
    const combinationDetails: string[] = [];

    // Replace placeholders in the XML template
    for (let j = 0; j < parameterNames.length; j++) {
        const placeholder = new RegExp(`\\{\\{${parameterNames[j]}\\}\\}`, 'g');
        currentPayload = currentPayload.replace(placeholder, combination[j]);
        combinationDetails.push(`${parameterNames[j]}: ${combination[j]}`);
    }

    // Save the generated XML payload to its own file
    const payloadFilePath = path.join(generatedPayloadsDir, `payload_${testId}.xml`);
    fs.writeFileSync(payloadFilePath, currentPayload);

    // Create the test case definition for the main YAML file
    generatedTestCases.push({
        test_id: testId,
        description: `Verify ${api} with combination: ${combinationDetails.join(', ')}`,
        endpoint: `/${product.toLowerCase()}/quotes`, // Assuming an endpoint structure
        method: 'POST',
        auth: 'bearer', // Assuming this endpoint requires auth
        headers: { 'Content-Type': 'application/xml' },
        payload: `file://${path.relative(rootDir, payloadFilePath)}`,
    });

    // Create the corresponding expected output
    generatedExpectedOutputs[testId] = varianceConfig.expected_response.success;

    // 6. Write the final generated files
    fs.writeFileSync(generatedYamlPath, yaml.dump(generatedTestCases));
    fs.writeFileSync(generatedExpectedJsonPath, JSON.stringify(generatedExpectedOutputs, null, 2));

    console.log(Successfully generated ${ combinations.length } test cases!);
    console.log(-> Payloads: ${ generatedPayloadsDir });
    console.log(-> Test YAML: ${ generatedYamlPath });
    console.log(-> Expected JSON: ${ generatedExpectedJsonPath });
}

generateTests().catch(error => {
    console.error("Error during test generation:", error);
    process.exit(1);
});