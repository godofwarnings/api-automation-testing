Excellent. Let's implement this critical security feature step-by-step. We will create the encryption utility, the decryption helper, and integrate it into our authentication flow.

---

### **Step 1: Install Node.js Crypto Library**

Node.js has a built-in `crypto` module, so we do not need to install any external dependencies for the encryption/decryption logic itself.

---

### **Step 2: Define the Master Key in `.env`**

This is the secret key used for all encryption and decryption. It **must** be a 32-character (256-bit) string for AES-256.

**Action:** Add this line to your `.env` file. **Remember to never commit this file.**

📁 **`.env`**
```
# A 32-character (256-bit) master key for AES encryption.
# IMPORTANT: This must be kept secret and should be managed by a secure
# credential store in a CI/CD environment like Jenkins.
# Generate one from a password manager or a secure key generator.
MASTER_CRYPTO_KEY="your-super-secret-32-char-key!!z"
```

---

### **Step 3: Create the Encryption/Decryption Utility**

This helper module will contain the core logic for both encrypting (for our offline utility) and decrypting (for runtime use).

📁 **`src/helpers/crypto.ts`** (New File)
```typescript
import * as crypto from 'crypto';
import { log } from './logger';
import { ConfigurationError } from './errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For AES, this is always 16
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts a plain-text string using AES-256-GCM.
 * @param text The plain-text string to encrypt.
 * @returns The encrypted string in the format "enc:alg:iv:authTag:encryptedData".
 */
export function encrypt(text: string): string {
  const masterKey = process.env.MASTER_CRYPTO_KEY;
  if (!masterKey || masterKey.length !== 32) {
    throw new ConfigurationError("MASTER_CRYPTO_KEY is not defined in .env or is not 32 characters long.");
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(masterKey), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();

  return `enc:${ALGORITHM}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * @param encryptedText The string to decrypt, in the format "enc:alg:iv:authTag:encryptedData".
 * @returns The decrypted, plain-text string.
 */
export function decrypt(encryptedText: string | undefined): string {
  if (!encryptedText) {
    throw new ConfigurationError("Cannot decrypt an undefined value.");
  }

  // If the string is not encrypted, return it as-is.
  if (!encryptedText.startsWith('enc:')) {
    return encryptedText;
  }

  const masterKey = process.env.MASTER_CRYPTO_KEY;
  if (!masterKey || masterKey.length !== 32) {
    throw new ConfigurationError("MASTER_CRYPTO_KEY is not defined in .env or is not 32 characters long. Cannot decrypt secrets.");
  }
  
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 5) throw new Error("Invalid encrypted string format.");
    
    const [, , ivHex, authTagHex, encryptedDataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(masterKey), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error: any) {
    log.error(error, "Failed to decrypt secret. Check if the MASTER_CRYPTO_KEY is correct.");
    throw new Error(`Decryption failed: ${error.message}`);
  }
}
```

---

### **Step 4: Create the Offline Encryption Script**

This is the command-line utility for developers to encrypt their secrets.

📁 **`scripts/encrypt-secret.ts`** (New File)
```typescript
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { encrypt } from '../src/helpers/crypto';
import * as dotenv from 'dotenv';

// Load the .env file to get the MASTER_CRYPTO_KEY
dotenv.config();

async function main() {
  const argv = await yargs(hideBin(process.argv)).options({
    secret: { type: 'string', demandOption: true, describe: 'The plain-text secret to encrypt' },
  }).argv;

  try {
    const encryptedString = encrypt(argv.secret);
    console.log('\n✅ Encryption Successful!');
    console.log('\nCopy this entire string into your configuration file:');
    console.log(`\n${encryptedString}\n`);
  } catch (error: any) {
    console.error('\n❌ Encryption Failed!');
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }
}

main();
```

**Action:** Add the corresponding script to `package.json`.

📁 **`package.json`**
```json
  "scripts": {
    "// --- SECURITY UTILITY ---": "",
    "encrypt": "ts-node scripts/encrypt-secret.ts",
    "//": "..."
  }
```

---

### **Step 5: Integrate Decryption into the Authentication Flow**

Now, we update our `bop.auth.setup.ts` to use the `decrypt` function.

**Action:** First, update your credential file with an encrypted value.
1.  Run `npm run encrypt -- --secret="your-real-app-key"` to get an encrypted string.
2.  Paste it into your credential file.

📁 **`config/credentials/default_creds.json`** (Example with encrypted key)
```json
{
  "api": {
    "app_id_var": "DEFAULT_APP_ID",
    "app_key_var": "DEFAULT_APP_KEY_ENCRYPTED" 
  }
}
```

📁 **`.env`** (The corresponding encrypted value)
```
DEFAULT_APP_ID="my-plain-text-app-id"
DEFAULT_APP_KEY_ENCRYPTED="enc:aes-256-gcm:a1b2...:c3d4...:e5f6..."
```

**Action:** Update the auth setup script to decrypt at runtime.

📁 **`tests/products/bop/bop.auth.setup.ts`** (Updated)
```typescript
import { test as setup, expect } from '@playwright/test';
import { log } from '../../../src/helpers/logger';
import { decrypt } from '../../../src/helpers/crypto'; // <-- IMPORT DECRYPT
// ... other imports

setup(`authenticate ${productName}`, async ({ request }) => {
  // ... (logic to load runConfig and get productAuthConfig)
  
  // Get the variable names from the config
  const appIdVar = productAuthConfig.credential_source.app_id_var;
  const appKeyVar = productAuthConfig.credential_source.app_key_var;
  
  // Get the values (which could be plain or encrypted) from process.env
  const appIdValue = process.env[appIdVar];
  const appKeyValue = process.env[appKeyVar];

  // --- DECRYPT AT RUNTIME ---
  // The decrypt function handles both plain and encrypted strings.
  const decryptedAppId = decrypt(appIdValue);
  const decryptedAppKey = decrypt(appKeyValue);
  
  log.info("Decrypting secrets for authentication call...");
  
  // Use the decrypted, plain-text values in the API call
  const authResponse = await request.post(`${baseURL}${productAuthConfig.auth_path}`, {
    headers: { 
      'App_ID': decryptedAppId,
      'App_key': decryptedAppKey,
    },
  });

  // ... (rest of the script is unchanged)
});
```

### **Workflow Summary**

1.  **Setup:** A developer with access to the real secrets and the `MASTER_CRYPTO_KEY` runs `npm run encrypt -- --secret="my-password"` to get an encrypted string.
2.  **Storage:** They commit the configuration files (e.g., `partner.json`) with these encrypted strings. The `.env` file containing `MASTER_CRYPTO_KEY` is **never** committed.
3.  **CI/CD:** In Jenkins, the `MASTER_CRYPTO_KEY` is stored as a Jenkins secret and injected into the build as an environment variable.
4.  **Execution:** When `npm test` runs, the `auth.setup.ts` script reads the encrypted string from the environment, calls `decrypt()`, gets the plain-text secret back, and uses it to log in. The plain-text secret only ever exists in memory for a brief moment during the test run.

This completes the implementation of a secure, robust, and industry-standard method for handling secrets in your framework.