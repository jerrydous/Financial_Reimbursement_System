import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Form, Input, Select, Space, Table, Typography } from 'antd';
import { fenToYuanText, parseFen, yuanTextToFen } from '@frs/domain';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  confirmInvoice,
  createExpenseReport,
  getExpenseReport,
  invoiceContentUrl,
  listEmployees,
  listExpenseReports,
  listInvoices,
  postAction,
  submitExpenseReport,
  uploadInvoice,
  type ExpenseReportDetail,
} from './api';
import { actionLabel, formatTime, labelOf, reportNo, roleLabel, statusLabel, statusStillMoving } from './labels';

const yuanPattern = /^\d+\.\d{2}$/;

const confirmForm = z.object({
  invoiceCode: z.string(),
  invoiceNumber: z.string().min(1, '请填写发票号码'),
  yuan: z.string().regex(yuanPattern, '金额写成两位小数，例如 12.30'),
});

export function ReportListPage({ enabled, inbox }: { enabled: boolean; inbox: boolean }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const list = useQuery({
    queryKey: ['expense-reports', inbox, page, pageSize],
    enabled,
    queryFn: () => listExpenseReports(inbox, page, pageSize),
  });
  if (!enabled) {
    return <Typography.Paragraph>请先登录。</Typography.Paragraph>;
  }
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {inbox ? '待我处理' : '我的报销'}
      </Typography.Title>
      {inbox ? null : (
        <Link to="/expense-reports/new">
          <Button type="primary">新建报销单</Button>
        </Link>
      )}
      {list.error instanceof Error ? <Alert type="error" message={list.error.message} /> : null}
      <Table
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.items ?? []}
        locale={{ emptyText: inbox ? '没有待处理的单据' : '暂无报销单' }}
        pagination={{
          current: list.data?.page ?? page,
          pageSize: list.data?.pageSize ?? pageSize,
          total: list.data?.total ?? 0,
          showSizeChanger: false,
          onChange: (next) => setPage(next),
        }}
        columns={[
          {
            title: '单号',
            dataIndex: 'id',
            render: (id: string) => (
              <Link to={`/expense-reports/${id}`} title={id}>
                {reportNo(id)}
              </Link>
            ),
          },
          { title: '状态', dataIndex: 'status', render: (status: string) => labelOf(statusLabel, status) },
          {
            title: '金额（元）',
            dataIndex: 'amountFen',
            render: (amountFen: string) => fenToYuanText(parseFen(amountFen)),
          },
          { title: '创建时间', dataIndex: 'createdAt', render: (createdAt: string) => formatTime(createdAt) },
        ]}
      />
    </Space>
  );
}

