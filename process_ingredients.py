import pandas as pd
import re
import uuid
from collections import defaultdict

"""
Process the SkinSafe product/ingredient CSV into three normalized tables:
products, ingredients, and a product<->ingredient join table.

The split/normalize helpers are importable without side effects.
Run directly (``python process_ingredients.py``) to regenerate the CSV exports.
"""

CSV_PATH = "/Users/jaewookang/Downloads/sss.csv"


# ---------- Helper functions ----------
def remove_parentheses(text):
    """Remove anything inside parentheses/brackets, repeatedly to handle nesting."""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r'\([^()]*\)', '', text)
        text = re.sub(r'\[[^\[\]]*\]', '', text)
    return text


# Leading chemical locant prefix, e.g. "1,2-", "1.2 ", "1;2-", "1-2 ", "2-",
# "12-" at the start of a name, followed by a letter. Crucially this only
# matches names that START with a digit, so carbon-range names like
# "C12-15 Alkyl Benzoate" (start with a letter) are never touched.
_LOCANT_RE = re.compile(r'^([0-9](?:[ .,;\-]*[0-9])*)[ .,;\-]+(?=[A-Za-z])')


def canonicalize_locant(name):
    """Normalize the separators in a leading locant prefix.

    "1.2-Hexanediol", "1;2 Hexanediol", "1-2-Hexanediol", "1, 2-Hexanediol"
    all become "1,2-Hexanediol". "12-Hexanediol" -> "12-Hexanediol" (kept;
    folded later if a real "1,2-" form exists). "2-Hexanediol" -> "2-Hexanediol".
    """
    m = _LOCANT_RE.match(name)
    if not m:
        return name
    nums = re.findall(r'[0-9]+', m.group(1))
    return ','.join(nums) + '-' + name[m.end():]


def normalize_ingredient(name):
    """Clean spacing and unify formatting."""
    if not isinstance(name, str):
        return None

    # Remove parentheses content
    name = remove_parentheses(name)

    # Strip any stray/unbalanced bracket characters left behind
    name = re.sub(r'[()\[\]{}]', ' ', name)

    # Collapse whitespace around hyphens ("1,2- Hexanediol" / "1,2 -Hexanediol")
    name = re.sub(r'\s*-\s*', '-', name)

    # Remove extra whitespace and normalize spaces
    name = ' '.join(name.split())

    # Remove leading/trailing punctuation (including stray hyphens, e.g. "1--")
    name = name.strip(",.;:/ -")

    # Drop tokens with no letters at all (pure numeric/punct fragments: "1", "12")
    if not re.search(r'[A-Za-z]', name):
        return None

    # Unify leading locant separators
    name = canonicalize_locant(name)

    # Title case for consistency (preserves common acronyms)
    if name and len(name) > 1:
        acronyms = ['PEG', 'PPG', 'CI', 'MEA', 'DEA', 'TEA', 'SLS', 'SLES']
        words = name.split()
        for i, word in enumerate(words):
            if any(word.upper().startswith(acr) for acr in acronyms):
                words[i] = word.upper()
            else:
                words[i] = word.title()
        name = ' '.join(words)

    return name if name else None


def split_ingredients(cell):
    """Robustly split an ingredient list on commas.

    A comma separates ingredients ONLY when it is:
      - outside any parentheses/brackets (depth == 0), AND
      - not a thousands/locant separator between two digits
        (e.g. "25,000 IU", "1,2-Propanediol").

    This fixes the old naive ``cell.split(',')`` which broke tokens like
    "Tocopheryl Acetate (Vitamin E 25,000 Iu/100g)" into the garbage
    ingredient "000 Iu/100G".

    Only *matched* brackets affect depth, so an unbalanced/stray "(" does not
    swallow the rest of the list (some source rows have unclosed parentheses).
    """
    if not isinstance(cell, str):
        return []

    # Identify indices of brackets that are part of a matched pair.
    matched = set()
    for open_ch, close_ch in (('(', ')'), ('[', ']'), ('{', '}')):
        stack = []
        for i, ch in enumerate(cell):
            if ch == open_ch:
                stack.append(i)
            elif ch == close_ch and stack:
                matched.add(stack.pop())
                matched.add(i)

    parts = []
    buf = []
    depth = 0
    n = len(cell)
    for i, ch in enumerate(cell):
        if ch in '([{' and i in matched:
            depth += 1
            buf.append(ch)
        elif ch in ')]}' and i in matched:
            depth -= 1
            buf.append(ch)
        elif ch == ',' and depth == 0:
            # Look past surrounding spaces: a comma flanked by digits is a
            # thousands/locant separator ("25,000", "1, 2-Hexanediol"), not a
            # delimiter -- so it must NOT create a "1" fragment.
            k = i - 1
            while k >= 0 and cell[k] == ' ':
                k -= 1
            prev_ch = cell[k] if k >= 0 else ''
            j = i + 1
            while j < n and cell[j] == ' ':
                j += 1
            next_ch = cell[j] if j < n else ''
            if prev_ch.isdigit() and next_ch.isdigit():
                buf.append(ch)  # numeric separator inside a value, keep it
            else:
                parts.append(''.join(buf))
                buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append(''.join(buf))

    cleaned = [normalize_ingredient(p) for p in parts]
    return [x for x in cleaned if x]


