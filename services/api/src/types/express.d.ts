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
      availableConnects?: number;
    }
  }
}

export {};
