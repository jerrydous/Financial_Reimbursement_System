import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Space, Typography } from 'antd';
import type { SettledSummary } from '@frs/contracts';
import { getSettledSummary } from './api';
import { categoryLabel, formatMoney, sourceLabel } from './labels';

const sliceColors = ['#C4513A', '#3D5A80', '#1F6B58', '#C48A2A', '#8C6A4F', '#6B7C8A'];

type Slice = SettledSummary['currencies'][number]['byCategory'][number];

export function SettledPage({ enabled }: { enabled: boolean }) {
  const summary = useQuery({
    queryKey: ['settled-summary'],
    enabled,
    queryFn: getSettledSummary,
  });
  if (!enabled) {
    return <Typography.Paragraph>请先登录。</Typography.Paragraph>;
  }
  const currencies = summary.data?.currencies ?? [];
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        已结算费用
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        只统计已支付的报销。左图是吃穿住行，右图是商家或应用。不同币种分开，不互相折算。更早没有填写的发票会计入「未分类」或「未填写」。
      </Typography.Paragraph>
      {summary.error instanceof Error ? <Alert type="error" message={summary.error.message} /> : null}
      {summary.isLoading ? <Typography.Text>正在汇总…</Typography.Text> : null}
      {!summary.isLoading && currencies.length === 0 ? <Typography.Text>还没有已结算的费用。</Typography.Text> : null}
      {currencies.map((item) => (
        <Space key={item.currency} size="large" align="start" wrap>
          <PieCard title={`类别 · ${item.currency}`} slices={item.byCategory} totalFen={item.totalFen} currency={item.currency} kind="category" />
          <PieCard title={`来源 · ${item.currency}`} slices={item.bySource} totalFen={item.totalFen} currency={item.currency} kind="source" />
        </Space>
      ))}
    </Space>
  );
}

function PieCard({
  title,
  slices,
  totalFen,
  currency,
  kind,
}: {
  title: string;
  slices: Slice[];
  totalFen: string;
  currency: string;
  kind: 'category' | 'source';
}) {
  return (
    <Card title={title} style={{ width: 380 }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Pie slices={slices} />
      </div>
      <div style={{ marginTop: 8 }}>
        {slices.map((slice, index) => (
          <div key={slice.key} style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '28px' }}>
            <span style={{ width: 12, height: 12, flex: '0 0 auto', background: sliceColors[index % sliceColors.length] }} />
            <span>{kind === 'category' ? (categoryLabel[slice.key] ?? slice.key) : sourceLabel(slice.key)}</span>
            <span style={{ marginLeft: 'auto', color: 'rgba(0, 0, 0, 0.45)' }}>
              {formatMoney(slice.amountFen, currency)} · {shareText(slice.amountFen, totalFen)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Pie({ slices }: { slices: Slice[] }) {
  const paths = piePaths(slices);
  return (
    <svg width="180" height="180" viewBox="0 0 200 200" role="img" aria-label="费用饼图">
      {paths.map((path, index) => (
        <path key={slices[index]?.key ?? index} d={path} fill={sliceColors[index % sliceColors.length]} />
      ))}
    </svg>
  );
}

function piePaths(slices: Slice[]): string[] {
  const total = slices.reduce((sum, slice) => sum + BigInt(slice.amountFen), 0n);
  if (total <= 0n) {
    return [];
  }
  let cursor = 0n;
  return slices.map((slice) => {
    const start = cursor;
    const amount = BigInt(slice.amountFen);
    cursor += amount;
    if (amount === total) {
      return 'M 100 20 A 80 80 0 1 1 100 180 A 80 80 0 1 1 100 20';
    }
    return wedge(start, cursor, total);
  });
}

function wedge(start: bigint, end: bigint, total: bigint): string {
  const startAngle = angle(start, total);
  const endAngle = angle(end, total);
  const radius = 80;
  const x1 = 100 + radius * Math.cos(startAngle);
  const y1 = 100 + radius * Math.sin(startAngle);
  const x2 = 100 + radius * Math.cos(endAngle);
  const y2 = 100 + radius * Math.sin(endAngle);
  const large = end - start > total / 2n ? 1 : 0;
  return `M 100 100 L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
}

function angle(part: bigint, total: bigint): number {
  const scale = 100000n;
  return (Number((part * scale) / total) / Number(scale)) * Math.PI * 2 - Math.PI / 2;
}

function shareText(amountFen: string, totalFen: string): string {
  const total = BigInt(totalFen);
  if (total <= 0n) {
    return '0%';
  }
  const hundredths = (BigInt(amountFen) * 10000n) / total;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}%`;
}
