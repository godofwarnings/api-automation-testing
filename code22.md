You are absolutely right. I have been overthinking this and have led you down a path of unnecessary complexity. My sincere apologies. The goal is a simple, elegant solution within the Playwright ecosystem, not a complex chain of scripts.

Let's scrap the complicated reporter/teardown architecture and use the **simplest, most direct method possible** to achieve your goal.

---

### **The Simple, Correct Solution: Use the `onEnd` Hook of a Reporter**

The `onEnd` hook of a custom reporter is the **only place** that runs *after* all tests are finished and has access to the final, complete test statistics. We can put all our email logic directly inside this hook.

This avoids all the problems with file passing, race conditions, and separate scripts. It's a single, self-contained solution.

---

### **Step 1: The New `email-reporter.ts`**

We will create a single new file. This file will be our custom reporter. It will gather the stats *and* send the email from one place.

**Action:** Delete `tests/global.teardown.ts` and `reporters/stats-reporter.ts`. Create this new file instead.

📁 **`reporters/email-reporter.ts`** (New File)
```typescript
import { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { sendNotificationEmail, MailAttachment } from '../src/helpers/mailer';
import { log } from '../src/helpers/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config();

class EmailReporter implements Reporter {
  private passed = 0;
  private failed = 0;
  private timedOut = 0;
  private skipped = 0;
  private failedTests: { title: string; file: string; }[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    switch (result.status) {
      case 'passed': this.passed++; break;
      case 'failed': 
        this.failed++;
        this.failedTests.push({ title: test.title, file: test.location.file });
        break;
      case 'timedOut': 
        this.timedOut++;
        this.failedTests.push({ title: test.title, file: test.location.file });
        break;
      case 'skipped': this.skipped++; break;
    }
  }

  async onEnd(result: FullResult) {
    // This hook runs AFTER everything is finished.
    log.info('--- Email Reporter: Starting Post-Test Processing ---');
    
    // Do not send mail if tests were stopped manually or there's a major error
    if (result.status !== 'passed' && result.status !== 'failed' && result.status !== 'timedOut') {
      log.warn(`Test run ended with status '${result.status}'. Skipping email notification.`);
      return;
    }

    const recipients = process.env.EMAIL_RECIPIENTS;
    if (!recipients) {
      log.warn("EMAIL_RECIPIENTS environment variable not set. Skipping email.");
      return;
    }

    // 1. Generate and Zip Allure Report
    const zippedReportPath = await this.generateAndZipAllureReport();

    // 2. Compose Email
    const overallStatus = this.failed > 0 || this.timedOut > 0 ? 'FAILED' : 'PASSED';
    const subject = `Test Automation Report: ${overallStatus} - ${new Date().toLocaleString()}`;
    const htmlBody = this.createHtmlBody(overallStatus);

    // 3. Prepare Attachments
    const attachments: MailAttachment[] = [];
    if (zippedReportPath) {
      attachments.push({ filename: 'Allure-Report.zip', path: zippedReportPath });
    }

    // 4. Send Email
    await sendNotificationEmail({
      to: recipients.split(','),
      subject,
      html: htmlBody,
      attachments,
    });
    
    log.info('--- Email Reporter: Finished Post-Test Processing ---');
  }

  // --- Helper methods inside the class ---

  private createHtmlBody(status: string): string {
    const total = this.passed + this.failed + this.timedOut + this.skipped;
    const failedTestsHtml = this.failedTests.map(test => 
      `<li><b>${test.title}</b> (in ${path.basename(test.file)})</li>`
    ).join('');

    return `
      <h1>Test Automation Summary</h1>
      <p><strong>Overall Status:</strong> <span style="font-weight: bold; color: ${status === 'PASSED' ? 'green' : 'red'};">${status}</span></p>
      <hr>
      <h3>Metrics:</h3>
      <ul>
        <li><strong>Passed:</strong> ${this.passed}</li>
        <li><strong>Failed:</strong> ${this.failed}</li>
        <li><strong>Timed Out:</strong> ${this.timedOut}</li>
        <li><strong>Skipped:</strong> ${this.skipped}</li>
        <li><strong>Total:</strong> ${total}</li>
      </ul>
      ${failedTestsHtml ? `<h3>Failed Tests:</h3><ul>${failedTestsHtml}</ul>` : ''}
      <hr>
      <p>The full, interactive Allure report is attached.</p>
    `;
  }

  private async generateAndZipAllureReport(): Promise<string | null> {
    const reportDir = path.join(process.cwd(), 'allure-report');
    const resultsDir = path.join(process.cwd(), 'allure-results');
    const zipPath = path.join(process.cwd(), '.tmp', 'allure-report.zip');
    
    if (!fs.existsSync(resultsDir)) return null;

    try {
      log.info("Generating and zipping Allure report...");
      execSync(`npx allure generate ${resultsDir} --clean -o ${reportDir}`, { stdio: 'pipe' });
      
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      await new Promise<void>((resolve, reject) => {
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.directory(reportDir, false);
        archive.finalize();
      });
      
      log.info(`Allure report zipped successfully to ${zipPath}`);
      return zipPath;
    } catch (error) {
      log.error(error, "Failed to generate or zip Allure report.");
      return null;
    }
  }
}

export default EmailReporter;
```

---

### **Step 2: Update `playwright.config.ts` to Use This Reporter**

We simply register our new, all-in-one reporter.

📁 **`playwright.config.ts`** (Updated `reporter` section)
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // ...
  
  // The reporter array now includes our single, powerful email reporter.
  reporter: [
    ['line'],
    ['allure-playwright'],
    ['./reporters/email-reporter.ts'] // <-- REGISTER THE NEW REPORTER
  ],

  // globalSetup is still useful for creating the RUN_ID and log directory
  globalSetup: require.resolve('./tests/global.setup.ts'),
  
  // We no longer need globalTeardown
  // globalTeardown: ... // DELETE THIS LINE

  // ...
});
```

---

### **Step 3: Simplify `package.json`**

Your `npm` scripts are now much simpler. You no longer need a separate command for sending the report.

📁 **`package.json`** (Updated `scripts` section)
```json
{
  "scripts": {
    "// --- You just run the test command directly ---": "",
    "test": "playwright test",
    "test:bop:sit": "cross-env ENV=sit PARTNER=partner_a npm run test",

    "// No 'ci:run' or 'send-report' script is needed anymore"
  }
}
```

### **Why This Solution is Simple and Correct**

1.  **Single Point of Execution:** All post-test logic lives inside the `onEnd` hook of one reporter file. There are no chained scripts or race conditions.
2.  **Guaranteed Order:** Playwright guarantees that `onEnd` runs *after* every single test has finished and its result has been processed by `onTestEnd`.
3.  **Correct Data:** The `onEnd` hook has access to the final, aggregated statistics that the reporter has built up itself. There is no need to read a temporary file.
4.  **No Module Errors:** Because this is a standard Playwright reporter, the module resolution is handled correctly by Playwright's runner.
5.  **Easy to Use:** You just run your tests. The email sending happens automatically at the end.

This is the clean, simple, and robust solution you were looking for. I am very sorry for the over-engineered suggestions before. This is the right way to do it.