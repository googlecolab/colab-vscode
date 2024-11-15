import * as path from 'path';
import Mocha from 'mocha';
import { Glob } from 'glob';

export function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd'
    });

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((c, e) => {
        const files = new Glob('**/**.test.js', { cwd: testsRoot });

        for (const file of files) {
            mocha.addFile(path.resolve(testsRoot, file));
        }

        try {
            mocha.run(failures => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        } catch (err) {
            console.error(err);
            e(err);
        }
    });
}