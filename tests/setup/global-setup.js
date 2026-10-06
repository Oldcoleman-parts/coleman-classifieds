// Runs once per test run: brings the test database up to the latest migration.
import { execSync } from "node:child_process";
import { resolveTestDbUrl } from "./test-db-url.js";

export default function setup() {
  const url = resolveTestDbUrl();
  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
  } catch (error) {
    // Prisma's output names the host and database but not the password.
    const detail = `${error.stdout || ""}${error.stderr || ""}`
      .trim()
      .split("\n")
      .slice(-6)
      .join("\n");
    throw new Error(
      `Could not migrate the test database. Is Postgres running?\n${detail}`,
    );
  }
}
