export interface ChallengeContext {
  retailer: string;
  listingId: string;
  signal: "ACCESS_DENIED" | "RATE_LIMITED" | "CAPTCHA" | "INTERSTITIAL";
  detail: string;
}

export interface ChallengeResolution {
  handlerId: string;
  action: "RETRY_AFTER" | "USE_APPROVED_ALTERNATE" | "QUARANTINE";
  retryAfterSeconds: number;
  detail: string;
}

export interface ChallengeHandler {
  id: string;
  priority: number;
  supports(context: ChallengeContext): boolean;
  resolve(context: ChallengeContext): Promise<ChallengeResolution>;
}

const handlers: ChallengeHandler[] = [
  {
    id: "safe-default",
    priority: 0,
    supports: () => true,
    async resolve(context) {
      if (context.signal === "RATE_LIMITED") {
        return {
          handlerId: "safe-default",
          action: "RETRY_AFTER",
          retryAfterSeconds: 300,
          detail: "Rate limit detected; scheduled a conservative cooldown.",
        };
      }
      return {
        handlerId: "safe-default",
        action: "QUARANTINE",
        retryAfterSeconds: 900,
        detail:
          "Challenge requires an approved alternate acquisition path; direct monitoring was quarantined.",
      };
    },
  },
];

export function registerChallengeHandler(handler: ChallengeHandler) {
  if (handlers.some((entry) => entry.id === handler.id)) {
    throw new Error(`Challenge handler ${handler.id} is already registered.`);
  }
  handlers.push(handler);
  handlers.sort((left, right) => right.priority - left.priority);
}

export async function resolveChallenge(context: ChallengeContext) {
  const handler = handlers.find((entry) => entry.supports(context));
  if (!handler) {
    throw new Error("No challenge handler accepted the challenge context.");
  }
  return handler.resolve(context);
}
