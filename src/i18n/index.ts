// Message layer. Deliberately tiny. The point isn't translation, it's that no
// component ever holds a bare user-facing literal, so adding a language later
// is a new catalogue rather than a sweep through every file.
//
// Reactive by construction: t() reads the locale ref, so a template that
// calls t() re-renders when the locale changes. Swapping in a real i18n
// library later means keeping this signature and changing the body.
import { ref } from 'vue'
import { en } from './messages/en'

export type MessageKey = keyof typeof en
export type Locale = 'en'

// What the user can choose: a specific locale, or 'system' to follow the
// browser (which in turn follows the OS). Same shape as the theme preference.
// "follow the system" has to survive the system changing, so it can't be
// resolved once and stored.
export type LocalePreference = 'system' | Locale

export const SUPPORTED_LOCALES: Locale[] = ['en']

const CATALOGUES: Record<Locale, Partial<Record<MessageKey, string>>> = { en }

const locale = ref<Locale>('en')

export function currentLocale(): Locale {
  return locale.value
}

export function setLocale(next: Locale) {
  locale.value = next
}

// Picks the best supported locale from the browser's ordered language list.
// Region tags degrade to their base language ('en-GB' → 'en') so a locale
// only has to be listed once per language, not once per region.
export function resolveSystemLocale(
  languages: readonly string[] = navigator.languages ?? [navigator.language],
): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]
    const match = SUPPORTED_LOCALES.find((supported) => supported.toLowerCase() === base)
    if (match) return match
  }
  return 'en'
}

// Builds a matcher for the reverse of t(): given a rendered string, pull the
// placeholder values back out. A few generated names are both written and read.
// "Map 3" has to be produced from a template and later parsed to find the next
// free number. Deriving both directions from the one message keeps them from
// drifting.
export function templateMatcher(template: string, patterns: Record<string, string>) {
  const names: string[] = []
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const source = escaped.replace(/\\\{(\w+)\\\}/g, (match, name: string) => {
    if (!(name in patterns)) return match
    names.push(name)
    return `(${patterns[name]})`
  })
  const regex = new RegExp(`^${source}$`)

  return (value: string): Record<string, string> | null => {
    const found = regex.exec(value)
    if (!found) return null
    return Object.fromEntries(names.map((name, index) => [name, found[index + 1]]))
  }
}

// Values are filled into {braces}. A placeholder with no matching value is
// left as-is rather than blanked, so a mistake shows up in the UI instead of
// disappearing.
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  // English backstops every other catalogue, so a locale that hasn't
  // translated a key yet renders English rather than the raw key.
  const template = CATALOGUES[locale.value][key] ?? en[key]
  return params ? interpolate(template, params) : template
}
