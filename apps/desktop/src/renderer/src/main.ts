import { createApp } from 'vue';
// 引入契约类型（同时让 window.cd 的全局声明生效）
import '@cd/shared';
import App from './App.vue';
import './styles/main.css';

createApp(App).mount('#app');
