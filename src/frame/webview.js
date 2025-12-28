const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const statusbar = require('../frame/statusbar');
const { print } = require('../frame/channel');

const {getOutputRedirectionTo, getMouseBehavior } = require('./setting');

let outputChannel = vscode.window.createOutputChannel('Call Hierarchy');

/**
 * WebviewViewProvider for the CRelations view
 */
class CRelationsViewProvider {
    constructor(extensionContext, isMainView = true) {
        this._extensionContext = extensionContext;
        this._view = null;
        this._isMainView = isMainView; // Track if this is the main view or a new tab
        this._currentRootSymbol = null; // Store the current root symbol name
        this._currentRootUri = null; // Store the current root symbol URI
        this._currentRootPosition = null; // Store the current root symbol position
        this._currentMode = null; // Store the current mode ('hierarchy' or 'references')
        this._isProcessing = false; // Track if currently processing a child node request
    }

    /**
     * Resolves the webview view
     * @param {vscode.WebviewView} webviewView
     */
    resolveWebviewView(webviewView/*, _context, _token*/) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(this._extensionContext.extensionPath, 'src', 'view'))]
        };

        webviewView.webview.html = this._getHtmlContent(webviewView.webview);

        // Set up message listener
        webviewView.webview.onDidReceiveMessage(
            async message => {
                await this._handleMessage(message, webviewView.webview);
            },
            undefined,
            this._extensionContext.subscriptions
        );
        
        // Send the isMainView flag to the webview after a short delay to ensure it's ready
        setTimeout(() => {
            if (webviewView.webview) {
                webviewView.webview.postMessage({ 
                    command: 'setViewType', 
                    isMainView: this._isMainView 
                });
            }
        }, 100);
    }

    /**
     * Update the view with new data
     * @param {string} title The title/function name
     * @param {object} treeData The tree data to display
     * @param {boolean} forceReveal Whether to force the panel to show and take focus
     * @param {string} mode The mode of operation ('hierarchy' or 'references')
     * @param {vscode.Uri} rootUri The URI of the root symbol (optional)
     * @param {vscode.Position} rootPosition The position of the root symbol (optional)
     * @param {boolean} isVariable Whether the root symbol is a variable (optional)
     */
    async updateView(title, treeData, forceReveal = true, mode = 'hierarchy', rootUri = null, rootPosition = null, isVariable = null) {
        // Store root symbol info for this tab
        this._currentRootSymbol = title;
        this._currentRootUri = rootUri;
        this._currentRootPosition = rootPosition;
        this._currentMode = mode;
        const viewWasNull = !this._view;
        
        if (!this._view) {
            // Automatically reveal the view to trigger resolveWebviewView
            await vscode.commands.executeCommand('crelation.relationsView.focus');
            
            // Wait a short moment for the view to be resolved
            await new Promise(resolve => setTimeout(resolve, 300));
            
            if (!this._view) {
                vscode.window.showErrorMessage('Failed to open Relations view. Please try again.');
                return;
            }
        }
        
        // Set both title and description to ensure visibility
        this._view.title = title;
        if (mode === 'references') {
            this._view.description = `All References for ${title}`;
        } else {
            this._view.description = `Call hierarchy for ${title}`;
        }
        
        // Show and take focus if:
        // 1. This is the first time opening the view, OR
        // 2. forceReveal is explicitly true (user-initiated command)
        if (viewWasNull || forceReveal) {
            this._view.show(true);
        }
        
        const mouseBehavior = getMouseBehavior();
        const config = vscode.workspace.getConfiguration('crelation');
        const hierarchyDirection = config.get('hierarchyDirection', 'calledFrom');
        const rootNodeIsVariable = isVariable !== null ? isVariable : (mode === 'references');
        this._view.webview.postMessage({ command: 'receiveTreeData', treeData, mouseBehavior, hierarchyDirection, rootNodeIsVariable });
    }

    /**
     * Get the HTML content for the webview
     * @param {vscode.Webview} webview
     */
    _getHtmlContent(webview) {
        const htmlPath = path.join(this._extensionContext.extensionPath, 'src', 'view', 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        return this._convertLocalPathsToWebviewUri(webview, htmlContent, this._extensionContext.extensionPath);
    }

    /**
     * Convert local paths to webview URIs
     * @param {vscode.Webview} webview
     * @param {string} htmlContent
     * @param {string} extensionPath
     */
    _convertLocalPathsToWebviewUri(webview, htmlContent, extensionPath) {
        const regex = /(<img src="|<script src="|<link href=")(.+?)"/g;
        return htmlContent.replace(regex, (match, prefix, url) => {
            if (!url.startsWith('http') && !url.startsWith('data:')) {
                const absolutePath = path.join(extensionPath, url);
                const webviewUri = webview.asWebviewUri(vscode.Uri.file(absolutePath));
                return prefix + webviewUri + '"';
            }
            return match;
        });
    }

    /**
     * Handle messages from the webview
     * @param {any} message
     * @param {vscode.Webview} webview
     */
    async _handleMessage(message, webview) {
        switch (message.command) {
            case 'fetchChildNodes':
                await this._handleFetchChildNodes(message, webview);
                break;
            case 'sendFunctionCallerInfo':
                await this._handleNavigateToFunction(message);
                break;
            case 'updateAutoUpdateSetting':
                await this._handleUpdateAutoUpdateSetting(message.value);
                break;
            case 'getAutoUpdateSetting':
                await this._handleGetAutoUpdateSetting(webview);
                break;
            case 'updateExcludeSuffixes':
                await this._handleUpdateExcludeSuffixes(message.value);
                break;
            case 'getExcludeSuffixes':
                await this._handleGetExcludeSuffixes(webview);
                break;
            case 'updateHierarchyDirection':
                await this._handleUpdateHierarchyDirection(message.value, message.rootNodeIsVariable);
                break;
            case 'getHierarchyDirection':
                await this._handleGetHierarchyDirection(webview);
                break;
            case 'refreshGraph':
                await this._handleRefreshGraph();
                break;
            case 'openNewRelationTab':
                await this._handleOpenNewRelationTab();
                break;
        }
    }

    async _handleUpdateAutoUpdateSetting(value) {
        const config = vscode.workspace.getConfiguration('crelation');
        await config.update('showRelationUserBehaviorSetting', value, vscode.ConfigurationTarget.Global);
    }

    async _handleGetAutoUpdateSetting(webview) {
        const config = vscode.workspace.getConfiguration('crelation');
        const value = config.get('showRelationUserBehaviorSetting');
        webview.postMessage({ command: 'autoUpdateSettingValue', value: value });
    }

    async _handleUpdateExcludeSuffixes(value) {
        const config = vscode.workspace.getConfiguration('crelation');
        await config.update('excludeFileSuffixes', value, vscode.ConfigurationTarget.Global);
    }

    async _handleGetExcludeSuffixes(webview) {
        const config = vscode.workspace.getConfiguration('crelation');
        const value = config.get('excludeFileSuffixes', '');
        webview.postMessage({ command: 'excludeSuffixesValue', value: value });
    }

    async _handleUpdateHierarchyDirection(value, rootNodeIsVariable) {
        // Check if current root is a variable and trying to change to non-findAllRef option
        // Use both the passed metadata and internal state for validation
        const isVariable = rootNodeIsVariable !== undefined ? rootNodeIsVariable : (this._currentMode === 'references');
        
        if (isVariable && value !== 'findAllRef') {
            vscode.window.showInformationMessage('Selected option is not supported for variable symbols');
            // Revert dropdown to findAllRef
            if (this._view && this._view.webview) {
                this._view.webview.postMessage({ command: 'hierarchyDirectionValue', value: 'findAllRef' });
                this._view.webview.postMessage({ command: 'refreshCompleted' });
            }
            return;
        }
        
        const config = vscode.workspace.getConfiguration('crelation');
        await config.update('hierarchyDirection', value, vscode.ConfigurationTarget.Global);
        
        // Trigger a refresh after changing the direction
        // Use stored root symbol if available, otherwise fall back to cursor position
        if (this._currentRootUri && this._currentRootPosition && this._currentRootSymbol) {
            // Refresh using the stored root symbol for this tab
            const { showRelationsForViewWithSymbol } = require('../core/api');
            await showRelationsForViewWithSymbol(
                this._extensionContext, 
                this, 
                this._currentRootSymbol,
                this._currentRootUri,
                this._currentRootPosition,
                false
            );
        } else {
            // Fall back to current cursor position
            await this._handleRefreshGraph();
        }
    }

    async _handleGetHierarchyDirection(webview) {
        const config = vscode.workspace.getConfiguration('crelation');
        const value = config.get('hierarchyDirection', 'calledFrom');
        webview.postMessage({ command: 'hierarchyDirectionValue', value: value });
    }

    async _handleRefreshGraph() {
        // Get the current active text editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            notifyProcessingCompleted();
            return;
        }

        // Import showRelationsForView dynamically to avoid circular dependencies
        const { showRelationsForView } = require('../core/api');
        
        try {
            // Call showRelationsForView to update only this specific view
            await showRelationsForView(this._extensionContext, this, false);
        } finally {
            notifyProcessingCompleted();
        }
    }

    async _handleOpenNewRelationTab() {
        // Execute the command to open a new relation window
        await vscode.commands.executeCommand('crelation.openNewRelationWindow');
    }

    async _handleFetchChildNodes(message, webview) {
        // Check if already processing
        if (this._isProcessing) {
            vscode.window.showInformationMessage('Extension is busy. Please wait until processing is done to try again.');
            return;
        }
        
        const nodeName = message.nodeName;
        if (!message.functionCallerInfo.filePath) {
            vscode.window.showInformationMessage('No Call Hierarchy item: ' + nodeName);
            return;
        }
        
        // Set processing flag
        this._isProcessing = true;
        
        try {
            // Create proper URI for WSL or local files
            const rawPath = message.functionCallerInfo.filePath;
            let _fileUri;
            if (rawPath.startsWith("vscode-remote:"))
            {
                _fileUri = rawPath;
            }
            else
            {
                // Windows path or UNC path
                _fileUri = vscode.Uri.file(rawPath);
            }
        
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(_fileUri));

        const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', nodeName);
        if (!Array.isArray(symbols) || symbols.length === 0) {
            return;
        }

        statusbar.showStatusbarItem();
        statusbar.setStatusbarText('Scanning...', true);

        let x = symbols.length;
        let position;
        let exact_match_symbols = [];

        if (x > 1) 
        {
            //need to locate the one that has the same file path implemented this as a for loop to avoid issues with special characters
            let filtered_symbols = [];
            for (const symbol of symbols) {
                if (symbol.location.uri.fsPath === vscode.Uri.parse(_fileUri).fsPath) {
                    filtered_symbols.push(symbol);
                }
            }
            

            //filter again match the exact node name but do it in a for loop to avoid issues with special characters        
            
            const docCache = new Map();
            for (const symbol of filtered_symbols) 
            {
                let doc;
                const uriStr = symbol.location.uri.toString();
                if (docCache.has(uriStr)) {
                    doc = docCache.get(uriStr);
                } else {
                    doc = await vscode.workspace.openTextDocument(symbol.location.uri);
                    docCache.set(uriStr, doc);
                }
                let extracted_name = doc.getText(symbol.location.range).trim();                

                let name = extracted_name;
                if (name == message.nodeName) {
                    exact_match_symbols.push(symbol);
                }
            }
            if (exact_match_symbols.length>0)
                position = exact_match_symbols[0].location.range.start;
            
        }
        else
        {
            position = symbols[0].location.range.start;
        }

        const items = await vscode.commands.executeCommand(
            'vscode.prepareCallHierarchy',
            document.uri,
            position
        );

        const root = items?.[0];
        if (!root) {
            vscode.window.showInformationMessage('No Call Hierarchy item at the cursor.');
            statusbar.hideStatusbarItem();
            return;
        }

        const maxDepth = 1;
        const rootKey = keyOf(root);
        
        // Get hierarchy direction from configuration
        const config = vscode.workspace.getConfiguration('crelation');
        const hierarchyDirection = String(config.get('hierarchyDirection', 'calledFrom'));
        const direction = hierarchyDirection === 'callingTo' ? 'outgoing' : 'incoming';
        
        const incomingTree = await buildHierarchy(root, direction, maxDepth, new Set([rootKey]));

        if (incomingTree.length == 0) {
            vscode.window.showInformationMessage('No Call Hierarchy item: ' + nodeName);
            statusbar.hideStatusbarItem();
            return;
        }

        let functionName = nodeName;
        let childNodes = {};
        childNodes[functionName] = { calledBy: [] };

        const excludeSuffixes = message.excludeSuffixes || '';

        // Track seen function names for deduplication (for outgoing/call-to direction)
        const seenFunctions = new Set();
        const docCache = new Map();

        for (const node of incomingTree) 
        {
            let doc;
            const uriStr = node.item.uri.toString();
            if (docCache.has(uriStr)) {
                doc = docCache.get(uriStr);
            } else {
                doc = await vscode.workspace.openTextDocument(node.item.uri);
                docCache.set(uriStr, doc);
            }            
            let extracted_name = doc.getText(node.item.selectionRange).trim();
            if(extracted_name.length==0)
                extracted_name = node.item.name;
            
            let lineNum;
            // Use the URI's path directly - it's already in the correct format
            let path="";

            if (vscode.env.remoteName == 'wsl')
            {
                let distro = process.env.WSL_DISTRO_NAME;
                path = "vscode-remote://wsl+" + distro + node.item.uri.path;
            }
            else
            {
                // Use the URI's path directly - it's already in the correct format
                path = node.item.uri.path;
            }

            // Check if this file should be excluded
            if (shouldExcludeFile(path, excludeSuffixes)) {
                continue; // Skip this node
            }

            // For outgoing/call-to direction: deduplicate by name and use definition location
            if (direction === 'outgoing') {
                // Skip duplicates
                if (seenFunctions.has(extracted_name)) {
                    continue;
                }
                seenFunctions.add(extracted_name);
                
                // Use definition location instead of call sites
                lineNum = `${node.item.range.start.line + 1}`;
            } else {
                // For incoming direction: keep existing behavior (call sites)
                if (!node.ranges || node.ranges.length === 0) return '';
                const parts = node.ranges.map(r => `${r.start.line + 1}`);
                lineNum = `${parts.join(', ')}`;
            }

            childNodes[functionName].calledBy.push({
                caller: extracted_name,
                filePath: path,
                lineNumber: lineNum
            });
        }

            webview.postMessage({ command: 'receiveChildNodes', childNodes });
            statusbar.hideStatusbarItem();
        } catch (error) {
            vscode.window.showErrorMessage(`Error fetching child nodes: ${error.message}`);
            statusbar.hideStatusbarItem();
        } finally {
            // Clear processing flag
            this._isProcessing = false;
        }
    }

    async _handleNavigateToFunction(message) {
        const functionCallerInfo = message.functionCallerInfo;
        const rawPath = functionCallerInfo.filePath;
        const isDoubleClick = message.isDoubleClick || false;
               
        if (!rawPath || rawPath.length === 0) 
        {
            //probably this is the root element so no action needed
            return;
        }
        const lineNumber = parseInt(functionCallerInfo.lineNumber, 10);

        // Detect if we're in a WSL environment
        let _fileUri;
        if (rawPath.startsWith("vscode-remote:"))
        {
            _fileUri = rawPath;
        }
        else
        {
            // Windows path or UNC path
            _fileUri = vscode.Uri.file(rawPath);
        }

        let redirection_to = getOutputRedirectionTo().toString();

        const range = {
            start: { line: lineNumber, character: 1 },
            end: { line: lineNumber, character: 1 }
        };

        if (redirection_to == "context_window_extension" && ! isDoubleClick) 
        {
            await vscode.commands.executeCommand('vscode-context-window.navigateUri', _fileUri.toString(), range);
        } 
        else 
        {
            try 
            {
                //no need in the prefix when working with the main tab editors.
               if(_fileUri.toString().startsWith("vscode-remote:"))
               {
                    _fileUri = _fileUri.toString();
                    let pre = _fileUri.replace("vscode-remote://wsl+", "");
                    let index = pre.indexOf("/");
                    _fileUri = pre.substring(index);  
                    _fileUri = vscode.Uri.parse(_fileUri);              
               }
                const doc = await vscode.workspace.openTextDocument(_fileUri);
                const editor = await vscode.window.showTextDocument(doc, {
                    viewColumn: vscode.ViewColumn.One,
                    selection: new vscode.Range(
                        new vscode.Position(lineNumber - 1, 0),
                        new vscode.Position(lineNumber - 1, 0)
                    )
                });
                editor.revealRange(editor.selection);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
            }
        }
    }
}

