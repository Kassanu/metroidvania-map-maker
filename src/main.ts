import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { createAppPinia } from './stores/pinia'

createApp(App).use(createAppPinia()).mount('#app')
