CREATE TABLE IF NOT EXISTS website_journey_daily (
  dealer_id text NOT NULL,
  day date NOT NULL,
  stage text NOT NULL CHECK (stage IN ('search','vehicle','enquiry','appointment_request')),
  event_count bigint NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  PRIMARY KEY (dealer_id, day, stage)
);
