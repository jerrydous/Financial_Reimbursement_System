import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Descriptions, Form, Input, Space, Table, Typography } from 'antd';
import { fenToYuanText, parseFen, yuanTextToFen } from '@frs/domain';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  confirmInvoice,
  createExpenseReport,
  getExpenseReport,
  invoiceContentUrl,
  listExpenseReports,
  listInvoices,
  postAction,
  submitExpenseReport,
  uploadInvoice,
  type ExpenseReportDetail,
} from './api';

const statusLabel: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  approving: '主管审批',
  finance_review: '财务审核',
  paying: '待支付',
  paid: '已支付',
  rejected: '已驳回',
  withdrawn: '已撤回',
};

const confirmForm = z.object({
  invoiceCode: z.string(),
  invoiceNumber: z.string().min(1, '填写发票号码'),
  yuan: z.string().regex(/^\d+\.\d{2}$/, '金额写成 0.00'),
});

export function ReportListPage({ enabled, inbox }: { enabled: boolean; inbox: boolean }) {
  const list = useQuery({
    queryKey: ['expense-reports', inbox],
    enabled,
    queryFn: () => listExpenseReports(inbox),
  });
  if (!enabled) {
    return <Typography.Paragraph>请先登录。</Typography.Paragraph>;
  }
  return (
    <>
      {inbox ? null : (
        <Link to="/expense-reports/new">
          <Button type="primary" style={{ marginBottom: 16 }}>
            新建报销单
          </Button>
        </Link>
      )}
      <Table
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.items ?? []}
        locale={{ emptyText: inbox ? '没有待处理的单据' : '暂无报销单' }}
        pagination={false}
        columns={[
          {
            title: '单号',
            dataIndex: 'id',
            render: (id: string) => <Link to={`/expense-reports/${id}`}>{id}</Link>,
          },
          { title: '状态', dataIndex: 'status', render: (status: string) => statusLabel[status] ?? status },
          {
            title: '金额（元）',
            dataIndex: 'amountFen',
            render: (amountFen: string) => fenToYuanText(parseFen(amountFen)),
          },
          { title: '创建时间', dataIndex: 'createdAt' },
        ]}
      />
    </>
  );
}

export function NewReportPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: listInvoices });
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const form = useForm<z.infer<typeof confirmForm>>({
    resolver: zodResolver(confirmForm),
    defaultValues: { invoiceCode: '', invoiceNumber: '', yuan: '' },
  });
  const upload = useMutation({
    mutationFn: async (values: z.infer<typeof confirmForm>) => {
      if (!file) {
        throw new Error('FILE_REQUIRED');
      }
      const stored = await uploadInvoice(file);
      const amountFen = yuanTextToFen(values.yuan).toString();
      await confirmInvoice(stored.id, {
        invoiceCode: values.invoiceCode,
        invoiceNumber: values.invoiceNumber,
        amountFen,
      });
      await client.invalidateQueries({ queryKey: ['invoices'] });
      return stored.id;
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      const draft = await createExpenseReport(selected, idempotencyKey);
      return submitExpenseReport(draft.id, `${idempotencyKey}:submit`);
    },
    onSuccess: (report) => {
      void navigate(`/expense-reports/${report.id}`);
    },
  });

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4}>上传发票并人工确认</Typography.Title>
      <Typography.Paragraph type="secondary">
        规格没有点名识票厂商，这里不会自动填入识别结果。请对照影像自己确认号码和金额。验真状态保持为未验真。
      </Typography.Paragraph>
      <input
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <Form
        layout="vertical"
        onFinish={form.handleSubmit((values) => {
          void upload.mutateAsync(values);
        })}
      >
        <Form.Item label="发票代码">
          <Input {...form.register('invoiceCode')} placeholder="数电票可以留空" />
        </Form.Item>
        <Form.Item label="发票号码" validateStatus={form.formState.errors.invoiceNumber ? 'error' : ''}>
          <Input {...form.register('invoiceNumber')} />
        </Form.Item>
        <Form.Item label="价税合计（元）" extra="必须带两位小数，例如 12.30" validateStatus={form.formState.errors.yuan ? 'error' : ''}>
          <Input {...form.register('yuan')} />
        </Form.Item>
        <Button htmlType="submit" loading={upload.isPending}>
          保存这张发票
        </Button>
      </Form>
      <Table
        rowKey="id"
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) }}
        dataSource={(invoices.data?.items ?? []).filter((item) => item.recognitionStatus === 'confirmed' && item.binding === 'released')}
        pagination={false}
        locale={{ emptyText: '还没有已确认且未占用的发票' }}
        columns={[
          { title: '发票号码', dataIndex: 'invoiceNumber' },
          {
            title: '金额（元）',
            dataIndex: 'amountFen',
            render: (amount: string | null) => (amount ? fenToYuanText(parseFen(amount)) : ''),
          },
          { title: '验真', render: () => '未验真' },
        ]}
      />
      <Button type="primary" disabled={selected.length === 0} loading={submit.isPending} onClick={() => void submit.mutateAsync()}>
        提交报销单
      </Button>
      {submit.error instanceof Error ? <Typography.Text type="danger">{submit.error.message}</Typography.Text> : null}
    </Space>
  );
}

