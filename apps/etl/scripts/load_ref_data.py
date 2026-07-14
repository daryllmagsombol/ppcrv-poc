#!/usr/bin/env python3
"""Load reference data CSVs into local pprcv_local Postgres database.

Usage:
    python3 scripts/load_ref_data.py         # skip if already loaded
    python3 scripts/load_ref_data.py --fresh  # drop + reload
"""

import argparse
import csv
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv()

BASE = Path(__file__).resolve().parent.parent.parent.parent / "sample-csv"
CONN_STR = (
    f"host={os.environ.get('PGHOST', 'localhost')} "
    f"dbname={os.environ.get('PGDATABASE', 'pprcv_local')} "
    f"user={os.environ.get('PGUSER', os.environ.get('USER', 'daryllmagsombol'))}"
)

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS ref_parties (
    parties_code TEXT PRIMARY KEY,
    parties_name TEXT NOT NULL,
    parties_alias TEXT
);

CREATE TABLE IF NOT EXISTS ref_contests (
    contest_code TEXT PRIMARY KEY,
    contest_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ref_precincts (
    acm_id TEXT PRIMARY KEY,
    reg_name TEXT,
    prv_name TEXT,
    mun_name TEXT,
    brgy_name TEXT,
    pollplace TEXT,
    clustered_prec TEXT,
    registered_voters INTEGER
);

CREATE TABLE IF NOT EXISTS ref_candidates (
    contest_code TEXT REFERENCES ref_contests(contest_code),
    candidate_code TEXT NOT NULL,
    candidate_name TEXT NOT NULL,
    parties_code TEXT REFERENCES ref_parties(parties_code),
    PRIMARY KEY (contest_code, candidate_code)
);
"""

DROP_SQL = """
DROP TABLE IF EXISTS ref_candidates CASCADE;
DROP TABLE IF EXISTS ref_precincts CASCADE;
DROP TABLE IF EXISTS ref_contests CASCADE;
DROP TABLE IF EXISTS ref_parties CASCADE;
"""


def load_csv_to_table(conn, table: str, csv_path: Path):
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        if not cols:
            return 0
        placeholders = ", ".join(["%s"] * len(cols))
        columns = ", ".join(cols)
        sql = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
        null_cols = {"PARTIES_CODE"} if table == "ref_candidates" else set()
        rows = []
        for row in reader:
            rows.append(
                tuple(None if c in null_cols and not row.get(c, "").strip() else row.get(c, "") for c in cols)
            )
        if rows:
            with conn.cursor() as cur:
                cur.executemany(sql, rows)
            conn.commit()
    return len(rows)


def already_loaded(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_name = 'ref_parties')"
        )
        if not cur.fetchone()[0]:
            return False
        cur.execute("SELECT COUNT(*) FROM ref_parties")
        return cur.fetchone()[0] > 0


def main():
    parser = argparse.ArgumentParser(
        description="Load reference data CSVs into Postgres"
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Drop and recreate all tables before loading",
    )
    args = parser.parse_args()

    conn = psycopg2.connect(CONN_STR)

    if args.fresh:
        with conn.cursor() as cur:
            cur.execute(DROP_SQL)
        conn.commit()
        with conn.cursor() as cur:
            cur.execute(CREATE_SQL)
        conn.commit()
        print("Recreated tables (--fresh)")
    elif already_loaded(conn):
        conn.close()
        print("Reference data already loaded (use --fresh to reload)")
        return
    else:
        with conn.cursor() as cur:
            cur.execute(CREATE_SQL)
        conn.commit()
        print("Created tables (first run)")

    counts = {
        "ref_parties": load_csv_to_table(conn, "ref_parties", BASE / "parties.csv"),
        "ref_contests": load_csv_to_table(conn, "ref_contests", BASE / "contest.csv"),
        "ref_precincts": load_csv_to_table(conn, "ref_precincts", BASE / "precincts.csv"),
        "ref_candidates": load_csv_to_table(conn, "ref_candidates", BASE / "candidates.csv"),
    }

    conn.close()
    print("Loaded rows:")
    for table, count in counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()