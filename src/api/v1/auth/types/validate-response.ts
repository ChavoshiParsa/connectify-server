export type ValidateResponse = {
  email: { ok: boolean; reason?: 'EMAIL_TAKEN' };
  password: {
    ok: boolean;
    issues: Array<'TOO_SHORT' | 'NO_UPPER' | 'NO_LOWER' | 'NO_NUMBER' | 'NO_SYMBOL' | 'CONTAINS_EMAIL'>;
  };
};
