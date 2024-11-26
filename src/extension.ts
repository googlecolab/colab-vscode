import * as vscode from 'vscode';

// Called when the extension is activated.
export function activate(context: vscode.ExtensionContext) {
	console.log('Colab is active!');

	const disposable = vscode.commands.registerCommand('colab.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World!');
	});

	context.subscriptions.push(disposable);
}
