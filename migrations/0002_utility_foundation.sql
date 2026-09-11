-- Gas meter data foundation (docs/GAS_METER_DIRECTION.md Phase A).
-- 1) meters gain an immutable utility kind; every existing meter backfills to
--    electricity because the runtime so far only created electricity meters.
-- 2) readings move from the electricity-only cumulative_wh to the unit-neutral
--    fixed-point counter cumulative_milliunit (1/1000 of the meter base unit).
--    electricity: 1 milli-unit = 1 Wh, so existing values transfer 1:1 with no
--    arithmetic. gas: 1 milli-unit = 0.001 m³. Row identity, instants, values,
--    ordering and the (meter_id, measured_at_ms) uniqueness contract survive.

ALTER TABLE meters ADD COLUMN utility_kind TEXT
  NOT NULL
  DEFAULT 'electricity'
  CHECK (utility_kind IN ('electricity', 'gas'));

CREATE TABLE readings_milliunit (
  reading_id TEXT NOT NULL PRIMARY KEY,
  meter_id TEXT NOT NULL,
  measured_at_ms INTEGER NOT NULL,
  cumulative_milliunit INTEGER NOT NULL CHECK (cumulative_milliunit >= 0),
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (meter_id) REFERENCES meters(meter_id) ON DELETE CASCADE
);

INSERT INTO readings_milliunit (
  reading_id, meter_id, measured_at_ms, cumulative_milliunit, created_at_ms
)
SELECT reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms
FROM readings;

DROP TABLE readings;

ALTER TABLE readings_milliunit RENAME TO readings;

CREATE UNIQUE INDEX ux_readings_meter_measured_at
  ON readings(meter_id, measured_at_ms);
