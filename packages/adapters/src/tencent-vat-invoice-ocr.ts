// 增值税发票识别来自腾讯云 OCR 官方 SDK。本文件只提交影像并取出字段。
import { draftFromVatPairs, type OcrDraft } from '@frs/domain';
import { TesseractInvoiceOcr } from './tesseract-invoice-ocr';

export type InvoiceOcrResult = {
  pairs: { name: string; value: string }[];
  requestId: string;
  draft: OcrDraft;
};

type VatClient = {
  VatInvoiceOCR(params: { ImageBase64: string; IsPdf?: boolean; PdfPageNumber?: number }): Promise<{
    VatInvoiceInfos?: { Name?: string; Value?: string }[];
    RequestId?: string;
  }>;
};

export class TencentVatInvoiceOcr {
  constructor(
    private readonly options: {
      secretId: string;
      secretKey: string;
      region: string;
    },
  ) {}

  async recognize(file: { body: Buffer; contentType: string }): Promise<InvoiceOcrResult> {
    if (!this.options.secretId || !this.options.secretKey) {
      throw new Error('未配置腾讯云密钥，不能识别发票');
    }
    const loaded = (await import('tencentcloud-sdk-nodejs-ocr')) as {
      ocr?: { v20181119: { Client: new (config: object) => VatClient } };
      default?: { ocr?: { v20181119: { Client: new (config: object) => VatClient } } };
    };
    const root = loaded.ocr ? loaded : loaded.default;
    if (!root?.ocr) {
      throw new Error('腾讯云 OCR SDK 没有加载成功');
    }
    const client = new root.ocr.v20181119.Client({
      credential: { secretId: this.options.secretId, secretKey: this.options.secretKey },
      region: this.options.region,
      profile: { httpProfile: { reqTimeout: 10 } },
    }) as unknown as VatClient;
    const pdf = file.contentType === 'application/pdf';
    const response = await client.VatInvoiceOCR({
      ImageBase64: file.body.toString('base64'),
      IsPdf: pdf,
      PdfPageNumber: pdf ? 1 : undefined,
    });
    const pairs = (response.VatInvoiceInfos ?? [])
      .filter((item) => item.Name && item.Value)
      .map((item) => ({ name: item.Name ?? '', value: item.Value ?? '' }));
    return {
      pairs,
      requestId: response.RequestId ?? '',
      draft: draftFromVatPairs(pairs),
    };
  }
}

export function createInvoiceOcrFromEnv(): { recognize(file: { body: Buffer; contentType: string }): Promise<{ pairs: { name: string; value: string }[]; requestId: string } | null> } {
  const provider = (process.env.OCR_PROVIDER ?? '').trim().toLowerCase();
  if (provider === 'off' || provider === 'none') {
    return { recognize: async () => null };
  }
  if (provider === 'tencent') {
    const ocr = new TencentVatInvoiceOcr({
      secretId: process.env.TENCENT_SECRET_ID ?? '',
      secretKey: process.env.TENCENT_SECRET_KEY ?? '',
      region: process.env.TENCENT_OCR_REGION ?? 'ap-guangzhou',
    });
    return {
      recognize: async (file) => {
        const result = await ocr.recognize(file);
        return { pairs: result.pairs, requestId: result.requestId };
      },
    };
  }
  return {
    recognize: async (file) => new TesseractInvoiceOcr().recognize(file),
  };
}
