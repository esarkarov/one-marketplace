import type { AppLogger } from "@/config/logger.js";
import type { ValidatedInput } from "@/middleware/types/validate.types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId?: string;
        role: "client" | "freelancer";
        accountExists: boolean;
        accountId: string | null;
        isOnboarded: boolean;
      };
      authClaims?: {
        userId: string;
        sessionId?: string | undefined;
      };
      requestId: string;
      logger: AppLogger;
      availableConnects?: number;
      validated?: ValidatedInput;
    }
  }
}

export {};
