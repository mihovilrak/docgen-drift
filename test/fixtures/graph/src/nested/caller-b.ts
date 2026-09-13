import { orchestrate } from "../service.js";

export const secondaryCaller = (): number =>
  orchestrate({ invoiceId: "secondary", amount: 20, validate: () => true });