/**
 * Check if a file path should be excluded based on the exclude suffixes
 * @param {string} filePath - The file path to check
 * @param {string} excludeSuffixesStr - Comma-separated list of suffixes (e.g., ".i, .c, .exe")
 * @returns {boolean} - True if the file should be excluded, false otherwise
 */
function shouldExcludeFile(filePath, excludeSuffixesStr) {
    if (!excludeSuffixesStr || excludeSuffixesStr.trim() === '') {
        return false; // No filter, don't exclude anything
    }
    
    // Parse the suffixes from the string
    const suffixes = excludeSuffixesStr
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    
    if (suffixes.length === 0) {
        return false;
    }
    
    // Extract filename from path (handle both Windows and Unix separators)
    const fileName = filePath.replace(/\\/g, '/').split('/').pop();
    
    // Check if any suffix matches
    for (const suffix of suffixes) {
        if (fileName.endsWith(suffix)) {
            return true;
        }
    }
    
    return false;
}

// Global provider instance
let viewProvider = null;

// Track all view providers
const allViewProviders = new Map();
const viewIds = [
    'crelation.relationsView2',
    'crelation.relationsView3',
    'crelation.relationsView4',
    'crelation.relationsView5'
];
let nextViewIndex = 0;
const usedViewIndices = new Set(); // Track which indices are currently in use

