import { normalizeCustomBaseUrl } from '@frs/adapters';
import { DomainError } from '@frs/domain';

export type VerificationProvider = 'off' | 'tencent' | 'custom';

export type StoredVerificationSetting = {
  provider: string;
  baseUrl: string;
  model: string;
  region: string;
  secretId: string;
  apiKey: string;
};

export type VerificationSettingInput = {
  provider: VerificationProvider;
  baseUrl: string;
  model: string;
  region: string;
  secretId: string;
  apiKey: string;
};

export type VerificationSettingDraft = {
  provider: VerificationProvider;
  baseUrl: string;
  model: string;
  region: string;
  secretId: string;
  apiKey: string;
};

const SECRET_TEXT = /^[\x21-\x7e]{8,512}$/;

export function draftVerificationSetting(
  existing: StoredVerificationSetting | null,
  input: VerificationSettingInput,
  seal: (plain: string) => string,
): VerificationSettingDraft {
  if (input.provider === 'off') {
    return {
      provider: 'off',
      baseUrl: existing?.baseUrl ?? '',
      model: existing?.model ?? '',
      region: existing?.region || 'ap-guangzhou',
      secretId: existing?.secretId ?? '',
      apiKey: existing?.apiKey ?? '',
    };
  }
  const apiKey = resolveApiKey(existing, input, seal);
  if (input.provider === 'tencent') {
    const secretId = input.secretId.trim();
    if (!/^[A-Za-z0-9]{8,128}$/.test(secretId)) {
      throw new DomainError('REQUEST_INVALID', '请填写腾讯云 SecretId');
    }
    const region = input.region.trim() || 'ap-guangzhou';
    if (!/^[a-z0-9-]{2,32}$/.test(region)) {
      throw new DomainError('REQUEST_INVALID', '地域请用小写，例如 ap-guangzhou');
    }
    return { provider: 'tencent', baseUrl: '', model: '', region, secretId, apiKey };
  }
  const baseUrl = normalizeCustomBaseUrl(input.baseUrl);
  if (!baseUrl) {
    throw new DomainError('REQUEST_INVALID', '请填写 http 或 https 的模型地址，地址里不要带参数');
  }
  const model = input.model.trim();
  if (!/^[\x21-\x7e]{1,120}$/.test(model)) {
    throw new DomainError('REQUEST_INVALID', '请填写模型名称');
  }
  return { provider: 'custom', baseUrl, model, region: '', secretId: '', apiKey };
}

function resolveApiKey(existing: StoredVerificationSetting | null, input: VerificationSettingInput, seal: (plain: string) => string): string {
  const typed = input.apiKey.trim();
  const providerChanged = !existing || existing.provider !== input.provider;
  if (!typed) {
    if (providerChanged || !existing?.apiKey) {
      throw new DomainError('REQUEST_INVALID', '请填写 API Key');
    }
    return existing.apiKey;
  }
  if (!SECRET_TEXT.test(typed)) {
    throw new DomainError('REQUEST_INVALID', 'API Key 需要 8 到 512 位，且不能包含空格');
  }
  return seal(typed);
}
