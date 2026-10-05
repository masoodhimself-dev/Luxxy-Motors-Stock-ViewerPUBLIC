CREATE TABLE "dealer_chat" (
	"dealer_id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_chat_schema_check" CHECK ("dealer_chat"."state"->>'schemaVersion' = '1')
);
