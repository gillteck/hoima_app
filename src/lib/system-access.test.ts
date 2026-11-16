import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { mustSignOut, canUseOperations, type SystemAccess } from "./system-access";

const openAccess: SystemAccess = { locked: false, can_manage: false, allowed: true, session_revoked: false, version: 0 };

describe("super-admin system lock", () => {
  test("ordinary staff are signed out when the system is locked", () => {
    assert.equal(mustSignOut(openAccess), false);
    assert.equal(mustSignOut({ ...openAccess, locked: true, allowed: false }), true);
  });
  test("the super admin keeps recovery access while locked", () => {
    assert.equal(mustSignOut({ ...openAccess, locked: true, can_manage: true, allowed: true }), false);
  });
  test("reopening does not restore an ended staff session", () => {
    assert.equal(mustSignOut({ ...openAccess, allowed: false, session_revoked: true, version: 2 }), true);
    assert.equal(mustSignOut({ ...openAccess, version: 2 }), false);
  });
  test("no role can use transactions while locked, including the super admin", () => {
    assert.equal(canUseOperations({ ...openAccess, locked: true, allowed: false }), false);
    assert.equal(canUseOperations({ ...openAccess, locked: true, can_manage: true, allowed: true }), false);
    assert.equal(canUseOperations(null), false);
    assert.equal(canUseOperations({ ...openAccess, can_manage: true }), true);
  });
});