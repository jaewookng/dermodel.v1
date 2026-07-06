#!/usr/bin/env python3
"""
Load cleanly-split products/ingredients into the remote Supabase sss_* tables.

- Re-splits sss.csv with the robust splitter in process_ingredients.py
- PRESERVES existing product_id / ingredient_id by matching on name
  (so product_favorites and any paper links stay intact)
- Upserts sss_products and sss_ingredients
- Fully rebuilds sss_product_ingredients_join (delete batched by product_id, then insert)
- Prunes ingredients that no longer appear (e.g. old garbage tokens)

Uses the PostgREST API with the service-role key (no direct DB connection available).
"""

import json
import os
import sys
import time

import pandas as pd
import requests

from process_ingredients import process, CSV_PATH

SUPABASE_URL = "https://dolkstgbyfozbetxyrby.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_KEY:
    sys.exit(
        "SUPABASE_SERVICE_KEY is not set. Export the service-role key first:\n"
        '  export SUPABASE_SERVICE_KEY="..."  (Supabase Dashboard > Settings > API)'
    )
REST = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

session = requests.Session()
session.headers.update(HEADERS)


def _request(method, url, **kw):
    for attempt in range(5):
        resp = session.request(method, url, timeout=120, **kw)
        if resp.status_code < 400:
            return resp
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < 4:
            time.sleep(2 * (attempt + 1))
            continue
        raise RuntimeError(f"{method} {url} -> {resp.status_code}: {resp.text[:500]}")
    raise RuntimeError("unreachable")


def fetch_name_map(table, id_col, name_col, step=1000):
    """Return {name: id} for an existing table, paginated."""
    out = {}
    start = 0
    while True:
        resp = _request(
            "GET",
            f"{REST}/{table}?select={id_col},{name_col}",
            headers={"Range-Unit": "items", "Range": f"{start}-{start + step - 1}"},
        )
        rows = resp.json()
        for r in rows:
            if r[name_col] is not None:
                out[r[name_col]] = r[id_col]
        if len(rows) < step:
            break
        start += step
    return out


def records(df, chunk):
    """Yield JSON-safe record batches (handles numpy types via to_json)."""
    for i in range(0, len(df), chunk):
        part = df.iloc[i:i + chunk]
        yield json.loads(part.to_json(orient="records"))


def upsert(table, df, on_conflict, chunk=2000):
    total = len(df)
    done = 0
    for batch in records(df, chunk):
        _request(
            "POST",
            f"{REST}/{table}?on_conflict={on_conflict}",
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            data=json.dumps(batch),
        )
        done += len(batch)
        print(f"  upsert {table}: {done}/{total}", end="\r", flush=True)
    print(f"  upsert {table}: {done}/{total}  done")


def insert(table, df, chunk=5000):
    total = len(df)
    done = 0
    for batch in records(df, chunk):
        _request(
            "POST",
            f"{REST}/{table}",
            headers={"Prefer": "return=minimal"},
            data=json.dumps(batch),
        )
        done += len(batch)
        print(f"  insert {table}: {done}/{total}", end="\r", flush=True)
    print(f"  insert {table}: {done}/{total}  done")


def delete_join_by_products(product_ids, chunk=400):
    """Delete join rows in bounded batches keyed by product_id (avoids one huge statement)."""
    ids = list(product_ids)
    done = 0
    for i in range(0, len(ids), chunk):
        group = ids[i:i + chunk]
        in_list = ",".join(f'"{pid}"' for pid in group)
        _request(
            "DELETE",
            f"{REST}/sss_product_ingredients_join?product_id=in.({in_list})",
            headers={"Prefer": "return=minimal"},
        )
        done += len(group)
        print(f"  delete join: {done}/{len(ids)} products", end="\r", flush=True)
    print(f"  delete join: {done}/{len(ids)} products  done")


def delete_ingredients(ids, chunk=200):
    ids = list(ids)
    done = 0
    for i in range(0, len(ids), chunk):
        group = ids[i:i + chunk]
        in_list = ",".join(f'"{x}"' for x in group)
        _request(
            "DELETE",
            f"{REST}/sss_ingredients?ingredient_id=in.({in_list})",
            headers={"Prefer": "return=minimal"},
        )
        done += len(group)
        print(f"  prune ingredients: {done}/{len(ids)}", end="\r", flush=True)
    print(f"  prune ingredients: {done}/{len(ids)}  done")


def main():
    dry = "--dry-run" in sys.argv

    print("Reading CSV + fetching existing IDs from remote ...")
    df = pd.read_csv(CSV_PATH)
    product_ids = fetch_name_map("sss_products", "product_id", "product_name")
    ingredient_ids = fetch_name_map("sss_ingredients", "ingredient_id", "ingredient_name")
    print(f"  existing products: {len(product_ids)}, existing ingredients: {len(ingredient_ids)}")

    print("Processing with robust splitter (preserving IDs) ...")
    products_df, ingredients_df, join_df = process(df, product_ids, ingredient_ids)

    new_names = set(ingredients_df["ingredient_name"])
    orphan_ids = [iid for name, iid in ingredient_ids.items() if name not in new_names]
    reused = sum(1 for n in products_df["product_name"] if n in product_ids)

    print("-" * 60)
    print(f"Products: {len(products_df)} (reused IDs: {reused})")
    print(f"Ingredients: {len(ingredients_df)} (orphans to prune: {len(orphan_ids)})")
    print(f"Join rows: {len(join_df)}")
    print("-" * 60)

    if dry:
        print("Dry run - no writes performed.")
        print("Sample orphan ingredient names being pruned:")
        inv = {v: k for k, v in ingredient_ids.items()}
        for oid in orphan_ids[:15]:
            print("   -", inv.get(oid))
        return

    print("1/5 Upserting products ...")
    upsert("sss_products", products_df, "product_id")

    print("2/5 Upserting ingredients ...")
    upsert("sss_ingredients", ingredients_df, "ingredient_id")

    print("3/5 Deleting old join rows ...")
    delete_join_by_products(products_df["product_id"].tolist())

    print("4/5 Inserting new join rows ...")
    insert("sss_product_ingredients_join", join_df)

    print("5/5 Pruning orphan ingredients ...")
    delete_ingredients(orphan_ids)

    print("\nDone.")


if __name__ == "__main__":
    main()
