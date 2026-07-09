#!/usr/bin/env python3
"""Load reference data CSVs into local pprcv_local Postgres database."""

import csv
from pathlib import Path

import psycopg2

BASE = Path(__file__).resolve().parent.parent / "sample-csv"
CONN_STR = "host=localhost dbname=pprcv_local user=daryllmagsombol"


SCHEMA_SQL = """
DROP TABLE IF EXISTS ref_parties CASCADE;
DROP TABLE IF EXISTS ref_contests CASCADE;
DROP TABLE IF EXISTS ref_precincts CASCADE;
DROP TABLE IF EXISTS ref_candidates CASCADE;

CREATE TABLE ref_parties (
    parties_code TEXT PRIMARY KEY,
    parties_name TEXT NOT NULL,
    parties_alias TEXT
);

CREATE TABLE ref_contests (
    contest_code TEXT PRIMARY KEY,
    contest_name TEXT NOT NULL
);

CREATE TABLE ref_precincts (
    acm_id TEXT PRIMARY KEY,
    reg_name TEXT,
    prv_name TEXT,
    mun_name TEXT,
    brgy_name TEXT,
    pollplace TEXT,
    clustered_prec TEXT,
    registered_voters INTEGER
);

CREATE TABLE ref_candidates (
    contest_code TEXT REFERENCES ref_contests(contest_code),
    candidate_code TEXT NOT NULL,
    candidate_name TEXT NOT NULL,
    parties_code TEXT REFERENCES ref_parties(parties_code),
    PRIMARY KEY (contest_code, candidate_code)
);
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


def main():
    conn = psycopg2.connect(CONN_STR)
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
    conn.commit()
    print("Created tables: ref_parties, ref_contests, ref_precincts, ref_candidates")

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