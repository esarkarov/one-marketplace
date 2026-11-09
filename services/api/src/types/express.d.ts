import type { AppLogger } from "../config/logger.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId?: string;
        role: "client" | "freelancer";
        accountExists: boolean;
        isOnboarded: boolean;
      };
      authClaims?: {
        userId: string;
        sessionId?: string | undefined;
      };
      requestId: string;
      logger: AppLogger;
      availableConnects?: number;
    }
  }
}

export {};
