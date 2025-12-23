const vscode = require('vscode');
const api = require('../core/api');
const { showRelationUserBehaviorSetting } = require('./setting');
const { isViewVisible } = require('./webview');

let cursorChangeListener = null;
let lastPosition = null;
let debounceTimer = null;

/**
 * 注册命令
 * @param {vscode.ExtensionContext} context
 * @param {string} commandName
 * @param {any} callback
 */
function registerCommand(context, commandName, callback) {
	let disposable = vscode.commands.registerCommand(commandName, () => callback(context));
	context.subscriptions.push(disposable);
}

/**
 * Initialize live mode listener
 * @param {vscode.ExtensionContext} context
 */
function initLiveModeListener(context) {
	// Clean up existing listener if any
	if (cursorChangeListener) {
		cursorChangeListener.dispose();
		cursorChangeListener = null;
	}

	const mode = showRelationUserBehaviorSetting();
	
	if (mode === 'Live') {
		cursorChangeListener = vscode.window.onDidChangeTextEditorSelection(event => {
			// Only trigger if the relations view is currently visible
			if (!isViewVisible()) {
				return;
			}
			
			const editor = event.textEditor;
			const position = editor.selection.active;
			
			// Clear any pending debounce timer
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			
			// Debounce to avoid too many calls when cursor moves rapidly
			debounceTimer = setTimeout(() => {
				// Check if position actually changed
				if (!lastPosition || 
					lastPosition.line !== position.line || 
					lastPosition.character !== position.character) {
					lastPosition = position;
					api.showRelations(context, false);
				}
			}, 500); // Wait 500ms after cursor stops moving
		});
		
		context.subscriptions.push(cursorChangeListener);
	}
}

/**
 * 初始化命令
 * @param {vscode.ExtensionContext} context
 */
function initCommand(context)
{
	registerCommand(context, 'crelation.showRelations', api.showRelations);
	registerCommand(context, 'crelation.GetCurrentLang', api.GetCurrentLang);
	registerCommand(context, 'crelation.openNewRelationWindow', api.openNewRelationWindow);
	
	// Register close commands for each relation tab
	const { closeViewProvider } = require('./webview');
	registerCommand(context, 'crelation.closeRelationTab2', () => closeRelationTabByViewId(context, 'crelation.relationsView2'));
	registerCommand(context, 'crelation.closeRelationTab3', () => closeRelationTabByViewId(context, 'crelation.relationsView3'));
	registerCommand(context, 'crelation.closeRelationTab4', () => closeRelationTabByViewId(context, 'crelation.relationsView4'));
	registerCommand(context, 'crelation.closeRelationTab5', () => closeRelationTabByViewId(context, 'crelation.relationsView5'));
	
	// Initialize live mode listener
	initLiveModeListener(context);
	
	// Re-initialize when configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('crelation.showRelationUserBehaviorSetting')) {
				initLiveModeListener(context);
			}
		})
	);
}

/**
 * Close a relation tab by its view ID
 * @param {vscode.ExtensionContext} context
 * @param {string} viewId
 */
function closeRelationTabByViewId(context, viewId) {
	const { closeViewProviderByViewId } = require('./webview');
	closeViewProviderByViewId(viewId);
}
module.exports = {
	initCommand
}