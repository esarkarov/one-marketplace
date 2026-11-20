import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const payoutTotalsFiles = [
  "src/modules/payouts/tests/payouts.integration.test.ts",
  "src/modules/client/tests/client.contract.test.ts",
  "src/modules/client/tests/client.search.integration.test.ts",
  "src/modules/admin/tests/admin.contract.test.ts",
  "src/modules/admin/tests/admin.listings.integration.test.ts",
  "src/modules/agency/tests/agency.contract.test.ts",
  "src/modules/freelancer/tests/freelancer.contract.test.ts",
  "src/modules/freelancer/tests/freelancer.repository.integration.test.ts",
  "src/modules/freelancer/tests/freelancer.job-feed.parity.test.ts",
  "src/modules/contracts/tests/contracts.refund-reconciliation.integration.test.ts",
  "src/modules/contracts/tests/contracts.orphan-payment-detection.integration.test.ts",
];

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`,
      },
    ],
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**", "src/**/*.d.ts"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "parallel",
          include: ["src/**/*.test.ts"],
          exclude: payoutTotalsFiles,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "payout-totals",
          include: payoutTotalsFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
