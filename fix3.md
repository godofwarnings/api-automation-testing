You are right. My previous solution coupled the header generation too tightly to the global run configuration. Your new proposal is much more flexible and powerful. It gives the user explicit control over the source of their header data on a per-step basis, which is a fantastic idea.

Let's implement this new, more flexible design for `contextual_headers`.

**The New Rule:**
*   A `contextual_header` will get its value from a `sourcePath`.
*   If an optional `path` field is provided alongside `sourcePath`, the framework will load that JSON file first and then use `sourcePath` to find a value within it.
*   The `path` itself can contain placeholders, which will be resolved first.
*   If `path` is *not* provided, `sourcePath` is assumed to be a path to a globally available object, such as `process.env`.

---

### **Step 1: The New YAML Syntax**

Let's define how this will look in the `parameters_file`.

📁 `params/api/some_api_params.json` (New Example)
```json
{
  "endpoint": "/v1/some/endpoint",
  "method": "POST",
  "contextual_headers": [
    {
      "key": "X-API-Version",
      "path": "config/environments/{{env.name}}.config.json",
      "sourcePath": "products.bop.version"
    },
    {
      "key": "X-Partner-ID",
      "path": "config/partners/{{env.partner}}.json",
      "sourcePath": "partnerId"
    },
    {
      "key": "X-Transaction-ID",
      "sourcePath": "$dynamic.uuid"
    },
    {
      "key": "X-Auth-Token",
      "sourcePath": "flow.bearerToken"
    },
    {
      "key": "X-Node-Version",
      "sourcePath": "process.env.npm_config_node_version"
    }
  ],
  "payload": { /* ... */ }
}
```

This is incredibly flexible. A single step can now pull header data from environment-specific files, partner-specific files, the `flowContext`, dynamic generators, and even system environment variables.

---

### **Step 2: The Code Implementation**

The only file that needs to change is the `ApiAction.ts` base class, specifically the `buildHeaders` method. The orchestrator and other helpers remain untouched.

📁 **`src/functions/base/ApiAction.ts`** (Updated `buildHeaders` method)
```typescript
import { APIRequestContext, APIResponse, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
// ... other imports
import { resolvePlaceholdersInString, getValueFromObject, generateDynamicData } from '../../helpers/utils';

// ... ApiActionParams interface will need contextual_headers to be updated
interface ContextualHeader {
  key: string;
  sourcePath: string;
  path?: string; // Optional file path
}
// ...

export class ApiAction {
  // ... (constructor and other properties) ...

  /**
   * Builds the final headers by merging static headers and resolving contextual ones.
   */
  protected async buildHeaders(): Promise<Record<string, string>> {
    const finalHeaders: Record<string, string> = { ...(this.params.headers || {}) };

    if (this.params.contextual_headers) {
      log.debug("Processing contextual headers...");
      
      // We need a context to resolve placeholders in the file path itself
      const pathResolutionContext = { 
        flow: this.masterContext.flow, 
        steps: this.masterContext.steps,
        env: { name: process.env.ENV, partner: process.env.PARTNER },
        process: { env: process.env }
      };

      for (const header of this.params.contextual_headers) {
        let value: any;
        let dataSource: any = pathResolutionContext; // Default data source is the master context

        // --- Step 1: Check if an external file path is provided ---
        if (header.path) {
          // Resolve any placeholders within the file path first
          const resolvedPath = resolvePlaceholdersInString(header.path, pathResolutionContext);
          const absolutePath = path.join(process.cwd(), resolvedPath);

          if (!fs.existsSync(absolutePath)) {
            log.warn(`[Header Gen] File not found at resolved path '${absolutePath}' for header '${header.key}'.`);
            continue; // Skip this header
          }
          // The loaded file becomes the new data source for this header
          dataSource = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
        }

        // --- Step 2: Get the value from the appropriate data source ---
        if (header.sourcePath.startsWith('$dynamic.')) {
          value = generateDynamicData(header.sourcePath);
        } else {
          // Use getValueFromObject on the determined data source (either the file or the context)
          value = getValueFromObject(dataSource, header.sourcePath);
        }

        // --- Step 3: Assign the header value ---
        if (value !== undefined) {
          finalHeaders[header.key] = String(value);
        } else {
          log.warn(`[Header Gen] Could not resolve sourcePath '${header.sourcePath}' for header '${header.key}'. It will be omitted.`);
        }
      }
    }
    return finalHeaders;
  }

  // ... (rest of the ApiAction class) ...
}
```

### **How It Works: The Resolution Logic**

1.  **Iterate:** The `buildHeaders` method loops through each object in the `contextual_headers` array.
2.  **Check for `path`:** For each header, it first checks if a `path` property exists.
3.  **Resolve File Path (if `path` exists):**
    *   It takes the `path` string (e.g., `"config/environments/{{env.name}}.config.json"`).
    *   It uses a temporary context object (`pathResolutionContext`) that contains `flow`, `steps`, and `env` data to resolve any placeholders *within the path string itself*. This turns it into a concrete path like `"config/environments/sit.config.json"`.
    *   It loads this JSON file into a temporary `dataSource` variable.
4.  **Determine Data Source:**
    *   If a file was loaded, `dataSource` is now the content of that file.
    *   If no `path` was provided, `dataSource` remains the default `pathResolutionContext`, which includes access to `flow`, `steps`, `env`, and `process.env`.
5.  **Get the Value:** It then takes the `sourcePath` (e.g., `"products.bop.version"` or `"process.env.PARTNER"`) and uses `getValueFromObject` to find the value *within the determined `dataSource`*.
6.  **Assign Header:** The final value is assigned to the header key.

### **Summary of Benefits**

*   **Ultimate Flexibility:** This design is incredibly flexible. A single step can pull header data from multiple different files, from the flow's state, and from environment variables simultaneously.
*   **Explicit over Implicit:** The source of the data is now explicitly declared in the YAML. There's no "magic" context. The user knows exactly where the `sourcePath` is being resolved from based on whether a `path` is provided.
*   **Generic:** The solution does not care about "partners" or any other specific concept. It simply resolves paths in files or in the provided context, making it universally applicable.

This implementation directly addresses your request, providing a powerful and generic mechanism for dynamic header generation.