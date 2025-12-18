# Relation VS Code Extension

Call Chain Visualization Plugin. - Modified version by Shai Sarfaty
Original version by - SingleMoonlight: https://github.com/SingleMoonlight/crelation

This plugin works by default to show the file content to the "context-window" extension: 
https://marketplace.visualstudio.com/items?itemName=zhiminxiong.context-window



## Details
This mod removes the need for parsing "C" files and generically uses Visual Studio Code APIs to retrieve information,
so now it supports more than "C" code. This mod also doesn't need a database file - everything is done at runtime.

This plugin can communicate with the "context-window" plugin to show the found result in the "context-window" instead of the main window.
This is configurable in the settings.


How to use:

1.**Select** a function name and then open right click menu and select `Show Relations`. You can see the call chain of the function in a new panel.

If you want show relations by a shortcut key, you can add the following code to your `keybindings.json` file. For example: 

```
{
    "key": "ctrl+alt+r",
    "command": "crelation.showRelations",
    "when": "editorTextFocus "
}
```

2. In the settings configuration you can choose where you would like to see the function code. The default is the context-window extension. You can change it to the main window if you want.

3.In the new panel, you can left-click the function name to collapse or expand the call chain. Moreover, it will just jump to the function code when you right click the function name. If the tree nodes are too many, you can drag the tree to make it easier to read.

4.If you don't like the current mouse key of choice and would like to switch the left and the right click actions, just got to the settings and change the mouse behavior to fit your desired behavior

5. You can add a filter by file suffix to exclude items from being presented on the tree graph. The suffix structure should be <.><suffix>[,] for example: .i,.cpp,.py
This will take effect after re-showing the complete graph and not on an existing graph.

## How to use and setup
![setup](https://github.com/ShaiModingGit/RelationWindow/blob/main/images/how_to_use.gif?raw=true)

## Features

### Activation Events
+ onStartupFinished

### Commands

| ID                      | Title                            | Description                               |
| ----------------------- | -------------------------------- | ----------------------------------------- |
| crelation.showRelations | Show Relations                   | Show the function call                    |

