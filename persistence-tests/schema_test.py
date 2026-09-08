from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations" / "0001_initial.sql"


class PersistenceSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(MIGRATION.read_text(encoding="utf-8"))

    def tearDown(self):
        self.db.close()

    def add_user(self, user_id, subject):
        self.db.execute(
            "INSERT INTO users (user_id, google_subject, created_at_ms) VALUES (?, ?, ?)",
            (user_id, subject, 1),
        )

    def add_meter(self, meter_id="meter-1", owner_id="owner-1", kind="day", day=21):
        self.db.execute(
            """
            INSERT INTO meters (
              meter_id, owner_user_id, name, timezone,
              billing_close_kind, billing_close_day,
              created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (meter_id, owner_id, "Home", "Asia/Seoul", kind, day, 1, 1),
        )

    def query_plan(self, sql, params):
        return "\n".join(
            row[3] for row in self.db.execute(f"EXPLAIN QUERY PLAN {sql}", params)
        )

    def test_expected_tables_and_cost_indexes_exist(self):
        tables = {
            row[0]
            for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        self.assertEqual(tables, {"users", "meters", "meter_members", "readings"})

        indexes = {
            row[0]
            for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'"
            )
        }
        self.assertEqual(
            indexes,
            {
                "ux_users_google_subject",
                "idx_meters_owner_user",
                "idx_meter_members_user",
                "ux_readings_meter_measured_at",
            },
        )

        reading_columns = {
            row[1] for row in self.db.execute("PRAGMA table_info(readings)")
        }
        self.assertEqual(
            reading_columns,
            {"reading_id", "meter_id", "measured_at_ms", "cumulative_wh", "created_at_ms"},
        )

    def test_google_subject_is_unique_and_internal_user_id_is_separate(self):
        self.add_user("user-1", "google-subject-1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_user("user-2", "google-subject-1")

        row = self.db.execute(
            "SELECT user_id, google_subject FROM users WHERE user_id = ?",
            ("user-1",),
        ).fetchone()
        self.assertEqual(row, ("user-1", "google-subject-1"))

    def test_meter_close_setting_matches_domain_contract(self):
        self.add_user("owner-1", "subject-owner")
        self.add_meter("day-meter", "owner-1", "day", 21)
        self.add_meter("month-end-meter", "owner-1", "month-end", None)

        invalid = [
            ("bad-null", "day", None),
            ("bad-zero", "day", 0),
            ("bad-32", "day", 32),
            ("bad-month-end", "month-end", 31),
        ]
        for meter_id, kind, day in invalid:
            with self.subTest(kind=kind, day=day):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.add_meter(meter_id, "owner-1", kind, day)

    def test_owner_is_canonical_and_viewer_grants_require_real_users(self):
        self.add_user("owner-1", "subject-owner")
        self.add_user("viewer-1", "subject-viewer")
        self.add_meter()

        self.db.execute(
            "INSERT INTO meter_members (meter_id, user_id, created_at_ms) VALUES (?, ?, ?)",
            ("meter-1", "viewer-1", 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO meter_members (meter_id, user_id, created_at_ms) VALUES (?, ?, ?)",
                ("meter-1", "viewer-1", 2),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO meter_members (meter_id, user_id, created_at_ms) VALUES (?, ?, ?)",
                ("meter-1", "missing-user", 1),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM users WHERE user_id = ?", ("owner-1",))

    def test_readings_preserve_raw_measurement_contract(self):
        self.add_user("owner-1", "subject-owner")
        self.add_meter()

        self.db.execute(
            """
            INSERT INTO readings
              (reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("reading-1", "meter-1", 1000, 100_000, 1000),
        )
        self.db.execute(
            """
            INSERT INTO readings
              (reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("reading-2", "meter-1", 2000, 100_000, 2000),
        )

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """
                INSERT INTO readings
                  (reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("reading-3", "meter-1", 2000, 101_000, 2000),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """
                INSERT INTO readings
                  (reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("reading-4", "meter-1", 3000, -1, 3000),
            )

    def test_meter_delete_cascades_only_meter_owned_rows(self):
        self.add_user("owner-1", "subject-owner")
        self.add_user("viewer-1", "subject-viewer")
        self.add_meter()
        self.db.execute(
            "INSERT INTO meter_members (meter_id, user_id, created_at_ms) VALUES (?, ?, ?)",
            ("meter-1", "viewer-1", 1),
        )
        self.db.execute(
            """
            INSERT INTO readings
              (reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("reading-1", "meter-1", 1000, 100_000, 1000),
        )

        self.db.execute("DELETE FROM meters WHERE meter_id = ?", ("meter-1",))
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM meter_members").fetchone()[0],
            0,
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM readings").fetchone()[0],
            0,
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM users").fetchone()[0],
            2,
        )

    def test_declared_indexes_cover_persistence_read_paths(self):
        plans = {
            "identity": self.query_plan(
                "SELECT user_id, google_subject, created_at_ms FROM users "
                "WHERE google_subject = ?1 LIMIT 1",
                {"1": "subject"},
            ),
            "owner": self.query_plan(
                "SELECT meter_id FROM meters WHERE owner_user_id = ?1 ORDER BY meter_id",
                {"1": "owner"},
            ),
            "viewer": self.query_plan(
                "SELECT meter_id FROM meter_members WHERE user_id = ?1 ORDER BY meter_id",
                {"1": "viewer"},
            ),
            "readings": self.query_plan(
                "SELECT reading_id, measured_at_ms FROM readings "
                "WHERE meter_id = ?1 ORDER BY measured_at_ms",
                {"1": "meter"},
            ),
        }

        self.assertIn("ux_users_google_subject", plans["identity"])
        self.assertIn("idx_meters_owner_user", plans["owner"])
        self.assertIn("idx_meter_members_user", plans["viewer"])
        self.assertIn("ux_readings_meter_measured_at", plans["readings"])

    def test_authorization_and_neighbor_queries_reuse_existing_indexes(self):
        accessible = self.query_plan(
            """
            SELECT meter_id, 'owner' AS access_role
            FROM meters
            WHERE owner_user_id = ?1
            UNION ALL
            SELECT m.meter_id, 'viewer' AS access_role
            FROM meter_members AS mm
            JOIN meters AS m ON m.meter_id = mm.meter_id
            WHERE mm.user_id = ?1 AND m.owner_user_id <> ?1
            ORDER BY meter_id
            """,
            {"1": "user"},
        )
        access = self.query_plan(
            """
            SELECT m.meter_id
            FROM meters AS m
            LEFT JOIN meter_members AS mm
              ON mm.meter_id = m.meter_id AND mm.user_id = ?2
            WHERE m.meter_id = ?1
              AND (m.owner_user_id = ?2 OR mm.user_id IS NOT NULL)
            LIMIT 1
            """,
            {"1": "meter", "2": "user"},
        )
        previous_reading = self.query_plan(
            "SELECT reading_id FROM readings "
            "WHERE meter_id = ?1 AND measured_at_ms < ?2 "
            "ORDER BY measured_at_ms DESC LIMIT 1",
            {"1": "meter", "2": 2000},
        )
        exact_reading = self.query_plan(
            "SELECT reading_id FROM readings "
            "WHERE meter_id = ?1 AND measured_at_ms = ?2 LIMIT 1",
            {"1": "meter", "2": 2000},
        )

        self.assertIn("idx_meters_owner_user", accessible)
        self.assertIn("idx_meter_members_user", accessible)
        self.assertIn("sqlite_autoindex_meters_1", access)
        self.assertIn("sqlite_autoindex_meter_members_1", access)
        self.assertIn("ux_readings_meter_measured_at", previous_reading)
        self.assertIn("ux_readings_meter_measured_at", exact_reading)


if __name__ == "__main__":
    unittest.main()
