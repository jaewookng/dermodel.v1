# Neo4j AuraDB Migration Plan

## Roadmap

```
Phase 1 — Now        Supabase (current)
                     Optimize for flat reads, collect user behavior data

Phase 2 — Trigger    Sufficient LIKES signal (~hundreds of active users)
                     Build recommendation engine on Supabase first to validate query patterns

Phase 3 — Migrate    Port to Neo4j AuraDB Professional when graph traversals
                     become the bottleneck, not before
```

Migration is **not the next step**. The graph schema and implementation details below are reference material for when Phase 3 begins.

---

## Why not migrate now

- 1.2M IS_IN edges exceeds AuraDB Free (400k limit) → requires Professional (~$65–175/month)
- Primary UI is flat table reads — Postgres matches or beats Neo4j for this pattern
- `product_favorites` (LIKES edges) is currently sparse; collaborative filtering needs signal
- `skin_type` / `skin_concerns` enums are now normalized and ready, but user volume isn't
- No recommendation query patterns defined yet — premature to optimize for them

**Trigger for Phase 3**: recommendation queries become measurably slow in Postgres, or multi-hop traversal patterns (user → product ← ingredient → similar product) are confirmed as core features.

---

## Phase 1: Supabase optimizations (completed)

These changes make Supabase performant now and make the future migration cleaner.

| Change | Status | Migration benefit |
|---|---|---|
| Index on `sss_product_ingredients_join(ingredient_id)` | Done | IS_IN edge lookups by source node |
| Server-side filter/sort/paginate in `useIngredients` | Done | Query shape maps directly to Cypher |
| `skin_type` / `skin_concerns` as enums | Done | Graph clustering requires controlled vocabulary |
| Stats views replacing stored `product_count` etc. | Done | Computed via traversal in graph — drop the columns |

---

## Phase 2: Recommendation engine on Supabase

Build and validate recommendation logic in Postgres before committing to graph infrastructure. Supabase handles these with CTEs and window functions.

### Collaborative filtering — users with similar skin concerns

```sql
-- Users who share skin concerns with the current user, ranked by overlap
SELECT
  p2.id,
  p2.username,
  array_length(
    ARRAY(SELECT unnest(p1.skin_concerns) INTERSECT SELECT unnest(p2.skin_concerns)),
    1
  ) AS shared_concern_count
FROM profiles p1
JOIN profiles p2
  ON p1.id != p2.id
  AND p1.skin_concerns && p2.skin_concerns   -- overlap operator
WHERE p1.id = $current_user_id
ORDER BY shared_concern_count DESC
LIMIT 20;
```

### Product recommendations from similar users

```sql
-- Products liked by users who share skin concerns, not yet liked by current user
SELECT
  sp.product_id,
  sp.product_name,
  COUNT(DISTINCT pf.user_id) AS liked_by_similar_users
FROM profiles p1
JOIN profiles p2
  ON p1.id != p2.id
  AND p1.skin_concerns && p2.skin_concerns
JOIN product_favorites pf ON pf.user_id = p2.id
JOIN sss_products sp ON sp.product_id = pf.product_id
WHERE p1.id = $current_user_id
  AND pf.product_id NOT IN (
    SELECT product_id FROM product_favorites WHERE user_id = $current_user_id
  )
GROUP BY sp.product_id, sp.product_name
ORDER BY liked_by_similar_users DESC
LIMIT 10;
```

### Ingredient co-occurrence (content-based)

```sql
-- Ingredients that frequently appear alongside a given ingredient
SELECT
  i2.ingredient_id,
  i2.ingredient_name,
  COUNT(*) AS co_occurrence_count
FROM sss_product_ingredients_join j1
JOIN sss_product_ingredients_join j2
  ON j1.product_id = j2.product_id
  AND j1.ingredient_id != j2.ingredient_id
JOIN sss_ingredients i2 ON i2.ingredient_id = j2.ingredient_id
WHERE j1.ingredient_id = $ingredient_id
GROUP BY i2.ingredient_id, i2.ingredient_name
ORDER BY co_occurrence_count DESC
LIMIT 20;
```

If these queries become slow at scale (measured, not assumed), that is the signal to migrate.

---

## Phase 3: Neo4j AuraDB migration

### Why Neo4j wins at scale for these patterns

The Phase 2 queries above are 3–4 table joins. In Neo4j they become pointer follows:

