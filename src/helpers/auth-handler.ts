import * as fs from 'fs';
import * as path from 'path';

interface AppState {
    bearerToken?: string;
    [key: string]: any; // For other global variables
}

const STATE_FILE_PATH = path.join(__dirname, '..', '..', '.auth', 'state.json');

function readState(): AppState {
    if (!fs.existsSync(STATE_FILE_PATH)) {
        return {}; // Return empty object if file doesn't exist
    }
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE_PATH, 'utf8'));
    } catch (error) {
        console.error("Error reading or parsing state file:", error);
        return {};
    }
}

function writeState(newState: AppState): void {
    const authDir = path.dirname(STATE_FILE_PATH);
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(newState, null, 2));
}

export function setGlobalVariable(key: string, value: any): void {
    const currentState = readState();
    currentState[key] = value;
    writeState(currentState);
}

export function getGlobalVariable(key: string): any {
    const currentState = readState();
    return currentState[key];
}

export function getAuthHeaders(): { [key: string]: string } {
    const token = getGlobalVariable('bearerToken');

    if (!token) {
        // Consider if throwing an error is more appropriate if auth is expected
        console.warn('[AuthHandler] Bearer token not found in state. Proceeding without Authorization header.');
        return {};
    }

    return {
        'Authorization': `Bearer ${token}`
    };
}