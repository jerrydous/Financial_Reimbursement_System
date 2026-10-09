import { useQuery } from '@tanstack/react-query';
import { Button, Descriptions, Layout, Menu, Typography } from 'antd';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { getMe, type EmployeeView } from './api';
import { keycloak } from './auth';
import { NewReportPage, ReportDetailPage, ReportListPage } from './report-pages';

const { Header, Content, Sider } = Layout;

export function App() {
  const location = useLocation();
  const me = useQuery({
    queryKey: ['me'],
    enabled: keycloak.authenticated === true,
    queryFn: getMe,
  });
  const selected = location.pathname.startsWith('/expense-reports')
    ? '/expense-reports'
    : location.pathname.startsWith('/approvals')
      ? '/approvals'
      : '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ color: '#fff', fontSize: 18 }}>财务报销</Header>
      <Layout>
        <Sider width={200} theme="light">
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
        <Content style={{ padding: 24 }}>
          {keycloak.authenticated ? null : (
            <Button type="primary" onClick={() => void keycloak.login()}>
              登录
            </Button>
          )}
          {keycloak.authenticated ? (
            <Button style={{ marginBottom: 16 }} onClick={() => void keycloak.logout()}>
              退出
            </Button>
          ) : null}
          {me.error ? <Typography.Paragraph type="danger">无法读取当前员工身份</Typography.Paragraph> : null}
          <Routes>
            <Route path="/" element={<IdentityPage employee={me.data ?? null} />} />
            <Route path="/expense-reports" element={<ReportListPage enabled={keycloak.authenticated === true} inbox={false} />} />
            <Route path="/expense-reports/new" element={<NewReportPage />} />
            <Route path="/expense-reports/:id" element={<ReportDetailPage actorId={me.data?.id} />} />
            <Route path="/approvals" element={<ReportListPage enabled={keycloak.authenticated === true} inbox />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function IdentityPage({ employee }: { employee: EmployeeView | null }) {
  if (!keycloak.authenticated) {
    return <Typography.Paragraph>登录后只能看到自己的员工身份和公司抬头。</Typography.Paragraph>;
  }
  if (!employee) {
    return <Typography.Paragraph>正在读取身份…</Typography.Paragraph>;
  }
  return (
    <Descriptions title="当前员工" bordered column={1}>
      <Descriptions.Item label="姓名">{employee.name}</Descriptions.Item>
      <Descriptions.Item label="账号">{employee.username}</Descriptions.Item>
      <Descriptions.Item label="邮箱">{employee.email}</Descriptions.Item>
      <Descriptions.Item label="岗位">{employee.role}</Descriptions.Item>
      <Descriptions.Item label="公司抬头">{employee.company.name}</Descriptions.Item>
      <Descriptions.Item label="税号">{employee.company.taxId}</Descriptions.Item>
    </Descriptions>
  );
}
