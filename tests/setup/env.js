// Runs in every test worker before the test file is loaded.
import { resolveTestDbUrl } from "./test-db-url.js";

process.env.DATABASE_URL = resolveTestDbUrl();
process.env.TOKEN_PEPPER = "test-pepper";
process.env.JOBS_SECRET = "test-jobs-secret";
process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.SHOPIFY_APP_URL = "https://app.example.test";
process.env.SCOPES =
  "write_metaobject_definitions,write_metaobjects,write_products,write_discounts,read_orders,write_merchant_managed_fulfillment_orders,read_themes,unauthenticated_write_checkouts,unauthenticated_read_product_listings";
process.env.SHOP_TIMEZONE = "America/New_York";
process.env.RENEWALS_RELEASED = "false";
process.env.OPEN_SUBMISSIONS_RELEASED = "false";
process.env.S3_BUCKET = "test-bucket";
process.env.CLOUDFRONT_DOMAIN = "photos.example.test";
process.env.CLOUDFRONT_DISTRIBUTION_ID = "TESTDIST";
