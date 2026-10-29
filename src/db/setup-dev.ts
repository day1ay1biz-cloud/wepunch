// Local setup: migrate, then create the app's login role. `pnpm db:setup`
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { ensureAppLoginRole } from "./app-role";

execFileSync("pnpm", ["tsx", "src/db/migrate.ts"], { stdio: "inherit" });
await ensureAppLoginRole(process.env.DATABASE_ADMIN_URL!, process.env.DATABASE_URL!);
console.log("app login role ready");