/**
 * Close and dispose a view provider
 * @param {CRelationsViewProvider} provider - The provider to close
 */
function closeViewProvider(provider) {
    // Find the viewId for this provider
    let viewIdToClose = null;
    let viewIndexToFree = null;
    
    for (const [viewId, providerInstance] of allViewProviders) {
        if (providerInstance === provider) {
            viewIdToClose = viewId;
            // Extract the index from viewId (e.g., 'crelation.relationsView2' -> 0)
            const match = viewId.match(/relationsView(\d+)/);
            if (match) {
                viewIndexToFree = parseInt(match[1]) - 2; // Convert to 0-based index
            }
            break;
        }
    }
    
    if (viewIdToClose) {
        // Remove from the map
        allViewProviders.delete(viewIdToClose);
        
        // Free up the index for reuse
        if (viewIndexToFree !== null) {
            usedViewIndices.delete(viewIndexToFree);
            // If this was the highest index, reduce nextViewIndex
            if (viewIndexToFree === nextViewIndex - 1) {
                nextViewIndex--;
                // Continue reducing if lower indices are also free
                while (nextViewIndex > 0 && !usedViewIndices.has(nextViewIndex - 1)) {
                    nextViewIndex--;
                }
            }
        }
        
        // Clear the provider's data
        provider._currentRootSymbol = null;
        provider._currentRootUri = null;
        provider._currentRootPosition = null;
        provider._currentMode = null;
        provider._view = null;
        
        // Hide the view by setting context key to false
        const contextKey = `crelation.view${viewIndexToFree + 2}Visible`;
        vscode.commands.executeCommand('setContext', contextKey, false);
    }
}

