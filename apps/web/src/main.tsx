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
            colorLink: '#1a2332',
            colorInfo: '#2d8b8b',
            colorText: '#1a2332',
            colorTextSecondary: '#49525b',
            colorBgLayout: '#f1faee',
            colorBorder: '#2d8b8b',
            colorBorderSecondary: '#a8dadc',
            borderRadius: 8,
            fontFamily: '"DejaVu Sans", "Noto Sans CJK SC", sans-serif',
            fontSize: 15,
            fontSizeSM: 13,
            fontSizeLG: 15,
            fontSizeHeading1: 28,
            fontSizeHeading2: 22,
            fontSizeHeading3: 18,
            fontSizeHeading4: 16,
            fontSizeHeading5: 15,
            lineHeight: 1.65,
            lineHeightHeading1: 1.25,
            lineHeightHeading2: 1.3,
            lineHeightHeading3: 1.35,
            fontWeightStrong: 700,
          },
          components: {
            Layout: { headerBg: '#1a2332', siderBg: '#ffffff', bodyBg: '#f1faee', headerHeight: 64 },
            Menu: {
              itemColor: '#1a2332',
              itemSelectedBg: '#a8dadc',
              itemSelectedColor: '#1a2332',
              itemHoverBg: 'rgba(168, 218, 220, 0.45)',
              itemBorderRadius: 8,
              itemHeight: 44,
            },
            Table: { headerBg: '#a8dadc', headerColor: '#1a2332', headerSplitColor: '#2d8b8b' },
            Button: { fontWeight: 600, primaryColor: '#f1faee', primaryShadow: 'none', defaultShadow: 'none', contentFontSize: 15 },
            Form: { labelColor: '#49525b', labelFontSize: 13, itemMarginBottom: 20 },
            Modal: { titleFontSize: 18, titleColor: '#1a2332' },
            Input: { activeBorderColor: '#2d8b8b', hoverBorderColor: '#1a2332' },
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
