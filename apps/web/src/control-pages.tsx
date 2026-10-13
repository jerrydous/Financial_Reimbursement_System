import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Form, Input, Select, Table, Typography } from 'antd';
import { fenToYuanText, parseFen, yuanTextToFen } from '@frs/domain';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listBudgets, listColleagues, listDocuments, listMaster, listProxies, postJson } from './api';
import { roleLabel, statusLabel } from './labels';

const yuanPattern = /^\d+\.\d{2}$/;

function fenFromYuan(value: string): string {
  return yuanTextToFen(value.trim()).toString();
}

export function ApplicationCreatePage() {
  return (
    <MoneyForm
      title="事前申请"
      hint="批准后，报销不能超过剩余额度。"
      path="/applications"
      fields={[{ name: 'purpose', label: '事由' }]}
      amountName="amountFen"
    />
  );
}

export function LoanCreatePage() {
  return (
    <MoneyForm
      title="借款"
      hint="超期未还会拦住新的报销。还款不能超过余额。"
      path="/loans"
      fields={[{ name: 'dueOn', label: '到期日', placeholder: '2026-12-31' }]}
      amountName="amountFen"
    />
  );
}

export function ContractCreatePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const vendors = useQuery({ queryKey: ['master'], queryFn: listMaster });
  const [vendorId, setVendorId] = useState<string>();
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('2026-12-31');
  const [yuan, setYuan] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      if (!vendorId || !title || !yuanPattern.test(yuan)) {
        throw new Error('请填写供应商、标题和两位小数金额');
      }
      return postJson(
        '/contracts',
        { vendorId, title, installments: [{ dueOn, amountFen: fenFromYuan(yuan) }] },
        crypto.randomUUID(),
      );
    },
    onSuccess: () => {
      message.success('合同已保存');
      void navigate('/expense-reports');
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '合同没有保存'),
  });
  return (
    <section className="panel">
      <h3>合同</h3>
      <Typography.Paragraph className="quiet">分期付清后合同关闭。金额用元的两位小数，入账仍是分。</Typography.Paragraph>
      <Select
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="供应商"
        value={vendorId}
        onChange={setVendorId}
        options={(vendors.data?.vendors ?? []).map((item) => ({ value: item.id, label: item.name }))}
      />
      <Input style={{ marginBottom: 12 }} placeholder="合同标题" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Input style={{ marginBottom: 12 }} placeholder="2026-12-31" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
      <Input style={{ marginBottom: 12 }} placeholder="金额，例如 100.00" value={yuan} onChange={(event) => setYuan(event.target.value)} />
      <Button type="primary" loading={create.isPending} onClick={() => void create.mutateAsync()}>
        保存合同
      </Button>
    </section>
  );
}

export function BudgetPage() {
  const budgets = useQuery({ queryKey: ['budgets'], queryFn: listBudgets });
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>预算</h3>
        <Link to="/proxies">审批代理</Link>
        <Typography.Text className="quiet">冻结、消耗和释放都在同一行上加锁。</Typography.Text>
      </div>
      <Table
        rowKey="id"
        loading={budgets.isLoading}
        dataSource={budgets.data ?? []}
        pagination={false}
        locale={{ emptyText: '还没有预算行' }}
        columns={[
          { title: '期间', dataIndex: 'period' },
          { title: '部门', dataIndex: 'departmentName' },
          { title: '项目', dataIndex: 'projectName' },
          { title: '科目', dataIndex: 'subjectName' },
          { title: '总额（元）', dataIndex: 'amountFen', render: (value: string) => fenToYuanText(parseFen(value)) },
          { title: '冻结（元）', dataIndex: 'reservedFen', render: (value: string) => fenToYuanText(parseFen(value)) },
          { title: '已消耗（元）', dataIndex: 'consumedFen', render: (value: string) => fenToYuanText(parseFen(value)) },
        ]}
      />
    </section>
  );
}