/**
 * Close and dispose a view provider by view ID
 * @param {string} viewId - The view ID to close
 */
function closeViewProviderByViewId(viewId) {
    const provider = allViewProviders.get(viewId);
    if (provider) {
        closeViewProvider(provider);
    }
}

/**
 * Check if the relations view is currently visible
 * @returns {boolean} True if the view is visible, false otherwise
 */
function isViewVisible() {
    return viewProvider && viewProvider._view && viewProvider._view.visible;
}

/**
 * Initialize the webview view provider
 * @param {vscode.ExtensionContext} context
 */
function initWebviewProvider(context) {
    viewProvider = new CRelationsViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('crelation.relationsView', viewProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        })
    );
}

/**
 * Send processing started message to all views to disable controls
 */
function notifyProcessingStarted() {
    if (viewProvider && viewProvider._view && viewProvider._view.webview) {
        viewProvider._view.webview.postMessage({ command: 'processingStarted' });
    }
    for (const provider of allViewProviders.values()) {
        if (provider && provider._view && provider._view.webview) {
            provider._view.webview.postMessage({ command: 'processingStarted' });
        }
    }
}

/**
 * Send processing completed message to all views to enable controls
 */
function notifyProcessingCompleted() {
    if (viewProvider && viewProvider._view && viewProvider._view.webview) {
        viewProvider._view.webview.postMessage({ command: 'refreshCompleted' });
    }
    for (const provider of allViewProviders.values()) {
        if (provider && provider._view && provider._view.webview) {
            provider._view.webview.postMessage({ command: 'refreshCompleted' });
        }
    }
}

