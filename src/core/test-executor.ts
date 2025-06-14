// Use our custom test fixture that provides an authenticated context
import { test, expect } from '@/helpers/test-fixtures';
import { APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { allure } from 'allure-playwright';

// --- Type Definitions ---

interface TestCase {
    test_id: string;
    description: string;
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: { [key: string]: string };
    payload?: any;
    auth: 'none' | 'bearer'; // 'bearer' will use the authenticated fixture
}

interface ExpectedOutput {
    status: number;
    body?: null | { should_contain_key?: string;[key: string]: any } | string;
    headers?: { [key: string]: string | RegExp };
}

// --- Main Executor Function ---

export function executeApiTests(definitionYamlPath: string, expectedJsonPath: string) {
    // 1. Prerequisite Checks (run before any tests are defined)
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

    // 2. Define the Test Suite
    test.describe(`API Tests for ${path.basename(definitionYamlPath)}`, () => {
        test.describe.configure({ mode: 'parallel' });

        for (const testCase of testCases) {
            if (!testCase || !testCase.test_id) {
                // Handle malformed entries gracefully by creating a failing test
                test(`Malformed Test Case in ${path.basename(definitionYamlPath)}`, () => {
                    throw new Error(`Malformed test case entry found (missing test_id): ${JSON.stringify(testCase)}`);
                });
                continue;
            }

            // 3. Define a Test for Each Case
            test(testCase.description || `Test ID: ${testCase.test_id}`, async ({ request, authedRequest }) => {
                const expected = allExpectedOutputs[testCase.test_id];
                if (!expected) {
                    throw new Error(`No expected output found for test_id: ${testCase.test_id}`);
                }

                // --- Allure Metadata ---
                await allure.id(testCase.test_id);
                await allure.epic(path.dirname(definitionYamlPath).split(path.sep).pop() || 'API Tests');
                await allure.feature(path.basename(definitionYamlPath, '.yml'));
                await allure.story(testCase.description);

                // --- Request Execution ---
                const apiRequest = testCase.auth === 'bearer' ? authedRequest : request;
                const response = await sendRequest(apiRequest, testCase);

                // --- Assertions ---
                await allure.step(`[Assert] Status Code - Expected: ${expected.status}`, async () => {
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

// --- Helper Functions ---

/**
 * Prepares and sends the API request based on the test case definition.
 */
async function sendRequest(request: APIRequestContext, testCase: TestCase): Promise<APIResponse> {
    const requestHeaders = { ...(testCase.headers || {}) };
    let payloadData: any = testCase.payload;

    if (typeof payloadData === 'string' && payloadData.startsWith('file://')) {
        const filePath = path.join(process.cwd(), payloadData.replace('file://', ''));
        if (!fs.existsSync(filePath)) throw new Error(`Payload file not found: ${filePath}`);
        payloadData = fs.readFileSync(filePath, 'utf-8');
    }

    const contentType = requestHeaders['Content-Type'] || requestHeaders['content-type'];
    const options: { headers: any; jsonData?: any; data?: any } = { headers: requestHeaders };

    if (payloadData !== undefined && payloadData !== null) {
        await allure.step(`[Prepare] Processing Payload`, async () => {
            if (contentType && contentType.toLowerCase().includes('json')) {
                options.jsonData = (typeof payloadData === 'string') ? JSON.parse(payloadData) : payloadData;
                await allure.attachment('Request Payload (JSON)', JSON.stringify(options.jsonData, null, 2), { contentType: 'application/json' });
            } else {
                options.data = String(payloadData);
                await allure.attachment('Request Payload (Text/XML)', options.data, { contentType: contentType || 'text/plain' });
            }
        });
    }

    await allure.step(`[Action] Sending ${testCase.method} request to ${testCase.endpoint}`, async () => {
        await allure.attachment('Request Headers', JSON.stringify(options.headers, null, 2), { contentType: 'application/json' });
    });

    const response = await request[testCase.method.toLowerCase() as 'post'](testCase.endpoint, options);

    await allure.step(`[Result] Received Response (Status: ${response.status()})`, async () => {
        const contentType = response.headers()['content-type'] || 'text/plain';
        await allure.attachment('Response Body', await response.text(), { contentType });
        await allure.attachment('Response Headers', JSON.stringify(response.headers(), null, 2), { contentType: 'application/json' });
    });

    return response;
}

/**
 * Tries to parse a string as JSON, returning the raw string if it fails.
 */
function tryParseJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * Contains the logic for asserting the response body.
 */
async function assertBody(actualBody: any, expectedBody: ExpectedOutput['body']) {
    if (expectedBody === undefined) return; // No body assertions needed

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
            // Fail if we expected an object but didn't get a parsable object
            throw new Error(`Type mismatch: Expected body to be an object, but received type '${typeof actualBody}'. Actual Body: ${actualBody}`);
        }
    });
}

/**
 * Contains the logic for asserting response headers.
 */
async function assertHeaders(actualHeaders: Record<string, string>, expectedHeaders?: ExpectedOutput['headers']) {
    if (!expectedHeaders) return; // No header assertions needed

    await allure.step('[Assert] Response Headers', async () => {
        for (const [key, expectedValue] of Object.entries(expectedHeaders)) {
            const actualValue = actualHeaders[key.toLowerCase()];
            expect(actualValue, `Header '${key}' not found.`).toBeDefined();
            if (typeof expectedValue === 'string') {
                expect(actualValue, `Header '${key}' did not match.`).toContain(expectedValue);
            } else { // It's a RegExp
                expect(actualValue, `Header '${key}' did not match regex.`).toMatch(expectedValue);
            }
        }
    });
}