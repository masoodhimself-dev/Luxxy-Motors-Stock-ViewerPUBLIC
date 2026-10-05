CREATE TABLE "sale_workspace" (
  "id" uuid PRIMARY KEY NOT NULL,
  "dealer_id" text NOT NULL,
  "reference" text NOT NULL,
  "revision" integer NOT NULL,
  "state" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_workspace_dealer_reference_uidx" ON "sale_workspace" USING btree ("dealer_id", "reference");
--> statement-breakpoint
CREATE INDEX "sale_workspace_dealer_updated_idx" ON "sale_workspace" USING btree ("dealer_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "sale_workspace_counters" (
  "dealer_id" text PRIMARY KEY NOT NULL,
  "numbers" jsonb DEFAULT '{}'::jsonb NOT NULL
);
