CREATE TABLE dealer_sales_terms (
 dealer_id text PRIMARY KEY, revision integer NOT NULL DEFAULT 1 CHECK (revision>0), draft jsonb NOT NULL,
 published_version_id uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL
);
--> statement-breakpoint
CREATE TABLE dealer_sales_terms_versions (
 id uuid PRIMARY KEY, dealer_id text NOT NULL, version integer NOT NULL CHECK (version>0), content jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX dealer_sales_terms_versions_number_uidx ON dealer_sales_terms_versions(dealer_id,version);
--> statement-breakpoint
CREATE TABLE sale_terms_documents (
 id uuid PRIMARY KEY, dealer_id text NOT NULL, sale_id uuid NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
 snapshot jsonb NOT NULL, dealer_pdf text NOT NULL, both_pdf text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX sale_terms_documents_request_uidx ON sale_terms_documents(dealer_id,request_id);
--> statement-breakpoint
CREATE INDEX sale_terms_documents_sale_idx ON sale_terms_documents(dealer_id,sale_id,created_at DESC);
