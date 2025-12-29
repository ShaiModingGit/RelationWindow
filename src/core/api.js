const vscode = require('vscode');
const statusbar = require('../frame/statusbar');
const { createWebview } = require('../frame/webview');


let langType ="";
let processingSymbol = null;

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



function GetCurrentLang()
{
    return langType;
}

/**
 * Determine if the symbol at the given position is a function/method/constructor
 * @param {vscode.Uri} uri 
 * @param {vscode.Position} position 
 * @returns {Promise<boolean>}
 */
const FUNCTION_KINDS = new Set([
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Constructor
]);

function kindName(kind) {
    return Object.entries(vscode.SymbolKind).find(([, v]) => v === kind)?.[0] || 'unknown';
}

async function isSymbolFunction(uri, position) {
    let result = true;
    let defCount = 0;
    let token = '';
    let deepestKind = 'unknown';

    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const wordRange = doc.getWordRangeAtPosition(position);
        token = wordRange ? doc.getText(wordRange) : '';

        // Skip running references on language keywords/operators by treating them as functions
        const keywordSet = new Set([
            'if','else','for','while','switch','case','break','continue','return','goto','struct','class','enum','typedef','namespace','template','public','private','protected','static','const','volatile','inline','using','try','catch','throw','new','delete','sizeof','this','virtual','override','final','import','package','interface','do','default','finally','with','yield','await','async'
        ]);
        if (keywordSet.has(token)) {
            return true;
        }

        const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position);
        defCount = Array.isArray(definitions) ? definitions.length : 0;
        
        // If no definition found, treat as non-function so we run references
        if (!definitions || definitions.length === 0) {
            result = false;
        } else {
            const def = definitions[0];
            // Handle Location vs LocationLink
            const defUri = def.targetUri || def.uri;
            // Use the selection range (the name) for comparison if available, otherwise range
            const defSelectionRange = def.targetSelectionRange || def.range; 

            const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', defUri);
            if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
                result = false;
            } else {
                /** @type {vscode.DocumentSymbol|null} */
                let deepest = null;
                
                // Helper to find deepest symbol containing the definition
                const findDeepest = (nodes) => {
                    for (const node of nodes) {
                        // Check if node range contains the definition start
                        if (node.range.contains(defSelectionRange.start)) {
                            deepest = node;
                            if (node.children && node.children.length > 0) {
                                findDeepest(node.children);
                            }
                            break; 
                        }
                    }
                };
                
                findDeepest(symbols);

                if (!deepest) {
                    result = false; 
                } else {
                    deepestKind = kindName(deepest.kind);
                    // If the definition range is inside a function symbol but not the function name itself, treat as non-function (likely a variable/member)
                    if (deepest.selectionRange && !deepest.selectionRange.isEqual(defSelectionRange)) {
                        result = false;
                    } else {
                        result = FUNCTION_KINDS.has(deepest.kind);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error in isSymbolFunction:", e);
        result = false; // Fallback to references on errors
    }

    return result;
}

/**
 * 显示函数关系图
 * @param {vscode.ExtensionContext} context
 * @param {boolean} forceReveal Whether to force the panel to show and take focus (default: true)
 */
async function showRelations(context, forceReveal = true) 
{
    statusbar.showStatusbarItem();
    statusbar.setStatusbarText('Scanning...', true);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        statusbar.hideStatusbarItem();
        return;
    }

    const { document, selection } = editor;

    let symbolName=null;

    // If the user has a selection, use that.
    if (!selection.isEmpty) {
      symbolName = document.getText(selection).trim();
    } else {
      // Otherwise, get the word at the cursor position.
      const cursorPos = selection.active;
      const wordRange = document.getWordRangeAtPosition(cursorPos);
      if (wordRange) {
        symbolName = document.getText(wordRange);
      }
    }

    if (!symbolName || symbolName.length === 0) {
      //vscode.window.showInformationMessage('No symbol found at the current position.');
      statusbar.hideStatusbarItem();
      return;
    }

    //vscode.window.showInformationMessage(`Need to work on symbol name: "${symbolName}"`);

    const position = editor.selection.active;
    const uri = editor.document.uri;

    if (processingSymbol) {
        vscode.window.showInformationMessage("Relation extension is Busy. \nPlease wait for previous processing to end.");
        statusbar.hideStatusbarItem();
        return;
    }
    const { isCurrentSymbol } = require('../frame/webview');
    if (isCurrentSymbol(symbolName, uri)) {
        statusbar.hideStatusbarItem();
        return;
    }
    
    processingSymbol = { name: symbolName, uri: uri };

    const { notifyProcessingStarted } = require('../frame/webview');
    notifyProcessingStarted();

    try {
    // Determine if the symbol is a function or variable
    const isFunc = await isSymbolFunction(uri, position);
    const config = vscode.workspace.getConfiguration('crelation');
    const hierarchyDirection = String(config.get('hierarchyDirection', 'calledFrom'));

    if (!isFunc || hierarchyDirection === 'findAllRef') {
        statusbar.setStatusbarText('Finding references...', true);
        const references = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position);
        
        if (!references || !Array.isArray(references) || references.length === 0) {
             vscode.window.showInformationMessage('No references found for: ' + symbolName);
             statusbar.hideStatusbarItem();
             return;
        }

        let rootFilePath = "";
        let rootLineNumber = "";
        if (uri) {
            if (vscode.env.remoteName == 'wsl') {
                let distro = process.env.WSL_DISTRO_NAME;
                rootFilePath = "vscode-remote://wsl+" + distro + uri.path;
            } else {
                rootFilePath = uri.path;
            }
            rootLineNumber = `${position.line + 1}`;
        }

        let obj = {
            [symbolName]: { calledBy: [], filePath: rootFilePath, lineNumber: rootLineNumber }
        };
        
        const excludeSuffixes = config.get('excludeFileSuffixes', '');

        for (const ref of references) {
             let path = "";
             if (vscode.env.remoteName == 'wsl') {
                let distro = process.env.WSL_DISTRO_NAME;
                path = "vscode-remote://wsl+" + distro + ref.uri.path;
            } else {
                path = ref.uri.path;
            }

            if (shouldExcludeFile(path, excludeSuffixes)) {
                continue;
            }
            
            const fileName = path.split('/').pop();
            const lineNum = `${ref.range.start.line + 1}`;
            
            obj[symbolName].calledBy.push({
                caller: fileName, 
                filePath: path,
                lineNumber: lineNum
            });
        }
        
        createWebview(context, symbolName, obj, forceReveal, 'references', !isFunc);
        statusbar.hideStatusbarItem();
        return;
    }

    const items = await vscode.commands.executeCommand(
        'vscode.prepareCallHierarchy',
        uri,
        position
    );   
    
    const root = items?.[0];
    if (!root) {
        //vscode.window.showInformationMessage('No Call Hierarchy item at the cursor.');
        statusbar.hideStatusbarItem();
        return;
    }    

    const maxDepth = 1;
    const rootKey = keyOf(root);
    
    // Get hierarchy direction and exclude suffixes from configuration
    const direction = hierarchyDirection === 'callingTo' ? 'outgoing' : 'incoming';
    const excludeSuffixes = config.get('excludeFileSuffixes', '');
    
    const incomingTree = await buildHierarchy(root, direction, maxDepth, new Set([rootKey]));

    //outputChannel.clear();
    //outputChannel.show(true);
    //printHierarchy(incomingTree, 0);

    
    let functionName = symbolName;
    let allCalls = {}; // assume empty for now

    // Get root's file path and line number from the user's cursor position
    let rootFilePath = "";
    let rootLineNumber = "";
    
    if (uri) {
        if (vscode.env.remoteName == 'wsl') {
            let distro = process.env.WSL_DISTRO_NAME;
            rootFilePath = "vscode-remote://wsl+" + distro + uri.path;
        } else {
            rootFilePath = uri.path;
        }
        
        // Use the actual cursor position, not the definition
        rootLineNumber = `${position.line + 1}`;
    }

    let obj = {
        [functionName]: allCalls[functionName] || { calledBy: [], filePath: rootFilePath, lineNumber: rootLineNumber }
    };

    // Add a new function entry with root's location info
    obj[functionName] = { calledBy: [], filePath: rootFilePath, lineNumber: rootLineNumber };

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

        obj[functionName].calledBy.push({
            caller: extracted_name,
            filePath: path,
            lineNumber: lineNum,
        });
    }

    createWebview(context, symbolName, obj, forceReveal, 'hierarchy', false);
    statusbar.hideStatusbarItem();
    } finally {
        processingSymbol = null;
        const { notifyProcessingCompleted } = require('../frame/webview');
        notifyProcessingCompleted();
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

function keyOf(item) {
    const p = item.uri.fsPath || item.uri.toString();
    const l = item.range.start.line;
    return `${p}:${item.name}:${l}`;
}


/**
 * Open a new relation window in a new editor tab
 * @param {vscode.ExtensionContext} context
 */
async function openNewRelationWindow(context) {
    // Import createWebviewPanel dynamically
    const { createWebviewPanel } = require('../frame/webview');
    
    // Create a new webview panel in a new editor tab
    await createWebviewPanel(context);
}

/**
 * Show relations for a specific view provider (used for tab-specific refresh)
 * @param {vscode.ExtensionContext} context
 * @param {object} viewProvider - The specific view provider to update
 * @param {boolean} forceReveal - Whether to force the panel to show and take focus (default: true)
 */
async function showRelationsForView(context, viewProvider, forceReveal = true) {
    statusbar.showStatusbarItem();
    statusbar.setStatusbarText('Scanning...', true);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        statusbar.hideStatusbarItem();
        return;
    }

    const { document, selection } = editor;

    let symbolName = null;

    // If the user has a selection, use that.
    if (!selection.isEmpty) {
        symbolName = document.getText(selection).trim();
    } else {
        // Otherwise, get the word at the cursor position.
        const cursorPos = selection.active;
        const wordRange = document.getWordRangeAtPosition(cursorPos);
        if (wordRange) {
            symbolName = document.getText(wordRange);
        }
    }

    if (!symbolName || symbolName.length === 0) {
        statusbar.hideStatusbarItem();
        return;
    }

    const position = editor.selection.active;
    const uri = editor.document.uri;

    await showRelationsForViewWithSymbol(context, viewProvider, symbolName, uri, position, forceReveal);
}