```cypher
-- Users with similar skin concerns
MATCH (u1:User {user_id: $id})-[:HAS_CONCERN]->(c:Concern)<-[:HAS_CONCERN]-(u2:User)
RETURN u2, count(c) AS shared ORDER BY shared DESC LIMIT 20

-- Products recommended from similar users
MATCH (u1:User {user_id: $id})-[:HAS_CONCERN]->(:Concern)<-[:HAS_CONCERN]-(u2:User)
      -[:LIKES]->(p:Product)
WHERE NOT (u1)-[:LIKES]->(p)
RETURN p, count(u2) AS score ORDER BY score DESC LIMIT 10

-- Ingredient co-occurrence
MATCH (i1:Ingredient {ingredient_id: $id})-[:IS_IN]->(p:Product)<-[:IS_IN]-(i2:Ingredient)
RETURN i2, count(p) AS co_occurrences ORDER BY co_occurrences DESC LIMIT 20
```

### AuraDB tier at migration time

| Data | Volume | Node/Edge type |
|---|---|---|
| Ingredients | 21k | Ingredient nodes |
| Products | 50k | Product nodes |
| IS_IN edges | 1.2M | Exceeds Free tier |
| User nodes | TBD at migration | User nodes |
| LIKES edges | TBD at migration | Critical signal |

Free tier (400k edges) will not fit — **AuraDB Professional required**.  
Estimated cost at migration: $65–175/month depending on RAM tier needed.

### Graph schema

```cypher
(:Ingredient {
  ingredient_id: String,
  ingredient_name: String
})

(:Product {
  product_id:   String,
  product_name: String,
  image_url:    String
})

(:User {
  user_id:       String,
  username:      String,
  email:         String,
  skin_type:     [String],   // SkinType enum values
  skin_concerns: [String]    // SkinConcern enum values
})

(:Concern {
  name: String   // normalized SkinConcern value — promoted to node for traversal
})

(:Paper {
  paper_id:     String,
  title:        String,
  doi:          String,
  authors:      [String],
  published_at: Date
})
```

```cypher
(:Ingredient)-[:IS_IN { position: Integer }]->(:Product)
(:User)-[:LIKES { notes: String, created_at: DateTime }]->(:Product)
(:User)-[:HAS_CONCERN]->(:Concern)
(:Ingredient)-[:REFERENCED_IN { relation_type: String }]->(:Paper)
```

Note: `skin_concerns` is promoted from a User property array to `(:Concern)` nodes with `HAS_CONCERN` edges. This enables the collaborative filtering traversal without array intersection operators.

### Indexes

```cypher
CREATE CONSTRAINT FOR (i:Ingredient) REQUIRE i.ingredient_id IS UNIQUE;
CREATE CONSTRAINT FOR (p:Product)    REQUIRE p.product_id IS UNIQUE;
CREATE CONSTRAINT FOR (u:User)       REQUIRE u.user_id IS UNIQUE;
CREATE CONSTRAINT FOR (c:Concern)    REQUIRE c.name IS UNIQUE;
CREATE CONSTRAINT FOR (p:Paper)      REQUIRE p.paper_id IS UNIQUE;

CREATE INDEX FOR (i:Ingredient) ON (i.ingredient_name);
CREATE INDEX FOR (p:Product)    ON (p.product_name);
```

### Target architecture

```
Browser (React SPA, Firebase Hosting)
    ↓ GraphQL over HTTPS
Firebase Cloud Functions
    ↓ Bolt protocol (neo4j-driver)
Neo4j AuraDB Professional
```

Auth stays in Supabase or moves to Firebase Auth — decision deferred to Phase 3.

### Service replacement map

| Supabase | Replacement |
|---|---|
| Postgres tables | Neo4j AuraDB |
| Supabase Auth | Keep Supabase Auth or move to Firebase Auth |
| `@supabase/supabase-js` | `@apollo/client` (GraphQL) |
| Supabase RLS | JWT verification in Cloud Function |
| Stats views | Computed via graph traversal |

### Migration script (reference)

Run once from a local Node script. The IS_IN edges (1.2M rows) must be chunked.