/**
 * 创建调用关系的树形图
 * @param {vscode.ExtensionContext} context
 * @param {string} text 查询的函数名
 * @param {object} treeData 查询的函数掉用关系数据
 * @param {boolean} forceReveal Whether to force the panel to show and take focus (default: true)
 * @param {string} mode The mode of operation ('hierarchy' or 'references')
 * @param {boolean} isVariable Whether the root symbol is a variable (default: false)
 */
async function createWebview(context, text, treeData, forceReveal = true, mode = 'hierarchy', isVariable = false) {
    if (!viewProvider) {
        initWebviewProvider(context);
    }
    
    print('info', 'Updating webview view.');
    viewProvider.updateView(text, treeData, forceReveal, mode, null, null, isVariable);
    
    // DO NOT automatically update new tabs - they should only update on explicit refresh
    // The new tabs maintain their own state independently
}


/* eslint-disable no-unused-vars */
// Legacy utility functions kept for potential future use
async function readLinesFromUri(uri, startLine, endLineInclusive) {
  const document = await vscode.workspace.openTextDocument(uri);

  const start = Math.max(0, startLine);
  const end = Math.min(document.lineCount - 1, endLineInclusive);

  const startPos = new vscode.Position(start, 0);
  const endPos = document.lineAt(end).range.end;
  const range = new vscode.Range(startPos, endPos);

  return document.getText(range);
}

