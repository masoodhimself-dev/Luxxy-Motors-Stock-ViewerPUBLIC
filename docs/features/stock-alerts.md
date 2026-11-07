# Stock alerts

Customers with a filtered stock search that returns no results can request an email alert. A confirmation link opens the dealer website and asks the customer to confirm the search. Each email address can have one active search per dealership. Confirming a replacement changes the criteria and starts a new 60-day period. A pending replacement leaves the active search in place.

The worker uses the website filters against newly listed, publicly available cars from the same dealer. An alert can send one digest per London date, with up to five cars per digest. It checks the current stock and subscription before provider delivery and uses a saved delivery record to deduplicate cars and bound provider retries. Each digest has links to stop or renew the alert.

**Cars → Buyer demand** shows active confirmed buyers and grouped criteria. Staff can also list individual requests by status and see their dates. The list omits email addresses and search keywords. Free text in structured fields is only shown when it matches a known public stock facet. Owners manage the switch under **Settings → Brand → Stock alerts**.

Apply migration `0084_stock_alerts.sql` through the normal database deployment process. To run the pilot, configure a dedicated stable `STOCK_ALERT_TOKEN_SECRET`, turn on `STOCK_ALERT_EMAIL_ENABLED` and enable the dealership setting. The dealer needs a verified public HTTPS origin and its usual enabled customer email integration. Demo dealers are excluded from sending.

`pnpm --filter @workspace/api-server test:stock-alerts` verifies the server flow with a disposable embedded database and a fictional email transport.