/**
 * Show relations for a specific view provider using a specific symbol
 * @param {vscode.ExtensionContext} context
 * @param {object} viewProvider - The specific view provider to update
 * @param {string} symbolName - The symbol name to show relations for
 * @param {vscode.Uri} uri - The URI of the document containing the symbol
 * @param {vscode.Position} position - The position of the symbol
 * @param {boolean} forceReveal - Whether to force the panel to show and take focus (default: true)
 */
async function showRelationsForViewWithSymbol(context, viewProvider, symbolName, uri, position, forceReveal = true) {
    statusbar.showStatusbarItem();
    statusbar.setStatusbarText('Scanning...', true);

    if (processingSymbol) {
        vscode.window.showInformationMessage("Relation extension is Busy. \nPlease wait for previous processing to end.");
        statusbar.hideStatusbarItem();
        return;
    }

    processingSymbol = { name: symbolName, uri: uri };

    const { notifyProcessingStarted } = require('../frame/webview');
    notifyProcessingStarted();

    try {
    // Determine if the symbol is a function or variable
    const isFunc = await isSymbolFunction(uri, position);
    const config = vscode.workspace.getConfiguration('crelation');
    const hierarchyDirection = String(config.get('hierarchyDirection', 'calledFrom'));

    if (!isFunc || hierarchyDirection === 'findAllRef') {
        statusbar.setStatusbarText('Finding references...', true);
        const references = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position);
        
        if (!references || !Array.isArray(references) || references.length === 0) {
            vscode.window.showInformationMessage('No references found for: ' + symbolName);
            statusbar.hideStatusbarItem();
            return;
        }

        let rootFilePath = "";
        let rootLineNumber = "";
        if (uri) {
            if (vscode.env.remoteName == 'wsl') {
                let distro = process.env.WSL_DISTRO_NAME;
                rootFilePath = "vscode-remote://wsl+" + distro + uri.path;
            } else {
                rootFilePath = uri.path;
            }
            rootLineNumber = `${position.line + 1}`;
        }

        let obj = {
            [symbolName]: { calledBy: [], filePath: rootFilePath, lineNumber: rootLineNumber }
        };
        
        const excludeSuffixes = config.get('excludeFileSuffixes', '');

        for (const ref of references) {
            let path = "";
            if (vscode.env.remoteName == 'wsl') {
                let distro = process.env.WSL_DISTRO_NAME;
                path = "vscode-remote://wsl+" + distro + ref.uri.path;
            } else {
                path = ref.uri.path;
            }

            if (shouldExcludeFile(path, excludeSuffixes)) {
                continue;
            }
            
            const fileName = path.split('/').pop();
            const lineNum = `${ref.range.start.line + 1}`;
            
            obj[symbolName].calledBy.push({
                caller: fileName, 
                filePath: path,
                lineNumber: lineNum
            });
        }
        
        // Update only the specific view provider
        await viewProvider.updateView(symbolName, obj, forceReveal, 'references', uri, position, !isFunc);
        statusbar.hideStatusbarItem();
        return;
    }

    const items = await vscode.commands.executeCommand(
        'vscode.prepareCallHierarchy',
        uri,
        position
    );   
    
    const root = items?.[0];
    if (!root) {
        statusbar.hideStatusbarItem();
        return;
    }    

    const maxDepth = 1;
    const rootKey = keyOf(root);
    
    // Get hierarchy direction and exclude suffixes from configuration
    const direction = hierarchyDirection === 'callingTo' ? 'outgoing' : 'incoming';
    const excludeSuffixes = config.get('excludeFileSuffixes', '');
    
    const incomingTree = await buildHierarchy(root, direction, maxDepth, new Set([rootKey]));

    let functionName = symbolName;
    let allCalls = {};

    // Get root's file path and line number from the user's cursor position
    let rootFilePath = "";
    let rootLineNumber = "";
    
    if (uri) {
        if (vscode.env.remoteName == 'wsl') {
            let distro = process.env.WSL_DISTRO_NAME;
            rootFilePath = "vscode-remote://wsl+" + distro + uri.path;
        } else {
            rootFilePath = uri.path;
        }
        
        rootLineNumber = `${position.line + 1}`;
    }

    let obj = {
        [functionName]: allCalls[functionName] || { calledBy: [], filePath: rootFilePath, lineNumber: rootLineNumber }
    };

    obj[functionName] = { calledBy: [], filePath: rootFilePath, lineNumber: rootLineNumber };

    const seenFunctions = new Set();
    const docCache = new Map();

    for (const node of incomingTree) {
        let doc;
        const uriStr = node.item.uri.toString();
        if (docCache.has(uriStr)) {
            doc = docCache.get(uriStr);
        } else {
            doc = await vscode.workspace.openTextDocument(node.item.uri);
            docCache.set(uriStr, doc);
        }
        
        let extracted_name = doc.getText(node.item.selectionRange).trim();
        if(extracted_name.length == 0)
            extracted_name = node.item.name;        
        
        let lineNum;
        let path = "";

        if (vscode.env.remoteName == 'wsl') {
            let distro = process.env.WSL_DISTRO_NAME;
            path = "vscode-remote://wsl+" + distro + node.item.uri.path;
        } else {
            path = node.item.uri.path;
        }

        if (shouldExcludeFile(path, excludeSuffixes)) {
            continue;
        }

        if (direction === 'outgoing') {
            if (seenFunctions.has(extracted_name)) {
                continue;
            }
            seenFunctions.add(extracted_name);
            lineNum = `${node.item.range.start.line + 1}`;
        } else {
            if (!node.ranges || node.ranges.length === 0) return '';
            const parts = node.ranges.map(r => `${r.start.line + 1}`);
            lineNum = `${parts.join(', ')}`;
        }

        obj[functionName].calledBy.push({
            caller: extracted_name,
            filePath: path,
            lineNumber: lineNum,
        });
    }

    // Update only the specific view provider, passing the root info
    await viewProvider.updateView(symbolName, obj, forceReveal, 'hierarchy', uri, position, false);
    statusbar.hideStatusbarItem();
    } finally {
        processingSymbol = null;
        const { notifyProcessingCompleted } = require('../frame/webview');
        notifyProcessingCompleted();
    }
}


module.exports = {
    showRelations,
    GetCurrentLang,
    openNewRelationWindow,
    showRelationsForView,
    showRelationsForViewWithSymbol
}
