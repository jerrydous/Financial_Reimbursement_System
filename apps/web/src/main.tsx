import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initAuth } from './auth';

const queryClient = new QueryClient();

const root = document.getElementById('root');
if (!root) {
  throw new Error('ROOT_MISSING');
}

void Promise.race([
  initAuth().catch(() => false),
  new Promise((resolve) => {
    setTimeout(resolve, 3000);
  }),
]).then(() => {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider locale={zhCN}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfigProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
