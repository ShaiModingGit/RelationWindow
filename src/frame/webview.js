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
    constructor(extensionContext) {
        this._extensionContext = extensionContext;
        this._view = null;
    }

    /**
     * Resolves the webview view
     * @param {vscode.WebviewView} webviewView
     * @param {vscode.WebviewViewResolveContext} _context
     * @param {vscode.CancellationToken} _token
     */
    resolveWebviewView(webviewView, _context, _token) {
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
    }

    /**
     * Update the view with new data
     * @param {string} title The title/function name
     * @param {object} treeData The tree data to display
     */
    async updateView(title, treeData) {
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
        this._view.description = `Call hierarchy for ${title}`;
        this._view.show(true);
        const mouseBehavior = getMouseBehavior();
        this._view.webview.postMessage({ command: 'receiveTreeData', treeData, mouseBehavior });
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
        }
    }

    async _handleUpdateAutoUpdateSetting(value) {
        const config = vscode.workspace.getConfiguration('crelation');
        await config.update('showRelationUserBehaviorSetteing', value, vscode.ConfigurationTarget.Global);
    }

    async _handleGetAutoUpdateSetting(webview) {
        const config = vscode.workspace.getConfiguration('crelation');
        const value = config.get('showRelationUserBehaviorSetteing');
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

    async _handleFetchChildNodes(message, webview) {
        const nodeName = message.nodeName;
        if (!message.functionCallerInfo.filePath) {
            vscode.window.showInformationMessage('No Call Hierarchy item: ' + nodeName);
            return;
        }
        
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
            
            for (const symbol of filtered_symbols) 
            {

                const doc = await vscode.workspace.openTextDocument(symbol.location.uri);           
                let extracte_name = doc.getText(symbol.location.range).trim();                

                let name = extracte_name;
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
        const incomingTree = await buildHierarchy(root, 'incoming', maxDepth, new Set([rootKey]));

        if (incomingTree.length == 0) {
            vscode.window.showInformationMessage('No Call Hierarchy item: ' + nodeName);
            statusbar.hideStatusbarItem();
            return;
        }

        let functionName = nodeName;
        let childNodes = {};
        childNodes[functionName] = { calledBy: [] };

        const excludeSuffixes = message.excludeSuffixes || '';

        for (const node of incomingTree) 
        {
            const doc = await vscode.workspace.openTextDocument(node.item.uri);            
            let extracte_name = doc.getText(node.item.selectionRange).trim();
            if(extracte_name.length==0)
                extracte_name = node.item.name;
            if (!node.ranges || node.ranges.length === 0) return '';

            const parts = node.ranges.map(r => `${r.start.line + 1}`);
            let lineNum = `${parts.join(', ')}`;
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

            childNodes[functionName].calledBy.push({
                caller: extracte_name,
                filePath: path,
                lineNumber: lineNum
            });
        }

        webview.postMessage({ command: 'receiveChildNodes', childNodes });
        statusbar.hideStatusbarItem();
    }

    async _handleNavigateToFunction(message) {
        const functionCallerInfo = message.functionCallerInfo;
        const rawPath = functionCallerInfo.filePath;
        const isDoubleClick = message.isDoubleClick || false;
               
        if (!rawPath || rawPath.length === 0) 
        {
            //probably this is the root elemet so no action needed
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

        let redirction_to = getOutputRedirectionTo().toString();

        const range = {
            start: { line: lineNumber, character: 1 },
            end: { line: lineNumber, character: 1 }
        };

        if (redirction_to == "contex_window_extension" && ! isDoubleClick) 
        {
            await vscode.commands.executeCommand('vscode-context-window.navigateUri', _fileUri.toString(), range);
        } 
        else 
        {
            try {
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
 * 创建调用关系的树形图
 * @param {vscode.ExtensionContext} context
 * @param {string} text 查询的函数名
 * @param {object} treeData 查询的函数掉用关系数据
 */
async function createWebview(context, text, treeData) {
    if (!viewProvider) {
        initWebviewProvider(context);
    }
    
    print('info', 'Updating webview view.');
    viewProvider.updateView(text, treeData);
}



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

module.exports = { createWebview, initWebviewProvider };
