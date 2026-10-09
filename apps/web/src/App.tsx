import { Button, Descriptions, Layout, Menu, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { getMe, listExpenseReports, type EmployeeView, type ExpenseReportList } from './api';
import { keycloak } from './auth';

const { Header, Content, Sider } = Layout;

export function App() {
  const location = useLocation();
  const [employee, setEmployee] = useState<EmployeeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!keycloak.authenticated) {
      return;
    }
    void getMe()
      .then((view) => {
        setEmployee(view);
        setError(null);
      })
      .catch(() => setError('无法读取当前员工身份'));
  }, []);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ color: '#fff', fontSize: 18 }}>财务报销</Header>
      <Layout>
        <Sider width={200} theme="light">
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={[
              { key: '/', label: <Link to="/">我的身份</Link> },
              { key: '/expense-reports', label: <Link to="/expense-reports">报销单</Link> },
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
            <Button style={{ marginLeft: 8 }} onClick={() => void keycloak.logout()}>
              退出
            </Button>
          ) : null}
          {error ? <Typography.Paragraph type="danger">{error}</Typography.Paragraph> : null}
          <Routes>
            <Route path="/" element={<IdentityPage employee={employee} />} />
            <Route path="/expense-reports" element={<ReportListPage enabled={keycloak.authenticated === true} />} />
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
      <Descriptions.Item label="公司抬头">{employee.company.name}</Descriptions.Item>
      <Descriptions.Item label="税号">{employee.company.taxId}</Descriptions.Item>
    </Descriptions>
  );
}

function ReportListPage({ enabled }: { enabled: boolean }) {
  const [list, setList] = useState<ExpenseReportList | null>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    void listExpenseReports().then(setList).catch(() => setList(null));
  }, [enabled]);
  if (!enabled) {
    return <Typography.Paragraph>请先登录。</Typography.Paragraph>;
  }
  return (
    <Table
      rowKey="id"
      dataSource={list?.items ?? []}
      locale={{ emptyText: '暂无报销单' }}
      pagination={false}
      columns={[
        { title: '单号', dataIndex: 'id' },
        { title: '状态', dataIndex: 'status' },
        { title: '金额（分）', dataIndex: 'amountFen' },
        { title: '创建时间', dataIndex: 'createdAt' },
      ]}
    />
  );
}
