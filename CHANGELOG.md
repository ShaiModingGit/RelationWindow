# Change Log
## 3.5.11
- minor fix to the readme and refresh icon

## 3.5.7
- added documentation in the readme for the extra capabilities and new image link to show the latest look instead of updating a gif with the latest flows that are implemented

## 3.5.6
- added tool tips when hovering with mouse on the zoom and reset buttons

## 3.5.5
- added a refresh button to the top bar

## 3.5.0
- new feature to show when on variable "Find all references" in graph view

## 3.4.0
- new feature to show "Calling To" by user choice dropdown list items so the user can choose between calling graph type: "Called From" and "Calling To"

## 3.3.4
- Fix: focus won't be taken if window doesn't exist and will not popup the panel. Only when right-click menu to show relation is chosen will the window take focus and popup the panel.
- Fix: README and changelog typos.

## 3.3.3
- Fix: double-click in WSL environment issue

## 3.3.0
- added double click event handler to show always to the main screen 

## 3.2.3
- additional trying to fix space in graph

## 3.2.2
- added small space in graph

## 3.2.1
- fix function that is a define cause to be and null string , show full name in that case.

## 3.2.0
- added text box for filter suffix file names to be excluded from being presented to the graph

## 3.1.1
- Added zoom in and zoom out functionality and a top bar. Reset to return to the original scale
- Fix: graph issues - collision of lines now back to the original d3, this has a cost of more spaces in elements in graph.

## 3.0.1
- changed the github link for the source code
## 3.0.0
- added an check box for the user to choose if the graph should be auto updated or not when text cursor moves

## 2.9.9
- added new user configuration to switch the behavior of the mouse clicks on graph

## 2.9.5
- Added new setting for the user to choose whether to update relation graph automatically or manually when text cursor moves

## 2.9.1
- fix case of dark theme font color in nodes

## 2.9.0
- added support for root node changes to editor 

## 2.8.8
- added background color changes when click to show selection in graph nodes

## 2.8.5
- added hover on graph color changes and some minor changes in graph presentation fixes

## 2.8.0
- graphical changes to the graph and looks and fixes to some minor glitches in graph generation.

## 2.7.0
- fixed extract name of function from the item node and parse it in a coding language agnosticly using visual code apis.
 
## 2.6.6
- Added fixes for supporting WSL remote files with correct URI file access. Might still have issues on WSL environments since prefix is complex and dependent on each environment...

## 2.5.1
- changed the webview to not be able to move via drag and drop but only via scroll bars.

## 2.5.0
- Added graphic changes to merge multiple children to single child with lines
- Each line can be clicked with right-click and marked with prefix ">> " 
- Some bugs may occur but tried to kill most bugs related to the scroll bar size while the graph is adding elements
- added tool tip instead of when hover to print below a child 

## 2.0.3
- added scroll bars to the graph view

## 2.0.2
- Fixed the symbol position to be based on API and not per view
- Changed the webview to be in a view instead of the original version being in a panel, allowing it to be in the lower panel with the context-window 

## 2.0.1
- added need changes to navigateUri of content-window extension Version 0.8.2

## 2.0
- Modified version by Shai Sarfaty
    -- Rewrote the entire show relation logic to use built-in Visual Studio Code APIs with no file parsing and no need for database files.
    -- Added support to view "right-click" results to the "context-window" extension
    -- configuration to where to show the "right-click" in settings.

## 1.0.10
- refactor: use an iterative approach to traverse the directory and the AST to avoid stack overflow
-docs: update readme

## 1.0.9
- feat: add setting that set the mode of the relations panel
- feat: add setting that set the interval to update the database automatically
- feat: support print log to the output panel
- refactor: optimize the logic of the scan and improve the speed of the scan
- chore: optimize the layout and description of the settings
- docs: update readme

## 1.0.8
- fix: only show relations when editor has selection
- docs: update readme, add custom shortcut key description

## 1.0.7

- fix: migrate data failed when using multilevel directory
- docs: update readme

## 1.0.6

- fix: show relations failed if change the data save path
- feat: add setting that set the position of relations shown
- feat: display the function name in the panel title

## 1.0.5

- feat: add auto init database setting
- docs: update readme

## 1.0.4

- fix: fix dynamic import nanoid error
- chore: modify default log level to error
- docs: update readme

## 1.0.3

- fix: fix promise error when running init command
- chore: create license with MIT

## 1.0.2

- chore: modify minimum required version of VS Code to 1.60.0

## 1.0.1

- docs: update readme

## 1.0.0

Initial release of C Relation plugin.
