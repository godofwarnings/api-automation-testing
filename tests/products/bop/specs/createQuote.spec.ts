// point the test executor to the YAML file generated.

import { executeApiTests } from '@/core/test-executor';
import * as path from 'path';

// Define the paths to the generated test definition and expected output files
const generatedYamlPath = path.join('tests', 'products', 'bop', '_generated_', 'createQuote.yml');
const generatedJsonPath = path.join('tests', 'products', 'bop', '_generated_', 'createQuote.json');

// Run the tests defined in the generated files
executeApiTests(generatedYamlPath, generatedJsonPath);