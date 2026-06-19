-- Production subscription control ledger.
-- Keeps cancellation-at-period-end, resume, and upgrade supersession decisions separate from provider payment records.
CREATE TABLE IF NOT EXISTS subscription_controls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  moonpay_subscription_id TEXT,
  tier INTEGER CHECK (tier BETWEEN 1 AND 3),
  action TEXT NOT NULL CHECK (action IN ('cancel_renewal', 'resume_renewal', 'superseded_by_upgrade', 'provider_cancel_required')),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'revoked', 'failed')),
  effective_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscription_controls_user_action_status ON subscription_controls(user_id, action, status);
CREATE INDEX IF NOT EXISTS idx_subscription_controls_subscription ON subscription_controls(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_controls_moonpay_subscription ON subscription_controls(moonpay_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_controls_effective_at ON subscription_controls(effective_at);
