This is a fantastic and very advanced requirement. You are asking for a **Data Generation Directive** system within your payloads. This moves beyond simple placeholder replacement (`{{...}}`) and into dynamic, rule-based test data construction.

This is a powerful feature for handling complex, variable list/array scenarios. Let's brainstorm the most effective and scalable way to design this.

---

### **The Brainstorming: A "Data Generation" Directive (`$generate`)**

The core idea is to introduce a special key, let's call it `$generate`, within our JSON templates. When our `placeholder-resolver` encounters this key, it will know not to treat the value as a literal object, but as a set of instructions for generating data.

This approach is powerful because it's:
*   **Explicit:** The `$generate` key makes it obvious that dynamic generation is happening.
*   **Contained:** All the rules for generation are co-located with where the data is needed.
*   **Scalable:** We can add new generation "types" in the future without changing the core syntax.

---

### **The Design: The `$generate` Directive Syntax**

Let's design the syntax to solve your exact use case.

#### **Use Case 1: Repeating a Template (The Buildings)**

Your payload needs an array of buildings, where each one is similar but has an incrementing ID.

**The Template (`templates/bop/create_multi_building_payload.json`):**
```json
{
  "customerName": "{{faker.company.name}}",
  "locations": [
    {
      "address": "{{faker.location.streetAddress}}",
      "buildings": {
        // --- The Data Generation Directive ---
        "$generate": {
          "type": "repeat",
          "count": 3, // Generate 3 building objects
          "template": {
            // The template for each object in the array
            "buildingId": "BLD-{{$index}}", // A special var for the loop index
            "roofType": "Shingle",
            "yearBuilt": {
              "$faker": "number.int",
              "args": { "min": 2000, "max": 2020 }
            }
          }
        }
      }
    }
  ]
}
```
**Explanation:**
*   **`$generate`:** The magic key that triggers our data generator.
*   **`type: "repeat"`:** Tells the generator what kind of operation to perform.
*   **`count: 3`:** A parameter for the "repeat" operation. It specifies how many items to create.
*   **`template`:** An object defining the structure of each generated item.
*   **`{{$index}}`:** A special, context-aware placeholder that is only available inside a `repeat` template. It represents the 0-based index of the loop (0, 1, 2...). We could also support `{{$index_1}}` for a 1-based index.

#### **Use Case 2: Repeating with Conditions (The Locations)**

This is the more complex scenario. We need to generate an array of locations, where the first one is "Primary" and the rest are "Secondary".

**The Template (`templates/bop/create_multi_location_payload.json`):**
```json
{
  "customerName": "{{faker.company.name}}",
  "locations": {
    "$generate": {
      "type": "repeat",
      "count_from": "{{testData.locationBuildingCounts}}", // e.g., [3, 2] -> 2 locations total
      "template": {
        // --- Conditional Logic within the template ---
        "locationType": {
          "$generate": {
            "type": "conditional",
            "if": "{{$index === 0}}", // If it's the first item in the array
            "then": "Primary",
            "else": "Secondary"
          }
        },
        "address": "{{faker.location.streetAddress}}",
        // We can nest generators!
        "buildings": {
          "$generate": {
            "type": "repeat",
            // Get the count for this specific location from the input array
            "count": "{{$parent.item}}", 
            "template": {
              "buildingId": "LOC{{$parent.$index}}-BLD{{$index_1}}",
              "squareFootage": 5000
            }
          }
        }
      }
    }
  }
}
```
**`test_data/multi_location_data.json`:**
```json
{
  "locationBuildingCounts": [3, 2]
}
```
**Explanation of New Concepts:**
*   **`count_from`:** A new parameter for the `repeat` generator. It takes a placeholder pointing to an array (e.g., `[3, 2]`). The number of items to generate will be the `length` of this array (2 locations).
*   **`$parent` context:** When inside a nested generator, `$parent` provides a way to access the context of the outer loop.
    *   `{{$parent.$index}}`: The index of the *outer* loop (the location loop).
    *   `{{$parent.item}}`: The value of the item from the `count_from` array for the current outer loop iteration (e.g., `3` for the first location, `2` for the second).
*   **`conditional` generator:** A new generator type to handle if/then/else logic. It resolves the `if` condition (which can contain placeholders) and returns either the `then` or `else` value.

---

### **The Implementation Plan**

This requires a significant upgrade to our **`placeholder-resolver.ts`**. It will become a true data generation engine.

**1. Refactor `resolvePlaceholdersIn`:**
   The main `resolvePlaceholdersIn` function will be the entry point. When it traverses an object, its primary job will now be to look for a `$generate` key first.
   ```typescript
   function resolvePlaceholdersIn(data, context) {
     if (typeof data === 'object' && data !== null && data.$generate) {
       // If we find the key, hand off to a new master generator function
       return executeGenerator(data.$generate, context);
     }
     // ... otherwise, continue with the existing recursive traversal and string replacement
   }
   ```

**2. Create `executeGenerator(config, context)`:**
   This new function will be a `switch` statement that calls the appropriate generator based on the `type` property in the config.
   ```typescript
   function executeGenerator(config, context) {
     switch (config.type) {
       case 'repeat':
         return generateRepeat(config, context);
       case 'conditional':
         return generateConditional(config, context);
       // ... other future generator types
       default:
         return null;
     }
   }
   ```

**3. Implement the Generator Functions (`generateRepeat`, `generateConditional`):**
   *   **`generateRepeat`:**
     *   Determine the loop count (either from `config.count` or the length of the array from `config.count_from`).
     *   Create an empty array for the results.
     *   Loop from 0 to `count-1`.
     *   In each iteration, create a **new, enriched context** for the template. This context will include the `$index` and, if nested, the `$parent` data.
     *   Call `resolvePlaceholdersIn` on the `config.template`, passing it this new, enriched context.
     *   Push the result into the results array.
     *   Return the final array.
   *   **`generateConditional`:**
     *   Resolve the `config.if` string using `resolvePlaceholdersInString`. This will turn `{{$index === 0}}` into a string like `"0 === 0"`.
     *   **Safely evaluate** this string condition. This is the trickiest part and must be done carefully to avoid security risks. Using a library like `safe-eval` or a simple custom parser is essential. We should not use `eval()`.
     *   Based on the result, return either the `config.then` or `config.else` value (which themselves can be objects that need to be run through `resolvePlaceholdersIn`).

This design provides an incredibly powerful, scalable, and declarative way to handle complex data generation needs directly within your test data templates.