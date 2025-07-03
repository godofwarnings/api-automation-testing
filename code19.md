You have found another critical flaw in the design. You are absolutely right. Using a static filename for the stats file (`test-stats.json`) is a major bug in a parallel or sequential run environment. The teardown would be reading stale data from a previous run. My apologies for this oversight.

Let's design and implement a much more robust solution that also addresses your request for more detailed email reports with optional log attachments.

---

### **The Corrected Plan: A Run-Specific, Self-Contained Teardown**

1.  **Run-Specific Artifacts:** The `globalSetup` script will be the single source of truth for a unique "run ID" (our timestamp is perfect for this). It will pass this ID to all subsequent processes.
2.  **Unique Stats File:** The custom reporter will now use this run ID to create a uniquely named stats file for every single test run (e.g., `.tmp/stats-2023-10-27T12-00-00-000Z.json`).
3.  **Teardown Knows the ID:** The teardown script will also use the run ID to find the correct stats file, log files, and a unique name for the zipped Allure report. This eliminates all race conditions and stale data issues.
4.  **Detailed HTML Report:** We will enhance the email body to include a detailed table of failed tests, including their file paths.
5.  **Optional Log Attachments:** We will add a new environment variable, `EMAIL_INCLUDE_LOGS=true`, to control whether the worker log files are attached to the email.

---

### **Step 1: Update `global.setup.ts` to Set the Run ID**

This is a minor but crucial change. It's already creating the timestamp; we just need to ensure we're using it as our unique ID.

📁 **`tests/global.setup.ts`** (No major changes, just confirming the `process.env` usage)
```typescript
async function globalSetup(config: FullConfig) {
  // ...
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // This environment variable is the key to connecting all the pieces.
  process.env.RUN_ID = runTimestamp; 
  
  const logsDir = path.join(process.cwd(), 'logs', runTimestamp);
  fs.mkdirSync(logsDir, { recursive: true });
  // ...
}
```

---

### **Step 2: Update the Custom Reporter (`stats-reporter.ts`)**

It will now use the `RUN_ID` to create a unique output file.

📁 **`reporters/stats-reporter.ts`** (Updated)
```typescript
import { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

// This function will now be exported so teardown can find the file.
export const getStatsFilePath = (runId: string) => {
  return path.join(process.cwd(), '.tmp', `stats-${runId}.json`);
};

class StatsReporter implements Reporter {
  private stats: TestStats = { /* ... */ };
  private runId: string | undefined = process.env.RUN_ID;

  onTestEnd(test: TestCase, result: TestResult) {
    // ... (logic for counting tests is unchanged)
  }

  onEnd() {
    if (!this.runId) {
      console.error("StatsReporter Error: RUN_ID environment variable not set. Cannot save stats.");
      return;
    }
    // Use the run-specific file path.
    const outputPath = getStatsFilePath(this.runId);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(this.stats, null, 2));
  }
}

export default StatsReporter;
```

---

### **Step 3: The New, More Powerful `global.teardown.ts`**

This script now generates a much more detailed email and handles optional log attachments.