async function getSymbolDefinition(filePath, lineNumber, characterIndex) {
    try {
        // Create proper URI for WSL or local files
        let fileUri;

        if (filePath.startsWith("vscode-remote:"))
        {
            fileUri = filePath;
        }
        else
        {
            // Windows path or UNC path
            fileUri = vscode.Uri.file(filePath);
        }        
        
        const document = await vscode.workspace.openTextDocument(fileUri);

        // Create position for the symbol
        const position = new vscode.Position(lineNumber - 1, characterIndex);

        // Ask language server for definition
        const locations = await vscode.commands.executeCommand(
            'vscode.executeDefinitionProvider',
            document.uri,
            position
        );

        if (!Array(locations) || Array(locations).length === 0) {
            vscode.window.showInformationMessage('No definition found for symbol.');
            return null;
        }

        // Each location has uri and range
        const def = locations[0];
        console.log(`Definition URI: ${def.uri.fsPath}`);
        console.log(`Definition Range: Line ${def.range.start.line + 1}, Char ${def.range.start.character}`);

        return def;
    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
        return null;
    }
}

async function buildHierarchy(root, direction, maxDepth, seen) {
    return await collectChildren(root, direction, maxDepth, seen);
}

async function collectChildren(item, direction, remainingDepth, seen) {
    if (remainingDepth <= 0) return [];
    const nodes = [];

    if (direction === 'outgoing') {
        const outgoing = await vscode.commands.executeCommand('vscode.provideOutgoingCalls', item);
        if (!Array.isArray(outgoing) || outgoing.length === 0) return nodes;
        for (const call of outgoing) {
            const childItem = call.to;
            const childKey = keyOf(childItem);
            if (seen.has(childKey)) {
                nodes.push({ item: childItem, ranges: call.fromRanges, children: [] });
                continue;
            }
            const nextSeen = new Set(seen);
            nextSeen.add(childKey);
            const children = await collectChildren(childItem, direction, remainingDepth - 1, nextSeen);
            nodes.push({ item: childItem, ranges: call.fromRanges, children });
        }
    } else {
        const incoming = await vscode.commands.executeCommand('vscode.provideIncomingCalls', item);
        if (!Array.isArray(incoming) || incoming.length === 0) return nodes;
        for (const call of incoming) {
            const childItem = call.from;
            const childKey = keyOf(childItem);
            if (seen.has(childKey)) {
                nodes.push({ item: childItem, ranges: call.fromRanges, children: [] });
                continue;
            }
            const nextSeen = new Set(seen);
            nextSeen.add(childKey);
            const children = await collectChildren(childItem, direction, remainingDepth - 1, nextSeen);
            nodes.push({ item: childItem, ranges: call.fromRanges, children });
        }
    }
    return nodes;
}

