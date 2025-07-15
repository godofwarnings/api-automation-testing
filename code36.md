Excellent. This is a significant and powerful feature, so we will implement it carefully, step by step.

The core of this change will be a major upgrade to our **`placeholder-resolver.ts`**. It will transform from a simple resolver into a true data generation engine.

---

### **Step 1: Install a Safe Evaluation Library**

We must **never** use `eval()`. It's a major security risk. We will use a library designed for safely evaluating expressions in a sandboxed environment. `safe-eval` is a good choice for this.

In your terminal, run:
```bash
npm install safe-eval
```

---

### **Step 2: The New, Powerful `placeholder-resolver.ts`**

This file will contain all the new logic. It becomes the heart of our data generation.

📁 **`src/helpers/placeholder-resolver.ts`** (Complete Rewrite/Major Update)
```typescript
import { faker } from '@faker-js/faker';
import { v4 as uuidv4 } from 'uuid';
import safeEval from 'safe-eval';
import { getValueFromObject } from './utils';
import { log } from './logger';

// --- Individual Generator Implementations ---

/**
 * Generates an array of objects by repeating a template.
 */
function generateRepeat(config: any, context: any): any[] {
  const results = [];
  let count = config.count || 0;
  const sourceArray = config.count_from ? getValueFromObject(context, config.count_from.replace(/\{\{|\}\}/g, '')) : null;

  if (sourceArray && Array.isArray(sourceArray)) {
    count = sourceArray.length;
  }
  
  if (count === 0) {
    log.warn({ config }, "Repeat generator has a count of 0. Returning empty array.");
    return [];
  }

  for (let i = 0; i < count; i++) {
    // Create a new, enriched context for this iteration
    const iterationContext = {
      ...context,
      $index: i,
      $index_1: i + 1, // 1-based index
      // If we are iterating from a source array, make the item and parent context available
      $parent: {
        ...(context.$parent || {}),
        item: sourceArray ? sourceArray[i] : null,
        $index: context.$index,
        $index_1: context.$index_1
      }
    };
    // Recursively call the main resolver on the template for this iteration
    results.push(resolvePlaceholdersIn(config.template, iterationContext));
  }

  return results;
}

/**
 * Returns a value based on a condition.
 */
function generateConditional(config: any, context: any): any {
  // First, resolve any placeholders within the 'if' condition string itself
  const conditionString = resolvePlaceholdersIn(config.if, context);
  
  let result = false;
  try {
    // Safely evaluate the resolved condition string.
    // The context passed to safeEval contains variables the condition can use.
    result = safeEval(conditionString, context);
  } catch (error: any) {
    log.error({ condition: conditionString, error: error.message }, "Error evaluating conditional generator 'if' statement.");
    return config.else; // Default to 'else' on error
  }

  if (result) {
    // Recursively resolve placeholders in the 'then' block
    return resolvePlaceholdersIn(config.then, context);
  } else {
    // Recursively resolve placeholders in the 'else' block
    return resolvePlaceholdersIn(config.else, context);
  }
}

/**
 * The master generator function that delegates to the correct generator type.
 */
function executeGenerator(config: any, context: any): any {
  log.debug({ type: config.type }, "Executing data generator directive.");
  switch (config.type) {
    case 'repeat':
      return generateRepeat(config, context);
    case 'conditional':
      return generateConditional(config, context);
    // Add other generator types here in the future
    default:
      log.warn(`Unknown generator type: '${config.type}'.`);
      return null;
  }
}

// --- Dynamic Data Generators (Unchanged) ---
export function generateFakerData(path: string): any { /* ... */ }
export function generateDynamicData(command: string): string | number { /* ... */ }

// --- THE MASTER RESOLVER FUNCTION (REWRITTEN) ---

/**
 * Recursively traverses any data structure and resolves all types of placeholders
 * and data generation directives.
 * @param data The object, array, or string to resolve placeholders in.
 * @param context The context object containing { flow, steps, testData, $index, $parent }
 */
export function resolvePlaceholdersIn(data: any, context: any = {}): any {
  if (Array.isArray(data)) {
    return data.map(item => resolvePlaceholdersIn(item, context));
  }

  if (typeof data === 'object' && data !== null) {
    // --- Primary Change: Check for a $generate directive first ---
    if (data.$generate) {
      // If found, hand off to the generator engine and return the result.
      return executeGenerator(data.$generate, context);
    }

    // If no directive, traverse the object as before.
    const newObj: { [key: string]: any } = {};
    for (const key in data) {
      newObj[key] = resolvePlaceholdersIn(data[key], context);
    }
    return newObj;
  }

  if (typeof data === 'string') {
    // Standard string replacement logic (using the robust regex)
    const placeholderRegex = /\{\{([^}]+?)\}\}/g;
    return data.replace(placeholderRegex, (match, placeholderPath) => {
      const cleanPath = placeholderPath.trim();
      if (cleanPath.startsWith('faker.')) return generateFakerData(cleanPath.substring(6));
      if (cleanPath.startsWith('$dynamic.')) return generateDynamicData(cleanPath);
      
      const value = getValueFromObject(context, cleanPath);
      return value !== undefined ? String(value) : match;
    });
  }

  return data;
}
```

---

### **Step 3: How to Use It (The Showcase)**

Let's write the templates and test data for the complex multi-location, multi-building scenario you described.

#### **A. The Test Data File**

This file now just needs to provide the array that drives the generation.

📁 `data/BOP_MULTI_LOCATION_TEST/test_data/main_data.json`
```json
{
  "locationBuildingCounts": [3, 2, 5]
}
```
This means we want to generate 3 locations total: the first with 3 buildings, the second with 2, and the third with 5.

#### **B. The Payload Template File**

This file now contains our new `$generate` directives.

📁 `data/BOP_MULTI_LOCATION_TEST/payloads/multi_location_payload.json`
```json
{
  "customerName": "{{faker.company.name}}",
  "policyId": "{{$dynamic.uuid}}",
  "locations": {
    "$generate": {
      "type": "repeat",
      "count_from": "{{testData.locationBuildingCounts}}",
      "template": {
        "locationId": "L-{{$index_1}}",
        "locationType": {
          "$generate": {
            "type": "conditional",
            "if": "{{$index === 0}}",
            "then": "Primary",
            "else": "Secondary"
          }
        },
        "address": "{{faker.location.streetAddress}}",
        "buildings": {
          "$generate": {
            "type": "repeat",
            "count": "{{$parent.item}}",
            "template": {
              "buildingId": "L{{$parent.$index_1}}-B{{$index_1}}",
              "constructionYear": {
                "$faker": "number.int",
                "args": { "min": 1990, "max": 2023 }
              }
            }
          }
        }
      }
    }
  }
}
```

### **Summary of the Implementation**

1.  **Engine Entry Point:** The `resolvePlaceholdersIn` function is now the main engine. Its first job is to check for the `$generate` key.
2.  **Delegation:** If `$generate` is found, it delegates the work to `executeGenerator`, which acts as a router.
3.  **Specialized Generators:** `generateRepeat` and `generateConditional` contain the specific logic for their tasks.
4.  **Context Passing:** The `generateRepeat` function is careful to create an *enriched* context for each iteration, adding the special `$index` and `$parent` variables so nested templates can access them.
5.  **Recursion:** The generators recursively call the main `resolvePlaceholdersIn` function on their templates. This is what allows you to nest generators and use Faker or other placeholders inside a generated template.

This new system is incredibly powerful and scalable. You can now define new generator types (e.g., `type: "randomChoice"`) by simply adding a new function and a `case` to the `executeGenerator` switch statement, without touching the core resolver logic.