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

function normalizePathFromUri(uri) {
    if (vscode.env.remoteName == 'wsl') {
        const distro = process.env.WSL_DISTRO_NAME;
        return "vscode-remote://wsl+" + distro + uri.path;
    }
    return uri.path;
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

function isFunctionKind(kind) {
    return FUNCTION_KINDS.has(kind);
}

async function getDocumentSymbolsWithCache(uri, cache) {
    const uriStr = uri.toString();
    if (cache.has(uriStr)) {
        return cache.get(uriStr);
    }
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri) || [];
    cache.set(uriStr, symbols);
    return symbols;
}

function findEnclosingSymbol(symbols, position) {
    let deepest = null;
    const search = (nodes) => {
        for (const node of nodes) {
            if (node.range.contains(position)) {
                deepest = node;
                if (node.children && node.children.length > 0) {
                    search(node.children);
                }
                break;
            }
        }
    };
    search(symbols);
    return deepest;
}

async function isSymbolFunction(uri, position) {
    let result = true;
    let hasDefinition = true;

    try {
        await vscode.workspace.openTextDocument(uri);

        const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position);
        const hasDefinitions = Array.isArray(definitions) && definitions.length > 0;
        if (!hasDefinitions) {
            result = false;
            hasDefinition = false;
            return { isFunc: result, hasDefinition };
        }

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
                // If the definition range is inside a function symbol but not the function name itself, treat as non-function (likely a variable/member)
                if (deepest.selectionRange && !deepest.selectionRange.isEqual(defSelectionRange)) {
                    result = false;
                } else {
                    result = FUNCTION_KINDS.has(deepest.kind);
                }
            }
        }
    } catch (e) {
        console.error("Error in isSymbolFunction:", e);
        result = false;
        hasDefinition = false; // Fallback to references on errors
    }

    return { isFunc: result, hasDefinition };
}

