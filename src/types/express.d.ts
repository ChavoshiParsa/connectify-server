declare namespace Express {
  export interface User {
    userId: string;
    email: string;
    refreshToken: string;
    deviceId: string;
  }
}
