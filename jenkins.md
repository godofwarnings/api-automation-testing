Excellent. We have made significant progress in building a feature-rich, robust API testing framework.

Based on our checklist and your recent request, the next logical and most valuable step is **#8: CI/CD Integration**, with a specific focus on **Jenkins**.

An automated testing framework only reaches its full potential when it can be run automatically as part of a continuous integration pipeline. This step makes our framework truly operational in an enterprise environment.

---

### **Next Step: Integrate the Framework with a Jenkins Pipeline**

We will create a sample `Jenkinsfile` that can be placed in the root of your project's repository. This file will define the entire CI process for running our API tests.

**Goals:**
*   Define a pipeline that can be triggered automatically (e.g., on a code push).
*   Use Jenkins' built-in features for managing parameters and secrets securely.
*   Run our tests using the `npm` scripts we've already created.
*   Publish the Allure test report directly in the Jenkins UI for easy access.

---

### **The Plan**

#### **1. Handling Secrets in Jenkins**

First, we need to address a critical CI/CD concept: **never commit secrets to your repository**. The `.env` file is for local development only and should be in your `.gitignore`.

In Jenkins, you would store your secret keys (`BOP_APP_KEY`, `GL_APP_KEY`, etc.) using Jenkins' built-in **Credentials Management**. You would typically add them as "Secret text" credentials with a unique ID (e.g., `BOP_APP_KEY_CREDENTIAL`).

Our `Jenkinsfile` will then securely access these credentials and inject them as environment variables during the build, making them available to our scripts.

#### **2. Using Jenkins Parameters**

To make our pipeline flexible, we will define parameters for `ENV` and `PARTNER`. This allows a user to manually trigger a build from the Jenkins UI and choose which environment and partner to test against.

#### **3. The `Jenkinsfile`**

Here is a sample declarative `Jenkinsfile` that accomplishes all our goals. You would save this file as `Jenkinsfile` in the root of your project.

```groovy
// Jenkinsfile (Declarative Pipeline)

pipeline {
    // 1. Agent Configuration: Use a Jenkins agent that has Node.js available.
    // 'nodejs' refers to a tool configured in your Jenkins Global Tool Configuration.
    agent {
        node {
            nodejs 'node-18' // Replace with your configured Node.js tool name
        }
    }

    // 2. Parameters: Allow users to choose the env and partner when running the job.
    parameters {
        string(name: 'ENV', defaultValue: 'sit', description: 'Target environment (e.g., sit, uat)')
        string(name: 'PARTNER', defaultValue: 'partner_a', description: 'Partner code (e.g., partner_a)')
        string(name: 'TEST_PROJECT', defaultValue: 'bop-api-tests', description: 'Playwright project to run (e.g., bop-api-tests)')
        string(name: 'PRODUCT_NAME', defaultValue: 'bop', description: 'Product name for test scripts (e.g., bop, gl)')
    }

    // 3. Environment Variables: Define variables to be used in the pipeline stages.
    environment {
        // This makes our npm scripts work consistently
        CI = 'true'
    }

    stages {
        // Stage 1: Clean the workspace and check out the code from version control
        stage('Checkout') {
            steps {
                script {
                    log.info "Checking out source code..."
                    cleanWs()
                    checkout scm
                }
            }
        }

        // Stage 2: Install all project dependencies securely
        stage('Install Dependencies') {
            steps {
                script {
                    log.info "Installing npm dependencies..."
                    // 'npm ci' is recommended for CI as it uses the package-lock.json
                    sh 'npm ci'
                }
            }
        }

        // Stage 3: Run the API tests with secrets injected securely
        stage('Run API Tests') {
            steps {
                // Use the withCredentials block to securely access Jenkins secrets.
                // It exposes them as environment variables only within this block.
                withCredentials([
                    string(credentialsId: 'BOP_APP_ID_CREDENTIAL', variable: 'BOP_APP_ID'),
                    string(credentialsId: 'BOP_APP_KEY_CREDENTIAL', variable: 'BOP_APP_KEY'),
                    string(credentialsId: 'BOP_RESOURCE_KEY_CREDENTIAL', variable: 'BOP_RESOURCE_KEY')
                    // Add other secrets for GL, etc. here
                ]) {
                    script {
                        log.info "Running tests for Product: ${params.PRODUCT_NAME}, Env: ${params.ENV}, Partner: ${params.PARTNER}"
                        
                        // Use a try/catch block to ensure reports are generated even if tests fail
                        try {
                            // Construct the npm command dynamically from the Jenkins parameters
                            // Example: 'npm run test:bop:sit:partner_a'
                            sh "npm run test:${params.PRODUCT_NAME}:${params.ENV}:${params.PARTNER}"
                        } catch (err) {
                            log.error "Test execution failed!"
                            // Re-throw the error to mark the build as failed
                            throw err
                        }
                    }
                }
            }
        }
    }

    // 4. Post-Build Actions: These actions run after all stages are complete.
    post {
        // The 'always' block ensures this runs whether the build succeeded or failed.
        always {
            script {
                log.info "Generating Allure report..."
                // Use the Allure Jenkins Plugin command to generate and archive the report.
                // This requires the plugin to be installed on your Jenkins instance.
                allure includeProperties: false, jdk: '', report: 'allure-report', results: [[path: 'allure-results']]
            }
        }
    }
}

// Custom logging function for clarity in the Jenkins console output
def log = new GroovyLog()
class GroovyLog {
    def info(String message) {
        println "INFO: ${message}"
    }
    def error(String message) {
        println "ERROR: ${message}"
    }
}
```

### **How This Works**

1.  **Jenkins Setup:**
    *   An administrator installs the **NodeJS Plugin** and the **Allure Jenkins Plugin**.
    *   They configure a Node.js installation under "Global Tool Configuration" (e.g., naming it `node-18`).
    *   They add your API keys as "Secret text" credentials in Jenkins' credential store, giving them descriptive IDs (e.g., `BOP_APP_KEY_CREDENTIAL`).
2.  **Pipeline Execution:**
    *   You create a new "Pipeline" job in Jenkins and point it to the `Jenkinsfile` in your Git repository.
    *   When you click "Build with Parameters," Jenkins presents you with dropdowns or text boxes to enter the `ENV`, `PARTNER`, and `TEST_PROJECT`.
    *   The `withCredentials` block securely pulls the secrets from the Jenkins store and sets them as environment variables, just like your `.env` file does locally.
    *   The `npm run` command is executed with the correct context.
    *   The `post` block runs `allure` to process the `allure-results` directory and generates a beautiful, interactive report that you can view directly from the Jenkins build page.

This `Jenkinsfile` provides a complete, secure, and flexible template for running your API test framework in a professional CI/CD environment.