export function CorporatePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const master = useQuery({ queryKey: ['master'], queryFn: listMaster });
  const budgets = useQuery({ queryKey: ['budgets'], queryFn: listBudgets });
  const bills = useQuery({ queryKey: ['documents', 'corporate'], queryFn: () => listDocuments('corporate') });
  const [vendorId, setVendorId] = useState<string>();
  const [budgetLineId, setBudgetLineId] = useState<string>();
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [yuan, setYuan] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      if (!vendorId || !yuanPattern.test(yuan)) {
        throw new Error('请选择供应商，并填写两位小数金额');
      }
      const created = (await postJson(
        '/corporate-bills',
        { vendorId, invoiceNumber, amountFen: fenFromYuan(yuan), budgetLineId: budgetLineId || null },
        crypto.randomUUID(),
      )) as { id: string };
      await postJson(`/corporate-bills/${created.id}/submit`);
      return created;
    },
    onSuccess: async () => {
      message.success('对公付款已提交');
      await bills.refetch();
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '没有提交'),
  });
  return (
    <div className="page">
      <section className="panel">
        <h3>对公付款</h3>
        <Typography.Paragraph className="quiet">提交时冻结预算，驳回或撤回释放，支付后转为消耗。</Typography.Paragraph>
        <Select
          style={{ width: '100%', marginBottom: 12 }}
          placeholder="供应商"
          value={vendorId}
          onChange={setVendorId}
          options={(master.data?.vendors ?? []).map((item) => ({ value: item.id, label: item.name }))}
        />
        <Select
          style={{ width: '100%', marginBottom: 12 }}
          placeholder="预算行，可以不选"
          allowClear
          value={budgetLineId}
          onChange={setBudgetLineId}
          options={(budgets.data ?? []).map((item) => ({
            value: item.id,
            label: `${item.period} ${item.departmentName} ${item.subjectName}`,
          }))}
        />
        <Input style={{ marginBottom: 12 }} placeholder="发票号码" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
        <Input style={{ marginBottom: 12 }} placeholder="金额，例如 200.00" value={yuan} onChange={(event) => setYuan(event.target.value)} />
        <Button type="primary" loading={create.isPending} onClick={() => void create.mutateAsync()}>
          提交
        </Button>
      </section>
      <section className="panel">
        <Table
          rowKey="id"
          dataSource={bills.data?.items ?? []}
          pagination={false}
          locale={{ emptyText: '还没有对公付款' }}
          columns={[
            { title: '单号', dataIndex: 'id', render: (id: string) => id.slice(0, 8) },
            { title: '状态', dataIndex: 'status', render: (value: string) => statusLabel[value] ?? value },
            { title: '金额（元）', dataIndex: 'amountFen', render: (value: string) => fenToYuanText(parseFen(value)) },
          ]}
        />
        <Button style={{ marginTop: 12 }} onClick={() => void navigate('/expense-reports')}>
          返回单据
        </Button>
      </section>
    </div>
  );
}

export function TravelPage() {
  const { message } = AntdApp.useApp();
  const orders = useQuery({ queryKey: ['documents', 'travel'], queryFn: () => listDocuments('travel') });
  const [raw, setRaw] = useState('{\n  "OrderID": "CT1",\n  "Amount": "12.30",\n  "OrderDate": "2026-10-08",\n  "ProductName": "机票"\n}');
  const importOrder = useMutation({
    mutationFn: async () => {
      const payload = JSON.parse(raw) as unknown;
      return postJson('/travel-orders', { provider: 'ctrip', payload });
    },
    onSuccess: async () => {
      message.success('订单已导入');
      await orders.refetch();
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '没有导入'),
  });
  return (
    <section className="panel">
      <h3>商旅订单</h3>
      <Typography.Paragraph className="quiet">金额必须是带两位小数的元。同一供应商单号只会导入一次。</Typography.Paragraph>
      <Input.TextArea rows={8} value={raw} onChange={(event) => setRaw(event.target.value)} />
      <Button style={{ marginTop: 12 }} type="primary" loading={importOrder.isPending} onClick={() => void importOrder.mutateAsync()}>
        导入携程订单
      </Button>
      <Table
        style={{ marginTop: 16 }}
        rowKey="id"
        dataSource={orders.data?.items ?? []}
        pagination={false}
        locale={{ emptyText: '还没有订单' }}
        columns={[
          { title: '摘要', dataIndex: 'title' },
          { title: '来源', dataIndex: 'status', render: (value: string) => statusLabel[value] ?? value },
          { title: '金额（元）', dataIndex: 'amountFen', render: (value: string) => fenToYuanText(parseFen(value)) },
        ]}
      />
    </section>
  );
}

