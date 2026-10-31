CREATE TABLE ai_browser_sessions (
 token_hash text PRIMARY KEY, dealer_id text NOT NULL, used_count integer NOT NULL DEFAULT 0 CHECK (used_count>=0 AND used_count<=10),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
--> statement-breakpoint
CREATE INDEX ai_browser_session_expiry ON ai_browser_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE ai_assistance_requests (
 id uuid PRIMARY KEY, dealer_id text NOT NULL, session_hash text NOT NULL, ip_hash text NOT NULL,
 request_id uuid NOT NULL, request_hash text NOT NULL, cache_key text, month_key text NOT NULL,
 cost_micro_usd integer NOT NULL DEFAULT 0 CHECK(cost_micro_usd>=0), status text NOT NULL CHECK(status IN ('reserved','succeeded','failed')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(dealer_id,session_hash,request_id)
);
--> statement-breakpoint
CREATE INDEX ai_assistance_month ON ai_assistance_requests(month_key);
--> statement-breakpoint
CREATE INDEX ai_assistance_ip_day ON ai_assistance_requests(ip_hash,created_at);
--> statement-breakpoint
CREATE TABLE ai_assistance_cache (
 dealer_id text NOT NULL, cache_key text NOT NULL, result jsonb NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(dealer_id,cache_key)
);
