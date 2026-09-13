import { describe, expect, test } from "vitest";

import { orchestrate } from "./service.js";

describe("payment conversion", () => {
  test("uses the payment amount", () => {
    expect(
      orchestrate({ invoiceId: "test", amount: 2, validate: () => true }),
    ).toBe(0);
  });
});
