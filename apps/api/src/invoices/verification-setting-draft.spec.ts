import { describe, expect, it } from 'vitest';
import { DomainError } from '@frs/domain';
import { draftVerificationSetting, type StoredVerificationSetting } from './verification-setting-draft';

const seal = (plain: string) => `sealed:${plain}`;

const storedCustom: StoredVerificationSetting = {
  provider: 'custom',
  baseUrl: 'https://model.example/v1',
  model: 'demo-model',
  region: '',
  secretId: '',
  apiKey: 'sealed:old-key',
};

describe('验真配置草稿', () => {
  it('关闭查验时保留已保存的密钥', () => {
    expect(draftVerificationSetting(storedCustom, blank('off'), seal).apiKey).toBe('sealed:old-key');
  });

  it('同一入口留空密钥时沿用旧值', () => {
    const draft = draftVerificationSetting(storedCustom, { ...blank('custom'), baseUrl: 'https://model.example/v1/', model: 'demo-model' }, seal);
    expect(draft.apiKey).toBe('sealed:old-key');
    expect(draft.baseUrl).toBe('https://model.example/v1');
  });

  it('更换入口必须重新填写 API Key', () => {
    expect(() => draftVerificationSetting(storedCustom, { ...blank('tencent'), secretId: 'AKIDexample1' }, seal)).toThrow(DomainError);
    const draft = draftVerificationSetting(
      storedCustom,
      { ...blank('tencent'), secretId: 'AKIDexample1', region: 'ap-beijing', apiKey: 'SecretKey1' },
      seal,
    );
    expect(draft).toMatchObject({ provider: 'tencent', secretId: 'AKIDexample1', region: 'ap-beijing', apiKey: 'sealed:SecretKey1', baseUrl: '' });
  });

  it('拒绝带参数的地址和带空格的密钥', () => {
    expect(() =>
      draftVerificationSetting(null, { ...blank('custom'), baseUrl: 'https://model.example/v1?token=1', model: 'demo', apiKey: 'SecretKey1' }, seal),
    ).toThrow(/不要带参数/);
    expect(() =>
      draftVerificationSetting(null, { ...blank('custom'), baseUrl: 'https://model.example/v1', model: 'demo', apiKey: 'secret key' }, seal),
    ).toThrow(/不能包含空格/);
  });
});

function blank(provider: 'off' | 'tencent' | 'custom') {
  return { provider, baseUrl: '', model: '', region: '', secretId: '', apiKey: '' };
}
