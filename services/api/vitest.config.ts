import { defineConfig } from "vitest/config";

const payoutTotalsFiles = [
  "src/modules/payouts/payouts.integration.test.ts",
  "src/modules/admin/admin.contract.test.ts",
  "src/modules/agency/agency.contract.test.ts",
  "src/modules/freelancer/freelancer.contract.test.ts",
];

export default defineConfig({
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
