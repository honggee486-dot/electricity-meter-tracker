-- Local-only deterministic fixture for the D1 persistence probe.
-- All identifiers are synthetic test data.

DELETE FROM readings WHERE meter_id = 'local-meter';
DELETE FROM meter_members WHERE meter_id = 'local-meter';
DELETE FROM meters WHERE meter_id = 'local-meter';
DELETE FROM users WHERE user_id IN ('local-owner', 'local-viewer');

INSERT INTO users (user_id, google_subject, created_at_ms) VALUES
  ('local-owner', 'local-owner-subject', 1),
  ('local-viewer', 'local-viewer-subject', 1);

INSERT INTO meters (
  meter_id, owner_user_id, name, timezone,
  billing_close_kind, billing_close_day, created_at_ms, updated_at_ms
) VALUES (
  'local-meter', 'local-owner', 'Local test meter', 'Asia/Seoul',
  'day', 21, 1, 1
);

INSERT INTO meter_members (meter_id, user_id, created_at_ms)
VALUES ('local-meter', 'local-viewer', 1);

INSERT INTO readings (
  reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms
) VALUES
  ('local-reading-1', 'local-meter', 1000, 100000, 1000),
  ('local-reading-2', 'local-meter', 2000, 101000, 2000);
