// Playwright test for login
import { executeApiTests } from '@/core/test-executor';

// Tell the executor to run tests defined in the login.yml file
executeApiTests('tests/api/definitions/login.yml');