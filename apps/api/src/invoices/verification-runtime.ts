import { CustomModelInvoiceVerify, TencentVatInvoiceVerify, VerificationNotConfigured } from '@frs/adapters';
import type { VerificationDecision } from '@frs/domain';

export type InvoiceVerifier = {
  verify(input: {
    invoiceCode: string;
    invoiceNumber: string;
    invoiceDate: string;
    amountYuan?: string;
  }): Promise<VerificationDecision>;
};

export type CompanyVerificationSetting = {
  provider: string;
  baseUrl: string;
  model: string;
  region: string;
  secretId: string;
  apiKey: string;
};

export function verifierForSetting(
  setting: CompanyVerificationSetting | null,
  fallback: InvoiceVerifier,
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>,
): InvoiceVerifier {
  if (!setting) {
    return fallback;
  }
  if (setting.provider === 'off') {
    return {
      async verify() {
        throw new VerificationNotConfigured('本公司已关闭查验，发票保持未验真');
      },
    };
  }
  if (setting.provider === 'tencent') {
    const client = new TencentVatInvoiceVerify({
      secretId: setting.secretId,
      secretKey: setting.apiKey,
      region: setting.region || 'ap-guangzhou',
    });
    return { verify: (input) => client.verify(input) };
  }
  if (setting.provider === 'custom') {
    const client = new CustomModelInvoiceVerify(
      { baseUrl: setting.baseUrl, model: setting.model, apiKey: setting.apiKey },
      fetchImpl,
    );
    return { verify: (input) => client.verify(input) };
  }
  return {
    async verify() {
      throw new VerificationNotConfigured();
    },
  };
}