export function NewReportPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [invoicePage, setInvoicePage] = useState(1);
  const invoices = useQuery({
    queryKey: ['invoices', invoicePage],
    queryFn: () => listInvoices(invoicePage, 20),
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const selectionKey = selected.slice().sort().join(',');
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [selectionKey]);
  const form = useForm<z.infer<typeof confirmForm>>({
    resolver: zodResolver(confirmForm),
    defaultValues: { invoiceCode: '', invoiceNumber: '', yuan: '' },
  });
  const upload = useMutation({
    mutationFn: async (values: z.infer<typeof confirmForm>) => {
      if (!file) {
        throw new Error('请先选择发票影像（PDF、JPEG 或 PNG）');
      }
      const stored = await uploadInvoice(file);
      const amountFen = yuanTextToFen(values.yuan).toString();
      await confirmInvoice(stored.id, {
        invoiceCode: values.invoiceCode,
        invoiceNumber: values.invoiceNumber,
        amountFen,
      });
      await client.invalidateQueries({ queryKey: ['invoices'] });
      return stored;
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
  const errors = form.formState.errors;
  const invoiceRows = invoices.data?.items ?? [];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4}>新建报销单</Typography.Title>
      <Typography.Paragraph type="secondary">
        请对照影像自己填写发票代码、发票号码和价税合计。系统不会自动填写识别结果，验真状态保持为未验真。
      </Typography.Paragraph>
      <Space direction="vertical" size={4}>
        <Typography.Text>发票影像</Typography.Text>
        <Space>
          <Button onClick={() => fileInput.current?.click()}>选择文件</Button>
          <Typography.Text type="secondary">{file ? file.name : '尚未选择，支持 PDF、JPEG、PNG'}</Typography.Text>
        </Space>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          style={{ display: 'none' }}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setFileError('');
          }}
        />
        {fileError ? <Typography.Text type="danger">{fileError}</Typography.Text> : null}
      </Space>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          form.setValue('invoiceCode', String(data.get('invoiceCode') ?? ''));
          form.setValue('invoiceNumber', String(data.get('invoiceNumber') ?? ''));
          form.setValue('yuan', String(data.get('yuan') ?? ''));
          void form.handleSubmit(
            (values) => {
              if (!file) {
                setFileError('请先选择发票影像（PDF、JPEG 或 PNG）');
                return;
              }
              void upload.mutateAsync(values).catch(() => undefined);
            },
            () => {
              if (!file) {
                setFileError('请先选择发票影像（PDF、JPEG 或 PNG）');
              }
            },
          )();
        }}
      >
        <Form.Item layout="vertical" label="发票代码" htmlFor="invoiceCode" extra="数电票可以留空">
          <div>
            <Input id="invoiceCode" {...form.register('invoiceCode')} />
          </div>
        </Form.Item>
        <Form.Item
          layout="vertical"
          label="发票号码"
          htmlFor="invoiceNumber"
          validateStatus={errors.invoiceNumber ? 'error' : ''}
          help={errors.invoiceNumber?.message}
        >
          <div>
            <Input id="invoiceNumber" {...form.register('invoiceNumber')} />
          </div>
        </Form.Item>
        <Form.Item
          layout="vertical"
          label="价税合计（元）"
          htmlFor="yuan"
          extra="必须带两位小数，例如 12.30"
          validateStatus={errors.yuan ? 'error' : ''}
          help={errors.yuan?.message}
        >
          <div>
            <Input id="yuan" {...form.register('yuan')} />
          </div>
        </Form.Item>
        <Button htmlType="submit" loading={upload.isPending}>
          保存这张发票
        </Button>
      </form>
      {upload.error instanceof Error ? <Alert type="error" message={upload.error.message} /> : null}
      {upload.data?.reused ? <Alert type="info" message="这张影像之前传过，已沿用原来的发票，没有新建一张。" /> : null}
      <Table
        rowKey="id"
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys.map(String)),
          getCheckboxProps: (row) => ({
            disabled: row.recognitionStatus !== 'confirmed' || row.binding !== 'released',
          }),
        }}
        dataSource={invoiceRows}
        pagination={{
          current: invoices.data?.page ?? invoicePage,
          pageSize: invoices.data?.pageSize ?? 20,
          total: invoices.data?.total ?? 0,
          showSizeChanger: false,
          onChange: (next) => setInvoicePage(next),
        }}
        locale={{ emptyText: '还没有发票' }}
        columns={[
          { title: '发票号码', dataIndex: 'invoiceNumber', render: (number: string) => number || '待确认' },
          {
            title: '金额（元）',
            dataIndex: 'amountFen',
            render: (amount: string | null) => (amount ? fenToYuanText(parseFen(amount)) : ''),
          },
          {
            title: '状态',
            render: (_, row) => (row.recognitionStatus === 'confirmed' && row.binding === 'released' ? '可报销' : row.binding === 'active' ? '已占用' : '待确认'),
          },
          { title: '验真', render: () => '未验真' },
        ]}
      />
      <Button type="primary" disabled={selected.length === 0} loading={submit.isPending} onClick={() => void submit.mutateAsync()}>
        提交报销单
      </Button>
      {submit.error instanceof Error ? <Alert type="error" message={submit.error.message} /> : null}
    </Space>
  );
}

