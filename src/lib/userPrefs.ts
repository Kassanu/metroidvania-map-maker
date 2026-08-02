// Namespaced localStorage wrapper for durable, per-user, cross-project
// preferences (theme, panel layout, view toggles, ...). Distinct from
// StorageProvider, which handles the project file. This is plain key/value
// settings, not file content.
const NAMESPACE = 'mmm:'

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NAMESPACE + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function savePref<T>(key: string, value: T) {
  try {
    localStorage.setItem(NAMESPACE + key, JSON.stringify(value))
  } catch {
    // Storage unavailable (private browsing, quota). Preference just won't persist.
  }
}
