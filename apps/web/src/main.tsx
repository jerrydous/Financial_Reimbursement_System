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
            colorPrimary: '#1a2332',
            colorLink: '#227272',
            colorInfo: '#2d8b8b',
            colorText: '#1a2332',
            colorTextSecondary: '#4a5d73',
            colorBgLayout: '#f1faee',
            colorBorder: '#d5e4e2',
            colorBorderSecondary: '#d5e4e2',
            borderRadius: 8,
            fontFamily: '"DejaVu Sans", "Noto Sans CJK SC", sans-serif',
            fontSize: 15,
            fontSizeSM: 13,
            fontSizeLG: 16,
            fontSizeHeading3: 18,
            fontSizeHeading4: 16,
            lineHeight: 1.6,
            fontWeightStrong: 700,
          },
          components: {
            Layout: { headerBg: '#1a2332', siderBg: '#ffffff', bodyBg: '#f1faee', headerHeight: 60 },
            Menu: {
              itemColor: '#1a2332',
              itemSelectedBg: '#e5f4f2',
              itemSelectedColor: '#227272',
              itemHoverBg: '#f3faf8',
              itemBorderRadius: 8,
              itemHeight: 42,
            },
            Table: { headerBg: '#f4faf8', headerColor: '#1a2332', headerSplitColor: '#d5e4e2' },
            Button: { fontWeight: 600, primaryColor: '#f1faee', primaryShadow: 'none', defaultShadow: 'none' },
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
