import fs from "node:fs";
import { parseEnv } from "node:util";

const LOCAL_TEST_URL =
  "postgresql://postgres:postgres@localhost:5432/classifieds_test";

// Vitest doesn't load .env, so read just this one key from it (never the rest).
function fromDotEnv() {
  try {
    return parseEnv(fs.readFileSync(".env", "utf8")).TEST_DATABASE_URL;
  } catch {
    return undefined;
  }
}

/**
 * The test database URL: TEST_DATABASE_URL (shell, then .env), or the docker-compose default.
 * Refuses any database whose name doesn't end in `_test`, because tests truncate every table.
 * @returns {string}
 */
export function resolveTestDbUrl() {
  const url = process.env.TEST_DATABASE_URL || fromDotEnv() || LOCAL_TEST_URL;
  let name;
  try {
    name = new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }
  // The URL holds credentials, so only the database name is ever shown.
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests: database "${name}" doesn't end in _test`,
    );
  }
  return url;
}