# ---------- Aggressive locant folding ----------
_FULL_LOCANT = re.compile(r'^(\d+(?:,\d+)+)-(.*)$')   # "1,2-Hexanediol"
_NUM_PREFIX = re.compile(r'^(\d+)-(.*)$')              # "2-..." or "12-..."
_STRIP_LOCANT = re.compile(r'^\d+(?:,\d+)*-')          # leading locant for base key


def build_fold_map(counts):
    """Map degenerate locant spellings onto a canonical full-locant name.

    Given {ingredient_name: product_count}, return {variant: canonical} so that
    e.g. "Hexanediol", "2-Hexanediol", "12-Hexanediol" all fold into
    "1,2-Hexanediol" (the dominant full-locant form). Genuinely distinct isomers
    are protected: when a base has 2+ different full locants (e.g. 1,3- and 1,4-
    Butylene Glycol), nothing is merged across them.
    """
    groups = defaultdict(list)
    for name in counts:
        base = _STRIP_LOCANT.sub('', name).strip().lower()
        groups[base].append(name)

    fold = {}
    for members in groups.values():
        if len(members) < 2:
            continue

        locant_of = {}   # name -> "1,2" (full or implied), or None (bare/single)
        rest_of = {}     # name -> remainder after the locant ("Hexanediol")
        for nm in members:
            mfull = _FULL_LOCANT.match(nm)
            if mfull:
                locant_of[nm], rest_of[nm] = mfull.group(1), mfull.group(2)
                continue
            mnum = _NUM_PREFIX.match(nm)
            if mnum:
                # A single numeric token ("2-", "12-") is a SPECIFIC position, not
                # a comma locant. We must NOT assume "12-" means "1,2-" (that would
                # corrupt real names like "12-Hydroxystearic Acid"). Single digits
                # may still fold into a full locant below; multi-digit stay put.
                rest_of[nm] = mnum.group(2)
                locant_of[nm] = None
            else:
                locant_of[nm], rest_of[nm] = None, nm

        full_locants = {l for l in locant_of.values() if l and ',' in l}
        canon_for_locant = {}
        for L in full_locants:
            cands = [m for m in members if locant_of.get(m) == L]
            best = max(cands, key=lambda m: counts[m])
            canon_for_locant[L] = f"{L}-{rest_of[best]}"

        for nm in members:
            L = locant_of.get(nm)
            if L and ',' in L:                       # full or no-separator double
                target = canon_for_locant[L]
                if nm != target:
                    fold[nm] = target
            elif len(full_locants) == 1:             # bare or single digit
                only = next(iter(full_locants))
                msingle = _NUM_PREFIX.match(nm)
                if msingle:                          # single digit, e.g. "2-"
                    if msingle.group(1) in only.split(','):
                        fold[nm] = canon_for_locant[only]
                else:                                # bare, e.g. "Hexanediol"
                    fold[nm] = canon_for_locant[only]
            # 2+ distinct full locants -> ambiguous, leave variant untouched
    return fold


