const vscode = require('vscode');
const statusbar = require('../frame/statusbar');
const { createWebview } = require('../frame/webview');


let autoUpdateTimer = null;
let outputChannel = vscode.window.createOutputChannel('Call Hierarchy');
let langType ="";

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
 * 显示函数关系图
 * @param {vscode.ExtensionContext} context
 */
async function showRelations(context) 
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
    const incomingTree = await buildHierarchy(root, 'incoming', maxDepth, new Set([rootKey]));

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

    // Get exclude suffixes from configuration
    const config = vscode.workspace.getConfiguration('crelation');
    const excludeSuffixes = config.get('excludeFileSuffixes', '');

    for (const node of incomingTree)
    {

        const doc = await vscode.workspace.openTextDocument(node.item.uri);
        
        let extracte_name = doc.getText(node.item.selectionRange).trim();
        if(extracte_name.length==0)
            extracte_name = node.item.name;        
        
        if (!node.ranges || node.ranges.length === 0) return '';
    
        const parts = node.ranges.map(r => `${r.start.line + 1}`);
    
        let lineNum = `${parts.join(', ')}`;
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

        obj[functionName].calledBy.push({
            caller: extracte_name,
            filePath: path,
            lineNumber: lineNum,
        });
    }

    createWebview(context, symbolName, obj);
    statusbar.hideStatusbarItem();
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


module.exports = {
    showRelations,
    GetCurrentLang
}
