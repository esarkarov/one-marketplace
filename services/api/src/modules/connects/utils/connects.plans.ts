import {
  CONNECTS_PLANS,
  type ConnectsPlan,
} from "@/modules/connects/constants/connects.constants.js";

export const isConnectsPlan = (value: unknown): value is ConnectsPlan =>
  typeof value === "number" && Object.hasOwn(CONNECTS_PLANS, String(value));
