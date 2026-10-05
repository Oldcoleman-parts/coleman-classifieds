// Runs in every test worker before the test file is loaded.
import { resolveTestDbUrl } from "./test-db-url.js";

process.env.DATABASE_URL = resolveTestDbUrl();
process.env.TOKEN_PEPPER = "test-pepper";
process.env.JOBS_SECRET = "test-jobs-secret";
process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.SHOPIFY_APP_URL = "https://app.example.test";
process.env.SCOPES =
  "write_products,write_metaobjects,write_metaobject_definitions";
