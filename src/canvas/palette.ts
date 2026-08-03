// Canvas colours, resolved from the active theme into a plain object.
//
// The renderer can't use CSS: it paints into a bitmap, so every colour has to
// arrive as a string. A lazy `getComputedStyle` call per colour per draw would
// be fine at one draw per interaction but a real cost once a pan/zoom render
// loop calls it several times a frame. Resolving once on theme change and
// handing the renderer a plain object keeps that off the draw path entirely.
//
// It is also where per-project canvas colours will land: background and grid
// are project-wide settings, so they will eventually come from the project
// data model rather than CSS variables. The renderer only ever sees this
// object and won't need to change.

export interface CanvasPalette {
  pasteboard: string
  page: string
  grid: string
  ruler: string
  rulerTick: string
  rulerText: string
  // Fallbacks for an area whose colours are null. That is not a missing value:
  // `null` means "resolve from the active theme", which is how the immutable
  // World area gets a neutral fill in both light and dark. Every user-created
  // area carries concrete colours and never reaches these.
  roomFill: string
  roomWall: string
  // The neutral colour for a transition with no lock colour to show: elevator
  // shafts and their end markers, teleport markers, and every one-way arrow.
  //
  // One colour for all of them on purpose. A lock colour is information (it
  // says which key you need), while these are structure, and giving each kind
  // its own neutral would read as three unrelated things rather than as one
  // layer over the rooms. It is also the only knob to turn if the layer sits too
  // loud or too quiet over the map.
  transition: string
  // The teleport connecting line: faint by default, emphasised on hover or
  // select. The faintness lives in this colour's alpha rather than in the line
  // weight, so how faint is faint is one value to tune.
  teleportLine: string
  // The letter on a cross-tab teleport's marker, naming the tab it leads to.
  // Reads as a label on a coloured chip, so it stays light in both themes rather
  // than following the foreground.
  markerText: string
  // A markup label: text on a chip drawn behind it. The chip is near-opaque and
  // follows the chrome rather than the map, because a label lands on room
  // fills, lines and icons in any combination and has to stay readable on all
  // of them. That is also why it is not `markerText`, which is sized to sit on
  // a coloured marker it can assume is there.
  labelPlate: string
  labelText: string
  // The ghost tint over rooms a live gesture is about to absorb. Translucent,
  // and warm on purpose: it marks the destructive part of the preview.
  absorb: string
  // A box drag that would produce nothing: invalid, so it cancels. Deliberately
  // not `absorb`, which means "this is about to be destroyed": a refused box
  // destroys nothing, it simply will not happen, and the two must not look
  // alike. It is the only feedback an invalid box has, because unlike a valid
  // one it applies nothing for the map to show.
  refuse: string
  // The brush footprint outline under the pointer. Cool, to read as an aiming
  // aid rather than as anything about to be destroyed: the deliberate
  // opposite of `absorb`.
  brush: string
  // The active room's resize and vertex handles. The same hue as `brush` and
  // more transparent, because both are "you could act here" chrome and only one
  // of them follows the pointer.
  handle: string
  // The one handle under the pointer. Opaque where `handle` is faint, because
  // idle handles are hints and this one is the thing about to be grabbed.
  handleHover: string
  // The halo behind a selected transition.
  //
  // Deliberately not `handle`/`brush`: those are "you could act here" chrome
  // that follows the pointer, and this marks a thing that stays marked when the
  // pointer leaves. Deliberately warm, too: every lock colour is a hue the user
  // chose, so a cool selection would be indistinguishable from a lock on a blue
  // door, and this one has to read as selection on top of any of them.
  selection: string
  // The marquee's outline and the sheet inside it, while a select drag is live.
  //
  // The selection hue rather than `brush`, because the marquee is the one aid
  // whose result is a selection: it turns into halos in the same colour the
  // moment it is released, and a cool box becoming warm outlines would read as
  // two unrelated events.
  //
  // Two entries because the fill has to be transparent enough to work over
  // rooms, walls and icons at once, and the outline has to stay crisp. One
  // colour with an alpha applied here would put the number in the renderer.
  marquee: string
  marqueeFill: string
}

function readVar(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim()
}

export function readCanvasPalette(): CanvasPalette {
  const styles = getComputedStyle(document.documentElement)
  return {
    pasteboard: readVar(styles, '--canvas-pasteboard'),
    page: readVar(styles, '--canvas-page'),
    grid: readVar(styles, '--canvas-grid'),
    ruler: readVar(styles, '--canvas-ruler'),
    rulerTick: readVar(styles, '--border'),
    rulerText: readVar(styles, '--fg'),
    roomFill: readVar(styles, '--canvas-room-fill'),
    roomWall: readVar(styles, '--canvas-room-wall'),
    transition: readVar(styles, '--canvas-transition'),
    teleportLine: readVar(styles, '--canvas-teleport-line'),
    markerText: readVar(styles, '--canvas-marker-text'),
    labelPlate: readVar(styles, '--canvas-label-plate'),
    labelText: readVar(styles, '--canvas-label-text'),
    absorb: readVar(styles, '--canvas-absorb'),
    refuse: readVar(styles, '--canvas-refuse'),
    brush: readVar(styles, '--canvas-brush'),
    handle: readVar(styles, '--canvas-handle'),
    handleHover: readVar(styles, '--canvas-handle-hover'),
    selection: readVar(styles, '--canvas-selection'),
    marquee: readVar(styles, '--canvas-marquee'),
    marqueeFill: readVar(styles, '--canvas-marquee-fill'),
  }
}
