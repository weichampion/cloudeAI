import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initNative } from './native.js';
import './index.css';

// 初始化原生能力（非原生平台自动跳过）
initNative();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
