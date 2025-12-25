const { initCommand } = require('./src/frame/command');
const { initStatusbar } = require('./src/frame/statusbar');
const { initOutputChannel, destroyOutputChannel } = require('./src/frame/channel');
const { initWebviewProvider } = require('./src/frame/webview');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
	initOutputChannel();
	initStatusbar(context);
	initWebviewProvider(context);
	initCommand(context);

}


// This method is called when your extension is deactivated
function deactivate() {
	destroyOutputChannel();
}

module.exports = {
	activate,
	deactivate
}
