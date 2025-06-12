import os

structure = {
    ".github/workflows/main.yml": "",
    ".husky/pre-commit": "#!/bin/sh\n. \"$(dirname \"$0\")/_/husky.sh\"\n\nnpm run lint\n",
    ".vscode/settings.json": """{
  "editor.formatOnSave": true,
  "eslint.validate": ["typescript"],
  "files.exclude": {
    "**/dist": true,
    "**/node_modules": true
  }
}
""",
    "dist/.gitkeep": "",
    "payloads/login-success.xml": "<login><status>success</status></login>\n",
    "payloads/create-user.tmpl": '{ "user": "{{username}}" }\n',
    "reports/allure-report/.gitkeep": "",
    "reports/allure-results/.gitkeep": "",
    "src/core/test-executor.ts": "// Parses YAML, runs tests, and performs assertions\n",
    "src/core/yaml-parser.ts": "// Logic for reading and validating YAML files\n",
    "src/helpers/auth-handler.ts": "// Token generation and session management\n",
    "src/helpers/data-generator.ts": "// Functions to create dynamic test data\n",
    "src/helpers/logger.ts": "// Logger configuration\n",
    "src/types/index.ts": "// Shared types\n",
    "tests/api/definitions/login.yml": "# Login test YAML definition\n",
    "tests/api/expected/login.json": '{\n  "status": 200,\n  "message": "Success"\n}\n',
    "tests/api/specs/login.spec.ts": "// Playwright test for login\n",
    "tests/ui/.gitkeep": "",
    ".env": "BASE_URL=https://example.com\n",
    ".env.development": "DEBUG=true\n",
    ".env.staging": "STAGING=true\n",
    ".eslintignore": "dist/\nnode_modules/\n",
    ".eslintrc.js": "module.exports = { extends: ['eslint:recommended'] };\n",
    ".gitignore": "node_modules/\ndist/\n.env*\n",
    ".prettierrc": "{ \"semi\": true, \"singleQuote\": true }\n",
    "allure.config.js": "// Allure config\n",
    "Dockerfile": "# Dockerfile for test environment\n",
    "package.json": '{\n  "name": "my-project",\n  "scripts": {\n    "test": "playwright test"\n  }\n}\n',
    "package-lock.json": "",
    "playwright.config.ts": "// Playwright configuration\n",
    "tsconfig.json": '{\n  "compilerOptions": {\n    "target": "ES6",\n    "module": "commonjs",\n    "outDir": "dist"\n  }\n}\n',
}

def create_structure(base_path="."):
    for path, content in structure.items():
        full_path = os.path.join(base_path, path)
        dir_name = os.path.dirname(full_path)
        os.makedirs(dir_name, exist_ok=True)

        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)

    print("✅ Project structure generated successfully.")

if __name__ == "__main__":
    create_structure()

