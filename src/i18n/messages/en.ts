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

  'menu.main': 'Main menu',
  'menu.file': 'File',
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
  'cheatSheet.section.help': 'Help',

  'action.mode.draw': 'Draw/Edit mode',
  'action.mode.select': 'Select/Move mode',
  'action.mode.door': 'Door mode',
  'action.mode.markup': 'Markup mode',
  'action.undo': 'Undo',
  'action.redo': 'Redo',
  'action.save': 'Save',
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
} as const
