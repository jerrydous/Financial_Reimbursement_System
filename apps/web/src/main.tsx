import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initAuth } from './auth';

const root = document.getElementById('root');
if (!root) {
  throw new Error('ROOT_MISSING');
}

void initAuth().then(() => {
  createRoot(root).render(
    <StrictMode>
      <ConfigProvider locale={zhCN}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConfigProvider>
    </StrictMode>,
  );
});
