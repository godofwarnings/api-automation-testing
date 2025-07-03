Excellent idea. Integrating post-execution notifications is a critical feature for any enterprise CI/CD pipeline. This allows teams to be notified of test results immediately without having to manually check a Jenkins dashboard.

We will build this feature in a clean, modular way, focusing on the logic first, as you requested.

---

### **The Architectural Plan: Post-Execution Hooks**

The best place to trigger a post-execution action like sending an email is in Playwright's **`globalTeardown`** function.

*   **`globalTeardown`:** This is a special function that, like `globalSetup`, you can specify in `playwright.config.ts`. It is guaranteed to run **once** after all tests and all workers have finished.
*   **Access to Test Results:** The `globalTeardown` function receives the full test run status object, so we will know if the run passed or failed and how many tests were in each state.
*   **Modular Design:** We will create a dedicated `mailer.ts` helper to encapsulate all the email-sending logic, keeping the `globalTeardown` script clean.

---

### **Step 1: Install a Robust Email Library**

We will use **Nodemailer**, which is the de facto standard for sending emails in Node.js. It's powerful, reliable, and supports everything from SMTP to services like SendGrid.

In your terminal, run:
```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

---

### **Step 2: Create the Mailer Utility**

This module will be responsible for composing and sending the email. We'll use environment variables for the configuration for now, which is perfect for Jenkins.

📁 **`src/helpers/mailer.ts`** (New File)
```typescript
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';

export interface MailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  attachments?: { filename: string; path: string }[];
}

/**
 * Configures and sends an email.
 * It reads SMTP configuration from environment variables.
 * Required ENV vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 */
export async function sendMail(options: MailOptions) {
  const { to, subject, htmlBody, attachments } = options;

  // For security, never hardcode credentials. Always use environment variables
  // or a secret management system.
  const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
    secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };

  if (!smtpConfig.host || !smtpConfig.auth.user || !smtpConfig.auth.pass) {
    log.warn("SMTP configuration is missing. Skipping email notification.");
    return;
  }

  try {
    const transporter = nodemailer.createTransport(smtpConfig);

    log.info({ to, subject }, "Sending notification email...");
    await transporter.sendMail({
      from: `"Test Automation" <${smtpConfig.auth.user}>`,
      to: to,
      subject: subject,
      html: htmlBody,
      attachments: attachments,
    });
    log.info("Email sent successfully.");
  } catch (error) {
    log.error(error, "Failed to send email notification.");
  }
}

/**
 * A helper to read the latest worker log file for attachment.
 */
export function getLatestLogFile(): { filename: string; path: string } | null {
  const runTimestamp = process.env.RUN_TIMESTAMP;
  if (!runTimestamp) return null;

  const logDir = path.join(process.cwd(), 'logs', runTimestamp);
  if (!fs.existsSync(logDir)) return null;

  // For simplicity, let's attach the first worker's log file.
  // A more advanced version could zip all log files.
  const logFile = path.join(logDir, 'worker-0.log');
  if (fs.existsSync(logFile)) {
    return {
      filename: `worker-0-log.json`, // Use .json to indicate content type
      path: logFile,
    };
  }
  return null;
}
```

---

### **Step 3: Create the `global.teardown.ts` Script**

This script will run after everything else is finished. It will gather information about the test run and call our mailer utility.

📁 **`tests/global.teardown.ts`** (New File)
```typescript
import { FullConfig, FullResult, Suite } from '@playwright/test/reporter';
import { sendMail, getLatestLogFile } from '../src/helpers/mailer';
import { log } from '../src/helpers/logger';
import * as path from 'path';
import * as fs from 'fs';

