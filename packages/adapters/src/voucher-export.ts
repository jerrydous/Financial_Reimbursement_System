// 凭证导出调用金蝶 K3Cloud 官方 Save 接口。本文件只组已支付单据的报文并提交。
import { voucherFromPaidReport, type Fen, type VoucherDraft } from '@frs/domain';

export type VoucherExportResult = {
  posted: boolean;
  payload: VoucherDraft;
  message: string;
};

export function buildVoucherPayload(input: {
  reportId: string;
  status: string;
  paidOn: string;
  amount: Fen;
  explanation: string;
}): VoucherDraft {
  return voucherFromPaidReport(input);
}

export class KingdeeVoucherExport {
  constructor(private readonly baseUrl: string) {}

  async exportPaid(input: {
    reportId: string;
    status: string;
    paidOn: string;
    amount: Fen;
    explanation: string;
  }): Promise<VoucherExportResult> {
    const payload = buildVoucherPayload(input);
    if (!this.baseUrl) {
      return { posted: false, payload, message: '未配置金蝶地址，只生成凭证报文' };
    }
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/k3cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        formid: payload.formId,
        data: {
          Model: {
            FDate: payload.date,
            FEntity: payload.lines.map((line) => ({
              FEXPLANATION: line.explanation,
              FDEBIT: line.debitYuan,
              FCREDIT: line.creditYuan,
            })),
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { posted: false, payload, message: `金蝶返回 ${response.status}` };
    }
    return { posted: true, payload, message: '' };
  }
}

export function createVoucherExportFromEnv(): KingdeeVoucherExport {
  return new KingdeeVoucherExport(process.env.KINGDEE_BASE_URL ?? '');
}