export function ReportDetailPage({ actorId }: { actorId: string | undefined }) {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const report = useQuery({ queryKey: ['expense-report', id], queryFn: () => getExpenseReport(id), refetchInterval: 2000 });
  const [approvedYuan, setApprovedYuan] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const act = useMutation({
    mutationFn: (input: { action: string; body?: unknown; key?: string }) => postAction(id, input.action, input.body, input.key),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['expense-report', id] });
    },
  });
  if (!report.data) {
    return <Typography.Paragraph>{report.isLoading ? '正在读取…' : '没有这张报销单'}</Typography.Paragraph>;
  }
  const current = report.data;
  const mine = current.currentActorId === actorId;
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Descriptions title="报销单" bordered column={1}>
        <Descriptions.Item label="状态">{statusLabel[current.status] ?? current.status}</Descriptions.Item>
        <Descriptions.Item label="金额（元）">{fenToYuanText(parseFen(current.amountFen))}</Descriptions.Item>
        <Descriptions.Item label="员工原始金额（元）">
          {current.submittedAmountFen ? fenToYuanText(parseFen(current.submittedAmountFen)) : '尚未提交'}
        </Descriptions.Item>
        <Descriptions.Item label="批准金额（元）">
          {current.approvedAmountFen ? fenToYuanText(parseFen(current.approvedAmountFen)) : '尚未提交'}
        </Descriptions.Item>
      </Descriptions>
      <InvoiceTable report={current} />
      <Space wrap>
        {current.status === 'approving' && mine ? (
          <Button onClick={() => void act.mutateAsync({ action: 'approve' })}>同意</Button>
        ) : null}
        {(current.status === 'approving' || current.status === 'finance_review') && mine ? (
          <Button danger onClick={() => void act.mutateAsync({ action: 'reject' })}>
            驳回
          </Button>
        ) : null}
        {(current.status === 'submitted' || current.status === 'approving') && current.employeeId === actorId ? (
          <Button onClick={() => void act.mutateAsync({ action: 'withdraw' })}>撤回</Button>
        ) : null}
        {current.status === 'finance_review' && mine ? (
          <>
            <Input style={{ width: 160 }} placeholder="批准金额 0.00" value={approvedYuan} onChange={(event) => setApprovedYuan(event.target.value)} />
            <Button
              onClick={() =>
                void act.mutateAsync({
                  action: 'finance-adjustment',
                  body: { approvedAmountFen: yuanTextToFen(approvedYuan).toString() },
                })
              }
            >
              修改批准金额
            </Button>
            <Button type="primary" onClick={() => void act.mutateAsync({ action: 'finance-approve' })}>
              财务通过
            </Button>
          </>
        ) : null}
        {current.status === 'paying' && mine ? (
          <Button
            type="primary"
            onClick={() => void act.mutateAsync({ action: 'payments', body: { outcome: 'succeeded' }, key: crypto.randomUUID() })}
          >
            确认支付
          </Button>
        ) : null}
        {(current.status === 'rejected' || current.status === 'withdrawn') ? (
          <Button onClick={() => void act.mutateAsync({ action: 'revise' })}>改回草稿</Button>
        ) : null}
        {mine && current.currentStep ? (
          <>
            <Input style={{ width: 280 }} placeholder="转交给员工 ID" value={transferTo} onChange={(event) => setTransferTo(event.target.value)} />
            <Button onClick={() => void act.mutateAsync({ action: 'transfer', body: { transferToEmployeeId: transferTo } })}>转交</Button>
          </>
        ) : null}
      </Space>
      {current.status === 'paid' ? <Typography.Text>支付成功后金额不能再改。</Typography.Text> : null}
      <Table
        rowKey={(row) => `${row.action}-${row.createdAt}`}
        dataSource={current.audits}
        pagination={false}
        locale={{ emptyText: '还没有审计记录' }}
        columns={[
          { title: '动作', dataIndex: 'action' },
          { title: '操作者', dataIndex: 'actorId' },
          { title: '从', dataIndex: 'fromStatus' },
          { title: '到', dataIndex: 'toStatus' },
          { title: '时间', dataIndex: 'createdAt' },
        ]}
      />
      {act.error instanceof Error ? <Typography.Text type="danger">{act.error.message}</Typography.Text> : null}
    </Space>
  );
}

function InvoiceTable({ report }: { report: ExpenseReportDetail }) {
  const open = useMutation({
    mutationFn: (invoiceId: string) => invoiceContentUrl(invoiceId),
    onSuccess: (result) => {
      window.open(result.url, '_blank', 'noopener');
    },
  });
  return (
    <Table
      rowKey="id"
      dataSource={report.invoices}
      pagination={false}
      columns={[
        { title: '发票代码', dataIndex: 'invoiceCode' },
        { title: '发票号码', dataIndex: 'invoiceNumber' },
        {
          title: '金额（元）',
          dataIndex: 'amountFen',
          render: (amount: string | null) => (amount ? fenToYuanText(parseFen(amount)) : ''),
        },
        { title: '验真', render: () => '未验真' },
        {
          title: '影像',
          render: (_, row) => (
            <Button size="small" onClick={() => void open.mutateAsync(row.id)}>
              短时查看
            </Button>
          ),
        },
      ]}
    />
  );
}
