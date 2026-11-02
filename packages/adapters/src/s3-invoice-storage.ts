// 发票原件来自 @aws-sdk/client-s3，兼容 MinIO。本文件只保存对象和签发短时下载地址。
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';

export const OBJECT_STORAGE_TIMEOUT_MS = 10_000;
export const PRESIGN_SECONDS = 60;

export type InvoiceObjectClientOptions = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function createInvoiceObjectClient(options: InvoiceObjectClientOptions): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 2_000,
      requestTimeout: OBJECT_STORAGE_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    }),
  });
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callWithRetry<T>(work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      last = error;
      if (attempt === 3) {
        break;
      }
      const base = 200 * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * base);
      await pause(base + jitter);
    }
  }
  throw last;
}

function missingBucket(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error.name === 'NoSuchBucket' || error.name === 'NotFound');
}

export class S3InvoiceStorage {
  private corsReady: Promise<void> | null = null;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  /** 浏览器里的 PDF 查看器会跨域读取分段响应，必须暴露 Content-Range。 */
  ensureBrowserRead(): Promise<void> {
    if (!this.corsReady) {
      this.corsReady = this.applyBrowserCors().catch((error: unknown) => {
        this.corsReady = null;
        throw error;
      });
    }
    return this.corsReady;
  }

  private async applyBrowserCors(): Promise<void> {
    const command = new PutBucketCorsCommand({
      Bucket: this.bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ['*'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['Accept-Ranges', 'Content-Range', 'Content-Length', 'Content-Type', 'ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    });
    await callWithRetry(async () => {
      try {
        await this.client.send(command, { abortSignal: AbortSignal.timeout(OBJECT_STORAGE_TIMEOUT_MS) });
      } catch (error) {
        if (!missingBucket(error)) {
          throw error;
        }
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }), {
          abortSignal: AbortSignal.timeout(OBJECT_STORAGE_TIMEOUT_MS),
        });
        await this.client.send(command, { abortSignal: AbortSignal.timeout(OBJECT_STORAGE_TIMEOUT_MS) });
      }
    });
  }

  async putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
    });
    await callWithRetry(async () => {
      try {
        await this.client.send(command, { abortSignal: AbortSignal.timeout(OBJECT_STORAGE_TIMEOUT_MS) });
      } catch (error) {
        if (!missingBucket(error)) {
          throw error;
        }
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }), {
          abortSignal: AbortSignal.timeout(OBJECT_STORAGE_TIMEOUT_MS),
        });
        await this.client.send(command, { abortSignal: AbortSignal.timeout(OBJECT_STORAGE_TIMEOUT_MS) });
      }
    });
  }

  async presignRead(objectKey: string, file?: { contentType: string; fileName: string }): Promise<string> {
    await this.ensureBrowserRead().catch(() => undefined);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ResponseContentType: file?.contentType,
        ResponseContentDisposition: file ? `inline; filename="${file.fileName}"` : undefined,
      }),
      { expiresIn: PRESIGN_SECONDS },
    );
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return callWithRetry(async () => {
      const response = await this.client.send(command, { abortSignal: AbortSignal.timeout(OBJECT_STORAGE_TIMEOUT_MS) });
      if (!response.Body) {
        throw new Error('发票影像是空的');
      }
      return response.Body.transformToByteArray();
    });
  }
}
