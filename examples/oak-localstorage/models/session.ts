import { User } from "./user.ts";

export interface Session {
  id: string;
  csrf: string;
  user?: User | null;
  state?: string | null;
  redirectUri?: string | null;
  codeVerifier?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessTokenExpiresAt?: Date | null;
}