```ts
// scripts/migrate-to-neo4j.ts
import neo4j from "neo4j-driver";
import { createClient } from "@supabase/supabase-js";

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const session = driver.session();
const CHUNK = 10_000;

// 1. Ingredients
const { data: ingredients } = await supabase.from("sss_ingredients").select("ingredient_id, ingredient_name");
await session.run(
  `UNWIND $rows AS row
   MERGE (i:Ingredient { ingredient_id: row.ingredient_id })
   SET i.ingredient_name = row.ingredient_name`,
  { rows: ingredients }
);

// 2. Products
const { data: products } = await supabase.from("sss_products").select("product_id, product_name, image_url");
await session.run(
  `UNWIND $rows AS row
   MERGE (p:Product { product_id: row.product_id })
   SET p.product_name = row.product_name, p.image_url = row.image_url`,
  { rows: products }
);

// 3. IS_IN edges — chunked (1.2M rows)
let from = 0;
while (true) {
  const { data: joins } = await supabase
    .from("sss_product_ingredients_join")
    .select("product_id, ingredient_id, position")
    .range(from, from + CHUNK - 1);
  if (!joins?.length) break;
  await session.run(
    `UNWIND $rows AS row
     MATCH (i:Ingredient { ingredient_id: row.ingredient_id })
     MATCH (p:Product    { product_id:    row.product_id })
     MERGE (i)-[:IS_IN { position: row.position }]->(p)`,
    { rows: joins }
  );
  from += CHUNK;
}

// 4. Users + Concern nodes + HAS_CONCERN edges
const { data: profiles } = await supabase.from("profiles").select("id, username, email, skin_type, skin_concerns");
await session.run(
  `UNWIND $rows AS row
   MERGE (u:User { user_id: row.id })
   SET u.username = row.username, u.email = row.email, u.skin_type = row.skin_type
   WITH u, row
   UNWIND coalesce(row.skin_concerns, []) AS concern
   MERGE (c:Concern { name: concern })
   MERGE (u)-[:HAS_CONCERN]->(c)`,
  { rows: profiles }
);

// 5. LIKES edges
const { data: favorites } = await supabase.from("product_favorites").select("user_id, product_id, notes");
await session.run(
  `UNWIND $rows AS row
   MATCH (u:User    { user_id:    row.user_id })
   MATCH (p:Product { product_id: row.product_id })
   MERGE (u)-[:LIKES { notes: row.notes }]->(p)`,
  { rows: favorites }
);

// 6. Papers + REFERENCED_IN edges
const { data: papers } = await supabase.from("papers").select("id, title, doi, authors, published_at");
await session.run(
  `UNWIND $rows AS row
   MERGE (p:Paper { paper_id: row.id })
   SET p.title = row.title, p.doi = row.doi, p.authors = row.authors, p.published_at = row.published_at`,
  { rows: papers }
);

const { data: ingredientPapers } = await supabase.from("sss_ingredients_papers").select("ingredient_id, paper_id, relation_type, notes");
await session.run(
  `UNWIND $rows AS row
   MATCH (i:Ingredient { ingredient_id: row.ingredient_id })
   MATCH (p:Paper      { paper_id:      row.paper_id })
   MERGE (i)-[:REFERENCED_IN { relation_type: row.relation_type, notes: row.notes }]->(p)`,
  { rows: ingredientPapers }
);

await session.close();
await driver.close();
```

### File changelist (Phase 3)

```
New
├── functions/
│   ├── src/index.ts          ← Neo4j GraphQL API (Firebase Cloud Function)
│   └── package.json
├── scripts/migrate-to-neo4j.ts

Rewritten
├── src/lib/apollo.ts                 ← replaces supabase/client.ts
├── src/hooks/useIngredients.ts       ← gql queries replace supabase queries
├── src/hooks/useIngredientProducts.ts
└── src/main.tsx                      ← ApolloProvider wrapper

Deleted
├── src/integrations/supabase/client.ts
├── src/integrations/supabase/publicClient.ts
└── src/integrations/supabase/types.ts  ← replaced by GraphQL codegen types

Modified
├── package.json       ← add @apollo/client; remove @supabase/supabase-js
└── firebase.json      ← add functions
```

---

## Decision log

| Decision | Rationale |
|---|---|
| Build recommendations on Supabase first | Validate query patterns before paying for graph infra |
| Promote `skin_concerns` to `(:Concern)` nodes | Enables HAS_CONCERN traversal; array intersection in Postgres, pointer follow in graph |
| Normalize skin enums now (Phase 1) | Graph clustering is garbage-in/garbage-out; clean data is the prerequisite |
| Defer auth migration decision | Supabase Auth works; not worth the rewrite risk until graph migration is confirmed |
| Chunk IS_IN migration at 10k rows | 1.2M rows in one transaction will timeout and OOM |
