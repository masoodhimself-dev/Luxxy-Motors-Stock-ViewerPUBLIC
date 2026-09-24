/** Must run before importing the app or database in every integration suite. */
const target = process.env.LUXXY_TEST_DATABASE_URL;
if (!target) {
  throw new Error(
    "Set LUXXY_TEST_DATABASE_URL to a disposable local luxxy_test_* database. DATABASE_URL is never used as a test fallback.",
  );
}
const url = new URL(target);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["127.0.0.1", "[::1]"].includes(url.hostname) ||
  !/^\/luxxy_test_[a-z0-9_]+$/.test(url.pathname) ||
  url.search ||
  url.hash
) {
  throw new Error(
    "Integration tests require a loopback PostgreSQL URL, a luxxy_test_* database, and no connection overrides.",
  );
}
process.env.DATABASE_URL = target;
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "fatal";
// Synthetic keys only: never use a real Clerk tenant or email credentials.
process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from("clerk.luxxy.test$").toString("base64")}`;
process.env.CLERK_SECRET_KEY = "sk_test_luxxy_integration_only";
process.env.PUBLIC_SITE_URL = "http://127.0.0.1";
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;

// Tests may call the local HTTP app. All external fetches, including email and
// identity providers, fail closed so test fixtures cannot trigger real sends.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const requestUrl = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!["127.0.0.1", "[::1]"].includes(requestUrl.hostname)) {
    return Promise.reject(
      new Error("External network requests are disabled in integration tests."),
    );
  }
  return originalFetch(input, init);
};