async function buildMixedReferenceTree(symbolName, references, rootUri, position, excludeSuffixes) {
    let rootFilePath = "";
    let rootLineNumber = "";

    if (rootUri) {
        rootFilePath = normalizePathFromUri(rootUri);
        rootLineNumber = `${position.line + 1}`;
    }

    const obj = {
        [symbolName]: { calledBy: [], filePath: rootFilePath, lineNumber: rootLineNumber }
    };

    const symbolCache = new Map();
    const docCache = new Map();
    const grouped = new Map();

    for (const ref of references) {
        const path = normalizePathFromUri(ref.uri);
        if (shouldExcludeFile(path, excludeSuffixes)) {
            continue;
        }

        const lineNum = `${ref.range.start.line + 1}`;
        const fileName = path.replace(/\\/g, '/').split('/').pop();

        const docSymbols = await getDocumentSymbolsWithCache(ref.uri, symbolCache);
        const enclosing = findEnclosingSymbol(docSymbols, ref.range.start);

        // Extract a clean display name similar to legacy call-hierarchy behavior
        let displayName = enclosing ? enclosing.name : fileName;
        if (enclosing && enclosing.selectionRange) {
            const uriStr = ref.uri.toString();
            let doc;
            if (docCache.has(uriStr)) {
                doc = docCache.get(uriStr);
            } else {
                doc = await vscode.workspace.openTextDocument(ref.uri);
                docCache.set(uriStr, doc);
            }
            const extracted = doc.getText(enclosing.selectionRange).trim();
            if (extracted.length > 0) {
                displayName = extracted;
            }
        }

        if (enclosing && isFunctionKind(enclosing.kind)) {
            const key = `func|${displayName}|${path}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    type: 'function',
                    displayName,
                    filePath: path,
                    lines: [],
                    filePaths: []
                });
            }
            const entry = grouped.get(key);
            entry.lines.push(lineNum);
            entry.filePaths.push(path);
        } else {
            const key = `file|${fileName}|${path}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    type: 'file',
                    displayName: fileName,
                    filePath: path,
                    lines: [],
                    filePaths: []
                });
            }
            const entry = grouped.get(key);
            entry.lines.push(lineNum);
            entry.filePaths.push(path);
        }
    }

    for (const entry of grouped.values()) {
        // Keep line/path pairs aligned; allow duplicates across files/paths
        const lines = [...entry.lines];
        const paths = [...entry.filePaths];
        obj[symbolName].calledBy.push({
            caller: entry.displayName,
            filePath: paths[0] || entry.filePath,
            lineNumber: lines[0] || '',
            lineNumbers: lines,
            filePaths: paths,
            canExpand: entry.type === 'function'
        });
    }

    return obj;
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

    try 
    {
        // Determine if the symbol is a function or variable
        const { isFunc, hasDefinition } = await isSymbolFunction(uri, position);
        if (!hasDefinition) {
            statusbar.hideStatusbarItem();
            return;
        }
        const config = vscode.workspace.getConfiguration('crelation');
        const rawDirection = String(config.get('hierarchyDirection', 'calledFrom'));

        let hierarchyDirection = rawDirection;
        
        //we want to force mixed mode for variables all the time as defult type of graphs.
        let isMixedMode = true;

        // For variables or refresh/auto-update, force fallback to mixed implementations based on visible selection
        if (!isFunc) {
            if (rawDirection === 'calledFrom') {
                hierarchyDirection = 'mixRefFrom';
                await config.update('hierarchyDirection', hierarchyDirection, vscode.ConfigurationTarget.Global);
            } else if (rawDirection === 'callingTo') {
                hierarchyDirection = 'mixRefTo';
                await config.update('hierarchyDirection', hierarchyDirection, vscode.ConfigurationTarget.Global);
            }
        } else {
            if (rawDirection === 'mixRefFrom') {
                hierarchyDirection = 'calledFrom';
            } else if (rawDirection === 'mixRefTo') {
                hierarchyDirection = 'callingTo';
            }
        }

        statusbar.setStatusbarText('Finding references...', true);
        const references = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position);
        
        if (!references || !Array.isArray(references) || references.length === 0) {
                vscode.window.showInformationMessage('No references found for: ' + symbolName);
                statusbar.hideStatusbarItem();
                return;
        }

        const excludeSuffixes = config.get('excludeFileSuffixes', '');

        if (isMixedMode) {
            const mixedObj = await buildMixedReferenceTree(symbolName, references, uri, position, excludeSuffixes);
            createWebview(context, symbolName, mixedObj, forceReveal, 'mixed', true);
        } else {
            let rootFilePath = "";
            let rootLineNumber = "";
            if (uri) {
                rootFilePath = normalizePathFromUri(uri);
                rootLineNumber = `${position.line + 1}`;
            }

            let obj = {
                [symbolName]: { calledBy: [], filePath: rootFilePath, lineNumber: rootLineNumber }
            };
            
            for (const ref of references) {
                    let path = normalizePathFromUri(ref.uri);

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
        }

    }
    //catch any error to avoid blocking further processing
    catch{/* nothing to do. */}
    
    statusbar.hideStatusbarItem();
    processingSymbol = null;
    const { notifyProcessingCompleted } = require('../frame/webview');
    notifyProcessingCompleted();    
    
    return;

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

    try 
    {
        // Determine if the symbol is a function or variable
        const isVariableMode = viewProvider && (viewProvider._currentMode === 'mixed' || viewProvider._currentMode === 'references');
        let { isFunc, hasDefinition } = await isSymbolFunction(uri, position);
        if (!hasDefinition) {
            statusbar.hideStatusbarItem();
            return;
        }
        if (isVariableMode) {
            // Preserve mixed/reference fallback during refresh/auto-update
            isFunc = false;
        }
        const config = vscode.workspace.getConfiguration('crelation');
        const rawDirection = String(config.get('hierarchyDirection', 'calledFrom'));

        let hierarchyDirection = rawDirection;

        if (!isFunc) {
            if (rawDirection === 'calledFrom') {
                hierarchyDirection = 'mixRefFrom';
                await config.update('hierarchyDirection', hierarchyDirection, vscode.ConfigurationTarget.Global);
            } else if (rawDirection === 'callingTo') {
                hierarchyDirection = 'mixRefTo';
                await config.update('hierarchyDirection', hierarchyDirection, vscode.ConfigurationTarget.Global);
            }

        } else {
            if (rawDirection === 'mixRefFrom') {
                hierarchyDirection = 'calledFrom';
            } else if (rawDirection === 'mixRefTo') {
                hierarchyDirection = 'callingTo';
            }
        }


        statusbar.setStatusbarText('Finding references...', true);
        const references = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position);
        
        if (!references || !Array.isArray(references) || references.length === 0) {
            vscode.window.showInformationMessage('No references found for: ' + symbolName);
            statusbar.hideStatusbarItem();
            return;
        }

        const excludeSuffixes = config.get('excludeFileSuffixes', '');


        const mixedObj = await buildMixedReferenceTree(symbolName, references, uri, position, excludeSuffixes);
        await viewProvider.updateView(symbolName, mixedObj, forceReveal, 'mixed', uri, position, true);

        statusbar.hideStatusbarItem();
    } 
    finally 
    {
        processingSymbol = null;
        const { notifyProcessingCompleted } = require('../frame/webview');
        notifyProcessingCompleted();
    }

    return;
}


module.exports = {
    showRelations,
    GetCurrentLang,
    openNewRelationWindow,
    showRelationsForView,
    showRelationsForViewWithSymbol
}
