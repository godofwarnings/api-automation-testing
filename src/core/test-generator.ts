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
    endpoint_template?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    expected_response: {
        success: {
            status: number;
            body?: any;
        };
    };
}

/**
 * Recursively traverses a JSON object or array to find and replace placeholders.
 * @param obj The object or array to traverse.
 * @param combinationData The key-value pairs for replacement.
 */
function replacePlaceholdersInJson(obj: any, combinationData: Record<string, any>): any {
    if (Array.isArray(obj)) {
        return obj.map(item => replacePlaceholdersInJson(item, combinationData));
    }
    if (typeof obj === 'object' && obj !== null) {
        const newObj: { [key: string]: any } = {};
        for (const key in obj) {
            newObj[key] = replacePlaceholdersInJson(obj[key], combinationData);
        }
        return newObj;
    }
    if (typeof obj === 'string') {
        let value = obj;
        for (const fieldName in combinationData) {
            const placeholder = `{{${fieldName}}}`;
            if (value.includes(placeholder)) {
                // If the string IS the placeholder, replace it with the actual type (boolean, number)
                if (value === placeholder) {
                    return combinationData[fieldName];
                }
                // Otherwise, replace as a substring
                value = value.replace(new RegExp(placeholder, 'g'), String(combinationData[fieldName]));
            }
        }
        return value;
    }
    return obj; // Return numbers, booleans, null as-is
}


