#!/usr/bin/env python3
"""
Seed sss_products.image_url with the SkinSafe CDN links from the source
dataset (sss.csv). One-time import; re-runnable (upserts are idempotent).

Images are HOTLINKED, not copied: only the URL is stored, the frontend loads
it straight from the origin. image_source_url (the SkinSafe product page) and
image_attribution ("skinsafeproducts.com") feed the visible credit line.

Matches CSV rows to existing products by exact product_name (the same key
load_to_supabase.py preserves product_ids with), and updates in bulk via
PostgREST upsert (merge-duplicates), ~500 rows per request.

Usage:
  export SUPABASE_SERVICE_KEY="..."
  python3 scripts/import_skinsafe_images.py [--csv PATH] [--dry-run]
"""

import argparse
import csv
import os
import sys
from urllib.parse import urlparse

import requests

SUPABASE_URL = "https://dolkstgbyfozbetxyrby.supabase.co"
DEFAULT_CSV = "/Users/jaewookang/Downloads/sss.csv"  # same source as process_ingredients.py
BATCH = 500
USER_AGENT = "dermodel-image-import/1.0 (admin@dermodel.app)"


def log(msg: str) -> None:
    print(msg, flush=True)


def load_csv_images(path: str) -> dict[str, dict]:
    """product_name -> {image_url, product_url}; first occurrence wins."""
    images: dict[str, dict] = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            name = (row.get("product_name") or "").strip()
            image_url = (row.get("image_url") or "").strip()
            product_url = (row.get("product_url") or "").strip()
            if not name or name in images:
                continue
            if not image_url.startswith(("http://", "https://")):
                continue
            images[name] = {"image_url": image_url, "product_url": product_url}
    log(f"CSV rows with a usable image link: {len(images)}")
    return images


def fetch_all_products(session: requests.Session) -> list[dict]:
    products, offset, page = [], 0, 1000
    while True:
        r = session.get(
            f"{SUPABASE_URL}/rest/v1/sss_products",
            params={
                "select": "product_id,product_name",
                "order": "product_id.asc",
                "offset": offset,
                "limit": page,
            },
            timeout=60,
        )
        r.raise_for_status()
        batch = r.json()
        products.extend(batch)
        if len(batch) < page:
            break
        offset += page
    log(f"Products in database: {len(products)}")
    return products


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", default=DEFAULT_CSV)
    ap.add_argument("--dry-run", action="store_true",
                    help="report match coverage, write nothing")
    args = ap.parse_args()

    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key and not args.dry_run:
        sys.exit("SUPABASE_SERVICE_KEY is not set (only --dry-run works without it).")
    if not key:
        key = os.environ.get("SUPABASE_ANON_KEY", "")
        if not key:
            sys.exit("For --dry-run set SUPABASE_ANON_KEY (or SUPABASE_SERVICE_KEY).")

    session = requests.Session()
    session.headers.update({
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "User-Agent": USER_AGENT,
    })

    images = load_csv_images(args.csv)
    products = fetch_all_products(session)

    updates = []
    for p in products:
        info = images.get(p["product_name"])
        if not info:
            continue
        updates.append({
            "product_id": p["product_id"],
            "product_name": p["product_name"],
            "image_url": info["image_url"],
            "image_source_url": info["product_url"] or info["image_url"],
            "image_attribution": urlparse(info["image_url"]).hostname or "skinsafeproducts.com",
        })
    log(f"Products matched to an image: {len(updates)} / {len(products)}")

    if args.dry_run:
        log("Dry run — nothing written.")
        return

    written = 0
    for i in range(0, len(updates), BATCH):
        chunk = updates[i:i + BATCH]
        r = session.post(
            f"{SUPABASE_URL}/rest/v1/sss_products",
            params={"on_conflict": "product_id"},
            json=chunk,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            timeout=120,
        )
        if r.status_code not in (200, 201, 204):
            sys.exit(f"Upsert failed at batch {i // BATCH} "
                     f"({r.status_code}): {r.text[:300]}")
        written += len(chunk)
        log(f"  upserted {written}/{len(updates)}")

    log(f"Done. {written} products now hotlink a SkinSafe image.")


if __name__ == "__main__":
    main()
