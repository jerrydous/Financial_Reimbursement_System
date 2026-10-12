// 发票原件来自 @aws-sdk/client-s3，兼容 MinIO。本文件只保存对象和签发短时下载地址。
import {
  CreateBucketCommand,
  GetObjectCommand,
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
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

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

  async presignRead(objectKey: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), {
      expiresIn: PRESIGN_SECONDS,
    });
  }
}
