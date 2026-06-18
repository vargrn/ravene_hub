CREATE TABLE IF NOT EXISTS paypal_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
  paypal_subscription_id TEXT NOT NULL UNIQUE,
  paypal_plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payer_email TEXT,
  current_period_end TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  raw_payload TEXT,
  UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_paypal_subscriptions_user_id ON paypal_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_paypal_subscriptions_status ON paypal_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_type ON webhook_events(provider, event_type);
