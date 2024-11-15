import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension', () => {
	test('should be present', () => {
		assert.ok(vscode.extensions.getExtension('google.colab'));
	});

	test('should activate', async () => {
		const extension = vscode.extensions.getExtension('google.colab');

		await extension?.activate();

		assert.strictEqual(extension?.isActive, true);
	});

	test('should register the helloWorld command', async () => {
		const extension = vscode.extensions.getExtension('google.colab');
		await extension?.activate();

		const commands = await vscode.commands.getCommands(true);

		assert.ok(commands.includes('colab.helloWorld'));
	});
});
