You have pointed out a critical piece of housekeeping that is essential for a strongly-typed and maintainable framework. You are absolutely right. As we've moved properties around into different files, the `ApiActionParams` interface has become outdated and needs to be updated to reflect the new, merged parameter structure.

Let's redefine the interfaces to accurately represent the data structure that the `ApiAction` class will now receive after the `composeStepParameters` function has merged everything.

---

### **The Corrected Interfaces and Data Flow**

The orchestrator composes the `params` object by merging `headers`, `payload`, and `test_data` files. This means the final `params` object passed to the `ApiAction` class has a specific, predictable structure. Our TypeScript interfaces must match this structure.

Here are the updated interfaces and the corresponding changes to the `ApiAction` class.

#### **Step 1: Update the Type Definitions**

We will define a new top-level interface for the fully composed parameters and update `ApiActionParams` to reflect this.

📁 **`src/functions/base/ApiAction.ts`** (Updated Interfaces)
```typescript
import { APIRequestContext, APIResponse, test } from '@playwright/test';
// ... other imports

// --- NEW: Define the shape of the composable parts ---

interface HeadersPart {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  contextual_headers?: { key: string; sourcePath: string; path?: string; }[];
  auth?: 'none' | 'bearer'; // The auth flag belongs with the request details
}

interface PayloadPart {
  // The payload can be any valid JSON structure or a file pointer
  [key: string]: any;
  file?: string;
}

interface TestDataPart {
  // Contains any data needed to populate placeholders
  [key: string]: any;
  // The expected block now lives inside the test_data part
  expected?: {
    status: number;
    body?: any;
    headers?: any;
  };
}

// --- THIS IS THE NEW TOP-LEVEL INTERFACE ---
// It represents the final, merged object that the ApiAction class receives.
export interface ComposedStepParams {
  headers: HeadersPart;
  payload?: PayloadPart;
  test_data?: TestDataPart;
}


/**
 * The ApiAction base class. It now expects the ComposedStepParams type.
 */
export class ApiAction {
  protected apiRequest: APIRequestContext;
  protected params: ComposedStepParams; // <-- Use the new interface
  protected masterContext: any;
  // ... other properties

  // The constructor signature is updated
  constructor(apiRequest: APIRequestContext, params: ComposedStepParams, masterContext: any) {
    this.apiRequest = apiRequest;
    this.params = params;
    this.masterContext = masterContext;
    // ...
  }
  
  // --- All other methods must now access properties via the new structure ---

  protected async buildHeaders(): Promise<Record<string, string>> {
    const finalHeaders: Record<string, string> = { ...(this.params.headers.headers || {}) };
    
    // Access contextual_headers via the nested 'headers' part
    if (this.params.headers.contextual_headers) {
      // ... logic to resolve contextual headers
    }
    return finalHeaders;
  }

  async execute(): Promise<APIResponse> {
    // Access endpoint and method via the nested 'headers' part
    const { method, endpoint } = this.params.headers;
    const finalHeaders = await this.buildHeaders();
    const options: { headers: any; data?: any; jsonData?: any; } = { headers: finalHeaders };
    
    // Access payload via the nested 'payload' part
    if (method !== 'GET' && method !== 'DELETE' && this.params.payload) {
        // ... logic to set options.data or options.jsonData from this.params.payload
    }

    return this.apiRequest[method.toLowerCase() as 'post'](endpoint, options);
  }

  async assert(response: APIResponse) {
    // Access the expected block via the nested 'test_data' part
    const expected = this.params.test_data?.expected || { status: 200 };
    
    log.info(`Asserting response status. Expected: ${expected.status}, Got: ${response.status()}`);
    
    // ... rest of the assertion logic uses the 'expected' object
  }

  // ... rest of the class
}
```

#### **Step 2: Update the Standard `sendRequest` Function**

This function's signature needs to be updated to use the new `ComposedStepParams` type for clarity, but its logic doesn't change.

📁 **`src/functions/api/standard/sendRequest.ts`** (Updated)
```typescript
import { ApiAction, ComposedStepParams } from '../../base/ApiAction';

export async function sendRequest(
  context: any,
  params: ComposedStepParams, // <-- Use the new, correct type
  masterContext: any
) {
  const apiAction = new ApiAction(context.api, params, masterContext);
  return apiAction.run();
}
```

#### **Step 3: Update `composeStepParameters` to be Type-Safe**

Finally, let's ensure the function in the orchestrator that builds this object returns the correct type.

📁 **`src/core/flow-orchestrator.ts`** (Updated `composeStepParameters` function)
```typescript
import { ComposedStepParams } from '../functions/base/ApiAction'; // <-- Import the new type

// ... other imports

async function composeStepParameters(parts: StepPartFiles, dataPath: string): Promise<ComposedStepParams> {
  let finalParams = {};

  // ... (the existing logic to load and merge files)

  // Cast the final merged object to our new type before returning
  return finalParams as ComposedStepParams;
}
```

### **Summary of the Solution**

1.  **Clear Data Contracts:** We have created specific interfaces (`HeadersPart`, `PayloadPart`, `TestDataPart`) that precisely define the contents of each composable file.
2.  **`ComposedStepParams`:** We created a single, top-level interface that represents the final, merged object. This is the "contract" that the orchestrator provides and the `ApiAction` class expects.
3.  **Type Safety:** By using these interfaces, we make our code strongly typed. If a developer tries to access `params.expected` directly, TypeScript will now correctly show an error and guide them to use the correct path: `params.test_data.expected`.
4.  **How `expected` is Handled:** You were right to ask about this. The `expected` block is now correctly defined as an optional property *inside* the `TestDataPart` interface. The `ApiAction`'s `assert` method now correctly accesses it via `this.params.test_data.expected`, which accurately reflects our new file structure.

This change brings our code's type definitions in sync with our architectural design, making the framework more robust, easier to understand, and less prone to errors.