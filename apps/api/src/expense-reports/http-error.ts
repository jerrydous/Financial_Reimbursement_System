import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, MoneyError } from '@frs/domain';

const statusByCode: Record<string, number> = {
  IDEMPOTENCY_KEY_REQUIRED: HttpStatus.BAD_REQUEST,
  INVOICE_REQUIRED: HttpStatus.BAD_REQUEST,
  INVOICE_NUMBER_REQUIRED: HttpStatus.BAD_REQUEST,
  AMOUNT_NOT_INTEGER_FEN: HttpStatus.BAD_REQUEST,
  AMOUNT_NOT_YUAN: HttpStatus.BAD_REQUEST,
  FILE_TYPE_UNSUPPORTED: HttpStatus.BAD_REQUEST,
  REQUEST_INVALID: HttpStatus.BAD_REQUEST,
  ALLOCATION_INVALID: HttpStatus.BAD_REQUEST,
  SUBSIDY_INVALID: HttpStatus.BAD_REQUEST,
  POLICY_INVALID: HttpStatus.BAD_REQUEST,
  APPROVAL_ACTORS_REQUIRED: HttpStatus.BAD_REQUEST,
  ACTOR_FORBIDDEN: HttpStatus.FORBIDDEN,
  PROXY_EXCLUSIVE: HttpStatus.FORBIDDEN,
  INVOICE_NOT_FOUND: HttpStatus.NOT_FOUND,
  REPORT_NOT_FOUND: HttpStatus.NOT_FOUND,
  DOCUMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVOICE_ALREADY_BOUND: HttpStatus.CONFLICT,
  LEDGER_LOCKED: HttpStatus.CONFLICT,
  VERSION_CONFLICT: HttpStatus.CONFLICT,
  AMOUNT_LOCKED: HttpStatus.CONFLICT,
  INVALID_TRANSITION: HttpStatus.CONFLICT,
  AMOUNT_MISMATCH: HttpStatus.CONFLICT,
  INVOICE_NOT_CONFIRMED: HttpStatus.CONFLICT,
  VERIFICATION_NOT_ALLOWED: HttpStatus.CONFLICT,
  WITHDRAW_TOO_LATE: HttpStatus.CONFLICT,
  QUOTA_EXCEEDED: HttpStatus.CONFLICT,
  BUDGET_EXCEEDED: HttpStatus.CONFLICT,
  WRITE_OFF_EXCEEDS_BALANCE: HttpStatus.CONFLICT,
  LOAN_OVERDUE: HttpStatus.CONFLICT,
  INSTALLMENT_EXCEEDED: HttpStatus.CONFLICT,
  TRAVEL_DUPLICATE: HttpStatus.CONFLICT,
  MANAGER_NOT_ASSIGNED: HttpStatus.UNPROCESSABLE_ENTITY,
  ROLE_ASSIGNEE_AMBIGUOUS: HttpStatus.UNPROCESSABLE_ENTITY,
  ACTOR_UNASSIGNED: HttpStatus.UNPROCESSABLE_ENTITY,
  TRANSFER_TARGET_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  AMOUNT_NEGATIVE: HttpStatus.UNPROCESSABLE_ENTITY,
  STANDARD_BLOCKED: HttpStatus.UNPROCESSABLE_ENTITY,
  VERIFICATION_NOT_CONFIGURED: HttpStatus.UNPROCESSABLE_ENTITY,
  VOUCHER_NOT_READY: HttpStatus.CONFLICT,
  BUYER_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  WORKFLOW_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  QUEUE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  VERIFICATION_TIMEOUT: HttpStatus.SERVICE_UNAVAILABLE,
};

export function rethrowAsHttp(error: unknown): never {
  if (error instanceof DomainError || error instanceof MoneyError) {
    throw new HttpException(
      { code: error.code, message: error.message },
      statusByCode[error.code] ?? HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new HttpException(
      { code: 'INVOICE_ALREADY_BOUND', message: '这张发票已经在另一张有效报销单里' },
      HttpStatus.CONFLICT,
    );
  }
  throw error;
}

export function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