// Helper function to generate all combinations of parameters
function generateCombinations(parameters: ParameterConfig[]): Record<string, any>[] {
    if (!parameters || parameters.length === 0) {
        return [{}];
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

// Main generator logic
async function generateTests() {
    console.log("Parsing arguments for test generation...");

    // 1. Parse CLI arguments
    const argv = await yargs(hideBin(process.argv))
        .option('product', {
            alias: 'p',
            describe: 'Product code (e.g., bop)',
            type: 'string',
            demandOption: true,
        })
        .option('api', {
            alias: 'a',
            describe: 'API name (e.g., createQuote)',
            type: 'string',
            demandOption: true,
        })
        .help()
        .alias('help', 'h')
        .strict()
        .parseAsync();



    const { product, api } = argv;
    console.log(`Generating tests for Product: ${product}, API: ${api}`);

    // 2. Define file paths
    const rootDir = process.cwd();
    // --- DETECT TEMPLATE TYPE ---
    const jsonTemplatePath = path.join(rootDir, 'templates', product, `${api}_base.json`);
    const xmlTemplatePath = path.join(rootDir, 'templates', product, `${api}_base.xml`);

    let baseTemplatePath: string;
    let templateType: 'json' | 'xml';
    let contentType: string;

    if (fs.existsSync(jsonTemplatePath)) {
        baseTemplatePath = jsonTemplatePath;
        templateType = 'json';
        contentType = 'application/json';
    } else if (fs.existsSync(xmlTemplatePath)) {
        baseTemplatePath = xmlTemplatePath;
        templateType = 'xml';
        contentType = 'application/xml';
    } else {
        throw new Error(`No base template found for ${product}/${api}. Looked for _base.json and _base.xml.`);
    }
    console.log(`Using ${templateType.toUpperCase()} template: ${baseTemplatePath}`);



    const varianceConfigPath = path.join(rootDir, 'config', 'data-variance', product, `${api}.yml`);
    const baseTemplateContent = fs.readFileSync(baseTemplatePath, 'utf8');

    const generatedPayloadsDir = path.join(rootDir, 'payloads', '_generated_', product, api);
    const generatedTestsDir = path.join(rootDir, 'tests', 'products', product, '_generated_');
    const generatedYamlPath = path.join(generatedTestsDir, `${api}.yml`);
    const generatedExpectedJsonPath = path.join(generatedTestsDir, `${api}.json`);

    fs.mkdirSync(generatedPayloadsDir, { recursive: true });
    fs.mkdirSync(generatedTestsDir, { recursive: true });

    // 3. Load input files
    if (!fs.existsSync(varianceConfigPath)) {
        throw new Error(`Variance config file not found: ${varianceConfigPath}`);
    }
    const varianceConfig = yaml.load(fs.readFileSync(varianceConfigPath, 'utf8')) as VarianceConfig;

    if (!fs.existsSync(baseTemplatePath)) {
        throw new Error(`Base template file not found: ${baseTemplatePath}`);
    }
    const baseTemplate = fs.readFileSync(baseTemplatePath, 'utf8');

    // 4. Generate data combinations
    const combinations = generateCombinations(varianceConfig.parameters);

    const generatedTestCases = [];
    const generatedExpectedOutputs: { [key: string]: any } = {};

    // 5. Create payloads and test definitions for each combination
    for (let i = 0; i < combinations.length; i++) {
        const combinationData = combinations[i];
        const testId = `TC_${product.toUpperCase()}_${api.replace(/([A-Z])/g, '_$1').toUpperCase()}_${String(i + 1).padStart(3, '0')}`;

        let payloadData: any;
        let relativePayloadPath: string;

        if (templateType === 'json') {
            const baseJson = JSON.parse(baseTemplateContent);
            payloadData = replacePlaceholdersInJson(baseJson, combinationData);
            relativePayloadPath = path.join('payloads', '_generated_', product, api, `payload_${testId}.json`);
            fs.writeFileSync(path.join(rootDir, relativePayloadPath), JSON.stringify(payloadData, null, 2));
        } else { // XML
            payloadData = baseTemplateContent;
            for (const fieldName in combinationData) {
                const value = combinationData[fieldName];
                const placeholder = new RegExp(`\\{\\{${fieldName}\\}\\}`, 'g');
                payloadData = payloadData.replace(placeholder, String(value));
            }
            relativePayloadPath = path.join('payloads', '_generated_', product, api, `payload_${testId}.xml`);
            fs.writeFileSync(path.join(rootDir, relativePayloadPath), payloadData);
        }

        let currentPayload = baseTemplate;

        const combinationDetails: string[] = [];
        for (const fieldName in combinationData) {
            const value = combinationData[fieldName];
            const placeholder = new RegExp(`\\{\\{${fieldName}\\}\\}`, 'g');
            currentPayload = currentPayload.replace(placeholder, String(value));
            combinationDetails.push(`${fieldName}: ${value}`);
        }

        const payloadFilePath = path.join(rootDir, relativePayloadPath);
        fs.writeFileSync(payloadFilePath, currentPayload);

        const endpoint = varianceConfig.endpoint_template || `/${product.toLowerCase()}/quotes`;
        const method = varianceConfig.method || 'POST';

        generatedTestCases.push({
            test_id: testId,
            description: `Verify ${api} for ${product} with: ${combinationDetails.join('; ')}`,
            endpoint: endpoint,
            method: method,
            auth: 'bearer',
            headers: { 'Content-Type': contentType },
            payload: `file://${relativePayloadPath.replace(/\\/g, '/')}`,
        });

        generatedExpectedOutputs[testId] = varianceConfig.expected_response.success;
    }

    // 6. Write the generated files
    fs.writeFileSync(generatedYamlPath, yaml.dump(generatedTestCases));
    fs.writeFileSync(generatedExpectedJsonPath, JSON.stringify(generatedExpectedOutputs, null, 2));

    console.log(`[SUCCESS] Successfully generated ${combinations.length} test cases!`);
    console.log(`   -> Payloads: ${generatedPayloadsDir}`);
    console.log(`   -> YAML Definition: ${generatedYamlPath}`);
    console.log(`   -> Expected Outputs: ${generatedExpectedJsonPath}`);
}

generateTests().catch(error => {
    console.error("[ERROR] Error during test generation:", error);
    process.exit(1);
});