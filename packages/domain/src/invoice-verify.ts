import { DomainError } from './domain-error';

export type OfficialVerifyPayload = {
  invoiceNumber: string;
  buyerName: string;
  buyerTaxId: string;
};

export type VerificationDecision = {
  status: 'verified' | 'failed';
  buyerName: string;
  buyerTaxId: string;
  message: string;
};

/** 只有官方查验结果里的发票号码与单据一致时才标为验真通过。空结果是未通过，不是通过。 */
export function verificationFromOfficial(payload: OfficialVerifyPayload | null, expectedNumber: string): VerificationDecision {
  const expected = expectedNumber.trim();
  if (!expected) {
    throw new DomainError('INVOICE_NUMBER_REQUIRED', '发票号码不能为空');
  }
  if (!payload || payload.invoiceNumber.trim() !== expected) {
    return { status: 'failed', buyerName: '', buyerTaxId: '', message: '查验没有返回这张发票' };
  }
  return {
    status: 'verified',
    buyerName: payload.buyerName.trim(),
    buyerTaxId: payload.buyerTaxId.trim(),
    message: '',
  };
}
