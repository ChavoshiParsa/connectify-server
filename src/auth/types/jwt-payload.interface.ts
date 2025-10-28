export interface JwtPayload {
  sub: string; // user ID
  email: string;
  deviceId: string;
  // Add iat/exp if needed later
}
