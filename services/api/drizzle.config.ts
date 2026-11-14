import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/modules/*/models/*.model.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
