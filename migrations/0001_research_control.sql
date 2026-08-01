CREATE TABLE IF NOT EXISTS research_daily_usage (
  day TEXT PRIMARY KEY,
  provider_calls INTEGER NOT NULL DEFAULT 0 CHECK (provider_calls >= 0),
  user_counts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(user_counts)),
  ip_counts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ip_counts))
);

CREATE TABLE IF NOT EXISTS research_provider_circuit (
  service TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  opened_until INTEGER NOT NULL DEFAULT 0 CHECK (opened_until >= 0)
);
