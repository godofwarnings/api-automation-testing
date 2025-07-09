You've asked two excellent questions that get to the very heart of making a BDD framework powerful and efficient. Let's clarify both concepts with clear explanations and examples.

---

### **1. How to Map Multiple Gherkin Steps to a Single Function**

This is a very common and important requirement. Often, several different Gherkin phrases mean the exact same thing in terms of the code that needs to run. For example:
*   `Given I am a logged-in user`
*   `And the user has an active session`
*   `Given a logged-in user exists`

All of these might map to the same underlying action: "run the login sequence."

**The Solution: Use Regular Expressions with "OR"**

The key is to use a regular expression with the `|` (OR) operator in your `gherkin_step_mapping.yml`. This allows you to define a single rule that matches multiple, different Gherkin sentences.

**Example Implementation:**

Let's say you have a single step in your library called `ensureUserIsLoggedIn`.

📁 `data/YOUR_TEST_CASE/step_library.yml`
```yaml
ensureUserIsLoggedIn:
  description: "Ensures the user is logged in, performing login if necessary"
  function: "custom.auth.ensureLogin"
  parts:
    test_data: "test_data/default_user_creds.json"
```

Now, in your mapping file, you create a single rule that can be triggered by multiple phrases.

📁 `data/YOUR_TEST_CASE/gherkin_step_mapping.yml`
```yaml
steps:
  - gherkin: "^(I am a logged-in user|the user has an active session|a logged-in user exists)$"
    # All three of the phrases above will match this single regex rule.
    # The ^ and $ ensure it matches the whole line for safety.
    step_id: "ensureUserIsLoggedIn"
```

**How it Works:**
*   The Gherkin parser takes a line from your `.feature` file, for example, `"Given I am a logged-in user"`.
*   It tests this string against the regex `^(I am a logged-in user|the user has an active session|a logged-in user exists)$`.
*   The `|` acts as an "OR", so the regex matches successfully.
*   The parser then knows to execute the `ensureUserIsLoggedIn` step from your library.

This is the most efficient way to handle this. You avoid duplicating rules and keep your mapping file clean and DRY (Don't Repeat Yourself).

---

### **2. What is the `maps` block? (Clarification and Usefulness)**

The `maps` block is the most powerful feature of our BDD integration. Its purpose is to **extract data from your Gherkin step and inject it into the parameters of your test step.**

This is what turns your BDD scenarios from static stories into powerful, data-driven test templates.

**Let's break down its usefulness with a clear example:**

Imagine you have this Gherkin step:
`When I add a product with SKU "BOP-PREMIUM-123" to the cart`

And your API requires a JSON payload like this:
```json
{
  "productIdentifier": "BOP-PREMIUM-123",
  "quantity": 1
}
```
Without the `maps` block, you would need to create a whole new step definition and parameter file for every single SKU you want to test. This is not scalable.

**With the `maps` block, you create one reusable step:**

**The Gherkin Step (with a value to be captured):**
```gherkin
When I add a product with SKU "BOP-PREMIUM-123" to the cart
```

**The Gherkin Mapping Rule (with `maps`):**
```yaml
steps:
  - gherkin: 'I add a product with SKU "(.*)" to the cart'
    step_id: "addProductToCart"
    # The 'maps' block tells the framework what to do with the captured value.
    maps:
      - gherkin_group: 1  # Corresponds to the first `(.*)` in the regex.
        # This is the path where the value will be injected into the step's parameters.
        param_path: "payload.productIdentifier"
```

**The Step Library Definition:**
```yaml
addProductToCart:
  function: "standard.api.sendRequest"
  parts:
    request: "request_params/cart_request.json"
    payload: "payloads/add_to_cart_payload.json" # A template payload
```

**The Template Payload File:**
📁 `payloads/add_to_cart_payload.json`
```json
{
  "productIdentifier": null,
  "quantity": 1
}
```

#### **How it Works End-to-End:**

1.  **Parsing:** The Gherkin parser reads the step `"I add a product with SKU "BOP-PREMIUM-123" to the cart"`.
2.  **Matching:** It matches this against the regex `'I add a product with SKU "(.*)" to the cart'`.
3.  **Extraction:** It extracts the first captured group (`(.*)`), which is the string `"BOP-PREMIUM-123"`.
4.  **Mapping:** It looks at the `maps` block.
    *   It sees `gherkin_group: 1`, so it takes the extracted value `"BOP-PREMIUM-123"`.
    *   It sees `param_path: "payload.productIdentifier"`.
5.  **Dynamic Parameter Creation:** It creates a small, dynamic parameter object in memory:
    ```javascript
    const dynamicParams = {
      payload: {
        productIdentifier: "BOP-PREMIUM-123"
      }
    };
    ```6.  **Parameter Composition:** The orchestrator loads the base `add_to_cart_payload.json` file.
7.  **Merging:** The orchestrator then **deep merges** the `dynamicParams` object on top of the parameters loaded from the file. The `null` value in the template is overwritten with the value from the Gherkin step.
8.  **Execution:** The `sendRequest` function receives the final, merged payload and sends it to the API:
    ```json
    {
      "productIdentifier": "BOP-PREMIUM-123",
      "quantity": 1
    }
    ```

**In summary, the `maps` block is the critical feature that makes your BDD tests truly reusable and data-driven.** It allows you to write one generic step implementation (`addProductToCart`) and control its behavior and data directly from the plain-English text of your `.feature` files.