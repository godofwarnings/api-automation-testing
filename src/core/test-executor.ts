import { test, expect, APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';
import { getAuthHeaders, setGlobalVariable, getGlobalVariable } from '@/helpers/auth-handler'; // Updated auth-handler

interface TestCase {
    test_id: string;
    description: string;
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; // Added PATCH
    headers?: { [key: string]: string };
    payload?: any; // Can be inline string/object, or file path string
    auth: 'none' | 'bearer' | 'cookie'; // Assuming bearer for API key based auth
    chaining?: {
        set_global?: { [key: string]: string }; // Store response values globally
        use_global?: { [key: string]: string }; // Use global values in request (e.g., in endpoint or payload)
    };
    pre_hooks?: string[]; // (Future) Scripts to run before the test
    post_hooks?: string[];// (Future) Scripts to run after the test
}

interface ExpectedOutput {
    status: number;
    body?: {
        should_contain_key?: string; // Simple check for key existence
        [key: string]: any; // For deeper object matching
    };
    headers?: { [key: string]: string | RegExp }; // Allow regex for header values
    // Add more assertion types as needed: regex_match_body, schema_validation, etc.
}

/**
 * Executes API tests based on a YAML definition file and its corresponding expected output file.
 * @param definitionYamlPath - The relative path to the YAML test definition file.
 * @param expectedJsonPath - The relative path to the JSON file with expected outputs.
 */
export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) {
    const definitionFilePath = path.join(process.cwd(), definitionYamlPath);
    const expectedOutputFilePath = path.join(process.cwd(), expectedJsonPath);

    if (!fs.existsSync(definitionFilePath)) {
        console.warn(`Skipping tests: Definition file not found at ${definitionFilePath}`);
        return;
    }
    if (!fs.existsSync(expectedOutputFilePath)) {
        console.warn(`Skipping tests: Expected output file not found at ${expectedOutputFilePath}`);
        return;
    }

    const testCases = yaml.load(fs.readFileSync(definitionFilePath, 'utf8')) as TestCase[];
    const allExpectedOutputs = JSON.parse(fs.readFileSync(expectedOutputFilePath, 'utf8'));

    test.describe(`API Tests for ${path.basename(definitionYamlPath)}`, () => {
        test.describe.configure({ mode: 'parallel' });

        for (const testCase of testCases) {
            test(testCase.description, async ({ request }) => {
                const expected: ExpectedOutput = allExpectedOutputs[testCase.test_id];
                if (!expected) {
                    throw new Error(`No expected output found for test_id: ${testCase.test_id} in ${expectedOutputFilePath}`);
                }

                await allure.id(testCase.test_id);
                await allure.epic(path.dirname(definitionYamlPath).split(path.sep).pop() || 'API Tests'); // e.g., 'bop'
                await allure.feature(path.basename(definitionYamlPath, '.yml')); // e.g., 'createQuote'
                await allure.story(testCase.description);

                await allure.step(`[Setup] Test ID: ${testCase.test_id}`, async () => {
                    allure.parameter('Method', testCase.method);
                    allure.parameter('Endpoint', testCase.endpoint);
                    allure.parameter('Auth Type', testCase.auth);
                });

                // --- Request Preparation ---
                let finalEndpoint = testCase.endpoint;
                let finalPayload = testCase.payload;

                // Apply global variables to endpoint and payload if specified
                if (testCase.chaining?.use_global) {
                    for (const [placeholder, globalVarKey] of Object.entries(testCase.chaining.use_global)) {
                        const value = getGlobalVariable(globalVarKey);
                        if (value === undefined) {
                            console.warn(`Global variable '${globalVarKey}' not found for placeholder '${placeholder}' in test ${testCase.test_id}`);
                            continue;
                        }
                        const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
                        finalEndpoint = finalEndpoint.replace(regex, String(value));
                        // Deep replace in payload (if payload is an object or stringified object)
                        if (typeof finalPayload === 'string') {
                            finalPayload = finalPayload.replace(regex, String(value));
                        } else if (typeof finalPayload === 'object' && finalPayload !== null) {
                            finalPayload = JSON.parse(JSON.stringify(finalPayload).replace(regex, String(value)));
                        }
                    }
                }

                const response = await sendRequest(request, { ...testCase, endpoint: finalEndpoint, payload: finalPayload });

                // --- Assertions ---
                await allure.step(`[Assert] Status Code - Expected: ${expected.status}`, async () => {
                    expect(response.status()).toBe(expected.status);
                });

                const responseBodyText = await response.text(); // Get text once for logging and potential parsing
                let actualBody: any;
                try {
                    actualBody = responseBodyText ? JSON.parse(responseBodyText) : null; // Handle empty body
                } catch (e) {
                    actualBody = responseBodyText; // If not JSON, keep as text for comparison
                }

                if (expected.body) {
                    await allure.step('[Assert] Response Body', async () => {
                        if (expected.body.should_contain_key && actualBody && typeof actualBody === 'object') {
                            expect(actualBody).toHaveProperty(expected.body.should_contain_key);
                        } else if (actualBody !== null) { // Only match if actualBody is not null
                            expect(actualBody).toMatchObject(expected.body);
                        } else if (expected.body !== null) { // Fail if expected body but got null
                            expect(actualBody).toEqual(expected.body); // This will show a clear diff
                        }
                        // For XML or non-JSON text bodies, you'd compare `responseBodyText`
                    });
                }

                if (expected.headers) {
                    await allure.step('[Assert] Response Headers', async () => {
                        for (const [key, value] of Object.entries(expected.headers!)) {
                            const headerValue = response.headers()[key.toLowerCase()];
                            expect(headerValue).toBeDefined();
                            if (value instanceof RegExp) {
                                expect(headerValue).toMatch(value);
                            } else {
                                expect(headerValue).toContain(value); // Use toContain for partial matches if needed
                            }
                        }
                    });
                }

                // --- Post-Request Chaining ---
                if (response.ok() && testCase.chaining?.set_global) {
                    await handleResponseChaining(actualBody, testCase.chaining.set_global);
                }
            });
        }
    });
}

