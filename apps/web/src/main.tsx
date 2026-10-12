import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient();
const root = document.getElementById('root');
if (!root) {
  throw new Error('ROOT_MISSING');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={zhCN}
        button={{ autoInsertSpace: false }}
        theme={{
          token: {
            colorPrimary: '#2f6bff',
            borderRadius: 8,
            colorBgLayout: '#f4f6fb',
            fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          },
          components: {
            Layout: { headerBg: '#2f6bff', siderBg: '#ffffff', bodyBg: '#f4f6fb', headerHeight: 56 },
            Menu: { itemSelectedBg: '#eef3ff', itemSelectedColor: '#2f6bff', itemBorderRadius: 8, itemHeight: 40 },
            Table: { headerBg: '#f7f8fa' },
          },
        }}
      >
        <AntdApp>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  </StrictMode>,
);
