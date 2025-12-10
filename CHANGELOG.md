# Change Log
## 3.0.0
-added an check box for the user to choose if the graph should be auto updated or not when text cursor moves

## 2.9.9
-added new user configuration to switch the behavior of the mouse clicks on graph

## 2.9.5
-added new setting for the user to choose if to update relation graph automaticly or manually when text cursor moves

## 2.9.1
-fix case of dark theme font color in nodes

## 2.9.0
-added support for root node changes to editor 

## 2.8.8
-added background color changes when click to show selection in graph nodes

## 2.8.5
-added hover on graph color changes and some minor changes in graph presentation fixes

## 2.8.0
-graphical changes to the graph and looks and fixes to some minor glitches in graph generation.

## 2.7.0
-fixed extract name of function from the item node and parse it in a coding language agnosticly using visual code apis.
 
## 2.6.6
-added fixes for supporting WSL remote files with currect Uri file access, might still have issues on WSL enviroments since prefix is complex and depended on each enviroment...

## 2.5.1
-changed the webview to not be able to move via drag and drop but only via scroll bars.

## 2.5.0
-added graphic changes to marge multiple child to singel child with lines
-each line can be clicked with right click and marked with prefix ">> " 
-some bugs may occur but tried to kiil most bugs related to the scroll bar size while the graph adding elements
-added tool tip instead of when hover to print below a child 

## 2.0.3
-added scroll bars to the graph view

## 2.0.2
-fixed the symbol position to be based API and not per view
-change the webview to be in a view instead of the original version being in a panel allowing to be in the lower panel with the contex-window 

## 2.0.1
-added need changes to navigateUri of content-window extension Version 0.8.2

## 2.0
-moded version by Shai Sarfaty
    - re-write the entire show relation logic to use build-in visual code APIs and no parsing files no need in database files.
    - added support to view "right-click" resualts to the "context-window" extension
    - configuration to where to show the "right-click" in settings.

## 1.0.10
-refactor: use an iterative approach to traverse the directory and the AST to avoid stack overflow
-docs: update readme

## 1.0.9
-feat: add setting that set the mode of the relations panel
-feat: add setting that set the interval to update the database automatically
-feat: support print log to the output panel
-refactor: optimize the logic of the scan and improve the speed of the scan
-chore: optimize the layout and description of the settings
-docs: update readme

## 1.0.8
-fix: only show relations when editor has selection
-docs: update readme, add custom shortcut key description

## 1.0.7

-fix: migrate data failed when using multilevel directory
-docs: update readme

## 1.0.6

-fix: show relations failed if change the data save path
-feat: add setting that set the position of relations shown
-feat: display the function name in the panel title

## 1.0.5

-feat: add auto init database setting
-docs: update readme

## 1.0.4

-fix: fix dynamic import nanoid error
-chore: modify default log level to error
-docs: update readme

## 1.0.3

-fix: fix promise error when running init command
-chore: create license with MIT

## 1.0.2

-chore: modify minimum required version of VS Code to 1.60.0

## 1.0.1

-docs: update readme

## 1.0.0

Initial release of C Relation plugin.
