import os

structure = {
    ".github/workflows/main.yml": "# GitHub Actions CI/CD workflow\n",
    "config/environments.yml": "# Central config for envs, partners, credentials\n",
    "config/data-variance/bop/.gitkeep": "",
    ".auth/state.json": "{}\n",
    "payloads/_generated_/.gitkeep": "",
    "payloads/login-success.xml": "<login><status>success</status></login>\n",
    "reports/allure-report/.gitkeep": "",
    "reports/allure-results/.gitkeep": "",
    "src/core/test-executor.ts": "// Simplified test executor\n",
    "src/core/test-generator.ts": "// (Future) Test Generation Engine\n",
    "src/helpers/auth-handler.ts": "// Reads token from .auth/state.json\n",
    "templates/bop/.gitkeep": "",
    "tests/globalSetup.ts": "// Playwright global setup for auth\n",
    "tests/products/bop/_generated_/.gitkeep": "",
    "tests/products/bop/expected/createQuote.json": '{ "status": "success" }\n',
    "tests/products/bop/definitions/createQuote.yml": "# YAML definition for BOP createQuote\n",
    "tests/products/bop/specs/createQuote.spec.ts": "// Spec glue for createQuote\n",
    ".env": "# Local environment secrets\n",
    ".gitignore": ".auth/\npayloads/_generated_/\nreports/\nnode_modules/\ndist/\n",
    "package.json": """{
  "name": "project",
  "scripts": {
    "test": "playwright test",
    "auth:setup": "ts-node tests/globalSetup.ts"
  }
}
""",
    "playwright.config.ts": """import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: require.resolve('./tests/globalSetup'),
});
""",
    "tsconfig.json": """{
  "compilerOptions": {
    "target": "ES6",
    "module": "commonjs",
    "outDir": "dist"
  }
}
""",
}


def create_structure(base_path="."):
    for path, content in structure.items():
        full_path = os.path.join(base_path, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
    print("✅ Updated project structure created successfully.")


if __name__ == "__main__":
    create_structure()
