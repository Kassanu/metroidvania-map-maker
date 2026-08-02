import { createPinia } from 'pinia'
import { createPersistPrefsPlugin } from './persistPrefs'

// The app's Pinia instance, with the preference-persistence plugin wired in.
// Tests use this too rather than a bare createPinia(), so store persistence
// behaves the same under test as it does in the app.
export function createAppPinia() {
  const pinia = createPinia()
  pinia.use(createPersistPrefsPlugin())
  return pinia
}
