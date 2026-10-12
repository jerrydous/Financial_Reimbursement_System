import { Button, Form, Input, Modal, Typography } from 'antd';
import { useState } from 'react';
import { loginWithPassword } from './auth';

export function LoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ username: string; password: string }>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(values: { username: string; password: string }) {
    setSubmitting(true);
    setError('');
    try {
      await loginWithPassword(values.username, values.password);
      form.resetFields();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录没有成功，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="登录"
      open={open}
      footer={null}
      width={400}
      destroyOnHidden
      onCancel={() => {
        if (!submitting) {
          setError('');
          onClose();
        }
      }}
    >
      <Typography.Paragraph className="quiet" style={{ marginTop: 0 }}>
        使用员工账号登录，登录后仍停留在当前页面。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请填写用户名' }]}>
          <Input autoFocus placeholder="请输入用户名" autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请填写密码' }]}>
          <Input.Password placeholder="请输入密码" autoComplete="current-password" />
        </Form.Item>
        {error ? (
          <Typography.Paragraph type="danger" style={{ marginTop: -8 }}>
            {error}
          </Typography.Paragraph>
        ) : null}
        <Button type="primary" htmlType="submit" block loading={submitting}>
          登录
        </Button>
      </Form>
    </Modal>
  );
}
