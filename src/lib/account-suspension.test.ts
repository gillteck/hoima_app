import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { ownsSuspension, priorBanDuration } from "./account-suspension";

describe("restoring access after unlocking", () => {
  test("previously unbanned accounts become eligible to sign in again", () => {
    assert.equal(priorBanDuration(null, Date.parse("2026-10-28T05:00:00Z")), "none");
  });
  test("independent bans are preserved when reopening", () => {
    assert.equal(priorBanDuration("2026-10-28T06:00:00Z", Date.parse("2026-10-28T05:00:00Z")), "3600s");
    assert.equal(ownsSuspension("2126-10-28T05:00:00Z", "2026-10-30T05:00:00Z"), false);
    assert.equal(ownsSuspension("2126-10-28T05:00:00.000Z", "2126-10-28T05:00:00Z"), true);
  });
});