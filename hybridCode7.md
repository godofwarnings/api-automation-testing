You are absolutely right. My apologies for over-simplifying and removing the per-product distinction. A generic, one-size-fits-all authentication doesn't reflect the reality of enterprise systems where different products (microservices, applications) often have their own unique authentication schemes.

Let's re-introduce the per-product model, but do it in the clean, object-oriented, and extensible way you've requested.

---

### **The Corrected, Per-Product OO Authentication Plan**

1.  **Auth Base Class:** We will create a `src/functions/base/AuthAction.ts`. This class defines the *interface* and *default behavior* for any authentication action.
2.  **Standard Auth Function:** We will provide a standard, plug-and-play auth function (`standard.auth.bearerTokenLogin`) that uses this base class.
3.  **User Extensibility:** A user can either:
    *   Use our standard function directly.
    *   Write their own function that *extends* our `AuthAction` class to inherit its structure but override specific parts (like how headers are built).
    *   Write a completely custom auth function from scratch.
4.  **Configuration:** The `playwright.config.ts` will go back to having per-product authentication projects and dependencies. The `test-fixtures.ts` will go back to being product-aware.

This approach provides the perfect balance: strong, sensible defaults with clear paths for extension and customization.

---

### **Step 1: Create the `AuthAction` Base Class**

This is the new foundation for all authentication operations.

📁 **`src/functions/base/AuthAction.ts`** (New File)
```typescript
import { APIRequestContext, APIResponse, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { log } from '../../helpers/logger';
import { ConfigurationError } from '../../helpers/errors';

dotenv.config();

// Defines the parameters any authentication function will receive from its param file
export interface AuthParams {
  auth_path: string;
  credential_source: string; // Path to a credential file
}

/**
 * A base class representing a standard authentication action.
 * Users can extend this class to handle different credential types or auth flows.
 */
export class AuthAction {
  protected request: APIRequestContext;
  protected params: AuthParams;
  protected baseUrl: string;

  constructor(request: APIRequestContext, baseUrl: string, params: AuthParams) {
    this.request = request;
    this.baseUrl = baseUrl;
    this.params = params;
  }

  /**
   * Loads credentials and builds the headers for the auth request.
   * Override this method to handle different header requirements (e.g., Basic Auth).
   */
  protected async buildAuthHeaders(): Promise<Record<string, string>> {
    const credsPath = path.join(process.cwd(), this.params.credential_source);
    if (!fs.existsSync(credsPath)) throw new ConfigurationError(`Credential file not found: ${credsPath}`);
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

    const appId = process.env[creds.api.app_id_var];
    const appKey = process.env[creds.api.app_key_var];

    if (!appId || !appKey) throw new ConfigurationError(`Missing app_id or app_key in environment variables.`);
    
    return { 'App_ID': appId, 'App_key': appKey };
  }

  /**
   * Executes the authentication request.
   */
  protected async execute(): Promise<APIResponse> {
    const headers = await this.buildAuthHeaders();
    log.info({ auth_path: this.params.auth_path }, "Sending authentication request.");
    return this.request.post(`${this.baseUrl}${this.params.auth_path}`, { headers });
  }

  /**
   * Extracts the token from the response.
   * Override this method if the token is in a different field (e.g., 'token' instead of 'access_token').
   * @param response The authentication API response.
   */
  protected async extractToken(response: APIResponse): Promise<string> {
    const responseBody = await response.json();
    const token = responseBody.access_token;
    if (!token) throw new Error("Authentication response did not contain an 'access_token' field.");
    return token;
  }

  /**
   * The main run method that orchestrates the authentication flow.
   */
  public async run(): Promise<string> {
    const response = await this.execute();
    test.expect(response, `Authentication failed: ${await response.text()}`).toBeOK();
    const token = await this.extractToken(response);
    log.info("Successfully extracted authentication token.");
    return token;
  }
}
```

