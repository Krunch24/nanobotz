CREATE TABLE IF NOT EXISTS nano_singularity_state (
  session_hash text PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
