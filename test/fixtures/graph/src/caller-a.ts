import { orchestrate } from "./service.js";

export const primaryCaller = (): number =>
  orchestrate({ invoiceId: "primary", amount: 10, validate: () => true });
