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

1.**Select** a function name or a variable and then open right click menu and select `Show Relations`. You can see the call chain of the function in a new panel.

in the window top bar, there is a checkbox option to do it automatically.

If you want show relations by a shortcut key, you can add the following code to your `keybindings.json` file. For example: 

```
{
    "key": "ctrl+alt+r",
    "command": "crelation.showRelations",
    "when": "editorTextFocus "
}
```

2. In the settings configuration you can choose where you would like to see the function code. The default is the context-window extension. You can change it to the main window if you want.

3. In the graph panel, you can collapse or expand the call chain by pressing the (+) marker. single click will show the item in the "context-window" if exist, you can change this defualt in the extension settings. double click will show in main editor

4. You can add a filter by file suffix to EXCLUDE items from being presented on the tree graph. This will take effect after re-showing the complete graph and not on an existing graph. The suffix structure should be <.><suffix>[,] for example: .i,.cpp,.py

5. User can choose to see either a "Called From" relation or a "Calling To", from the dropdown list.

6. Support up-to 5 tabs. Only main tab listen to the events of "auto update" and "Show Relation" from editor context menue. new open tabs are updated only via refresh button that is owned by the unique window.

## Latest look: UI
![setup](https://github.com/ShaiModingGit/RelationWindow/blob/main/images/how_its_looking.png?raw=true)

## Latest look: Graph
![setup](https://github.com/ShaiModingGit/RelationWindow/blob/main/images/graph_example.png?raw=true)

## How to use and setup
![setup](https://github.com/ShaiModingGit/RelationWindow/blob/main/images/how_to_use.gif?raw=true)

## Features

### Activation Events
+ onStartupFinished

### Commands

| ID                      | Title                            | Description                               |
| ----------------------- | -------------------------------- | ----------------------------------------- |
| crelation.showRelations | Show Relations                   | Show the function call                    |

