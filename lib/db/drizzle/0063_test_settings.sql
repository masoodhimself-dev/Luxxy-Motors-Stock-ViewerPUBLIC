CREATE TABLE sales_test_settings (
 session_id uuid PRIMARY KEY REFERENCES sales_test_sessions(id) ON DELETE CASCADE,
 config jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 templates jsonb,
 templates_revision integer NOT NULL DEFAULT 1 CHECK (templates_revision > 0),
 paperwork jsonb,
 paperwork_revision integer NOT NULL DEFAULT 1 CHECK (paperwork_revision > 0),
 team jsonb,
 team_revision integer NOT NULL DEFAULT 1 CHECK (team_revision > 0)
);
