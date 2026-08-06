// The parts of the web app manifest with something to get wrong.
//
// Here rather than in the build config's literal for two reasons. The file
// association is built from the same constants the save picker offers, so a
// manifest cannot drift into registering the app for files it does not
// write. And every icon named here is checked against what is actually in
// `public/`: a manifest naming a file that is not there is inert, and inert
// is exactly what it looks like when it is merely untested.

// Relative and extensioned, both because the build config imports this
// module: the `@` alias is declared in that same config and is not yet in
// effect while it loads, and the config is type-checked under Node's
// resolution, which requires the extension. TypeScript and Vite both map the
// `.js` back to the `.ts` beside it.
import { FILE_EXTENSION, MVM_MEDIA_TYPE } from '../core/storage/fileType.js'

export interface IconResource {
  src: string
  sizes: string
  type: string
}

export interface FileHandler {
  action: string
  accept: Record<string, string[]>
  // What a `.mvm` looks like in a file manager. A page rather than the app's
  // own mark, so a project is not mistaken for the application that opens it.
  // The shell picks a size from this list; without one it falls back to a
  // generic document.
  icons: IconResource[]
  // `single-client` sends the launch to a window that is already open rather
  // than starting another one. That is the case where unsaved work exists,
  // and the reason the launch is guarded like any other replacement.
  launch_type: 'single-client' | 'multiple-clients'
}

// The sizes a Windows shell icon is asked for. The smallest is the bare mark,
// since a page and its fold are three grey pixels there.
const FILE_ICON_SIZES = [16, 32, 48, 256]

export function fileHandlers(action: string): FileHandler[] {
  return [
    {
      action,
      accept: { [MVM_MEDIA_TYPE]: [FILE_EXTENSION] },
      icons: FILE_ICON_SIZES.map((size) => ({
        src: `file-icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: 'image/png',
      })),
      launch_type: 'single-client',
    },
  ]
}

// Sizes an installed app is shown at. `maskable` is a separate file rather
// than the same art declared twice: Android crops a maskable icon to a shape
// it chooses and keeps only the middle, so the mark in it is scaled to
// survive that.
export function appIcons(): (IconResource & { purpose: 'any' | 'maskable' })[] {
  return [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]
}
