import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--disable-extensions'],
        });
    } catch {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main().catch((error: unknown) => {
    console.error('Unhandled error in main function', error);
    process.exit(1);
});