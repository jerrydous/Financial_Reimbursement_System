import { useQuery } from '@tanstack/react-query';
import { Button, Descriptions, Layout, Menu, Space, Spin, Typography } from 'antd';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { getMe, type EmployeeView } from './api';
import { keycloak, useSession } from './auth';
import { BrandMark } from './brand';
import { labelOf, roleLabel } from './labels';
import { NewReportPage, ReportDetailPage, ReportListPage } from './report-pages';

const { Header, Content, Sider } = Layout;

export function App() {
  const location = useLocation();
  const session = useSession();
  const me = useQuery({
    queryKey: ['me'],
    enabled: session.authenticated,
    queryFn: getMe,
  });
  const selected = location.pathname.startsWith('/expense-reports')
    ? '/expense-reports'
    : location.pathname.startsWith('/approvals')
      ? '/approvals'
      : '/';

  return (
    <Layout style={{ minHeight: '100vh', background: '#F6F4EF' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 64,
          lineHeight: 'normal',
          paddingInline: 20,
          background: 'linear-gradient(180deg, #FBF8F2 0%, #F3EEE4 100%)',
          borderBottom: '1px solid #E4DCCE',
        }}
      >
        <Space size={10} align="center">
          <BrandMark />
          <Typography.Text style={{ color: '#1C1917', fontSize: 18, fontWeight: 600 }}>财务报销</Typography.Text>
        </Space>
        <Space size={12}>
          {session.phase === 'loading' ? <Typography.Text style={{ color: '#6B645B' }}>正在连接登录…</Typography.Text> : null}
          {session.phase === 'ready' && session.authenticated && me.data ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#fff',
                border: '1px solid #E6DFD2',
                color: '#3F3A33',
              }}
            >
              {me.data.name}
              <span
                style={{
                  color: '#1F6B58',
                  background: '#E7F3EF',
                  borderRadius: 999,
                  padding: '1px 8px',
                  fontSize: 12,
                }}
              >
                {labelOf(roleLabel, me.data.role)}
              </span>
            </span>
          ) : null}
          {session.phase === 'ready' && session.authenticated ? (
            <Button type="text" onClick={() => void keycloak.logout()}>
              退出
            </Button>
          ) : null}
          {session.phase === 'ready' && !session.authenticated ? (
            <Button type="primary" onClick={() => void keycloak.login()}>
              登录
            </Button>
          ) : null}
        </Space>
      </Header>
      <Layout>
        <Sider width={200} theme="light" style={{ background: '#fff', borderRight: '1px solid #EFEAE2' }}>
          <Menu
            mode="inline"
            selectedKeys={[selected]}
            items={[
              { key: '/', label: <Link to="/">我的身份</Link> },
              { key: '/expense-reports', label: <Link to="/expense-reports">我的报销</Link> },
              { key: '/approvals', label: <Link to="/approvals">待我处理</Link> },
            ]}
          />
        </Sider>
        <Content style={{ padding: 24, background: '#F6F4EF' }}>
          {session.phase === 'loading' ? (
            <Space>
              <Spin />
              <Typography.Text>正在连接登录服务…</Typography.Text>
            </Space>
          ) : (
            <>
              {session.authenticated && me.error ? (
                <Typography.Paragraph type="danger">无法读取当前员工身份</Typography.Paragraph>
              ) : null}
              <Routes>
                <Route path="/" element={<IdentityPage authenticated={session.authenticated} employee={me.data ?? null} />} />
                <Route path="/expense-reports" element={<ReportListPage enabled={session.authenticated} inbox={false} />} />
                <Route path="/expense-reports/new" element={<NewReportPage />} />
                <Route path="/expense-reports/:id" element={<ReportDetailPage actorId={me.data?.id} />} />
                <Route path="/approvals" element={<ReportListPage enabled={session.authenticated} inbox />} />
              </Routes>
            </>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}

function IdentityPage({ authenticated, employee }: { authenticated: boolean; employee: EmployeeView | null }) {
  if (!authenticated) {
    return <Typography.Paragraph>请使用右上角的登录。登录后只能看到自己的员工身份和公司抬头。</Typography.Paragraph>;
  }
  if (!employee) {
    return <Typography.Paragraph>正在读取身份…</Typography.Paragraph>;
  }
  return (
    <Descriptions title="当前员工" bordered column={1} style={{ background: '#fff' }}>
      <Descriptions.Item label="姓名">{employee.name}</Descriptions.Item>
      <Descriptions.Item label="账号">{employee.username}</Descriptions.Item>
      <Descriptions.Item label="邮箱">{employee.email}</Descriptions.Item>
      <Descriptions.Item label="岗位">{labelOf(roleLabel, employee.role)}</Descriptions.Item>
      <Descriptions.Item label="公司抬头">{employee.company.name}</Descriptions.Item>
      <Descriptions.Item label="税号">{employee.company.taxId}</Descriptions.Item>
    </Descriptions>
  );
}
