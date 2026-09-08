-- Initial Cloudflare D1 persistence schema.
-- Store source measurements and access data only; usage/forecast values remain derived.

CREATE TABLE users (
  user_id TEXT NOT NULL PRIMARY KEY,
  google_subject TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX ux_users_google_subject
  ON users(google_subject);

CREATE TABLE meters (
  meter_id TEXT NOT NULL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
  billing_close_kind TEXT NOT NULL CHECK (billing_close_kind IN ('day', 'month-end')),
  billing_close_day INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id),
  CHECK (
    (
      billing_close_kind = 'day'
      AND billing_close_day IS NOT NULL
      AND billing_close_day BETWEEN 1 AND 31
    )
    OR
    (
      billing_close_kind = 'month-end'
      AND billing_close_day IS NULL
    )
  )
);

CREATE INDEX idx_meters_owner_user
  ON meters(owner_user_id, meter_id);

-- The owner is canonical in meters.owner_user_id.
-- meter_members rows are explicit viewer grants.
CREATE TABLE meter_members (
  meter_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (meter_id, user_id),
  FOREIGN KEY (meter_id) REFERENCES meters(meter_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX idx_meter_members_user
  ON meter_members(user_id, meter_id);

CREATE TABLE readings (
  reading_id TEXT NOT NULL PRIMARY KEY,
  meter_id TEXT NOT NULL,
  measured_at_ms INTEGER NOT NULL,
  cumulative_wh INTEGER NOT NULL CHECK (cumulative_wh >= 0),
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (meter_id) REFERENCES meters(meter_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ux_readings_meter_measured_at
  ON readings(meter_id, measured_at_ms);
