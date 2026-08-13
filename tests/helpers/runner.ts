// Tiny harness shared by the unit and integration suites.
//
// Mirrors the pattern every existing suite already uses (tsx + node:assert,
// PASS/FAIL lines, exit code) but centralizes it so new suites stay uniform.
// The DB-aware variant runs `reconcile` after every scenario, so no mutation
// scenario can pass while an invariant (D3/D4/D6/wallet) is broken.

import { strict as assert } from "node:assert";
import type { PrismaClient } from "../../generated/prisma/client";
import { truncateAll, reconcile } from "./db";

interface Results {
  passed: number;
  failed: number;
}

// Plain harness for pure (no-DB) unit suites.
export function createUnit(): {
  test: (name: string, fn: () => void) => void;
  finish: () => number;
} {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void): void {
    try {
      fn();
      passed++;
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL  ${name}`);
      console.error(error);
    }
  }

  function finish(): number {
    console.log(`\n${passed} passed, ${failed} failed`);
    return failed === 0 ? 0 : 1;
  }

  return { test, finish };
}

// DB harness for integration suites: truncates before each scenario and
// re-derives the D3/D4/D6/wallet invariants after the scenario body runs.
export function createDbSuite(prisma: PrismaClient): {
  scenario: (
    name: string,
    fn: (ctx: { prisma: PrismaClient }) => Promise<void> | void
  ) => Promise<void>;
  finish: () => number;
  summary: () => Results;
} {
  let passed = 0;
  let failed = 0;

  async function scenario(
    name: string,
    fn: (ctx: { prisma: PrismaClient }) => Promise<void> | void
  ): Promise<void> {
    try {
      await truncateAll(prisma);
      await fn({ prisma });
      const violations = await reconcile(prisma);
      assert.deepEqual(
        violations,
        [],
        `D3/D4/D6/wallet invariants broken: ${violations.join("; ")}`
      );
      passed++;
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL  ${name}`);
      console.error(error);
    }
  }

  function finish(): number {
    console.log(`\n${passed} passed, ${failed} failed`);
    return failed === 0 ? 0 : 1;
  }

  function summary(): Results {
    return { passed, failed };
  }

  return { scenario, finish, summary };
}