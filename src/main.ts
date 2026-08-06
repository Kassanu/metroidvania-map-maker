import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { createAppPinia } from './stores/pinia'
import { useModelStore } from './stores/model'
import { loadSampleFromUrl } from './dev/loadSample'
import { watchForLaunchedFiles } from './pwa/launchFiles'

// Before anything can await, so a file the OS launched the app with is
// claimed rather than left in the queue.
watchForLaunchedFiles()

const pinia = createAppPinia()
const app = createApp(App).use(pinia)

// Development only, and compiled out of a production build. Awaited before the
// mount so the first render already has the project: a sample arriving after
// the canvas has painted would make anything measuring the canvas race it.
await loadSampleFromUrl(useModelStore(pinia))

app.mount('#app')
