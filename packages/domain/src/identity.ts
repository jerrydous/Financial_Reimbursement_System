export class IdentityError extends Error {
  readonly code: 'SUBJECT_MISMATCH';

  constructor() {
    super('SUBJECT_MISMATCH');
    this.name = 'IdentityError';
    this.code = 'SUBJECT_MISMATCH';
  }
}

export type AccessTokenClaims = {
  subject: string;
  username: string;
};

export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessTokenClaims>;
}

export function assertCanBindSubject(boundSubject: string | null, incomingSubject: string): void {
  if (boundSubject !== null && boundSubject !== incomingSubject) {
    throw new IdentityError();
  }
}

export function assertSameSubject(actorSubject: string, recordSubject: string): void {
  if (actorSubject !== recordSubject) {
    throw new IdentityError();
  }
}
