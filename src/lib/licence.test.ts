import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { LICENCE_RENEWAL_AMOUNT, LICENCE_RENEWAL_CURRENCY } from "./licence";

describe("licence renewal terms", () => {
  test("renewal costs 60 USD", () => {
    assert.equal(LICENCE_RENEWAL_AMOUNT, 60);
    assert.equal(LICENCE_RENEWAL_CURRENCY, "USD");
  });
});