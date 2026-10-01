---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "tests/**"
---

# Testing rules (token-light)

- **Always run tests with `npm run test:ai`**, never raw `vitest` or `npm test`. While building, use `npm run test:ai -- --changed`. At ticket close, use `npm run test:ai -- app/modules/<module>`. The full suite runs only for reviews and launch.
- Never paste or re-read full test logs. If `test:ai` shows a failure, open only the referenced file and line.
- Write the minimum tests: one per acceptance criterion, plus the “Required security tests” of the module’s `security-<module>` skill. No exhaustive variations unless the ticket asks for them.
- Use the shared factories in `tests/factories.ts` (`makeListing`, `makeInvitation`, `asSeller`, `asStaff`, `mockShopify`, `mockSes`, `mockS3`). Never repeat setup inline.
- Use table-driven tests (`it.each`) for validation, status transitions and permission matrices.
- No snapshot files and no large fixtures. Keep a test file under ~150 lines; split by behaviour if it grows.
- Mock Shopify, S3, SES and Turnstile at the client boundary only. Use a separate test DB, reset per file.
- Name tests after the criterion: `it("AC: …")`, `it("SEC: …")`.
