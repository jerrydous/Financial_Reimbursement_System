// 开源识票：PDF 先取文字层，图片交给 tesseract.js。字段对应不依赖云厂商。
import { invoiceTextFromGlyphs, pairsFromInvoiceText } from '@frs/domain';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const nodeRequire = createRequire(__filename);

type OcrFile = { body: Buffer; contentType: string };

type OcrWorker = {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
};

let workerTask: Promise<OcrWorker> | null = null;

async function imageWorker(): Promise<OcrWorker> {
  if (!workerTask) {
    workerTask = (async () => {
      const tesseract = (await import('tesseract.js')) as {
        createWorker: (lang: string) => Promise<OcrWorker>;
      };
      return tesseract.createWorker('chi_sim+eng');
    })().catch((error: unknown) => {
      workerTask = null;
      throw error;
    });
  }
  return workerTask;
}

async function textFromPdf(body: Buffer): Promise<string> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as {
    getDocument: (src: object) => { promise: Promise<{ getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>; destroy: () => Promise<void> }> };
    GlobalWorkerOptions: { workerSrc: string };
  };
  const workerPath = pathToFileURL(nodeRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(body), verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    return invoiceTextFromGlyphs(
      content.items.map((item) => {
        const positioned = item as { str?: string; transform?: number[] };
        return {
          str: positioned.str ?? '',
          x: positioned.transform?.[4] ?? 0,
          y: positioned.transform?.[5] ?? 0,
        };
      }),
    );
  } finally {
    await doc.destroy();
  }
}

function readable(text: string): boolean {
  return text.replace(/\s/g, '').length >= 20;
}

export class TesseractInvoiceOcr {
  async recognize(file: OcrFile): Promise<{ pairs: { name: string; value: string }[]; requestId: string }> {
    let text = '';
    if (file.contentType === 'application/pdf') {
      text = await textFromPdf(file.body).catch(() => '');
      if (!readable(text)) {
        throw new Error('这张 PDF 没有可复制的文字。请改传清晰的发票图片，或手工填写');
      }
    } else {
      const worker = await imageWorker();
      const result = await worker.recognize(file.body).catch(() => {
        throw new Error('没有从影像里读出文字，请换一张更清晰的图片或手工填写');
      });
      text = result.data.text;
      if (!readable(text)) {
        throw new Error('没有从影像里读出文字，请换一张更清晰的图片或手工填写');
      }
    }
    return { pairs: pairsFromInvoiceText(text), requestId: 'tesseract' };
  }
}
