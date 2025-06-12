// Parses YAML, runs tests, and performs assertions
import { test, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';

// Type definition for a single test case in YAML
interface TestCase {
    test_id: string;
    description: string;
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: { [key: string]: string };
    payload?: any;
}

/**
 * Executes API tests based on a YAML definition file.
 * @param yamlPath - The relative path to the YAML test definition file.
 */
export function executeApiTests(yamlPath: string) {
    // Construct full paths to definition and expected output files
    const definitionFilePath = path.join(process.cwd(), yamlPath);
    const expectedFilePath = definitionFilePath.replace('definitions', 'expected').replace('.yml', '.json');

    // Load and parse the YAML and JSON files
    const testCases = yaml.load(fs.readFileSync(definitionFilePath, 'utf8')) as TestCase[];
    const expectedOutputs = JSON.parse(fs.readFileSync(expectedFilePath, 'utf8'));

    // Group tests by the YAML file name
    test.describe(`API Tests for ${path.basename(yamlPath)}`, () => {
        // Run tests in parallel
        test.describe.configure({ mode: 'parallel' });

        // Iterate over each test case defined in the YAML file
        for (const testCase of testCases) {
            test(testCase.description, async ({ request }) => {
                const expected = expectedOutputs[testCase.test_id];
                if (!expected) {
                    throw new Error(`No expected output found for test_id: ${testCase.test_id}`);
                }

                await allure.step(`[Setup] Test ID: ${testCase.test_id}`, async () => {
                    allure.parameter('Endpoint', `${testCase.method} ${testCase.endpoint}`);
                });

                // Send the API request using Playwright
                const response = await sendRequest(request, testCase);

                // Perform Assertions
                await allure.step('Assert Status Code', async () => {
                    expect(response.status()).toBe(expected.status);
                });

                if (expected.body) {
                    await allure.step('Assert Response Body', async () => {
                        const actualBody = await response.json();
                        if (expected.body.should_contain_key) {
                            expect(actualBody).toHaveProperty(expected.body.should_contain_key);
                        } else {
                            expect(actualBody).toMatchObject(expected.body);
                        }
                    });
                }
            });
        }
    });
}

/**
 * A helper function to send an API request based on the test case definition.
 */
async function sendRequest(request: APIRequestContext, testCase: TestCase) {
    const options: any = {
        headers: testCase.headers,
        data: typeof testCase.payload === 'string' ? JSON.parse(testCase.payload) : testCase.payload,
    };

    await allure.step(`[Action] Sending ${testCase.method} request`, async () => {
        await allure.attachment('Request Payload', JSON.stringify(options.data, null, 2), { contentType: 'application/json' });
    });

    const response = await request[testCase.method.toLowerCase() as 'get' | 'post'](testCase.endpoint, options);

    await allure.step(`[Result] Received response`, async () => {
        const body = await response.text();
        await allure.attachment('Response Body', body, { contentType: 'application/json' });
    });

    return response;
}