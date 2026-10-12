import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Form, Input, Layout, Menu, Modal, Space, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { getMe, type EmployeeView } from './api';
import { loginWithPassword, signOut, useSession } from './auth';
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
  const [loginOpen, setLoginOpen] = useState(false);
  const selected = location.pathname.startsWith('/approvals/history')
    ? '/approvals/history'
    : location.pathname.startsWith('/approvals')
      ? '/approvals'
      : location.pathname.startsWith('/expense-reports')
        ? '/expense-reports'
        : '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 64,
          lineHeight: 'normal',
          paddingInline: 24,
          background: '#3D5A80',
        }}
      >
        <Space size={10} align="center">
          <BrandMark />
          <Typography.Text style={{ color: '#fff', fontSize: 18 }}>财务报销</Typography.Text>
        </Space>
        <Space>
          {session.phase === 'ready' && session.authenticated && me.data ? (
            <Typography.Text style={{ color: '#fff' }}>
              {me.data.name} · {labelOf(roleLabel, me.data.role)}
            </Typography.Text>
          ) : null}
          {session.phase === 'loading' ? <Typography.Text style={{ color: '#fff' }}>正在连接登录…</Typography.Text> : null}
          {session.phase === 'ready' && session.authenticated ? (
            <Button onClick={() => void signOut()}>退出</Button>
          ) : null}
          {session.phase === 'ready' && !session.authenticated ? (
            <Button type="primary" onClick={() => setLoginOpen(true)}>
              登录
            </Button>
          ) : null}
        </Space>
      </Header>
      <Layout>
        <Sider width={200} theme="light">
          <Menu
            mode="inline"
            selectedKeys={[selected]}
            items={[
              { key: '/', label: <Link to="/">我的身份</Link> },
              { key: '/expense-reports', label: <Link to="/expense-reports">我的报销</Link> },
              { key: '/approvals', label: <Link to="/approvals">待我处理</Link> },
              { key: '/approvals/history', label: <Link to="/approvals/history">审批记录</Link> },
            ]}
          />
        </Sider>
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
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
                <Route
                  path="/"
                  element={
                    <IdentityPage
                      authenticated={session.authenticated}
                      employee={me.data ?? null}
                      onLogin={() => setLoginOpen(true)}
                    />
                  }
                />
                <Route path="/expense-reports" element={<ReportListPage enabled={session.authenticated} scope="own" />} />
                <Route path="/expense-reports/new" element={<NewReportPage />} />
                <Route path="/expense-reports/:id" element={<ReportDetailPage actorId={me.data?.id} />} />
                <Route path="/approvals/history" element={<ReportListPage enabled={session.authenticated} scope="reviewed" />} />
                <Route path="/approvals" element={<ReportListPage enabled={session.authenticated} scope="inbox" />} />
              </Routes>
            </>
          )}
        </Content>
      </Layout>
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </Layout>
  );
}

function LoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      title="登录"
      footer={null}
      width={420}
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
      onCancel={() => {
        if (!pending) {
          setError('');
          onClose();
        }
      }}
    >
      <Form
        layout="vertical"
        requiredMark={false}
        onFinish={(values: { username: string; password: string }) => {
          setPending(true);
          setError('');
          void loginWithPassword(values.username.trim(), values.password)
            .then(() => {
              setError('');
              onClose();
            })
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : '登录没有成功，请稍后再试');
            })
            .finally(() => setPending(false));
        }}
      >
        <Form.Item label="账号" name="username" rules={[{ required: true, message: '请填写账号' }]}>
          <Input autoFocus autoComplete="username" />
        </Form.Item>
        <Form.Item label="密码" name="password" rules={[{ required: true, message: '请填写密码' }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        {error ? <Alert type="error" message={error} style={{ marginBottom: 16 }} /> : null}
        <Button type="primary" htmlType="submit" block loading={pending}>
          登录
        </Button>
      </Form>
    </Modal>
  );
}

function IdentityPage({
  authenticated,
  employee,
  onLogin,
}: {
  authenticated: boolean;
  employee: EmployeeView | null;
  onLogin: () => void;
}) {
  if (!authenticated) {
    return (
      <Space direction="vertical">
        <Typography.Paragraph style={{ marginBottom: 0 }}>请登录后查看自己的员工身份和公司抬头。</Typography.Paragraph>
        <Button type="primary" onClick={onLogin}>
          登录
        </Button>
      </Space>
    );
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
