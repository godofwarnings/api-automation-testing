That is a fantastic and very advanced use case. You are asking for the ability to **query an array to find a specific object based on a condition**, and then access a property from that found object.

Standard dot notation (`a.b.c`) cannot do this. We need to invent a more powerful placeholder syntax. This is a common challenge in data-driven automation, and solving it will make the framework significantly more capable.

### The Solution: A New "Query" Syntax in Placeholders

We will introduce a new, special syntax inside our `{{...}}` placeholders specifically for querying arrays. The syntax will look like a SQL `WHERE` clause:

`{{...array_path[field_to_check=value_to_match].property_to_get}}`

**Example:**

Let's say a previous step (`create_insurers_step`) returned this response, which was saved to the `stepHistory`:

```json
// The response body from 'create_insurers_step'
{
  "quoteId": "q-123",
  "insurers": [
    {
      "id": "ins-abc",
      "name": "Global Insurance Co",
      "type": "secondary"
    },
    {
      "id": "ins-xyz",
      "name": "Primary National",
      "type": "primary" // <-- We want to find this object
    }
  ]
}
```

To get the `id` (`ins-xyz`) of the object where `type` is `primary`, your new placeholder in a later step would be:

```yaml
payload:
  primaryInsurerId: "{{steps.create_insurers_step.response.insurers[type=primary].id}}"
```

**Breaking down the new syntax:**

*   **`steps.create_insurers_step.response.insurers`**: The standard path to get to the array.
*   **`[type=primary]`**: The new query syntax. It means "find the object in this array where the `type` property has a value of `primary`".
*   **`.id`**: After finding the correct object, get its `id` property.

---

### The Code: Updating `getValueFromObject`

This is the only function we need to change. We will make it "smarter" so it can detect and parse this new query syntax.

📁 **`src/core/test-executor.ts`** (Updated `getValueFromObject` function)
```typescript
// ... (All other code in the file remains the same) ...
// ... (imports, interfaces, executeApiFlows, resolveStepPlaceholders, etc.) ...

/**
 * Utility to extract a value from an object using a dot-notation string path,
 * now with support for querying arrays.
 * e.g., 'insurers[type=primary].id'
 * @param obj The object to search within.
 * @param path The dot-notation path, with optional array query syntax.
 */
function getValueFromObject(obj: any, path: string): any {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }

  // Regex to detect and capture array query syntax
  // Captures: 1=path before query, 2=field to check, 3=value to match, 4=path after query
  const arrayQueryRegex = /(.+?)\[(\w+)=([\w\d_-]+)\]\.?(.*)/;

  return path.split('.').reduce((currentObject, key) => {
    if (currentObject === undefined) {
      return undefined;
    }

    const match = key.match(arrayQueryRegex);

    if (match) {
      // --- Array Query Logic ---
      const [, arrayKey, queryField, queryValue, remainingPath] = match;
      
      // Get the array itself first (the part before the bracket)
      const targetArray = currentObject[arrayKey];
      if (!Array.isArray(targetArray)) {
        console.warn(`[Chaining] Path '${arrayKey}' did not resolve to an array for query '[${queryField}=${queryValue}]'.`);
        return undefined;
      }
      
      // Find the specific object within the array
      const foundObject = targetArray.find(item => 
        item && typeof item === 'object' && String(item[queryField]) === queryValue
      );
      
      if (!foundObject) {
        console.warn(`[Chaining] No object found in array '${arrayKey}' where '${queryField}' equals '${queryValue}'.`);
        return undefined;
      }
      
      // If there's more path to resolve after the query (e.g., '.id'), start from the found object
      if (remainingPath) {
        return getValueFromObject(foundObject, remainingPath);
      }
      
      // Otherwise, return the entire found object
      return foundObject;

    } else {
      // --- Standard Key Logic ---
      return currentObject[key];
    }
  }, obj);
}

// Ensure the rest of the test-executor.ts file is present.
// This is the only function that needs to be replaced with this new, more powerful version.
```

### **How the New `getValueFromObject` Works**

1.  **Standard Traversal:** It still uses `reduce()` to walk down the object path key by key.
2.  **Regex Check:** On *each key*, it uses a regular expression (`arrayQueryRegex`) to check if the key contains the `[...=...]` query syntax.
3.  **If a Query is Found:**
    *   It breaks the key apart into the array name (`insurers`), the field to check (`type`), the value to match (`primary`), and any path that comes *after* it (`id`).
    *   It gets the array from the current object.
    *   It uses `Array.prototype.find()` to search for the first object in the array that matches the condition.
    *   If an object is found:
        *   If there's a `remainingPath` (like `.id`), it calls *itself* recursively to continue resolving the path starting from the found object.
        *   If there's no remaining path, it returns the entire found object.
    *   If no object is found, it returns `undefined`, and the chain stops.
4.  **If No Query is Found:** It behaves exactly as before, simply accessing the property using `currentObject[key]`.

### **Summary of Benefits**

*   **Declarative and Readable:** The new syntax is self-documenting in your YAML files. It's clear what the intent is.
*   **Powerful:** This unlocks the ability to handle complex API responses where you need to find specific items in a collection based on their properties.
*   **Isolated Change:** The complexity is contained entirely within the `getValueFromObject` function. No other part of the framework needs to be aware of this new syntax.
*   **Handles Chaining:** Because it can continue resolving a path *after* the query, you can do things like `...insurers[type=primary].contact.email`.

This enhancement makes your framework's chaining capabilities truly advanced and suitable for complex, real-world API testing scenarios.