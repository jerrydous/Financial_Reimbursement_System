import { Button, Typography } from 'antd';
import { roleLabel } from './labels';

export function TransferChoices({
  loading,
  error,
  people,
  value,
  onChange,
}: {
  loading: boolean;
  error: string;
  people: { id: string; name: string; role: string }[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {loading ? <Typography.Text>正在读取账号…</Typography.Text> : null}
      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
      {!loading && !error && people.length === 0 ? <Typography.Text>本公司没有其他可转交的账号</Typography.Text> : null}
      {people.map((person) => (
        <Button key={person.id} block type={value === person.id ? 'primary' : 'default'} onClick={() => onChange(person.id)}>
          {person.name} · {roleLabel[person.role] ?? person.role}
        </Button>
      ))}
    </div>
  );
}