### **Step 2: Create the Standard Auth Function**

This is the default function users will call from their YAML. It's a simple wrapper around our new class.

📁 **`src/functions/auth/standard/bearerTokenLogin.ts`** (New File)
```typescript
import { APIRequestContext } from '@playwright/test';
import { AuthAction, AuthParams } from '../../base/AuthAction';

/**
 * This is the standard, plug-and-play function for performing authentication.
 * It uses the inheritable AuthAction class to do the work.
 */
export async function bearerTokenLogin(
  context: { request: APIRequestContext, baseUrl: string }, 
  params: AuthParams
) {
  const authAction = new AuthAction(context.request, context.baseUrl, params);
  const token = await authAction.run();

  // It returns the auth context needed by the orchestrator.
  return {
    bearerToken: token,
  };
}
```

### **Step 3: Update Per-Product Auth Setup (`bop.auth.setup.ts`)**

This setup test now becomes a lean orchestrator for authentication. It loads the config, finds the right function to call, and calls it.

📁 **`tests/products/bop/bop.auth.setup.ts`** (Updated)
```typescript
import { test as setup } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../../../src/helpers/logger';
import { functionRegistry } from '../../../src/helpers/function-registry'; // Import the registry

const productName = 'bop';
export const AUTH_FILE = path.join(__dirname, '..', '..', '..', '.auth', `${productName}.state.json`);

setup(`authenticate ${productName}`, async ({ request }) => {
  log.info(`--- Starting Authentication Test for Product: '${productName}' ---`);
  
  const env = process.env.ENV!;
  const envConfigPath = path.join(__dirname, '..', '..', '..', 'config', 'environments', `${env}.config.json`);
  const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));

  // Assume the auth function is defined in the config
  const productAuthConfig = envConfig.products[productName].auth;
  if (!productAuthConfig) throw new Error(`Auth config for '${productName}' not found in ${env}.config.json`);

  const functionToCall = functionRegistry.get(productAuthConfig.function);
  const authParams = productAuthConfig.parameters;

  const executionContext = { request, baseUrl: envConfig.host };

  // Execute the specified auth function
  const authResult = await functionToCall(executionContext, authParams);
  
  // Save the result (the auth context) to the state file
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(authResult));
  log.info(`Authentication for ${productName.toUpperCase()} successful. State file created.`);
});
```

### **Step 4: Update the Configuration File**

The `sit.config.json` now needs to specify *which* auth function to use.

📁 **`config/environments/sit.config.json`** (Updated)
```json
{
  "environmentName": "SIT",
  "host": "https://api.sit.mycompany.com",
  "products": {
    "bop": {
      "version": "1.2.3",
      "auth": {
        "function": "standard.auth.bearerTokenLogin",
        "parameters": {
          "auth_path": "/v2/authenticate",
          "credential_source": "config/credentials/bop_creds.json"
        }
      }
    }
  }
}
```

### **Summary of Benefits**

*   **Per-Product Auth:** We are back to having authentication projects for each product (`BOP Authentication`, `GL Authentication`), which is correct.
*   **Default Provided:** We ship a `standard.auth.bearerTokenLogin` function that handles a very common authentication pattern.
*   **User Choice & Extensibility:** A user can:
    1.  Point their config to our standard function.
    2.  Create a `MyCustomAuthAction extends AuthAction` class, override a method (like `buildAuthHeaders`), and then create a simple wrapper function for it.
    3.  Write a completely different auth function from scratch if their logic is totally unique.
*   **Clean Architecture:** The `AuthAction` class encapsulates the logic, the `bop.auth.setup.ts` file orchestrates the authentication for a product, and the `playwright.config.ts` handles the dependency. All pieces have a clear, single responsibility.

All other files (`playwright.config.ts`, `test-fixtures.ts`, `flow-orchestrator.ts`) can now revert to the stable, per-product model we had before, as this authentication mechanism plugs into it perfectly.
