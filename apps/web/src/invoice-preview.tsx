import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { useEffect, useState } from 'react';
import { Modal, Typography } from 'antd';
import { invoiceContent } from './api';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

async function renderPdfPages(data: ArrayBuffer): Promise<string[]> {
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;
  try {
    const urls: string[] = [];
    const count = Math.min(pdf.numPages, 8);
    for (let number = 1; number <= count; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      urls.push(canvas.toDataURL('image/jpeg', 0.92));
      page.cleanup();
    }
    return urls;
  } finally {
    await pdf.destroy();
  }
}

export function useInvoicePreview() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  async function show(invoiceId: string) {
    setOpen(true);
    setLoading(true);
    setError('');
    setPages([]);
    setImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    try {
      const file = await invoiceContent(invoiceId);
      if (file.contentType.startsWith('image/')) {
        setImageUrl(URL.createObjectURL(file.blob));
      } else if (file.contentType === 'application/pdf') {
        setPages(await renderPdfPages(await file.blob.arrayBuffer()));
      } else {
        setError('这个影像格式暂时不能预览');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时不能查看影像');
    } finally {
      setLoading(false);
    }
  }

  return { open, loading, error, imageUrl, pages, show, close: () => setOpen(false) };
}

export function InvoicePreview({
  open,
  loading,
  error,
  imageUrl,
  pages,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string;
  imageUrl: string | null;
  pages: string[];
  onClose: () => void;
}) {
  return (
    <Modal title="发票影像" open={open} footer={null} onCancel={onClose} width={840} transitionName="" maskTransitionName="">
      {loading ? <Typography.Text>正在打开影像…</Typography.Text> : null}
      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
      {imageUrl ? <img src={imageUrl} alt="发票影像" style={{ display: 'block', maxWidth: '100%', margin: '0 auto', background: '#fff' }} /> : null}
      <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
        {pages.map((src, index) => (
          <img key={src.slice(0, 32) + index} src={src} alt={`发票第 ${index + 1} 页`} style={{ display: 'block', width: '100%', marginBottom: 12, background: '#fff' }} />
        ))}
      </div>
    </Modal>
  );
}
