// 发票查验来自腾讯云 OCR 官方 SDK 的 VatInvoiceVerify。本文件只提交号码并读回官方字段。
import { verificationFromOfficial, type VerificationDecision } from '@frs/domain';

export class VerificationTimeout extends Error {
  constructor() {
    super('查验超时');
    this.name = 'VerificationTimeout';
  }
}

export class VerificationNotConfigured extends Error {
  constructor() {
    super('未配置腾讯云密钥，不能查验发票');
    this.name = 'VerificationNotConfigured';
  }
}

type VerifyResponse = {
  Invoice?: {
    Number?: string;
    BuyerName?: string;
    BuyerTaxCode?: string;
  };
  RequestId?: string;
};

type VerifyClient = {
  VatInvoiceVerifyNew(params: {
    InvoiceNo: string;
    InvoiceDate: string;
    InvoiceCode?: string;
    Amount?: string;
  }): Promise<VerifyResponse>;
};

export function readVatVerifyFields(response: VerifyResponse | null): { invoiceNumber: string; buyerName: string; buyerTaxId: string } | null {
  const invoice = response?.Invoice;
  if (!invoice?.Number) {
    return null;
  }
  return {
    invoiceNumber: invoice.Number,
    buyerName: invoice.BuyerName ?? '',
    buyerTaxId: invoice.BuyerTaxCode ?? '',
  };
}

export function decideVatVerify(response: VerifyResponse | null, expectedNumber: string): VerificationDecision {
  return verificationFromOfficial(readVatVerifyFields(response), expectedNumber);
}

export class TencentVatInvoiceVerify {
  constructor(
    private readonly options: {
      secretId: string;
      secretKey: string;
      region: string;
    },
  ) {}

  async verify(input: {
    invoiceCode: string;
    invoiceNumber: string;
    invoiceDate: string;
    amountYuan?: string;
  }): Promise<VerificationDecision> {
    if (!this.options.secretId || !this.options.secretKey) {
      throw new VerificationNotConfigured();
    }
    const loaded = (await import('tencentcloud-sdk-nodejs-ocr')) as unknown as {
      ocr?: { v20181119: { Client: new (config: object) => VerifyClient } };
      default?: { ocr?: { v20181119: { Client: new (config: object) => VerifyClient } } };
    };
    const root = loaded.ocr ? loaded : loaded.default;
    if (!root?.ocr) {
      throw new Error('腾讯云 OCR SDK 没有加载成功');
    }
    const client = new root.ocr.v20181119.Client({
      credential: { secretId: this.options.secretId, secretKey: this.options.secretKey },
      region: this.options.region,
      profile: { httpProfile: { reqTimeout: 10 } },
    });
    try {
      const response = await client.VatInvoiceVerifyNew({
        InvoiceCode: input.invoiceCode || undefined,
        InvoiceNo: input.invoiceNumber,
        InvoiceDate: input.invoiceDate,
        Amount: input.amountYuan || undefined,
      });
      return decideVatVerify(response, input.invoiceNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.toLowerCase().includes('timeout') || message.includes('超时')) {
        throw new VerificationTimeout();
      }
      return {
        status: 'failed',
        buyerName: '',
        buyerTaxId: '',
        message: message || '查验没有返回这张发票',
      };
    }
  }
}

export function createInvoiceVerifierFromEnv(): {
  verify(input: { invoiceCode: string; invoiceNumber: string; invoiceDate: string; amountYuan?: string }): Promise<VerificationDecision>;
} {
  const provider = (process.env.VERIFY_PROVIDER ?? process.env.OCR_PROVIDER ?? '').trim().toLowerCase();
  if (provider !== 'tencent') {
    return {
      verify: async () => {
        throw new VerificationNotConfigured();
      },
    };
  }
  const verifier = new TencentVatInvoiceVerify({
    secretId: process.env.TENCENT_SECRET_ID ?? '',
    secretKey: process.env.TENCENT_SECRET_KEY ?? '',
    region: process.env.TENCENT_OCR_REGION ?? 'ap-guangzhou',
  });
  return { verify: (input) => verifier.verify(input) };
}
