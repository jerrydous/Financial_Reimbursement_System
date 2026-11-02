import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Dropdown, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { amountTextToMinor, minorToAmountText, minorUnitDigits, parseFen } from '@frs/domain';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  confirmInvoice,
  createExpenseReport,
  getExpenseReport,
  listColleagues,
  listDocuments,
  listExpenseReports,
  listInvoices,
  postAction,
  postJson,
  submitExpenseReport,
  uploadInvoice,
  type ExpenseReportDetail,
} from './api';
import { InvoicePreview, useInvoicePreview } from './invoice-preview';
import { TransferChoices } from './transfer-choices';
import { actionLabel, currencyOptions, formatMoney, formatWhen, isActiveStatus, roleLabel, shortNo, statusLabel, verificationLabel } from './labels';

const documentTabs = [
  { key: 'expense', label: '报销单' },
  { key: 'application', label: '申请单' },
  { key: 'loan', label: '借款单' },
  { key: 'contract', label: '合同' },
  { key: 'installment', label: '分期付款单' },
  { key: 'repayment', label: '还款单' },
  { key: 'payment', label: '付款单' },
] as const;

const inboxTabs = [
  { key: 'expense', label: '报销单' },
  { key: 'application', label: '申请单' },
  { key: 'loan', label: '借款单' },
  { key: 'corporate', label: '对公付款' },
] as const;

type ListKind = (typeof documentTabs)[number]['key'] | 'corporate';

function LoanWithdraw({ id, status }: { id: string; status: string }) {
  const { message } = AntdApp.useApp();
  const client = useQueryClient();
  const act = useMutation({
    mutationFn: async () => {
      await postJson(`/loans/${id}/withdraw`);
    },
    onSuccess: async () => {
      message.success('已撤回');
      await client.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '没有撤回');
    },
  });
  if (status !== 'approving') {
    return null;
  }
  return (
    <Button size="small" loading={act.isPending} onClick={() => void act.mutateAsync()}>
      撤回
    </Button>
  );
}

