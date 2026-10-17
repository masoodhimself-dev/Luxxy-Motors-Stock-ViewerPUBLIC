CREATE TABLE staff_push_preferences (
 dealer_id text NOT NULL,
 auth_user_id text NOT NULL,
 enquiries boolean NOT NULL DEFAULT true,
 bookings boolean NOT NULL DEFAULT true,
 reminders boolean NOT NULL DEFAULT true,
 followups boolean NOT NULL DEFAULT true,
 email_failures boolean NOT NULL DEFAULT true,
 reminder_minutes integer NOT NULL DEFAULT 30 CHECK (reminder_minutes IN (10,15,30,60)),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(dealer_id,auth_user_id),
 FOREIGN KEY(dealer_id,auth_user_id) REFERENCES portal_users(dealer_id,auth_user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE staff_push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dealer_id text NOT NULL,
 auth_user_id text NOT NULL,
 origin text NOT NULL,
 endpoint text NOT NULL,
 endpoint_hash text NOT NULL UNIQUE,
 p256dh text NOT NULL,
 auth text NOT NULL,
 device_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_success_at timestamptz,
 last_test_at timestamptz,
 FOREIGN KEY(dealer_id,auth_user_id) REFERENCES portal_users(dealer_id,auth_user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX staff_push_subscriptions_actor_idx ON staff_push_subscriptions(dealer_id,auth_user_id);
--> statement-breakpoint
CREATE TABLE staff_push_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES staff_push_subscriptions(id) ON DELETE CASCADE,
 dealer_id text NOT NULL,
 event_key text NOT NULL,
 category text NOT NULL CHECK(category IN ('enquiries','bookings','reminders','followups','emailFailures','test')),
 enquiry_id uuid,
 revision integer,
 due_at timestamptz,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','cancelled','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 retry_after timestamptz,
 lease_until timestamptz,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 error_code text,
 UNIQUE(subscription_id,event_key)
);
--> statement-breakpoint
CREATE INDEX staff_push_deliveries_due_idx ON staff_push_deliveries(dealer_id,status,next_attempt_at);
