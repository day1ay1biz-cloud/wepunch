import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations run as the table owner, never as the app role.
    url: process.env.DATABASE_ADMIN_URL ?? "",
  },
});
