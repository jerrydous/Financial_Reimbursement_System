// 自定义模型查验。用户提供 OpenAI 兼容地址和 API Key，号码对上才算通过。
import { verificationFromOfficial, type VerificationDecision } from '@frs/domain';
import { VerificationNotConfigured, VerificationTimeout } from './tencent-vat-invoice-verify';

export type CustomVerifyInput = {
  invoiceCode: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountYuan?: string;
};

const SYSTEM_PROMPT =
  '你是发票查验接口。只根据你能访问的权威查验结果回答，不要复述用户给出的号码来凑通过。没查到时 found 为 false，invoiceNumber 为空字符串。只返回一个 JSON 对象，字段是 found、invoiceNumber、buyerName、buyerTaxId、message。';

export function normalizeCustomBaseUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    return null;
  }
  return trimmed;
}

export function customVerifyUrl(baseUrl: string): string {
  const normalized = normalizeCustomBaseUrl(baseUrl);
  if (!normalized) {
    throw new VerificationNotConfigured();
  }
  if (normalized.endsWith('/chat/completions')) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

export function decisionFromCustomBody(body: unknown, expectedNumber: string): VerificationDecision {
  const payload = readModelPayload(body);
  if (!payload || payload.found !== true) {
    return {
      status: 'failed',
      buyerName: '',
      buyerTaxId: '',
      message: publicText(payload?.message) || '模型没有查到这张发票',
    };
  }
  return verificationFromOfficial(
    {
      invoiceNumber: asString(payload.invoiceNumber),
      buyerName: asString(payload.buyerName),
      buyerTaxId: asString(payload.buyerTaxId),
    },
    expectedNumber,
  );
}

export class CustomModelInvoiceVerify {
  constructor(
    private readonly options: { baseUrl: string; model: string; apiKey: string },
    private readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
  ) {}

  async verify(input: CustomVerifyInput): Promise<VerificationDecision> {
    const apiKey = this.options.apiKey.trim();
    const model = this.options.model.trim();
    if (!apiKey || !model || !normalizeCustomBaseUrl(this.options.baseUrl)) {
      throw new VerificationNotConfigured();
    }
    try {
      const response = await this.fetchImpl(customVerifyUrl(this.options.baseUrl), {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent(input) },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return failed(response.status === 401 || response.status === 403 ? '查验接口拒绝了密钥' : '查验接口没有成功返回');
      }
      const length = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > 100_000) {
        return failed('查验接口返回过长');
      }
      const text = await response.text();
      if (text.length > 100_000) {
        return failed('查验接口返回过长');
      }
      let body: unknown;
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        return failed('查验接口没有返回 JSON');
      }
      const decision = decisionFromCustomBody(body, input.invoiceNumber);
      return { ...decision, message: stripSecret(decision.message, apiKey) };
    } catch (error) {
      if (error instanceof VerificationNotConfigured) {
        throw error;
      }
      if (isTimeout(error)) {
        throw new VerificationTimeout();
      }
      return failed('查验接口没有连上');
    }
  }
}

function userContent(input: CustomVerifyInput): string {
  return [
    `发票代码：${input.invoiceCode}`,
    `发票号码：${input.invoiceNumber}`,
    `开票日期：${input.invoiceDate}`,
    `价税合计：${input.amountYuan ?? ''}`,
  ].join('\n');
}

function failed(message: string): VerificationDecision {
  return { status: 'failed', buyerName: '', buyerTaxId: '', message };
}

function readModelPayload(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as Record<string, unknown>;
  const choices = record.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
    const parsed = contentToRecord(content);
    if (parsed) {
      return parsed;
    }
  }
  if ('found' in record || 'invoiceNumber' in record) {
    return record;
  }
  return null;
}

function contentToRecord(content: unknown): Record<string, unknown> | null {
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(stripFence(content)) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : ''))
      .join('');
    return contentToRecord(text);
  }
  if (content && typeof content === 'object') {
    return content as Record<string, unknown>;
  }
  return null;
}

function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function publicText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function stripSecret(message: string, secret: string): string {
  if (!message || !secret) {
    return message;
  }
  return message.split(secret).join('');
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return error.name === 'TimeoutError' || error.name === 'AbortError' || message.includes('timeout') || error.message.includes('超时');
}