📁 **`tests/global.teardown.ts`** (Updated and Final Version)
```typescript
import { FullConfig } from '@playwright/test/reporter';
import { sendNotificationEmail, MailAttachment } from '../src/helpers/mailer';
import { log } from '../src/helpers/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import { execSync } from 'child_process';
import { getStatsFilePath } from '../reporters/stats-reporter';

async function generateAndZipAllureReport(runId: string): Promise<string | null> {
  const zipPath = path.join(process.cwd(), '.tmp', `allure-report-${runId}.zip`);
  // ... (rest of zipping logic is the same)
  return zipPath;
}

function getLogAttachments(runId: string): MailAttachment[] {
  const attachments: MailAttachment[] = [];
  if (process.env.EMAIL_INCLUDE_LOGS !== 'true') {
    log.info("Log file attachment is disabled. Skipping.");
    return attachments;
  }
  
  const logDir = path.join(process.cwd(), 'logs', runId);
  if (!fs.existsSync(logDir)) return attachments;

  const logFiles = fs.readdirSync(logDir);
  for (const file of logFiles) {
    attachments.push({
      filename: `log-${file}`,
      path: path.join(logDir, file),
    });
  }
  log.info(`Attaching ${attachments.length} log file(s) to email.`);
  return attachments;
}

// Main teardown function
async function globalTeardown(config: FullConfig) {
  log.info('--- Starting Global Teardown ---');
  const runId = process.env.RUN_ID;
  if (!runId) {
    log.error("Teardown Error: RUN_ID not found. Cannot generate report.");
    return;
  }
  
  const recipients = process.env.EMAIL_RECIPIENTS;
  if (!recipients) {
    log.warn("EMAIL_RECIPIENTS not set. Skipping email notification.");
    return;
  }
  
  const statsFilePath = getStatsFilePath(runId);
  if (!fs.existsSync(statsFilePath)) {
    log.error(`Test stats file not found at ${statsFilePath}.`);
    return;
  }
  const stats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));

  const overallStatus = stats.failed > 0 || stats.timedOut > 0 ? 'FAILED' : 'PASSED';
  const subject = `Test Automation Report: ${overallStatus} - ${runId}`;

  // --- NEW: Detailed HTML Body ---
  const failedTestsHtml = stats.failedTests.map((test: any) => `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd;">${test.title}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${path.basename(test.file)}</td>
    </tr>
  `).join('');

  const htmlBody = `
    <style> table, th, td { border: 1px solid black; border-collapse: collapse; } </style>
    <h1>Test Automation Summary</h1>
    <p><strong>Run ID:</strong> ${runId}</p>
    <p><strong>Overall Status:</strong> <span style="font-weight: bold; color: ${overallStatus === 'PASSED' ? 'green' : 'red'};">${overallStatus}</span></p>
    <h3>Metrics:</h3>
    <ul>
      <li><strong>Passed:</strong> ${stats.passed}</li>
      <li><strong>Failed:</strong> ${stats.failed + stats.timedOut}</li>
      <li><strong>Skipped:</strong> ${stats.skipped}</li>
      <li><strong>Total:</strong> ${stats.total}</li>
    </ul>
    ${failedTestsHtml ? `
    <h3>Failed Tests Details:</h3>
    <table style="width:100%; text-align: left;">
      <tr>
        <th style="padding: 8px; border: 1px solid #ddd; background-color: #f2f2f2;">Test Title</th>
        <th style="padding: 8px; border: 1px solid #ddd; background-color: #f2f2f2;">File</th>
      </tr>
      ${failedTestsHtml}
    </table>
    ` : ''}
    <hr>
    <p>The full, interactive Allure report is attached as a zip file.</p>
  `;
  // --- END NEW ---

  // Prepare Attachments
  const attachments: MailAttachment[] = [];
  const zippedReportPath = await generateAndZipAllureReport(runId);
  if (zippedReportPath) {
    attachments.push({ filename: 'Allure-Report.zip', path: zippedReportPath });
  }

  // Add log files if enabled
  attachments.push(...getLogAttachments(runId));

  // Send Email
  await sendNotificationEmail({
    to: recipients.split(','),
    subject: subject,
    html: htmlBody,
    attachments: attachments,
  });

  log.info('--- Global Teardown Complete ---');
}

export default globalTeardown;
```

### **How to Use the New Features**

1.  **Standard Run:**
    ```bash
    npm run test:bop:sit
    ```
    *   Creates a unique log directory (e.g., `logs/2023-10-27.../`).
    *   Creates a unique stats file (e.g., `.tmp/stats-2023-10-27....json`).
    *   The teardown finds the correct files using the `RUN_ID`.
    *   Sends a detailed email with a zipped Allure report, but **no** log files.

2.  **Run with Log Attachments:**
    Set the `EMAIL_INCLUDE_LOGS` environment variable to `true`.
    ```bash
    cross-env EMAIL_INCLUDE_LOGS=true npm run test:bop:sit
    ```
    *   Does everything from the standard run.
    *   The final email will now **also** include all `worker-*.log` files from that specific run as attachments.

This robust, run-ID-based approach solves the stale data problem completely and adds the powerful, configurable features you requested for more detailed and useful notifications.