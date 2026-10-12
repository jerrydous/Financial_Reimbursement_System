import { Alert, Modal, Spin, Typography } from 'antd';
import { getDocument, GlobalWorkerOptions, PasswordException } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

GlobalWorkerOptions.workerSrc = workerSrc;

export type InvoicePreviewState =
  | null
  | { phase: 'loading'; name: string }
  | { phase: 'ready'; name: string; url: string; type: string }
  | { phase: 'error'; name: string; message: string };

export function useInvoicePreview() {
  const urlRef = useRef<string | null>(null);
  const generation = useRef(0);
  const [preview, setPreview] = useState<InvoicePreviewState>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    };
  }, []);

  function retain(url: string | null) {
    if (urlRef.current && urlRef.current !== url) {
      URL.revokeObjectURL(urlRef.current);
    }
    urlRef.current = url;
  }

  async function open(name: string, load: () => Promise<Blob>, key = name) {
    const ticket = generation.current + 1;
    generation.current = ticket;
    setBusyKey(key);
    setPreview({ phase: 'loading', name });
    try {
      const blob = await load();
      if (generation.current !== ticket) {
        return;
      }
      const type = await mediaType(blob);
      const url = URL.createObjectURL(blob);
      retain(url);
      setPreview({ phase: 'ready', name, url, type });
    } catch (error) {
      if (generation.current !== ticket) {
        return;
      }
      retain(null);
      setPreview({
        phase: 'error',
        name,
        message: error instanceof Error ? error.message : '发票影像暂时读不出来，请稍后再试',
      });
    } finally {
      if (generation.current === ticket) {
        setBusyKey(null);
      }
    }
  }

  function close() {
    generation.current += 1;
    retain(null);
    setBusyKey(null);
    setPreview(null);
  }

  return { preview, busyKey, open, close };
}

async function mediaType(blob: Blob): Promise<string> {
  if (blob.type && blob.type !== 'application/octet-stream') {
    return blob.type;
  }
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  if (head[0] === 0xff && head[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
    return 'application/pdf';
  }
  return blob.type || 'application/octet-stream';
}

export function InvoicePreviewDialog({
  preview,
  onClose,
}: {
  preview: InvoicePreviewState;
  onClose: () => void;
}) {
  return (
    <Modal
      open={preview !== null}
      title={preview ? `发票影像 ${preview.name}` : '发票影像'}
      footer={null}
      width={880}
      zIndex={2000}
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
      onCancel={onClose}
    >
      {preview?.phase === 'loading' ? (
        <div style={{ minHeight: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Spin />
          <Typography.Text>正在读取影像…</Typography.Text>
        </div>
      ) : null}
      {preview?.phase === 'error' ? <Alert type="error" message={preview.message} /> : null}
      {preview?.phase === 'ready' ? <InvoiceMedia url={preview.url} type={preview.type} name={preview.name} /> : null}
    </Modal>
  );
}

export function LocalInvoicePreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!file || !url) {
    return null;
  }
  return (
    <div style={{ maxWidth: 720 }}>
      <InvoiceMedia url={url} type={file.type || typeFromName(file.name)} name={file.name} />
    </div>
  );
}

function InvoiceMedia({ url, type, name }: { url: string; type: string; name: string }) {
  const [broken, setBroken] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  if (type.startsWith('image/')) {
    const scale = size ? displayScale(size.width, size.height) : 1;
    return (
      <div>
        {broken ? (
          <Alert type="error" message="影像文件已经取到，但浏览器没有把它画出来。" />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 280,
              padding: 16,
              backgroundColor: '#fff',
              backgroundImage:
                'linear-gradient(45deg, #ececec 25%, transparent 25%), linear-gradient(-45deg, #ececec 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ececec 75%), linear-gradient(-45deg, transparent 75%, #ececec 75%)',
              backgroundSize: '24px 24px',
              backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
            }}
          >
            <img
              alt={name}
              src={url}
              onLoad={(event) => {
                setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
              }}
              onError={() => setBroken(true)}
              style={{
                display: 'block',
                width: size ? size.width * scale : undefined,
                height: size ? size.height * scale : undefined,
                maxWidth: '100%',
                maxHeight: 640,
                imageRendering: scale > 1 ? 'pixelated' : 'auto',
                boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.12)',
                background: '#fff',
              }}
            />
          </div>
        )}
        {size ? (
          <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
            {size.width} × {size.height} 像素
            {scale > 1 ? '。原图很小，这里按比例放大，方便查看。' : ''}
          </Typography.Paragraph>
        ) : null}
      </div>
    );
  }
  return <PdfPages url={url} />;
}

function PdfPages({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('正在打开 PDF…');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let destroyTask: (() => void) | null = null;
    void (async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('影像文件没有读到');
      }
      const data = new Uint8Array(await response.arrayBuffer());
      if (cancelled) {
        return;
      }
      const task = getDocument({
        data,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
      });
      destroyTask = () => {
        void task.destroy();
      };
      const pdf = await task.promise;
      if (cancelled || !host.current) {
        return;
      }
      host.current.replaceChildren();
      const shown = Math.min(pdf.numPages, 8);
      for (let index = 1; index <= shown; index += 1) {
        const page = await pdf.getPage(index);
        if (cancelled || !host.current) {
          return;
        }
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(1.5, 800 / unscaled.width) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.marginBottom = '12px';
        canvas.style.background = '#fff';
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('浏览器不能绘制这一页');
        }
        host.current.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
      if (!cancelled) {
        setFailed(false);
        setMessage(pdf.numPages > shown ? `共 ${pdf.numPages} 页，这里显示前 ${shown} 页` : `共 ${pdf.numPages} 页`);
      }
    })().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      setFailed(true);
      setMessage(pdfErrorText(error));
    });
    return () => {
      cancelled = true;
      destroyTask?.();
    };
  }, [url]);
  return (
    <div>
      {failed ? <Alert type="error" message={message} /> : <Typography.Text type="secondary">{message}</Typography.Text>}
      <div ref={host} style={{ marginTop: 8, maxHeight: 640, overflow: 'auto', background: '#525659', padding: 12 }} />
    </div>
  );
}

function pdfErrorText(error: unknown): string {
  if (error instanceof PasswordException) {
    return '这份 PDF 有打开密码，这里打不开。';
  }
  return '这份 PDF 没有打开。请确认文件本身能用阅读器打开。';
}

function displayScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return 1;
  }
  if (width >= 320 && height >= 160) {
    return 1;
  }
  return Math.max(1, Math.min(80, 720 / width, 480 / height));
}

function typeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  return 'application/octet-stream';
}
