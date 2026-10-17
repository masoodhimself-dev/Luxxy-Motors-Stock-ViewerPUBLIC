CREATE INDEX vehicles_current_history_idx ON vehicles(dealer_id,first_seen_at DESC,id DESC) WHERE archived_at IS NULL AND inventory_status<>'archived';
--> statement-breakpoint
CREATE INDEX vehicles_archived_history_idx ON vehicles(dealer_id,first_seen_at DESC,id DESC) WHERE archived_at IS NOT NULL OR inventory_status='archived';
