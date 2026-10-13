// 台账文件来自 exceljs。本文件只按列定义写入工作簿。
import { minorToAmountText, parseFen } from '@frs/domain';

export type LedgerRow = {
  invoiceCode: string;
  invoiceNumber: string;
  amountFen: string | null;
  currency?: string;
  sellerName: string;
  invoiceDate: string;
  verificationStatus: string;
  ledgerStatus: string;
  reportId: string;
};

export const ledgerColumns = [
  { header: '发票代码', key: 'invoiceCode', width: 18 },
  { header: '发票号码', key: 'invoiceNumber', width: 24 },
  { header: '价税合计', key: 'amountYuan', width: 18 },
  { header: '销售方', key: 'sellerName', width: 28 },
  { header: '开票日期', key: 'invoiceDate', width: 14 },
  { header: '验真', key: 'verificationStatus', width: 12 },
  { header: '台账状态', key: 'ledgerStatus', width: 12 },
  { header: '报销单号', key: 'reportId', width: 38 },
] as const;

const verificationText: Record<string, string> = {
  unverified: '未验真',
  verified: '验真通过',
  failed: '验真未通过',
};

export async function buildLedgerWorkbook(rows: readonly LedgerRow[]): Promise<Buffer> {
  const excel = (await import('exceljs')) as {
    Workbook?: new () => WorkbookLike;
    default?: { Workbook?: new () => WorkbookLike };
  };
  const Workbook = excel.Workbook ?? excel.default?.Workbook;
  if (!Workbook) {
    throw new Error('exceljs 没有加载成功');
  }
  const book = new Workbook();
  const sheet = book.addWorksheet('发票台账');
  sheet.columns = ledgerColumns.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  for (const row of rows) {
    sheet.addRow({
      invoiceCode: row.invoiceCode,
      invoiceNumber: row.invoiceNumber,
      amountYuan: row.amountFen ? minorToAmountText(parseFen(row.amountFen), row.currency ?? 'CNY') : '',
      sellerName: row.sellerName,
      invoiceDate: row.invoiceDate,
      verificationStatus: verificationText[row.verificationStatus] ?? row.verificationStatus,
      ledgerStatus: row.ledgerStatus,
      reportId: row.reportId,
    });
  }
  const contents = await book.xlsx.writeBuffer();
  return Buffer.from(contents);
}

type WorkbookLike = {
  addWorksheet: (name: string) => {
    columns: { header: string; key: string; width: number }[];
    addRow: (row: Record<string, string>) => void;
  };
  xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
};
