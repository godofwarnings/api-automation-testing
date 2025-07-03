Excellent. This is a critical security consideration for any enterprise-grade framework. Storing secrets in plain text, even in `.env` files that are git-ignored, is a significant security risk.

Let's brainstorm a robust, secure, and flexible way to handle encrypted secrets.

---

### **Brainstorming & Game Plan: Runtime Secret Decryption**

#### **Core Principle: The Framework Decrypts, It Never Encrypts**

The framework's responsibility should be to **decrypt** secrets at runtime. The process of **encrypting** the secrets should be a separate, offline utility. This is a crucial separation of concerns for security.

1.  **Encryption (Offline Utility):** A developer or a DevOps engineer with the master key will run a command-line utility to encrypt a secret.
    *   `npm run encrypt -- --secret="mySuperSecretPassword"`
    *   This will output an encrypted string (e.g., `enc:aes:a1b2c3d4...`).
2.  **Storage:** This encrypted string is what gets stored in the configuration files (e.g., `partner.json` or `.env`). It is now safe to commit `partner.json` to Git (though the `.env` file containing the master key should always be git-ignored).
3.  **Decryption (Runtime):** When the framework starts (in `global.setup.ts` or the `auth.setup.ts`), it will detect strings that start with a specific prefix (e.g., `enc:`). It will then use a master decryption key to decrypt these strings into their plain-text form just before they are needed.

---

### **Detailed Architectural Breakdown**

#### **1. The Encryption/Decryption Strategy**

*   **Algorithm:** We should use a strong, standard, symmetric encryption algorithm. **AES-256-GCM** is an excellent choice.
    *   **AES:** Advanced Encryption Standard, the industry standard.
    *   **256:** A strong key length.
    *   **GCM (Galois/Counter Mode):** This is a modern, authenticated encryption mode. It not only encrypts the data but also provides an authentication tag that ensures the data has not been tampered with. This prevents certain types of attacks.
*   **The Master Key:**
    *   There will be a single, master encryption/decryption key.
    *   This key must **NEVER** be stored in the Git repository.
    *   **Local Development:** It will be stored in the `.env` file (e.g., `MASTER_CRYPTO_KEY=...`).
    *   **CI/CD (Jenkins):** It will be stored as a "Secret Text" credential in Jenkins and injected as an environment variable during the build.
*   **The Encrypted String Format:**
    *   To make the encrypted strings self-describing, they should have a clear format:
        `enc:<algorithm>:<iv>:<authTag>:<encryptedData>`
    *   Example: `enc:aes-256-gcm:a1b2c3d4:e5f6g7h8:i9j0k1l2...`
    *   The **IV (Initialization Vector)** and **Auth Tag** are essential components of AES-GCM and must be stored alongside the encrypted data to allow for decryption. They are not secret.

#### **2. The Offline Encryption Utility**

This will be a new script, perhaps `scripts/crypto-util.ts`.

*   **Functionality:**
    *   It will read the `MASTER_CRYPTO_KEY` from the `.env` file.
    *   It will take a plain-text string as a command-line argument.
    *   It will generate a new, random IV for each encryption operation.
    *   It will perform the AES-256-GCM encryption.
    *   It will then assemble the final string in our specified format (`enc:aes-256-gcm:...`) and print it to the console.

**User Workflow:**
```bash
# 1. User runs the command with their secret
npm run encrypt -- --secret="my-api-key-12345"

# 2. The script outputs the encrypted string
# Output: enc:aes-256-gcm:5b1d...:8e7f...:c9a0...

# 3. User copies this entire string and pastes it into their config file
# (e.g., config/credentials/partner_a_creds.json)
```

#### **3. The Runtime Decryption Module**

This will be a new helper module, `src/helpers/crypto.ts`.

*   **Functionality:**
    *   It will export a `decrypt(encryptedString)` function.
    *   This function will first check if the input string starts with the `enc:` prefix. If not, it returns the string as-is (assuming it's already plain text).
    *   If it does have the prefix, it will:
        *   Read the `MASTER_CRYPTO_KEY` from the environment variables. If the key is missing, it will throw a fatal `ConfigurationError`.
        *   Parse the `encryptedString` to separate the algorithm, IV, auth tag, and encrypted data.
        *   Perform the AES-256-GCM decryption using the master key and the stored IV/auth tag.
        *   Return the plain-text secret.

#### **4. Integration with the Framework**

The final step is to call our new `decrypt` function at the last possible moment before a secret is used.

*   **The `auth.setup.ts` script is the perfect place for this.**
*   When it retrieves a credential variable name from the config (e.g., `partnerConfig.products.bop.credential_source.app_key_var`), it will:
    1.  Get the corresponding value from `process.env`. This value will be the encrypted string (`enc:aes...`).
    2.  Pass this encrypted string to the `decrypt()` function.
    3.  Use the returned plain-text secret in the API header for the authentication call.

**Example in `auth.setup.ts`:**
```typescript
import { decrypt } from '../helpers/crypto';
// ...

// Get the encrypted string from the environment variable
const encryptedAppKey = process.env[productAuthConfig.credential_source.app_key_var];

// Decrypt it just before use
const plainTextAppKey = decrypt(encryptedAppKey);

// Use the plain-text key in the API call
const response = await request.post(..., {
  headers: { 'App_key': plainTextAppKey },
});
```

### **Summary of Benefits**

*   **High Security:** Secrets are never stored in plain text in the repository. The master key is also never committed.
*   **Flexibility:** The system doesn't care what you encrypt. It can be a password, an API key, a database connection string, etc.
*   **Clear Separation:** The high-privilege action (encryption) is separate from the runtime action (decryption).
*   **Robustness:** The structured format (`enc:alg:iv:tag:data`) makes the encrypted strings self-contained and less prone to error. The GCM mode ensures data integrity.
*   **Ease of Use:** For the user running the tests, the process is transparent. They just run `npm test`. For the user managing secrets, the `npm run encrypt` command provides a simple and secure workflow.

This game plan provides a comprehensive, secure, and industry-standard solution for managing secrets within your automation framework.