/**
 * A helper function to send an API request based on the test case definition.
 */
async function sendRequest(request: APIRequestContext, testCase: TestCase): Promise<APIResponse> {
    let payloadData: any = testCase.payload;
    const requestHeaders = { ...(testCase.headers || {}) }; // Start with defined headers
    let payloadContentType = requestHeaders['Content-Type'] || requestHeaders['content-type'] || 'application/json';

    if (testCase.auth === 'bearer' || testCase.auth === 'cookie') {
        Object.assign(requestHeaders, getAuthHeaders()); // Add auth headers
    }

    // Check if payload is a file path
    if (typeof testCase.payload === 'string' && testCase.payload.startsWith('file://')) {
        const filePath = path.join(process.cwd(), testCase.payload.replace('file://', ''));
        if (!fs.existsSync(filePath)) {
            throw new Error(`Payload file not found: ${filePath}`);
        }
        payloadData = fs.readFileSync(filePath, 'utf-8');
        // Content-Type might be in headers already, or infer from file extension if needed.
        // For now, we rely on the `Content-Type` header specified in the YAML.
        await allure.attachment('Request Payload (from file)', payloadData, {
            contentType: payloadContentType
        });
    } else if (payloadData && typeof payloadData === 'object') {
        // If payload is an object, assume JSON if Content-Type is not explicitly XML
        if (payloadContentType.toLowerCase().includes('xml')) {
            // Here you might need an XML builder if your object needs to be converted to XML string
            // For now, assuming if it's an object and Content-Type is XML, it's a pre-formatted string.
            // If it's truly an object needing XML serialization, you'd use a library like 'xml-js' or 'js2xmlparser'.
            // For this example, let's assume it's passed as a string if it's XML from an object.
            // payloadData = convertObjectToXml(payloadData); // Placeholder for actual conversion
        } else { // Default to JSON
            payloadData = JSON.stringify(payloadData);
            if (!payloadContentType.toLowerCase().includes('json')) {
                payloadContentType = 'application/json'; // Ensure content type is json
                requestHeaders['Content-Type'] = 'application/json';
            }
        }
        await allure.attachment('Request Payload (inline)', payloadData, { contentType: payloadContentType });
    } else if (typeof payloadData === 'string' && (payloadContentType.toLowerCase().includes('json'))) {
        // If payload is a string and looks like JSON, try to parse it to ensure it's valid for Playwright's `data`
        try {
            payloadData = JSON.parse(payloadData); // Playwright's `data` expects an object for JSON
        } catch (e) {
            // Not a valid JSON string, send as is (Playwright might handle it as form data or text)
        }
        await allure.attachment('Request Payload (inline string)', String(testCase.payload), { contentType: payloadContentType });
    } else if (payloadData) { // For other string payloads (e.g. plain text, form-urlencoded)
        await allure.attachment('Request Payload (inline string)', String(payloadData), { contentType: payloadContentType });
    }


    const options: any = {
        headers: requestHeaders,
        data: payloadData, // Playwright's `data` can be string (for XML, form-data) or object (for JSON)
    };

    if (payloadContentType.toLowerCase().includes('xml') && typeof payloadData === 'string') {
        options.data = payloadData; // Send XML as raw string
    } else if (payloadContentType.toLowerCase().includes('json') && typeof payloadData === 'object') {
        options.data = payloadData; // Send JSON as object
    }
    // Add other content types if needed

    await allure.step(`[Action] Sending ${testCase.method} request to ${testCase.endpoint}`, async () => {
        if (options.data) {
            const dataToLog = (typeof options.data === 'object') ? JSON.stringify(options.data, null, 2) : options.data;
            await allure.attachment('Request Data Sent', dataToLog, { contentType: payloadContentType });
        }
        await allure.attachment('Request Headers Sent', JSON.stringify(options.headers, null, 2), { contentType: 'application/json' });
    });

    const response = await request[testCase.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'](
        testCase.endpoint,
        options
    );

    await allure.step(`[Result] Received response (Status: ${response.status()})`, async () => {
        const bodyText = await response.text();
        let contentType = response.headers()['content-type'] || 'text/plain';
        // Ensure attachment type is one Allure supports, or default to text/plain
        if (contentType.includes('json')) contentType = 'application/json';
        else if (contentType.includes('xml')) contentType = 'application/xml';
        else if (contentType.includes('html')) contentType = 'text/html';
        else contentType = 'text/plain';

        await allure.attachment('Response Body', bodyText, { contentType });
        await allure.attachment('Response Headers', JSON.stringify(response.headers(), null, 2), { contentType: 'application/json' });
    });

    return response;
}

