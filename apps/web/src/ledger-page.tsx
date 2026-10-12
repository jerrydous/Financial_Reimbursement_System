import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Dropdown, Modal, Select, Table, Typography } from 'antd';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { classifyInvoice, createExpenseReport, createLedgerExport, listColleagues, listInvoices, submitExpenseReport, transferInvoice, verifyInvoice } from './api';
import { formatMoney, roleLabel, verificationLabel } from './labels';

const buckets = [
  { key: 'unreimbursed', label: '未报销' },
  { key: 'reimbursed', label: '已报销' },
  { key: 'exempt', label: '免报销' },
  { key: 'removed', label: '已移除' },
  { key: 'transferred', label: '已转交' },
] as const;

type Bucket = (typeof buckets)[number]['key'];

export function LedgerPage({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { message } = AntdApp.useApp();
  const [bucket, setBucket] = useState<Bucket>('unreimbursed');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState<string>();
  const pendingKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const invoices = useQuery({
    queryKey: ['invoices', bucket, page],
    enabled,
    queryFn: () => listInvoices(page, 20, bucket),
  });
  const colleagues = useQuery({ queryKey: ['colleagues'], queryFn: listColleagues, enabled: transferOpen });
  const refresh = async () => {
    setSelected([]);
    await client.invalidateQueries({ queryKey: ['invoices'] });
  };
  const classify = useMutation({
    mutationFn: (action: 'exempt' | 'remove') => Promise.all(selected.map((id) => classifyInvoice(id, action))),
    onSuccess: async () => {
      message.success('分类已更新');
      await refresh();
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '分类没有更新'),
  });
  const transfer = useMutation({
    mutationFn: async () => {
      if (!transferTo) {
        throw new Error('选择转交对象');
      }
      await Promise.all(selected.map((id) => transferInvoice(id, transferTo)));
    },
    onSuccess: async () => {
      setTransferOpen(false);
      message.success('发票已转交');
      await refresh();
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '转交没有完成'),
  });
  const createReport = useMutation({
    mutationFn: async () => {
      const fingerprint = [...selected].sort().join(',');
      if (!pendingKey.current || pendingKey.current.fingerprint !== fingerprint) {
        pendingKey.current = { fingerprint, key: crypto.randomUUID() };
      }
      const draft = await createExpenseReport(selected, pendingKey.current.key);
      return submitExpenseReport(draft.id, `${pendingKey.current.key}:submit`);
    },
    onSuccess: (report) => {
      pendingKey.current = null;
      void navigate(`/expense-reports/${report.id}`);
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '报销单没有创建'),
  });

  if (!enabled) {
    return <section className="panel">请先登录。</section>;
  }

  return (
    <section className="panel">
      <div className="tab-row">
        {buckets.map((item) => (
          <button
            key={item.key}
            type="button"
            className={bucket === item.key ? 'tab active' : 'tab'}
            onClick={() => {
              setBucket(item.key);
              setPage(1);
              setSelected([]);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="panel-head">
        <Typography.Text className="quiet">共 {invoices.data?.total ?? 0} 条</Typography.Text>
        <div>
          <Button
            style={{ marginRight: 8 }}
            onClick={() => {
              void createLedgerExport(crypto.randomUUID()).then((job) => {
                if (job.downloadPath) {
                  window.open(job.downloadPath, '_blank', 'noopener');
                }
                message.success(job.status === 'succeeded' ? '台账已导出' : job.message || '导出已排队');
              }).catch((error: unknown) => {
                message.error(error instanceof Error ? error.message : '没有导出');
              });
            }}
          >
            导出台账
          </Button>
          <Link to="/ledger/new">
            <Button type="primary">新建费用</Button>
          </Link>
        </div>
      </div>
      <Table
        rowKey="id"
        loading={invoices.isLoading}
        dataSource={invoices.data?.items ?? []}
        locale={{ emptyText: '暂无发票' }}
        rowSelection={
          bucket === 'unreimbursed'
            ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) }
            : undefined
        }
        pagination={{
          current: page,
          pageSize: 20,
          total: invoices.data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          { title: '发票号码', dataIndex: 'invoiceNumber', render: (value: string) => value || '待确认' },
          { title: '销售方', dataIndex: 'sellerName', render: (value: string) => value || '—' },
          { title: '开票日期', dataIndex: 'invoiceDate', render: (value: string) => value || '—' },
          {
            title: '价税合计',
            dataIndex: 'amountFen',
            render: (amount: string | null, row) => formatMoney(amount, row.currency),
          },
          {
            title: '验真',
            dataIndex: 'verificationStatus',
            render: (value: string, row: { id: string; recognitionStatus: string; currency: string }) => (
              <span>
                {verificationLabel[value] ?? value}
                {value === 'unverified' && row.recognitionStatus === 'confirmed' ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      void verifyInvoice(row.id, crypto.randomUUID())
                        .then(async () => {
                          message.success('查验完成');
                          await refresh();
                        })
                        .catch((error: unknown) => message.error(error instanceof Error ? error.message : '没有查验'));
                    }}
                  >
                    查验
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      {bucket === 'unreimbursed' ? (
        <div className="ledger-bar">
          <span className="quiet">已选 {selected.length} 张</span>
          <Button type="primary" disabled={selected.length === 0} loading={createReport.isPending} onClick={() => void createReport.mutateAsync()}>
            创建报销单
          </Button>
          <Dropdown
            disabled={selected.length === 0}
            menu={{
              items: [
                { key: 'exempt', label: '免报销' },
                { key: 'remove', label: '移除', danger: true },
                { key: 'transfer', label: '转交' },
              ],
              onClick: ({ key }) => {
                if (key === 'transfer') {
                  setTransferOpen(true);
                  return;
                }
                void classify.mutateAsync(key === 'exempt' ? 'exempt' : 'remove');
              },
            }}
          >
            <Button disabled={selected.length === 0}>分类</Button>
          </Dropdown>
        </div>
      ) : null}
      <Modal
        title="转交发票"
        open={transferOpen}
        transitionName=""
        maskTransitionName=""
        confirmLoading={transfer.isPending}
        onCancel={() => setTransferOpen(false)}
        onOk={() => void transfer.mutateAsync()}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="选择同事"
          loading={colleagues.isLoading}
          value={transferTo}
          onChange={setTransferTo}
          options={(colleagues.data ?? []).map((person) => ({
            value: person.id,
            label: `${person.name} · ${roleLabel[person.role] ?? person.role}`,
          }))}
        />
      </Modal>
    </section>
  );
}
