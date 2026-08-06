// The English message catalogue, being the only complete one. `MessageKey` is
// derived from these keys, so a typo'd or missing key is a type error rather
// than a string that silently renders as itself.
//
// Keys are dotted and grouped by where they appear. Placeholders use {braces}
// and are filled by t()'s second argument.
//
// The `name.*` keys generate content, not chrome. They're translated at the
// moment a name is created and then stored as plain text. A map called "Map 1"
// stays "Map 1" when the project is reopened under another language, because
// by then it's the user's data, not a label. (draw.io's model: new defaults
// follow the current locale, existing names are never rewritten.)
export const en = {
  'app.name': 'Metroidvania Map Maker',

  'name.project': 'Untitled Project',
  'name.map': 'Map {n}',
  'name.room': 'Room {n}',
  'name.area': 'Area {n}',
  // What an unnamed room is called wherever one has to be listed. Rooms start
  // unnamed, and two of them need telling apart.
  'name.roomAt': 'Room at {cell}',
  'name.roomUnplaced': 'Empty room',
  'name.copy': '{base} copy',
  'name.copyNth': '{base} copy {n}',
  // The two immutable fallbacks and the one shipped editable lock type. Core
  // reserves their ids but takes their names as parameters. A name is content:
  // see createProject's ProjectSeed.
  'name.areaWorld': 'World',
  'name.lockOpen': 'Open',
  'name.lockLocked': 'Locked',

  // Undo-step labels. They are stored on the transaction at commit time, so
  // they freeze in whatever locale was active then. Acceptable because the
  // undo stack is session-only and never persisted.
  'history.renameProject': 'Rename Project',
  'history.switchTab': 'Switch Tab',
  'history.addMap': 'Add Map',
  'history.deleteMap': 'Delete Map',
  'history.duplicateMap': 'Duplicate Map',
  'history.renameMap': 'Rename Map',
  'history.reorderMap': 'Reorder Map',
  'history.paint': 'Paint',
  'history.erase': 'Erase',
  'history.resize': 'Resize Room',
  'history.innerWall': 'Draw Inner Wall',
  'history.eraseInnerWall': 'Erase Inner Wall',
  // Erasing a cell selection back to bare grid, which is what Delete means at
  // the cell granularity. Distinct from `history.erase`, the brush stroke.
  'history.eraseCells': 'Erase Cells',
  // One label for the box drag, whichever kind it turns out to have made: the
  // undo entry is named when the gesture opens, and Door mode is
  // context-inferred, so at that moment nobody knows yet.
  'history.addTransition': 'Add Transition',
  // Its own label rather than a second use of the one above, because unlike the
  // box drag this gesture *does* know what it made: the two-click teleport can
  // only ever produce a teleport.
  'history.addTeleport': 'Add Teleport',
  // One label for all three kinds, unlike creation, which knows what it made:
  // the erase column deletes whatever is under the pointer, and the undo entry
  // is named before the target is resolved.
  'history.deleteTransition': 'Delete Transition',
  // One label for both placement routes, the popup's pick and a click while
  // armed: they are the same op, and the undo entry should not say which
  // chrome the user reached it through.
  'history.placeIcon': 'Place Icon',
  'history.moveIcon': 'Move Icon',
  'history.moveRoom': 'Move Room',
  'history.renameRoom': 'Rename Room',
  'history.roomNotes': 'Edit Room Notes',
  'history.assignArea': 'Change Area',
  'history.reorderRoom': 'Reorder Room',
  'history.addArea': 'Add Area',
  'history.renameArea': 'Rename Area',
  'history.recolorArea': 'Recolor Area',
  'history.areaNotes': 'Edit Area Notes',
  'history.deleteArea': 'Delete Area',
  'history.areaFromRoom': 'New Area From Room',
  'history.iconColors': 'Change Icon Colors',
  'history.iconLabel': 'Edit Icon Label',
  'history.iconNotes': 'Edit Icon Notes',
  'history.lineColor': 'Change Line Color',
  'history.lineArrow': 'Change Line Arrows',
  'history.lineLabel': 'Edit Line Label',
  'history.lineNotes': 'Edit Line Notes',
  'history.setLock': 'Change Lock',
  'history.setDirection': 'Change Direction',
  'history.transitionNotes': 'Edit Transition Notes',
  'history.moveSelection': 'Move Selection',
  // Named after what it does to the map rather than after what was dragged: the
  // cells leave their rooms and arrive as new ones, which is not a move of
  // anything the user could point at before the drag.
  'history.moveCells': 'Move Cells',
  'history.drawLine': 'Draw Line',
  'history.extendLine': 'Extend Line',
  'history.moveLine': 'Move Line',
  'history.deleteIcon': 'Delete Icon',
  'history.deleteLine': 'Delete Line',
  'history.deleteRoom': 'Delete Room',
  'history.deleteSelection': 'Delete Selection',
  // Copy leaves no undo step, having changed no model. The other three do.
  'history.cut': 'Cut',
  'history.paste': 'Paste',
  'history.duplicate': 'Duplicate',
  'history.peelLine': 'Erase Line',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',

  'menu.main': 'Main menu',
  'menu.file': 'File',
  'menu.file.new': 'New',
  'menu.file.open': 'Open\u2026',
  'menu.file.save': 'Save',
  'menu.file.saveAs': 'Save As\u2026',
  // Absent rather than empty where the provider cannot reopen a file, which is
  // every engine without File System Access.
  'menu.file.recent': 'Recent',

  // The file the project came from, beside the project name. Absent until a
  // project has been saved or opened, since there is nothing true to say.
  'file.noFile': 'Not saved to a file',

  // The three-way question every replacement asks first. Worded as the
  // desktop convention, because that is what people already know.
  'unsaved.title': 'Save changes to {name}?',
  'unsaved.body': 'Your changes will be lost if you do not save them.',
  'unsaved.save': 'Save',
  'unsaved.discard': "Don't Save",

  // What a repaired load reports. Counts by kind rather than a list: a
  // damaged file produces thousands of events and a wall of them informs
  // nobody.
  //
  // Written as label-and-count rather than "{count} cells dropped", which
  // reads wrong at one. The catalogue has no plural machinery, and this
  // phrasing needs none at any count; it also scans better as a list.
  'load.repaired.title': 'This file needed repairs',
  'load.repaired.body':
    'Opening it will change your data as listed. The file on disk is not modified.',
  'load.repaired.accept': 'Open Anyway',
  'load.cellDropped': 'Cells dropped: {count}',
  'load.innerWallDropped': 'Inner walls dropped: {count}',
  'load.roomDropped': 'Rooms dropped: {count}',
  'load.roomSplit': 'Rooms split apart: {count}',
  'load.iconDropped': 'Icons dropped: {count}',
  'load.lineDropped': 'Lines dropped: {count}',
  'load.transitionDropped': 'Transitions dropped: {count}',
  'load.doorTrimmed': 'Doors trimmed: {count}',
  'load.areaRemapped': 'Rooms moved to World: {count}',
  'load.lockRemapped': 'Locks reset to Open: {count}',
  'load.settingReset': 'Settings reset: {count}',
  'load.colorReset': 'Colours reset: {count}',
  'load.iconTypeReset': 'Icons of an unknown type: {count}',
  'load.assumedDefault': 'Missing values assumed: {count}',
  'load.idRemapped': 'Duplicate ids reissued: {count}',
  'load.textTruncated': 'Over-long text shortened: {count}',

  'load.failed.title': 'Could not open that file',
  'load.invalid': 'It is not a Metroidvania Map Maker project, or it is damaged.',
  // Says what is too big and by how much, so the answer is not "make it
  // smaller somehow". The limit names are code; these are what a person can
  // act on.
  'load.tooLarge': 'It holds {found} {what}, and the most this app can open is {allowed}.',
  'load.limit.bytes': 'bytes',
  'load.limit.maps': 'maps',
  'load.limit.areas': 'areas',
  'load.limit.lockTypes': 'lock types',
  'load.limit.roomsPerMap': 'rooms on one map',
  'load.limit.cellsPerRoom': 'cells in one room',
  'load.limit.cellsPerProject': 'cells in total',
  'load.limit.innerWallsPerRoom': 'inner walls in one room',
  'load.limit.transitionsPerMap': 'transitions on one map',
  'load.limit.segmentsPerDoor': 'segments in one door',
  'load.limit.iconsPerMap': 'icons on one map',
  'load.limit.linesPerMap': 'lines on one map',
  'load.limit.pointsPerLine': 'points in one line',
  'load.limit.coordinate': 'grid coordinates',
  'load.limit.nameLength': 'characters in one name',
  'load.limit.notesLength': 'characters in one note',
  'load.limit.glyphLength': 'characters in one glyph',
  'load.tooNew':
    'It was saved by a newer version of the app (file version {version}, and this build reads {supported}).',
  // A file the app already knew about that has stopped opening. Both name it,
  // because the user picked it off a list and needs to know which one broke,
  // and both offer to drop the entry rather than leave it there failing.
  'load.missing': '{name} is no longer where it was. It may have been moved, renamed, or deleted.',
  'load.permissionRefused':
    'This app was not given permission to open {name}. Browsers ask again each time the app is reloaded.',
  'load.forget': 'Remove from Recent',
  'load.error': 'Something went wrong: {message}',

  // The offer made at startup when a previous session left work behind.
  // Worded so it cannot be read as "your file was changed": nothing here has
  // been anywhere near the file on disk.
  'recovery.title': 'Recover unsaved work?',
  'recovery.body':
    'The app closed before these changes were saved. Recover the ones you want to keep.',
  'recovery.from': 'From {file}',
  'recovery.noFile': 'Never saved to a file',
  'recovery.savedAt': 'Autosaved {when}',
  'recovery.recover': 'Recover',
  'recovery.discard': 'Discard',
  // Leaves the snapshots alone, so they are offered again next time.
  // Discarding is the only thing that stops the question coming back.
  'recovery.dismiss': 'Not Now',

  // A new build, waiting. Worded as an offer rather than a warning: nothing
  // is wrong, and the update keeps until it is taken.
  //
  // It asks for a save even though Reload asks about unsaved work anyway. The
  // guard is the safety net, not the instruction, and a notice that leans on
  // one the user cannot see is a notice that reads as riskier than it is.
  'update.title': 'A new version is available',
  'update.body': 'Please save your work and reload the page to update.',
  'update.reload': 'Reload',
  'update.later': 'Later',
  'menu.edit': 'Edit',
  'menu.view': 'View',
  'menu.help': 'Help',

  // "Undo" alone when the stack is empty, "Undo Paint" when there is a step to
  // name. The label comes off the transaction, so it says what will actually be
  // reverted rather than making the user guess.
  'menu.edit.undo': 'Undo',
  'menu.edit.redo': 'Redo',
  'menu.edit.undoStep': 'Undo {label}',
  'menu.edit.redoStep': 'Redo {label}',
  // The seven that act on a selection. The canvas context menu is the shorter
  // list: four of these, without Paste, Select All or Deselect.
  'menu.edit.cut': 'Cut',
  'menu.edit.copy': 'Copy',
  'menu.edit.paste': 'Paste',
  'menu.edit.duplicate': 'Duplicate',
  'menu.edit.delete': 'Delete',
  'menu.edit.selectAll': 'Select All',
  'menu.edit.deselect': 'Deselect',
  // Marks unsaved work in the project title and the browser tab.
  'title.unsaved': '{name} •',

  'menu.view.grid': 'Grid',
  'menu.view.rulers': 'Rulers',
  'menu.view.coords': 'Coords Overlay',
  'menu.view.transitions': 'Transitions',
  'menu.view.teleportLines': 'Teleport Lines',
  'menu.view.markup': 'Markup',
  'menu.view.icons': 'Icons',
  'menu.view.lines': 'Lines',
  'menu.view.allLabels': 'All Labels',
  'menu.view.rulerUnits': 'Ruler Units',
  'menu.view.units.cells': 'Cells',
  'menu.view.units.px': 'Pixels',
  'menu.view.appearance': 'Appearance',
  'menu.view.theme.system': 'System Default',
  'menu.view.theme.light': 'Light',
  'menu.view.theme.dark': 'Dark',
  'menu.view.resetSidebars': 'Reset Sidebars',
  'menu.view.zenMode': 'Zen mode',

  'menu.help.cheatSheet': 'Cheat sheet',
  'menu.help.welcome': 'Welcome screen',
  'menu.help.github': 'GitHub Repository',
  'menu.help.wiki': 'Wiki',
  'menu.help.about': 'About',

  'toolbar.label': 'Toolbar',
  'toolbar.undo': 'Undo (Ctrl+Z)',
  'toolbar.redo': 'Redo (Ctrl+Shift+Z)',
  'toolbar.zen': 'Zen',
  'toolbar.zenTitle': 'Zen mode - hide the menu, activity bar, and sidebars',
  // Draw has a real toolbar now; the rest are still placeholders for the modes
  // whose tools are unbuilt.
  'toolbar.erase': 'Erase',
  'toolbar.eraseTitle':
    'Erase - makes the primary pointer erase cells. Right-click and the stylus eraser always erase.',
  'toolbar.draw.label': 'Draw options',
  'toolbar.door.label': 'Door options',
  // The creation strip. Every one of these says what the next transition gets
  // and none of them edits the selected one. The tooltips say outright: this is
  // the question a user will otherwise ask by experiment, on a door they wanted
  // to keep.
  'toolbar.lock.label': 'Lock',
  'toolbar.lock.title':
    'Lock type for new doors, elevators and teleports. Does not change what is selected.',
  'toolbar.oneWay': 'One-way',
  'toolbar.oneWayTitle':
    'Draw new transitions as one-way, in the direction you draw them. Does not change what is selected.',
  // Its own title, not a share of the one above: the toggle is the same control
  // and the same store flag, but what it erases is the mode's business.
  // "erase cells" would be a lie here. Door mode never destroys a room.
  'toolbar.door.eraseTitle':
    'Erase - makes the primary pointer delete doors, elevators and teleports. Right-click and the stylus eraser always delete.',
  'toolbar.brush': 'Brush',
  // Square N×N for v1, so one number says it all. When circle brushes land
  // this becomes a shape plus a size.
  'toolbar.brushSize': '{n}×{n}',
  'toolbar.brushSmaller': 'Smaller brush ([)',
  'toolbar.brushLarger': 'Larger brush (])',
  // Inner-wall styles. The names are the spec's own, and each means something
  // specific rather than being decoration: dotted is the secret/breakable
  // convention, doorway an internal passage.
  'toolbar.wall': 'Wall',
  'toolbar.wallStyle.solid': 'Solid',
  'toolbar.wallStyle.dotted': 'Dotted',
  'toolbar.wallStyle.doorway': 'Doorway',
  'toolbar.wallStyleTitle': 'Inner-wall style - drag between interior corners of a room to draw.',
  // The sub-mode lock: a filter over what a press can do, for focused work.
  'toolbar.lock': 'Lock',
  'toolbar.subMode.auto': 'Auto',
  'toolbar.subMode.cells': 'Cells',
  'toolbar.subMode.resize': 'Resize',
  'toolbar.subMode.vertex': 'Vertex',
  'toolbar.subModeTitle':
    'Lock what a press does. Auto infers from what is under the pointer; the others remove the inference.',
  // The area new rooms are drawn into. Creating areas lives in the Hierarchy,
  // deliberately. This only picks from what exists.
  'toolbar.area': 'Area',
  'toolbar.areaTitle':
    'The area new rooms are drawn into. Growing an existing room keeps its own area.',
  // Select mode's toolbar: what a press selects, and nothing else.
  'toolbar.select.label': 'Select options',
  'toolbar.select.granularity': 'Select',
  'toolbar.select.rooms': 'Rooms',
  'toolbar.select.cells': 'Cells',
  'toolbar.select.granularityTitle':
    'What a press selects: whole rooms and the objects on them, or individual cells.',

  'zoom.label': 'Zoom',
  'zoom.options': 'Zoom options',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.resetView': 'Reset View',
  'zoom.fitWindow': 'Fit Window',
  'zoom.toSelection': 'To Selection',

  'activityBar.label': 'Mode switch',
  'mode.draw': 'Draw/Edit',
  'mode.select': 'Select/Move',
  'mode.door': 'Door',
  'mode.markup': 'Markup',

  'tabs.list': 'Maps',
  'tabs.new': 'New map',
  'tabs.all': 'All maps',
  'tabs.allWithCurrent': 'All maps (current: {name})',
  'tabs.scrollLeft': 'Scroll left',
  'tabs.scrollRight': 'Scroll right',
  'tab.rename': 'Rename',
  'tab.duplicate': 'Duplicate',
  'tab.delete': 'Delete',
  'tab.deleteTitle': 'Delete "{name}"?',
  'tab.deleteEmpty': 'This map is empty.',
  // Counts are rendered as "Label: n" rather than "{n} rooms" on purpose: this
  // catalogue has no plural machinery, and "1 rooms" is worse than a label.
  'tab.deleteRooms': 'Rooms',
  'tab.deleteIcons': 'Icons',
  'tab.deleteLines': 'Lines',
  'tab.deleteTransitions': 'Doors and transitions',
  // The cascade the user cannot see, and the reason this dialog exists: these
  // teleports live in *other* maps and are removed too.
  'tab.deleteIncoming': 'Teleports in other maps that link here will also be removed:',
  'tab.deleteIncomingEntry': '{name} ({count})',
  'tab.deleteReplacesLast': 'This is the only map, so a new blank one will take its place.',
  'tab.deleteUndoable': 'You can undo this.',

  'sidebar.primary': 'Primary sidebar',
  'sidebar.secondary': 'Secondary sidebar',
  'sidebar.toggle': 'Toggle sidebar',
  'sidebar.resize': 'Resize sidebar',

  'panel.expand': 'Expand panel',
  'panel.collapse': 'Collapse panel',
  'panel.options': 'Panel options',
  'panel.optionsFor': '{title} options',
  'panel.remove': 'Remove',
  'panel.placeholder': '{title} panel (future)',
  'panel.hierarchy': 'Hierarchy',
  'panel.iconLibrary': 'Icon Library',
  'panel.inspector': 'Inspector',

  'hierarchy.tree': 'Areas and rooms',
  'hierarchy.expandArea': 'Expand {name}',
  'hierarchy.collapseArea': 'Collapse {name}',
  'hierarchy.filter': 'Filter',
  'hierarchy.addArea': 'New area',
  'hierarchy.noMatches': 'Nothing matches "{query}"',
  'hierarchy.menu.rename': 'Rename',
  'hierarchy.menu.duplicate': 'Duplicate',
  'hierarchy.menu.areaFromRoom': 'New area from this room',
  'hierarchy.menu.delete': 'Delete',

  // The area-delete confirmation, shared by the tree's row menu and Delete on a
  // selection. Worded for one area or several, since a selection can hold both.
  'areaDelete.title': 'Delete "{name}"?',
  'areaDelete.titleMany': 'Delete {count} areas?',
  'areaDelete.rooms': '{count} room(s) move to World.',
  'areaDelete.empty': 'No rooms move.',
  'areaDelete.alsoSelection': 'Everything else selected is deleted.',

  // The two counts are separate keys rather than one plural, because this
  // catalogue interpolates and does not decline.
  'inspector.selected': '{n} selected',
  'inspector.cellSelected': '1 cell selected',
  'inspector.cellsSelected': '{n} cells selected',
  'inspector.name': 'Name',
  'inspector.notes': 'Notes',
  'inspector.area': 'Area',
  'inspector.areaColorHint': 'Room colors come from the area',
  'inspector.plate': 'Plate',
  'inspector.glyph': 'Glyph',
  'inspector.label': 'Label',
  'inspector.color': 'Color',
  'inspector.arrowStart': 'Arrow at start',
  'inspector.arrowEnd': 'Arrow at end',
  'inspector.type': 'Type',
  'inspector.typeEdge': 'Door',
  'inspector.typeElevator': 'Elevator',
  'inspector.typeTeleport': 'Teleport',
  'inspector.endA': 'End A',
  'inspector.endB': 'End B',
  // A cross-tab teleport's far end is on another map, and the room name alone
  // would not say which.
  'inspector.endOnMap': '{room} ({map})',
  'inspector.endMissing': 'No room',
  'inspector.lock': 'Lock',
  'inspector.lockA': 'Lock at A',
  'inspector.lockB': 'Lock at B',
  'inspector.lockSync': 'Same lock at both ends',
  'inspector.cellColor': 'Cell color',
  'inspector.wallColor': 'Wall color',
  'inspector.worldLocked':
    'World cannot be renamed or recolored: it is the fallback area for every room.',
  'inspector.direction': 'Direction',
  'inspector.directionBoth': 'Both ways',
  'inspector.directionAToB': 'A to B',
  'inspector.directionBToA': 'B to A',

  'toolbar.markup.label': 'Markup options',
  'toolbar.markup.plate': 'Plate',
  'toolbar.markup.glyph': 'Glyph',
  'toolbar.markup.line': 'Line',
  'toolbar.markup.arrowStart': '←',
  'toolbar.markup.arrowStartTitle': 'Arrowhead at the start of new lines',
  'toolbar.markup.arrowEnd': '→',
  'toolbar.markup.arrowEndTitle': 'Arrowhead at the end of new lines',
  'toolbar.markup.replace': 'Replace',
  'toolbar.markup.replaceTitle': 'Replace an icon already on the cell',
  'toolbar.markup.disarm': 'Disarm',
  'toolbar.markup.disarmTitle': 'Stop placing this icon (Esc)',
  'toolbar.markup.eraseTitle': 'Erase: delete icons, peel lines from an end',

  'iconPicker.search': 'Search icons',
  'iconPicker.empty': 'No icons match "{query}"',
  // The popup, which opens at a map cell rather than from a button, so it says
  // which cell it is about to place into.
  'iconPicker.atCell': 'Place an icon at {cell}',

  'canvas.label': 'Map canvas',
  // The pending teleport's prompt. Names the escape route as well as the ask,
  // because the pending state is the one thing on the canvas with no pointer
  // holding it open. There is no "let go" to get out of it.
  'canvas.pickTeleportDestination': 'Pick a destination - Esc to cancel',

  'modal.about.title': 'Metroidvania Map Maker',
  'modal.about.description': 'App version and links.',
  'modal.about.version': 'Version {version}',

  'modal.welcome.title': 'Welcome to Metroidvania Map Maker',
  'modal.welcome.description': 'Welcome screen - reopen it any time from Help.',
  'modal.welcome.body': 'More to come here. For now, press "?" any time for the cheat sheet.',
  'modal.welcome.hideOnStartup': "Don't show this on startup",
  'modal.welcome.getStarted': 'Get started',

  'modal.cheatSheet.title': 'Cheat Sheet',
  'modal.cheatSheet.description': 'All keyboard shortcuts for Metroidvania Map Maker.',

  'cheatSheet.section.modes': 'Modes',
  'cheatSheet.section.general': 'General',
  'cheatSheet.section.clipboard': 'Clipboard',
  'cheatSheet.section.drawEdit': 'Draw/Edit',
  'cheatSheet.section.zoom': 'Zoom',
  'cheatSheet.section.gestures': 'Panning',
  'cheatSheet.section.help': 'Help',

  'action.mode.draw': 'Draw/Edit mode',
  'action.mode.select': 'Select/Move mode',
  'action.mode.door': 'Door mode',
  'action.mode.markup': 'Markup mode',
  'action.undo': 'Undo',
  'action.redo': 'Redo',
  'action.save': 'Save',
  'action.saveAs': 'Save As',
  'action.openProject': 'Open',
  'action.newProject': 'New',
  'action.deleteSelection': 'Delete selection',
  'action.copy': 'Copy',
  'action.cut': 'Cut',
  'action.paste': 'Paste',
  'action.selectAll': 'Select all',
  'action.deselect': 'Deselect',
  'action.duplicate': 'Duplicate',
  'action.brushSizeDown': 'Decrease brush size',
  'action.brushSizeUp': 'Increase brush size',
  'action.cheatSheet': 'Open cheat sheet',
  'action.zenMode': 'Toggle Zen mode',
  'action.zoomIn': 'Zoom in',
  'action.zoomOut': 'Zoom out',
  'action.zoomReset': 'Reset zoom',
  'action.panDrag': 'Pan the canvas',
  'action.panSpace': 'Pan the canvas',
} as const