async function globalTeardown(config: FullConfig, result: FullResult) {
  log.info('--- Starting Global Teardown ---');

  // Do not send mail if tests were interrupted (e.g., Ctrl+C)
  if (result.status === 'interrupted') {
    log.warn('Test run was interrupted. Skipping email notification.');
    return;
  }

  // Determine overall status and create a subject line
  const status = result.status.toUpperCase(); // PASSED, FAILED, TIMEDOUT
  const subject = `Test Automation Report: ${status} - ${new Date().toLocaleString()}`;

  // --- Compose the HTML Body ---
  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  
  // Need to recursively walk the suite to count tests
  function countTests(suite: Suite) {
      for(const test of suite.tests) {
          switch(test.results[0]?.status) {
              case 'passed': passedCount++; break;
              case 'failed': failedCount++; break;
              case 'timedOut': failedCount++; break;
              case 'skipped': skippedCount++; break;
          }
      }
      for(const childSuite of suite.suites) {
          countTests(childSuite);
      }
  }
  countTests(result.suites[0]); // Start from the root suite

  const htmlBody = `
    <h1>Test Automation Run Summary</h1>
    <p><strong>Overall Status:</strong> <span style="font-weight: bold; color: ${status === 'PASSED' ? 'green' : 'red'};">${status}</span></p>
    <hr>
    <h3>Metrics:</h3>
    <ul>
      <li><strong>Total Tests:</strong> ${passedCount + failedCount + skippedCount}</li>
      <li style="color: green;"><strong>Passed:</strong> ${passedCount}</li>
      <li style="color: red;"><strong>Failed:</strong> ${failedCount}</li>
      <li style="color: orange;"><strong>Skipped:</strong> ${skippedCount}</li>
    </ul>
    <hr>
    <p>The full, interactive Allure report is available in the Jenkins build artifacts.</p>
    <p>This is an automated email. Please do not reply.</p>
  `;

  // --- Prepare Attachments ---
  const attachments = [];
  
  // Attach the Allure report (as a zip, optional but very useful)
  const allureReportPath = path.join(process.cwd(), 'allure-report.zip');
  if (fs.existsSync(allureReportPath)) {
    attachments.push({ filename: 'AllureReport.zip', path: allureReportPath });
  }

  // Attach the latest log file
  const logFile = getLatestLogFile();
  if (logFile) {
    attachments.push(logFile);
  }

  // --- Send the Email ---
  await sendMail({
    to: process.env.EMAIL_RECIPIENTS!, // Read recipients from environment variable
    subject: subject,
    htmlBody: htmlBody,
    attachments: attachments,
  });

  log.info('--- Global Teardown Complete ---');
}

export default globalTeardown;
```*Note: This teardown assumes you have a step in your CI pipeline that generates the Allure report and zips it before this script runs.*

---

### **Step 4: Update `playwright.config.ts` to Use the Teardown Script**

Finally, we tell Playwright to execute our new teardown script.

📁 **`playwright.config.ts`** (Updated)
```typescript
import { defineConfig } from '@playwright/test';
// ... other imports

export default defineConfig<MyProjectOptions>({
  // ... (testDir, reporter, workers, use, projects...)
  
  // Run the global setup script once before all tests
  globalSetup: require.resolve('./tests/global.setup.ts'),

  // --- NEW: Run the global teardown script once after all tests ---
  globalTeardown: require.resolve('./tests/global.teardown.ts'),
});
```

### **How to Configure and Use in Jenkins**

Your `Jenkinsfile` or Jenkins job configuration would now look like this:

1.  **Checkout Code:** Get the latest from your Git repo.
2.  **Install Dependencies:** Run `npm install`.
3.  **Set Secrets:** Use the Jenkins `withCredentials` block to securely set the following environment variables:
    *   `SMTP_HOST`
    *   `SMTP_PORT`
    *   `SMTP_USER`
    *   `SMTP_PASS`
    *   `EMAIL_RECIPIENTS` (e.g., `qa-team@example.com,dev-lead@example.com`)
4.  **Run Tests:** Execute your test command, e.g., `cross-env LOG_TO_FILE=true npm run test:bop:sit`.
5.  **Generate Allure Report:** Run `npm run report:allure`. This creates the `allure-report` directory.
6.  **(Optional) Zip the Report:** Add a shell command to zip the report: `zip -r allure-report.zip allure-report`.
7.  **Publish Allure Report:** Use the Allure Jenkins plugin to point to the `allure-results` directory.
8.  **The `globalTeardown` script will run automatically** at the end of the test execution step, gather the results, find the log file and zipped report, and send the summary email.