# ---------- Core processing ----------
def process(df, product_ids=None, ingredient_ids=None):
    """Build (products_df, ingredients_df, join_table_df) from the raw CSV df.

    ``product_ids`` / ``ingredient_ids`` are optional name->id dicts used to
    PRESERVE existing UUIDs (e.g. fetched from Supabase). Names not present in
    those maps get a fresh UUID.
    """
    product_ids = dict(product_ids or {})
    ingredient_ids = dict(ingredient_ids or {})

    # Expand each product into per-ingredient rows with position
    records = []
    for _, row in df.iterrows():
        product_name = row["product_name"]
        ingredients = split_ingredients(row["ingredients"])
        for position, ing in enumerate(ingredients, 1):
            records.append({
                "product_name": product_name,
                "ingredient": ing,
                "position": position,
            })
    expanded_df = pd.DataFrame(records)

    # Aggressive locant folding: collapse degenerate spellings (e.g. "Hexanediol",
    # "2-Hexanediol", "12-Hexanediol" -> "1,2-Hexanediol") using distinct-product
    # counts to pick the dominant canonical form.
    pair_counts = (
        expanded_df.drop_duplicates(["product_name", "ingredient"])["ingredient"]
        .value_counts()
        .to_dict()
    )
    fold_map = build_fold_map(pair_counts)
    if fold_map:
        expanded_df["ingredient"] = expanded_df["ingredient"].map(lambda x: fold_map.get(x, x))

    # product_count = number of DISTINCT products containing the ingredient
    ingredient_counts = (
        expanded_df.drop_duplicates(["product_name", "ingredient"])["ingredient"].value_counts()
    )
    avg_position = expanded_df.groupby("ingredient")["position"].mean().round(2)

    # Assign IDs, preserving any provided existing mappings
    for name in df["product_name"].unique():
        product_ids.setdefault(name, str(uuid.uuid4()))
    for ing in expanded_df["ingredient"].unique():
        ingredient_ids.setdefault(ing, str(uuid.uuid4()))

    # Join table (dedupe duplicate ingredient in a product, keep lowest position)
    join_table_df = pd.DataFrame({
        "product_id": expanded_df["product_name"].map(product_ids),
        "ingredient_id": expanded_df["ingredient"].map(ingredient_ids),
        "position": expanded_df["position"],
    })
    join_table_df = (
        join_table_df.sort_values("position")
        .drop_duplicates(subset=["product_id", "ingredient_id"], keep="first")
        .reset_index(drop=True)
    )

    # Products table (count DISTINCT ingredients; folding can dedupe within a product)
    ingredient_counts_per_product = (
        expanded_df.drop_duplicates(["product_name", "ingredient"]).groupby("product_name").size()
    )
    products_df = pd.DataFrame({
        "product_id": [product_ids[n] for n in df["product_name"].unique()],
        "product_name": list(df["product_name"].unique()),
    })
    products_df["ingredient_count"] = products_df["product_name"].map(ingredient_counts_per_product)

    # Ingredients table
    unique_ings = list(expanded_df["ingredient"].unique())
    ingredients_df = pd.DataFrame({
        "ingredient_id": [ingredient_ids[i] for i in unique_ings],
        "ingredient_name": unique_ings,
    })
    ingredients_df["product_count"] = ingredients_df["ingredient_name"].map(ingredient_counts)
    ingredients_df["avg_position"] = ingredients_df["ingredient_name"].map(avg_position)

    return products_df, ingredients_df, join_table_df


def main():
    df = pd.read_csv(CSV_PATH)
    products_df, ingredients_df, join_table_df = process(df)

    print("=" * 60)
    print("PROCESSING SUMMARY")
    print("=" * 60)
    print(f"Total Products: {len(products_df)}")
    print(f"Total Unique Ingredients: {len(ingredients_df)}")
    print(f"Total Relationships: {len(join_table_df)}")
    print(f"Avg Ingredients per Product: {len(join_table_df) / len(products_df):.2f}")

    out = "/Users/jaewookang/Downloads/jaewookng/projects/dermodel"
    products_df.to_csv(f"{out}/products.csv", index=False)
    ingredients_df.to_csv(f"{out}/ingredients.csv", index=False)
    join_table_df.to_csv(f"{out}/product_ingredients.csv", index=False)
    print("\n✅ Files exported: products.csv, ingredients.csv, product_ingredients.csv")


if __name__ == "__main__":
    main()