/**
 * Handles post-response actions, like extracting and storing global variables.
 */
async function handleResponseChaining(responseBody: any, setGlobalConfig: { [key: string]: string }) {
    if (!responseBody || typeof responseBody !== 'object') {
        console.warn('[Chaining] Cannot process chaining: Response body is not a parsable object.');
        return;
    }
    await allure.step('[Chaining] Processing response data for global variables', async () => {
        for (const [globalVarKey, sourcePath] of Object.entries(setGlobalConfig)) {
            const value = getValueFromObject(responseBody, sourcePath);
            if (value !== undefined && value !== null) {
                setGlobalVariable(globalVarKey, value);
                await allure.attachment(`${globalVarKey} Captured`, String(value), { contentType: 'text/plain' });
            } else {
                console.warn(`[Chaining] Value for path '${sourcePath}' not found in response for global variable '${globalVarKey}'.`);
            }
        }
    });
}

/**
 * Utility to extract a value from an object using a dot-notation string path.
 * e.g., getValueFromObject({ a: { b: 5 } }, 'a.b') returns 5
 */
function getValueFromObject(obj: any, path: string): any {
    if (typeof path !== 'string') return undefined;
    return path.split('.').reduce((o, key) => (o && typeof o === 'object' && o[key] !== undefined ? o[key] : undefined), obj);
}