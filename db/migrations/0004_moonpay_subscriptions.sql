CREATE TABLE IF NOT EXISTS moonpay_checkout_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
  paylink_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'started', 'active', 'renewed', 'ended', 'expired', 'cancelled', 'failed')),
  checkout_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  raw_payload TEXT
);

CREATE TABLE IF NOT EXISTS moonpay_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
  moonpay_subscription_id TEXT NOT NULL UNIQUE,
  paylink_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'renewed', 'ended', 'expired', 'cancelled', 'failed')),
  customer_email TEXT,
  payer_wallet TEXT,
  checkout_session_id TEXT REFERENCES moonpay_checkout_sessions(id) ON DELETE SET NULL,
  renewal_date TEXT,
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

CREATE INDEX IF NOT EXISTS idx_moonpay_checkout_sessions_user_id ON moonpay_checkout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_moonpay_checkout_sessions_token ON moonpay_checkout_sessions(checkout_token);
CREATE INDEX IF NOT EXISTS idx_moonpay_checkout_sessions_status ON moonpay_checkout_sessions(status);
CREATE INDEX IF NOT EXISTS idx_moonpay_subscriptions_user_id ON moonpay_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_moonpay_subscriptions_status ON moonpay_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_moonpay_subscriptions_paylink ON moonpay_subscriptions(paylink_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_type ON webhook_events(provider, event_type);
