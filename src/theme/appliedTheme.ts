// Which of the two themes is actually on screen.
//
// Distinct from the theme store, which holds a three-way choice: 'system' is
// not an answer to this question, and what is applied is the attribute
// `useApplyTheme` stamps, or the OS preference where it has stamped none.
//
// Here rather than beside the palette because it reads `window`, which nothing
// under `src/canvas` may: a renderer that asks the display for anything renders
// differently under test than it does in the app.
export function appliedTheme(): 'light' | 'dark' {
  const stamped = document.documentElement.getAttribute('data-theme')
  if (stamped === 'light' || stamped === 'dark') return stamped
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