function InboxActions({ kind, id, status }: { kind: 'application' | 'loan' | 'corporate'; id: string; status: string }) {
  const { message } = AntdApp.useApp();
  const client = useQueryClient();
  const act = useMutation({
    mutationFn: async (path: string) => {
      const key = path.endsWith('/payments') ? crypto.randomUUID() : undefined;
      await postJson(path, undefined, key);
    },
    onSuccess: async () => {
      message.success('已处理');
      await client.invalidateQueries({ queryKey: ['documents'] });
      await client.invalidateQueries({ queryKey: ['inbox-total'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '没有处理');
    },
  });
  const base = kind === 'application' ? `/applications/${id}` : kind === 'loan' ? `/loans/${id}` : `/corporate-bills/${id}`;
  if (kind === 'corporate' && status === 'finance_review') {
    return (
      <Space>
        <Button size="small" type="primary" loading={act.isPending} onClick={() => void act.mutateAsync(`${base}/finance-approve`)}>
          通过
        </Button>
        <Button size="small" loading={act.isPending} onClick={() => void act.mutateAsync(`${base}/reject`)}>
          驳回
        </Button>
      </Space>
    );
  }
  if (kind === 'corporate' && status === 'paying') {
    return (
      <Button size="small" type="primary" loading={act.isPending} onClick={() => void act.mutateAsync(`${base}/payments`)}>
        确认支付
      </Button>
    );
  }
  if (status !== 'approving') {
    return null;
  }
  return (
    <Space>
      <Button size="small" type="primary" loading={act.isPending} onClick={() => void act.mutateAsync(`${base}/approve`)}>
        同意
      </Button>
      <Button size="small" loading={act.isPending} onClick={() => void act.mutateAsync(`${base}/reject`)}>
        驳回
      </Button>
    </Space>
  );
}

export function ReportListPage({ enabled, inbox }: { enabled: boolean; inbox: boolean }) {
  const [kind, setKind] = useState<ListKind>('expense');
  const [queue, setQueue] = useState<'pending' | 'handled'>('pending');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const handled = inbox && queue === 'handled';
  const list = useQuery({
    queryKey: ['expense-reports', inbox, handled, page, pageSize],
    enabled: enabled && kind === 'expense',
    queryFn: () => listExpenseReports(inbox, page, pageSize, handled),
  });
  const documents = useQuery({
    queryKey: ['documents', kind, page, pageSize, inbox],
    enabled: enabled && kind !== 'expense' && !(inbox && handled),
    queryFn: () => listDocuments(kind, page, pageSize, inbox),
  });
  const createPath =
    kind === 'application' ? '/applications/new' : kind === 'loan' ? '/loans/new' : kind === 'contract' ? '/contracts/new' : '';
  if (!enabled) {
    return <section className="panel">请先登录。</section>;
  }
  return (
    <section className="panel">
      {inbox ? (
        <>
          <div className="tab-row">
            <button
              type="button"
              className={queue === 'pending' ? 'tab active' : 'tab'}
              onClick={() => {
                setQueue('pending');
                setPage(1);
              }}
            >
              待我处理
            </button>
            <button
              type="button"
              className={queue === 'handled' ? 'tab active' : 'tab'}
              onClick={() => {
                setQueue('handled');
                setKind('expense');
                setPage(1);
              }}
            >
              我已处理
            </button>
          </div>
          {queue === 'pending' ? (
            <div className="tab-row">
              {inboxTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={kind === tab.key ? 'tab active' : 'tab'}
                  onClick={() => {
                    setKind(tab.key);
                    setPage(1);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="tab-row">
          {documentTabs.map((tab) => (
            <button key={tab.key} type="button" className={kind === tab.key ? 'tab active' : 'tab'} onClick={() => setKind(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="panel-head">
        <h3>{inbox ? (handled ? '我已处理' : '待我处理') : '我的单据'}</h3>
        {inbox || !createPath ? (
          inbox || kind !== 'expense' ? null : (
            <Link to="/ledger/new">
              <Button type="primary">新建单据</Button>
            </Link>
          )
        ) : (
          <Link to={createPath}>
            <Button type="primary">新建</Button>
          </Link>
        )}
      </div>
      {kind !== 'expense' && !(inbox && handled) ? (
        <Table
          rowKey="id"
          loading={documents.isLoading}
          dataSource={documents.data?.items ?? []}
          locale={{ emptyText: inbox ? '没有待处理的单据' : '还没有这类单据' }}
          pagination={{
            current: page,
            pageSize,
            total: documents.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: '单号', dataIndex: 'id', render: (id: string) => shortNo(id) },
            { title: '标题', dataIndex: 'title' },
            { title: '状态', dataIndex: 'status', render: (status: string) => statusLabel[status] ?? status },
            {
              title: '金额',
              dataIndex: 'amountFen',
              render: (amountFen: string) => formatMoney(amountFen, 'CNY'),
            },
            { title: '时间', dataIndex: 'createdAt', render: (value: string) => formatWhen(value) },
            ...(inbox && (kind === 'application' || kind === 'loan' || kind === 'corporate')
              ? [
                  {
                    title: '处理',
                    render: (_value: unknown, row: { id: string; status: string }) => (
                      <InboxActions kind={kind} id={row.id} status={row.status} />
                    ),
                  },
                ]
              : !inbox && kind === 'loan'
                ? [
                    {
                      title: '处理',
                      render: (_value: unknown, row: { id: string; status: string }) => <LoanWithdraw id={row.id} status={row.status} />,
                    },
                  ]
                : []),
          ]}
        />
      ) : (
      <Table
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.items ?? []}
        locale={{ emptyText: handled ? '还没有审批记录' : inbox ? '没有待处理的单据' : '还没有报销单' }}
        pagination={{
          current: page,
          pageSize,
          total: list.data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          {
            title: '单号',
            dataIndex: 'id',
            render: (id: string) => <Link to={`/expense-reports/${id}`}>{shortNo(id)}</Link>,
          },
          { title: '状态', dataIndex: 'status', render: (status: string) => statusLabel[status] ?? status },
          {
            title: '金额',
            dataIndex: 'amountFen',
            render: (amountFen: string, row) => formatMoney(amountFen, row.currency),
          },
          { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => formatWhen(value) },
          {
            title: '操作',
            render: (_value: unknown, row) => (row.status === 'draft' ? <Link to={`/expense-reports/${row.id}`}>继续</Link> : null),
          },
        ]}
      />
      )}
      {list.error instanceof Error ? <Typography.Text type="danger">{list.error.message}</Typography.Text> : null}
      {documents.error instanceof Error ? <Typography.Text type="danger">{documents.error.message}</Typography.Text> : null}
    </section>
  );
}

export function NewReportPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { message } = AntdApp.useApp();
  const [page, setPage] = useState(1);
  const invoices = useQuery({ queryKey: ['invoices', page], queryFn: () => listInvoices(page) });
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [sellerName, setSellerName] = useState('');
  const [form] = Form.useForm<{
    invoiceCode?: string;
    invoiceNumber: string;
    yuan: string;
    currency: string;
    buyerName?: string;
    buyerTaxId?: string;
    invoiceDate?: string;
  }>();
  const currency = Form.useWatch('currency', form) ?? 'CNY';
  const pendingKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const recognize = useMutation({
    mutationFn: async () => {
      if (!file) {
        throw new Error('请先选择发票影像');
      }
      return uploadInvoice(file);
    },
    onSuccess: (stored) => {
      setDraftId(stored.id);
      setSellerName(stored.sellerName);
      form.setFieldsValue({
        invoiceCode: stored.invoiceCode,
        invoiceNumber: stored.invoiceNumber,
        currency: stored.currency || 'CNY',
        yuan: stored.amountFen ? minorToAmountText(parseFen(stored.amountFen), stored.currency || 'CNY') : '',
        buyerName: stored.buyerName,
        buyerTaxId: stored.buyerTaxId,
        invoiceDate: stored.invoiceDate,
      });
      if (stored.reused && stored.binding === 'active') {
        message.warning('这张影像已经在报销单里，不会再新建一份');
      } else if (stored.reused) {
        message.info('这张影像已经确认过，在下面的列表里选用即可');
      } else if (stored.ocrStatus === 'recognized') {
        message.success(stored.sellerName ? `已识别：${stored.sellerName}` : '已识别发票内容，请核对后确认');
      } else {
        message.info(stored.ocrMessage || '请手工填写发票内容');
      }
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '发票没有上传');
    },
  });
  const confirm = useMutation({
    mutationFn: async (values: {
      invoiceCode?: string;
      invoiceNumber: string;
      yuan: string;
      currency: string;
      buyerName?: string;
      buyerTaxId?: string;
      invoiceDate?: string;
    }) => {
      if (!draftId) {
        throw new Error('请先上传并识别发票');
      }
      await confirmInvoice(draftId, {
        invoiceCode: values.invoiceCode ?? '',
        invoiceNumber: values.invoiceNumber,
        amountFen: amountTextToMinor(values.yuan, values.currency).toString(),
        currency: values.currency,
        buyerName: values.buyerName ?? '',
        buyerTaxId: values.buyerTaxId ?? '',
        invoiceDate: values.invoiceDate ?? '',
      });
    },
    onSuccess: async () => {
      message.success('发票已确认，可以加入报销单');
      form.resetFields();
      setFile(null);
      setDraftId(null);
      setSellerName('');
      await client.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '发票没有确认');
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      const fingerprint = [...selected].sort().join(',');
      if (!pendingKey.current || pendingKey.current.fingerprint !== fingerprint) {
        pendingKey.current = { fingerprint, key: crypto.randomUUID() };
      }
      const key = pendingKey.current.key;
      const draft = await createExpenseReport(selected, key);
      return submitExpenseReport(draft.id, `${key}:submit`);
    },
    onSuccess: (report) => {
      pendingKey.current = null;
      void navigate(`/expense-reports/${report.id}`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '报销单没有提交');
    },
  });
  const rows = invoices.data?.items ?? [];

  return (
    <div className="page">
      <section className="panel">
        <div className="panel-head">
          <h3>记费用</h3>
          <Typography.Text className="quiet">上传后用开源文字识别填写草稿。请核对后再确认，验真状态仍是未验真。</Typography.Text>
        </div>
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => {
            void confirm.mutateAsync(values);
          }}
        >
          <Form.Item label="发票影像" extra="支持 PDF、JPEG、PNG">
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              style={{ display: 'none' }}
              id="invoice-file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Space>
              <Button onClick={() => document.getElementById('invoice-file')?.click()}>{file ? file.name : '选择发票影像'}</Button>
              <Button type="primary" loading={recognize.isPending} disabled={!file} onClick={() => void recognize.mutateAsync()}>
                识别发票
              </Button>
            </Space>
          </Form.Item>
          {sellerName ? <Typography.Paragraph>销售方：{sellerName}</Typography.Paragraph> : null}
          <Form.Item label="发票代码" name="invoiceCode">
            <Input placeholder="数电票可以留空" />
          </Form.Item>
          <Form.Item label="发票号码" name="invoiceNumber" rules={[{ required: true, message: '填写发票号码' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="购买方名称" name="buyerName" rules={[{ required: true, message: '填写购买方名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="购买方税号" name="buyerTaxId" rules={[{ required: true, message: '填写购买方税号' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label="开票日期"
            name="invoiceDate"
            rules={[
              { required: true, message: '填写开票日期' },
              { pattern: /^\d{4}-\d{2}-\d{2}$/, message: '日期格式应为 2026-10-13' },
            ]}
          >
            <Input placeholder="2026-10-13" style={{ maxWidth: 240 }} />
          </Form.Item>
          <Form.Item label="币种" name="currency" initialValue="CNY" rules={[{ required: true, message: '选择币种' }]}>
            <Select options={[...currencyOptions]} style={{ maxWidth: 240 }} />
          </Form.Item>
          <Form.Item
            label="价税合计"
            name="yuan"
            extra={minorUnitDigits(currency) === 0 ? '日元填整数，例如 1200。不同币种不会自动换汇。' : '按票面币种填写，保留两位小数，例如 12.30。不同币种不会自动换汇。'}
            rules={[
              { required: true, message: '填写金额' },
              {
                validator: (_, value) => {
                  try {
                    amountTextToMinor(String(value ?? ''), currency);
                    return Promise.resolve();
                  } catch (error) {
                    return Promise.reject(new Error(error instanceof Error ? error.message : '金额不合法'));
                  }
                },
              },
            ]}
          >
            <Input placeholder={minorUnitDigits(currency) === 0 ? '1200' : '12.30'} style={{ maxWidth: 240 }} />
          </Form.Item>
          <Button htmlType="submit" loading={confirm.isPending} disabled={!draftId}>
            确认发票
          </Button>
        </Form>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>选择要报销的发票</h3>
          <Button type="primary" disabled={selected.length === 0} loading={submit.isPending} onClick={() => void submit.mutateAsync()}>
            提交报销
          </Button>
        </div>
        <Table
          rowKey="id"
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys.map(String)),
            getCheckboxProps: (row) => ({ disabled: row.recognitionStatus !== 'confirmed' || row.binding !== 'released' }),
          }}
          dataSource={rows}
          locale={{ emptyText: '还没有未报销的发票。上传并确认后会出现在这里' }}
          pagination={{
            current: page,
            pageSize: 20,
            total: invoices.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: '发票号码', dataIndex: 'invoiceNumber', render: (value: string) => value || '待识别' },
            {
              title: '金额',
              dataIndex: 'amountFen',
              render: (amount: string | null, row) => formatMoney(amount, row.currency),
            },
            {
              title: '状态',
              dataIndex: 'recognitionStatus',
              render: (value: string) => (value === 'confirmed' ? '已确认' : '待确认'),
            },
            { title: '验真', dataIndex: 'verificationStatus', render: (value: string) => verificationLabel[value] ?? '未验真' },
          ]}
        />
      </section>
    </div>
  );
}

export function ReportDetailPage({ actorId }: { actorId: string | undefined }) {
  const { id = '' } = useParams();
  const { message } = AntdApp.useApp();
  const client = useQueryClient();
  const report = useQuery({
    queryKey: ['expense-report', id],
    queryFn: () => getExpenseReport(id),
    refetchInterval: (query) => (query.state.data && isActiveStatus(query.state.data.status) ? 5000 : false),
  });
  const [transferOpen, setTransferOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferTo, setTransferTo] = useState<string>();
  const [approvedYuan, setApprovedYuan] = useState('');
  const [amountError, setAmountError] = useState('');
  const colleagues = useQuery({
    queryKey: ['colleagues'],
    queryFn: listColleagues,
    enabled: transferOpen,
  });
  const act = useMutation({
    mutationFn: (input: { action: string; body?: unknown; key?: string }) => postAction(id, input.action, input.body, input.key),
    onSuccess: async () => {
      setTransferOpen(false);
      setAdjustOpen(false);
      setAmountError('');
      await client.invalidateQueries({ queryKey: ['expense-report', id] });
      await client.invalidateQueries({ queryKey: ['expense-reports'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '操作没有完成');
    },
  });
  if (!report.data) {
    return <section className="panel">{report.isLoading ? '正在读取…' : '没有这张报销单'}</section>;
  }
  const current = report.data;
  const mine = current.canAct;
  const owner = current.employeeId === actorId;
  const actions = detailActions(current, mine, owner);

  return (
    <div className="page">
      <section className="panel">
        <div className="detail-bar">
          <div>
            <Link to="/expense-reports">返回单据</Link>
            <h3 className="section-title" style={{ marginTop: 8 }}>
              报销单 {shortNo(current.id)}
            </h3>
            <div className="quiet">{statusLabel[current.status] ?? current.status}</div>
          </div>
          <div className="detail-actions">
            {actions.primary ? (
              <Button type="primary" loading={act.isPending} onClick={() => void runAction(actions.primary, act.mutateAsync)}>
                {actions.primary.label}
              </Button>
            ) : null}
            {actions.more.length > 0 ? (
              <Dropdown
                menu={{
                  items: actions.more.map((item) => ({ key: item.key, label: item.label, danger: item.danger })),
                  onClick: ({ key }) => {
                    const item = actions.more.find((entry) => entry.key === key);
                    if (!item) {
                      return;
                    }
                    if (item.key === 'transfer') {
                      setTransferOpen(true);
                      return;
                    }
                    if (item.key === 'adjust') {
                      setAdjustOpen(true);
                      return;
                    }
                    void runAction(item, act.mutateAsync);
                  },
                }}
              >
                <Button>更多</Button>
              </Dropdown>
            ) : null}
          </div>
        </div>
      </section>
      <section className="panel">
        <Space size="large" wrap>
          <div>
            <div className="quiet">金额</div>
            <strong>{formatMoney(current.amountFen, current.currency)}</strong>
          </div>
          <div>
            <div className="quiet">员工原始金额</div>
            <div>{current.submittedAmountFen ? formatMoney(current.submittedAmountFen, current.currency) : '尚未提交'}</div>
          </div>
          <div>
            <div className="quiet">批准金额</div>
            <div>{current.approvedAmountFen ? formatMoney(current.approvedAmountFen, current.currency) : '尚未提交'}</div>
          </div>
        </Space>
        {current.warnings.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            {current.warnings.map((warning) => (
              <Typography.Paragraph key={warning.message} type="warning" style={{ marginBottom: 4 }}>
                {warning.message}
              </Typography.Paragraph>
            ))}
          </div>
        ) : null}
      </section>
      <section className="panel">
        <h3 className="section-title" style={{ marginBottom: 16 }}>发票</h3>
        <InvoiceTable report={current} />
      </section>
      <section className="panel">
        <h3 className="section-title" style={{ marginBottom: 16 }}>处理记录</h3>
        <Table
          rowKey={(row) => `${row.action}-${row.createdAt}`}
          dataSource={current.audits}
          pagination={false}
          locale={{ emptyText: '还没有处理记录' }}
          columns={[
            { title: '动作', dataIndex: 'action', render: (value: string) => actionLabel[value] ?? value },
            { title: '操作者', dataIndex: 'actorName' },
            { title: '从', dataIndex: 'fromStatus', render: (value: string) => statusLabel[value] ?? value },
            { title: '到', dataIndex: 'toStatus', render: (value: string) => statusLabel[value] ?? value },
            { title: '时间', dataIndex: 'createdAt', render: (value: string) => formatWhen(value) },
          ]}
        />
      </section>
      <Modal
        title="转交"
        open={transferOpen}
        transitionName=""
        maskTransitionName=""
        confirmLoading={act.isPending}
        onCancel={() => setTransferOpen(false)}
        onOk={() => {
          if (!transferTo) {
            message.warning('选择转交对象');
            return;
          }
          void act.mutateAsync({ action: 'transfer', body: { transferToEmployeeId: transferTo } });
        }}
      >
        <TransferChoices
          loading={colleagues.isLoading}
          error={colleagues.error instanceof Error ? colleagues.error.message : ''}
          people={(colleagues.data ?? []).filter((person) => person.id !== current.employeeId)}
          value={transferTo}
          onChange={setTransferTo}
        />
      </Modal>
      <Modal
        title="调整批准金额"
        open={adjustOpen}
        transitionName=""
        maskTransitionName=""
        confirmLoading={act.isPending}
        onCancel={() => {
          setAdjustOpen(false);
          setAmountError('');
        }}
        onOk={() => {
          let fen: string;
          try {
            fen = amountTextToMinor(approvedYuan.trim(), current.currency).toString();
          } catch (error) {
            setAmountError(error instanceof Error ? error.message : '金额不合法');
            return;
          }
          void act.mutateAsync({ action: 'finance-adjustment', body: { approvedAmountFen: fen } });
        }}
      >
        <Input placeholder={minorUnitDigits(current.currency) === 0 ? '1200' : '12.30'} value={approvedYuan} status={amountError ? 'error' : ''} onChange={(event) => setApprovedYuan(event.target.value)} />
        {amountError ? <div style={{ color: '#cf1322', marginTop: 8 }}>{amountError}</div> : null}
      </Modal>
    </div>
  );
}

type DetailAction = {
  key: string;
  label: string;
  danger?: boolean;
  action?: string;
  body?: unknown;
  keySuffix?: string;
};

function detailActions(current: ExpenseReportDetail, mine: boolean, owner: boolean): { primary: DetailAction | null; more: DetailAction[] } {
  const more: DetailAction[] = [];
  let primary: DetailAction | null = null;
  if (current.status === 'draft' && owner) {
    primary = { key: 'submit', label: '提交', action: 'submit', keySuffix: 'submit' };
  }
  if (current.status === 'approving' && mine) {
    primary = { key: 'approve', label: '同意', action: 'approve' };
  }
  if (current.status === 'finance_review' && mine) {
    primary = { key: 'finance-approve', label: '通过', action: 'finance-approve' };
    more.push({ key: 'adjust', label: '调整批准金额' });
  }
  if (current.status === 'paying' && mine) {
    primary = { key: 'pay', label: '确认支付', action: 'payments', body: { outcome: 'succeeded' }, keySuffix: 'pay' };
  }
  if ((current.status === 'rejected' || current.status === 'withdrawn') && owner) {
    primary = { key: 'revise', label: '改回草稿', action: 'revise' };
  }
  if ((current.status === 'approving' || current.status === 'finance_review') && mine) {
    more.push({ key: 'reject', label: '驳回', danger: true, action: 'reject' });
  }
  if ((current.status === 'submitted' || current.status === 'approving') && owner) {
    more.push({ key: 'withdraw', label: '撤回', action: 'withdraw' });
  }
  if (mine && current.currentStep) {
    more.push({ key: 'transfer', label: '转交' });
  }
  return { primary, more };
}

function runAction(
  item: DetailAction | null,
  mutate: (input: { action: string; body?: unknown; key?: string }) => Promise<unknown>,
): void {
  if (!item?.action) {
    return;
  }
  void mutate({
    action: item.action,
    body: item.body,
    key: item.keySuffix ? crypto.randomUUID() : undefined,
  });
}

function InvoiceTable({ report }: { report: ExpenseReportDetail }) {
  const preview = useInvoicePreview();
  return (
    <>
      <Table
        rowKey="id"
        dataSource={report.invoices}
        pagination={false}
        columns={[
          { title: '发票代码', dataIndex: 'invoiceCode', render: (value: string) => value || '—' },
          { title: '发票号码', dataIndex: 'invoiceNumber' },
          {
            title: '金额',
            dataIndex: 'amountFen',
            render: (amount: string | null, row) => formatMoney(amount, row.currency || report.currency),
          },
          { title: '验真', dataIndex: 'verificationStatus', render: (value: string) => verificationLabel[value] ?? '未验真' },
          {
            title: '影像',
            render: (_, row) => (
              <Button type="link" size="small" loading={preview.loading} onClick={() => void preview.show(row.id)}>
                查看
              </Button>
            ),
          },
        ]}
      />
      <InvoicePreview
        open={preview.open}
        loading={preview.loading}
        error={preview.error}
        imageUrl={preview.imageUrl}
        pages={preview.pages}
        onClose={preview.close}
      />
    </>
  );
}