export function ReportDetailPage({ actorId }: { actorId: string | undefined }) {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const report = useQuery({
    queryKey: ['expense-report', id],
    queryFn: () => getExpenseReport(id),
    refetchInterval: (query) => (statusStillMoving(query.state.data?.status) ? 2000 : false),
  });
  const directory = useQuery({
    queryKey: ['employees'],
    enabled: Boolean(actorId),
    queryFn: listEmployees,
  });
  const [approvedYuan, setApprovedYuan] = useState('');
  const [transferTo, setTransferTo] = useState<string>();
  const amountError = approvedYuan.length > 0 && !yuanPattern.test(approvedYuan) ? '金额写成两位小数，例如 12.30' : '';
  const act = useMutation({
    mutationFn: (input: { action: string; body?: unknown; key?: string }) => postAction(id, input.action, input.body, input.key),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['expense-report', id] });
      await client.invalidateQueries({ queryKey: ['expense-reports'] });
    },
  });
  if (!report.data) {
    return <Typography.Paragraph>{report.isLoading ? '正在读取…' : '没有这张报销单'}</Typography.Paragraph>;
  }
  const current = report.data;
  const mine = current.currentActorId === actorId;
  const colleagues = (directory.data?.items ?? []).filter((person) => person.id !== actorId);
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Descriptions title={`报销单 ${reportNo(current.id)}`} bordered column={1} style={{ background: '#fff' }}>
        <Descriptions.Item label="完整单号">{current.id}</Descriptions.Item>
        <Descriptions.Item label="状态">{labelOf(statusLabel, current.status)}</Descriptions.Item>
        <Descriptions.Item label="金额（元）">{fenToYuanText(parseFen(current.amountFen))}</Descriptions.Item>
        <Descriptions.Item label="员工原始金额（元）">
          {current.submittedAmountFen ? fenToYuanText(parseFen(current.submittedAmountFen)) : '尚未提交'}
        </Descriptions.Item>
        <Descriptions.Item label="批准金额（元）">
          {current.approvedAmountFen ? fenToYuanText(parseFen(current.approvedAmountFen)) : '尚未提交'}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatTime(current.createdAt)}</Descriptions.Item>
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
            <Form.Item validateStatus={amountError ? 'error' : ''} help={amountError} style={{ marginBottom: 0 }}>
              <div>
                <Input
                  style={{ width: 180 }}
                  placeholder="批准金额 0.00"
                  value={approvedYuan}
                  onChange={(event) => setApprovedYuan(event.target.value.trim())}
                />
              </div>
            </Form.Item>
            <Button
              disabled={approvedYuan.length === 0 || amountError.length > 0}
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
        {current.status === 'rejected' || current.status === 'withdrawn' ? (
          <Button onClick={() => void act.mutateAsync({ action: 'revise' })}>改回草稿</Button>
        ) : null}
        {mine && current.currentStep ? (
          <>
            <Select
              style={{ width: 240 }}
              placeholder={colleagues.length > 0 ? '转交给同事' : '没有其他同事可转交'}
              disabled={colleagues.length === 0}
              value={transferTo}
              options={colleagues.map((person) => ({
                value: person.id,
                label: `${person.name}（${labelOf(roleLabel, person.role)}）`,
              }))}
              onChange={(value) => setTransferTo(value)}
            />
            <Button
              disabled={!transferTo}
              onClick={() => void act.mutateAsync({ action: 'transfer', body: { transferToEmployeeId: transferTo } })}
            >
              转交
            </Button>
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
          { title: '动作', dataIndex: 'action', render: (action: string) => labelOf(actionLabel, action) },
          { title: '操作者', dataIndex: 'actorName' },
          { title: '从', dataIndex: 'fromStatus', render: (status: string) => labelOf(statusLabel, status) },
          { title: '到', dataIndex: 'toStatus', render: (status: string) => labelOf(statusLabel, status) },
          { title: '时间', dataIndex: 'createdAt', render: (createdAt: string) => formatTime(createdAt) },
        ]}
      />
      {act.error instanceof Error ? <Alert type="error" message={act.error.message} /> : null}
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
        { title: '发票代码', dataIndex: 'invoiceCode', render: (code: string) => code || '—' },
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
              查看影像
            </Button>
          ),
        },
      ]}
    />
  );
}