export function ProxyPage() {
  const client = useQueryClient();
  const { message } = AntdApp.useApp();
  const proxies = useQuery({ queryKey: ['proxies'], queryFn: listProxies });
  const colleagues = useQuery({ queryKey: ['colleagues'], queryFn: listColleagues });
  const [agentId, setAgentId] = useState<string>();
  const create = useMutation({
    mutationFn: async () => {
      if (!agentId) {
        throw new Error('选择代理人');
      }
      return postJson('/approval-proxies', { agentId, startsOn: '2026-10-01', endsOn: '2026-12-31' });
    },
    onSuccess: async () => {
      message.success('代理已启用。期间原审批人不能操作。');
      await client.invalidateQueries({ queryKey: ['proxies'] });
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '没有保存'),
  });
  return (
    <section className="panel">
      <h3>审批代理</h3>
      <Typography.Paragraph className="quiet">代理期内由代理人审批，原审批人不能同时操作。</Typography.Paragraph>
      <Select
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="代理人"
        value={agentId}
        onChange={setAgentId}
        options={(colleagues.data ?? []).map((person) => ({
          value: person.id,
          label: `${person.name} · ${roleLabel[person.role] ?? person.role}`,
        }))}
      />
      <Button type="primary" loading={create.isPending} onClick={() => void create.mutateAsync()}>
        启用到 2026-12-31
      </Button>
      <Table
        style={{ marginTop: 16 }}
        rowKey="id"
        dataSource={proxies.data ?? []}
        pagination={false}
        locale={{ emptyText: '还没有代理' }}
        columns={[
          { title: '代理人', dataIndex: 'agentName' },
          { title: '开始', dataIndex: 'startsOn' },
          { title: '结束', dataIndex: 'endsOn' },
          { title: '状态', dataIndex: 'enabled', render: (value: boolean) => (value ? '启用' : '停用') },
        ]}
      />
    </section>
  );
}

function MoneyForm({
  title,
  hint,
  path,
  fields,
  amountName,
}: {
  title: string;
  hint: string;
  path: string;
  fields: { name: string; label: string; placeholder?: string }[];
  amountName: string;
}) {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<Record<string, string>>();
  const create = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const body: Record<string, string> = {};
      for (const field of fields) {
        body[field.name] = values[field.name] ?? '';
      }
      body[amountName] = fenFromYuan(values.yuan ?? '');
      const created = (await postJson(path, body, crypto.randomUUID())) as { id: string };
      await postJson(`${path}/${created.id}/submit`);
      return created;
    },
    onSuccess: () => {
      message.success('已提交');
      void navigate('/expense-reports');
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '没有提交'),
  });
  return (
    <section className="panel">
      <h3>{title}</h3>
      <Typography.Paragraph className="quiet">{hint}</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(values) => void create.mutateAsync(values)}>
        {fields.map((field) => (
          <Form.Item key={field.name} name={field.name} label={field.label} rules={[{ required: true, message: '必填' }]}>
            <Input placeholder={field.placeholder} />
          </Form.Item>
        ))}
        <Form.Item name="yuan" label="金额（元）" rules={[{ required: true, pattern: yuanPattern, message: '写成 12.30 这样的两位小数' }]}>
          <Input placeholder="12.30" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending}>
          提交
        </Button>
      </Form>
    </section>
  );
}
