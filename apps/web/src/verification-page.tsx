import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App as AntdApp, Button, Input, Select, Typography } from 'antd';
import { useState } from 'react';
import { getVerificationSetting, saveVerificationSetting, type VerificationSetting } from './api';

type Provider = VerificationSetting['provider'];

type FormState = {
  provider: Provider;
  baseUrl: string;
  model: string;
  region: string;
  secretId: string;
  apiKey: string;
};

function formFromSetting(setting: VerificationSetting): FormState {
  return {
    provider: setting.provider,
    baseUrl: setting.baseUrl,
    model: setting.model,
    region: setting.region || 'ap-guangzhou',
    secretId: setting.secretId,
    apiKey: '',
  };
}

export function VerificationSettingsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const setting = useQuery({ queryKey: ['verification-setting'], queryFn: getVerificationSetting });
  const [draft, setDraft] = useState<FormState | null>(null);
  const form = draft ?? (setting.data ? formFromSetting(setting.data) : emptyForm());
  const saved = setting.data;

  const save = useMutation({
    mutationFn: (input: FormState) => saveVerificationSetting(input),
    onSuccess: async (next) => {
      setDraft(formFromSetting(next));
      await queryClient.invalidateQueries({ queryKey: ['verification-setting'] });
      message.success('验真配置已保存');
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '没有保存'),
  });

  const providerChanged = Boolean(saved && saved.provider !== 'off' && form.provider !== saved.provider);
  const keyPlaceholder = providerChanged
    ? '更换查验入口时请重新填写 API Key'
    : saved?.apiKeySet
      ? `已保存末四位 ${saved.apiKeyHint || '****'}，留空则不修改`
      : '请填写 API Key';

  function update(patch: Partial<FormState>) {
    setDraft({ ...form, ...patch });
  }

  return (
    <section className="panel">
      <h3>验真配置</h3>
      <Typography.Paragraph className="quiet">
        财务在这里填写本公司的查验入口。API Key 只保存在服务器上，保存后不再显示全文。还没有保存过配置时，查验仍使用部署环境里的腾讯云变量。保存为「不启用」后，环境变量也不再参与查验。
      </Typography.Paragraph>
      {setting.error ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="error"
          showIcon
          message={setting.error instanceof Error ? setting.error.message : '读不到验真配置'}
        />
      ) : null}
      <Select
        style={{ width: '100%', marginBottom: 12 }}
        value={form.provider}
        onChange={(value: Provider) => update({ provider: value })}
        options={[
          { value: 'off', label: '不启用' },
          { value: 'tencent', label: '腾讯云查验' },
          { value: 'custom', label: '自定义模型' },
        ]}
      />
      {form.provider === 'tencent' ? (
        <>
          <Typography.Paragraph className="quiet">使用腾讯云增值税发票核验。SecretId 和 SecretKey 填写你自己的账号。</Typography.Paragraph>
          <Input style={{ marginBottom: 12 }} placeholder="SecretId" autoComplete="off" value={form.secretId} onChange={(event) => update({ secretId: event.target.value })} />
          <Input style={{ marginBottom: 12 }} placeholder="地域，例如 ap-guangzhou" value={form.region} onChange={(event) => update({ region: event.target.value })} />
          <Input.Password style={{ marginBottom: 12 }} placeholder={keyPlaceholder} autoComplete="new-password" value={form.apiKey} onChange={(event) => update({ apiKey: event.target.value })} />
        </>
      ) : null}
      {form.provider === 'custom' ? (
        <>
          <Typography.Paragraph className="quiet">
            接口需要兼容 OpenAI 的 chat/completions。请求会发到你填写的地址，并带上 API Key。只有返回 JSON 里 found 为 true，且 invoiceNumber 与票面一致，才会标成验真通过。请把地址指到你自己的查验服务。模型如果只是把票面号码原样返回，系统也会把它标成通过。这不是税务局直连。
          </Typography.Paragraph>
          <Input style={{ marginBottom: 12 }} placeholder="https://api.example/v1" autoComplete="off" value={form.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} />
          <Input style={{ marginBottom: 12 }} placeholder="模型名称" autoComplete="off" value={form.model} onChange={(event) => update({ model: event.target.value })} />
          <Input.Password style={{ marginBottom: 12 }} placeholder={keyPlaceholder} autoComplete="new-password" value={form.apiKey} onChange={(event) => update({ apiKey: event.target.value })} />
        </>
      ) : null}
      <Button type="primary" loading={save.isPending || setting.isLoading} disabled={setting.isLoading} onClick={() => void save.mutateAsync(form)}>
        保存
      </Button>
    </section>
  );
}

function emptyForm(): FormState {
  return { provider: 'off', baseUrl: '', model: '', region: 'ap-guangzhou', secretId: '', apiKey: '' };
}
