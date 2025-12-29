const vscode = require('vscode');

/**
 * 获取调用关系显示位置
 * @returns {string} 调用关系显示位置
 */
function getRelationPosition()
{
    const config = vscode.workspace.getConfiguration('crelation');
    return config.get('relationsPosition');
}

/**
 * 获取调用关系面板模式
 * @returns {string} 调用关系面板模式
 */
function getRelationPanelMode()
{
    const config = vscode.workspace.getConfiguration('crelation');
    return config.get('relationsPanelMode');
}

function getOutputRedirectionTo()
{
    const config = vscode.workspace.getConfiguration('crelation');
    return config.get('rightClickRedirectTo');
}

function showRelationUserBehaviorSetting()
{
    const config = vscode.workspace.getConfiguration('crelation');
    return config.get('showRelationUserBehaviorSetting');
}

module.exports = {
    showRelationUserBehaviorSetting,
    getOutputRedirectionTo,
    getRelationPosition,
    getRelationPanelMode,
};
