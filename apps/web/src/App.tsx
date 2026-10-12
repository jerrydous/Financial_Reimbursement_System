import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Layout, Menu, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getMe, listExpenseReports, type EmployeeView } from './api';
import { initAuth, keycloak, logout } from './auth';
import { LoginDialog } from './login-dialog';
import { formatWhen, roleLabel, shortNo, statusLabel } from './labels';
import { LedgerPage } from './ledger-page';
import { ApplicationCreatePage, BudgetPage, ContractCreatePage, CorporatePage, LoanCreatePage, ProxyPage, TravelPage } from './control-pages';
import { NewReportPage, ReportDetailPage, ReportListPage } from './report-pages';

const { Header, Content, Sider } = Layout;

export function App() {
  const auth = useAuthState();
  if (auth.phase === 'loading') {
    return <div className="boot">正在连接登录服务…</div>;
  }
  return <Shell authenticated={auth.authenticated} authDown={auth.phase === 'down'} authError={auth.authError} />;
}

function useAuthState(): { phase: 'loading' | 'ready' | 'down'; authenticated: boolean; authError: string } {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'down'>('loading');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setPhase((current) => (current === 'loading' ? 'ready' : current));
      }
    }, 4000);
    keycloak.onAuthSuccess = () => {
      setAuthenticated(true);
      setPhase('ready');
    };
    keycloak.onAuthLogout = () => setAuthenticated(false);
    void initAuth()
      .then((ok) => {
        if (cancelled) {
          return;
        }
        window.clearTimeout(timer);
        setAuthenticated(ok);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        window.clearTimeout(timer);
        setAuthenticated(keycloak.authenticated === true);
        setAuthError(error instanceof Error ? error.message : '登录服务没有响应');
        setPhase(keycloak.authenticated ? 'ready' : 'down');
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return { phase, authenticated, authError };
}

function Shell({ authenticated, authDown, authError }: { authenticated: boolean; authDown: boolean; authError: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [loginOpen, setLoginOpen] = useState(false);
  const me = useQuery({
    queryKey: ['me'],
    enabled: authenticated,
    queryFn: getMe,
  });
  const selected = location.pathname.startsWith('/approvals')
    ? '/approvals'
    : location.pathname.startsWith('/ledger')
      ? '/ledger'
      : location.pathname.startsWith('/budgets')
        ? '/budgets'
        : location.pathname.startsWith('/corporate')
          ? '/corporate'
          : location.pathname.startsWith('/travel')
            ? '/travel'
            : location.pathname.startsWith('/expense-reports') ||
                location.pathname.startsWith('/applications') ||
                location.pathname.startsWith('/loans') ||
                location.pathname.startsWith('/contracts')
              ? '/expense-reports'
              : '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header className="app-header">
        <div className="brand">
          <span className="brand-mark">报</span>
          费用报销
        </div>
        <div className="header-user">
          {authenticated && me.data ? (
            <>
              <span className="avatar">{me.data.name.slice(0, 1)}</span>
              <span>{me.data.name}</span>
              <button type="button" className="header-link" onClick={() => void logout()}>
                退出
              </button>
            </>
          ) : (
            <button type="button" className="header-link" onClick={() => setLoginOpen(true)}>
              登录
            </button>
          )}
        </div>
      </Header>
      <Layout>
        <Sider className="app-sider" width={200} theme="light">
          <Menu
            mode="inline"
            selectedKeys={[selected]}
            items={[
              { key: '/', label: <Link to="/">工作台</Link> },
              { key: '/ledger', label: <Link to="/ledger">我的账本</Link> },
              { key: '/expense-reports', label: <Link to="/expense-reports">我的单据</Link> },
              { key: '/budgets', label: <Link to="/budgets">预算</Link> },
              { key: '/corporate', label: <Link to="/corporate">对公付款</Link> },
              { key: '/travel', label: <Link to="/travel">商旅订单</Link> },
              { key: '/approvals', label: <Link to="/approvals">待我处理</Link> },
            ]}
          />
        </Sider>
        <Content className="app-content">
          {authDown ? <Alert style={{ marginBottom: 16 }} type="warning" showIcon message={authError || '登录服务没有响应，请稍后刷新。'} /> : null}
          {me.error ? <Alert style={{ marginBottom: 16 }} type="error" showIcon message="无法读取当前员工身份" /> : null}
          <Routes>
            <Route path="/" element={<HomePage authenticated={authenticated} employee={me.data ?? null} onCreate={() => navigate('/ledger/new')} />} />
            <Route path="/ledger" element={<LedgerPage enabled={authenticated} />} />
            <Route path="/ledger/new" element={<NewReportPage />} />
            <Route path="/expense-reports" element={<ReportListPage enabled={authenticated} inbox={false} />} />
            <Route path="/expense-reports/new" element={<NewReportPage />} />
            <Route path="/expense-reports/:id" element={<ReportDetailPage actorId={me.data?.id} />} />
            <Route path="/applications/new" element={<ApplicationCreatePage />} />
            <Route path="/loans/new" element={<LoanCreatePage />} />
            <Route path="/contracts/new" element={<ContractCreatePage />} />
            <Route path="/budgets" element={<BudgetPage />} />
            <Route path="/corporate" element={<CorporatePage />} />
            <Route path="/travel" element={<TravelPage />} />
            <Route path="/proxies" element={<ProxyPage />} />
            <Route path="/approvals" element={<ReportListPage enabled={authenticated} inbox />} />
          </Routes>
        </Content>
      </Layout>
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </Layout>
  );
}

function HomePage({
  authenticated,
  employee,
  onCreate,
}: {
  authenticated: boolean;
  employee: EmployeeView | null;
  onCreate: () => void;
}) {
  const mine = useQuery({
    queryKey: ['expense-reports', false, 'home'],
    enabled: authenticated,
    queryFn: () => listExpenseReports(false, 1, 5),
  });
  const inbox = useQuery({
    queryKey: ['expense-reports', true, 'home'],
    enabled: authenticated,
    queryFn: () => listExpenseReports(true, 1, 1),
  });
  const recent = mine.data?.items ?? [];

  return (
    <div className="page">
      <div className="toolbar">
        <Button type="primary" disabled={!authenticated} onClick={onCreate}>
          提报销
        </Button>
      </div>
      <div className="stat-grid">
        <article className="stat-card">
          <span>待我处理</span>
          <strong>{authenticated ? (inbox.data?.total ?? 0) : 0}</strong>
        </article>
        <article className="stat-card">
          <span>我的单据</span>
          <strong>{authenticated ? (mine.data?.total ?? 0) : 0}</strong>
        </article>
        <article className="stat-card">
          <span>当前岗位</span>
          <strong style={{ fontSize: 22 }}>{employee ? roleLabel[employee.role] ?? employee.role : '未登录'}</strong>
        </article>
      </div>
      <div className="home-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>我发起的</h3>
            <Link to="/expense-reports">查看全部</Link>
          </div>
          {recent.length === 0 ? (
            <Typography.Paragraph className="quiet" style={{ textAlign: 'center', margin: '48px 0' }}>
              {authenticated ? '还没有报销单。从左上角提一张即可。' : '登录后可以在这里看到自己的单据。'}
            </Typography.Paragraph>
          ) : (
            recent.map((item) => (
              <Link key={item.id} to={`/expense-reports/${item.id}`} style={{ display: 'block', padding: '12px 0', borderTop: '1px solid #f2f3f5', color: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>单号 {shortNo(item.id)}</span>
                  <span className="quiet">{statusLabel[item.status] ?? item.status}</span>
                </div>
                <div className="quiet" style={{ marginTop: 4 }}>{formatWhen(item.createdAt)}</div>
              </Link>
            ))
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>当前身份</h3>
          </div>
          {employee ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.6 }}>
              <div>{employee.name}</div>
              <div className="quiet">{roleLabel[employee.role] ?? employee.role}</div>
              <div>{employee.company.name}</div>
              <div className="quiet">税号 {employee.company.taxId}</div>
            </div>
          ) : (
            <Typography.Paragraph className="quiet">登录后显示姓名、岗位和公司抬头。</Typography.Paragraph>
          )}
        </section>
      </div>
    </div>
  );
}