function printShaiMsg(msg)
{
     outputChannel.appendLine(msg);
}
function printHierarchy(nodes, depth) {
    const indent = ' '.repeat(depth);
    if (!nodes || nodes.length === 0) {
        outputChannel.appendLine(`${indent}- (none)`);
        return;
    }
    for (const node of nodes) {
        outputChannel.appendLine(`${indent}- ${labelOf(node.item)} ${rangesText(node.ranges)}`);
        if (node.children.length > 0) {
            printHierarchy(node.children, depth + 1);
        }
    }
}

function buildJsonFromHierarchy(nodes, direction) {
    const result = [];
    for (const node of nodes) {
        const entry = {
            [direction === 'incoming' ? 'caller' : 'callee']: cleanName(node.item.name),
            filePath: node.item.uri.fsPath,
            lineNumber: node.item.range.start.line + 1
        };
        if (node.children.length > 0) {
            entry[direction === 'incoming' ? 'calledBy' : 'callsTo'] = buildJsonFromHierarchy(node.children, direction);
        }
        result.push(entry);
    }
    return result;
}

function cleanName(name) {
    return name.split('(')[0].trim();
}

function labelOf(item) {
    const file = item.uri.path.split('/').pop();
    const line = item.range.start.line + 1;
    return `${item.name} (${file}:${line})`;
}

function rangesText(ranges) {
    if (!ranges || ranges.length === 0) return '';
    const parts = ranges.map(r => `L${r.start.line + 1}`);
    return `[at ${parts.join(', ')}]`;
}


function keyOf(item) {
    const p = item.uri.fsPath || item.uri.toString();
    const l = item.range.start.line;
    return `${p}:${item.name}:${l}`;
}

/**
 * Create/activate a new webview view tab
 * @param {vscode.ExtensionContext} context
 */
async function createWebviewPanel(context) {
    // Check if we've reached the limit
    if (nextViewIndex >= viewIds.length) {
        vscode.window.showWarningMessage(`Maximum of ${viewIds.length + 1} relation windows reached.`);
        return;
    }
    
    const viewId = viewIds[nextViewIndex];
    const contextKey = `crelation.view${nextViewIndex + 2}Visible`;
    usedViewIndices.add(nextViewIndex); // Mark this index as used
    nextViewIndex++;
    
    // Set the context key to make the view visible
    await vscode.commands.executeCommand('setContext', contextKey, true);
    
    // Register the provider if not already registered
    if (!allViewProviders.has(viewId)) {
        const newProvider = new CRelationsViewProvider(context, false); // false = not main view
        allViewProviders.set(viewId, newProvider);
        
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(viewId, newProvider, {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            })
        );
    }
    
    // Wait for view to register and become visible
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Focus the view
    await vscode.commands.executeCommand(`${viewId}.focus`);
    
    // The new tab is now created and visible, but empty
    // User can click refresh button to populate it with data
}

/**
 * Convert local paths to webview URIs (standalone function for panel use)
 * @param {vscode.Webview} webview
 * @param {string} htmlContent
 * @param {string} extensionPath
 */
function convertLocalPathsToWebviewUri(webview, htmlContent, extensionPath) {
    const regex = /(<img src="|<script src="|<link href=")(.+?)"/g;
    return htmlContent.replace(regex, (match, prefix, url) => {
        if (!url.startsWith('http') && !url.startsWith('data:')) {
            const absolutePath = path.join(extensionPath, url);
            const webviewUri = webview.asWebviewUri(vscode.Uri.file(absolutePath));
            return prefix + webviewUri + '"';
        }
        return match;
    });
}

/**
 * Check if the given symbol is currently displayed in the main view or any other view
 * @param {string} symbolName 
 * @param {vscode.Uri} uri 
 * @returns {boolean}
 */
function isCurrentSymbol(symbolName, uri) {
    // Helper to check a single provider
    const checkProvider = (provider) => {
        if (!provider) return false;
        if (provider._currentRootSymbol !== symbolName) return false;
        
        if (provider._currentRootUri && uri) {
            return provider._currentRootUri.toString() === uri.toString();
        }
        return true;
    };

    // Check main view
    if (checkProvider(viewProvider)) return true;
    
    // Check other views
    for (const provider of allViewProviders.values()) {
        if (checkProvider(provider)) return true;
    }
    
    return false;
}

module.exports = { createWebview, initWebviewProvider, isViewVisible, createWebviewPanel, closeViewProvider, closeViewProviderByViewId, isCurrentSymbol, notifyProcessingStarted, notifyProcessingCompleted };
