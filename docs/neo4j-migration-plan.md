# Neo4j AuraDB Migration Plan

## Context

Dermodel currently uses Supabase (Postgres) with join tables for ingredient-product relationships. This plan migrates to Neo4j AuraDB Free to express ingredients, products, and users as nodes with typed edges — eliminating join table overhead for multi-hop queries.

**Honest tradeoff**: Flat table reads (the primary UI) perform comparably or slightly better in Postgres. Neo4j earns its keep when multi-hop traversal features are added (recommendations, similarity, skin-concern paths). This migration is best treated as **infrastructure for future graph features**, not a flat-read performance win.

---

## AuraDB Free Tier Limits

| Limit | Value |
|---|---|
| Nodes | 200,000 |
| Relationships | 400,000 |
| Storage | 200 MB |
| RAM | 1 GB |
| Instances | 1 |
| Region | Fixed at creation |

Estimate for current data:
- `sss_ingredients` rows → Ingredient nodes
- `sss_products` rows → Product nodes
- `sss_product_ingredients_join` rows → IS_IN edges (largest volume)
- `profiles` rows → User nodes
- `product_favorites` rows → LIKES edges
- `papers` rows → Paper nodes
- `sss_ingredients_papers` rows → REFERENCED_IN edges

If `sss_product_ingredients_join` exceeds ~380k rows, the free tier will not fit. Verify row counts before committing.

---

## Target Architecture

```
Browser (React SPA, Firebase Hosting)
    ↓ GraphQL over HTTPS
Firebase Cloud Functions
    ↓ Bolt protocol (neo4j-driver)
Neo4j AuraDB Free
```

Auth moves from Supabase Auth → Firebase Auth (same Google/GitHub OAuth providers).

---

## Graph Schema

### Nodes

```cypher
(:Ingredient {
  ingredient_id: String,   // PK
  ingredient_name: String
})

(:Product {
  product_id:       String,   // PK
  product_name:     String,
  image_url:        String,
  image_fetched_at: DateTime
})

(:User {
  user_id:       String,   // maps to profiles.id
  username:      String,
  avatar_url:    String,
  email:         String,
  skin_type:     [String],
  skin_concerns: [String],
  bio:           String,
  created_at:    DateTime
})

(:Paper {
  paper_id:     String,   // PK
  doi:          String,
  arxiv_id:     String,
  url:          String,
  title:        String,
  authors:      [String],
  published_at: Date,
  journal:      String,
  volume:       String,
  issue:        String
})
```

### Relationships (edges)

```cypher
// replaces sss_product_ingredients_join
(:Ingredient)-[:IS_IN { position: Integer }]->(:Product)

// replaces product_favorites
(:User)-[:LIKES { notes: String, created_at: DateTime }]->(:Product)

// replaces sss_ingredients_papers
(:Ingredient)-[:REFERENCED_IN { relation_type: String, notes: String }]->(:Paper)
```

### Indexes

```cypher
CREATE CONSTRAINT FOR (i:Ingredient) REQUIRE i.ingredient_id IS UNIQUE;
CREATE CONSTRAINT FOR (p:Product)    REQUIRE p.product_id IS UNIQUE;
CREATE CONSTRAINT FOR (u:User)       REQUIRE u.user_id IS UNIQUE;
CREATE CONSTRAINT FOR (p:Paper)      REQUIRE p.paper_id IS UNIQUE;

// for table-view sort/filter performance
CREATE INDEX ingredient_name_index FOR (i:Ingredient) ON (i.ingredient_name);
CREATE INDEX product_name_index    FOR (p:Product)    ON (p.product_name);
```

Dropped fields (computed via traversal instead):
- `sss_ingredients.product_count` → `COUNT { (i)-[:IS_IN]->() }`
- `sss_ingredients.avg_position` → `avg(r.position)`
- `sss_products.ingredient_count` → `COUNT { ()-[:IS_IN]->(p) }`

---

## Service Replacement Map

| Supabase | Replacement |
|---|---|
| Postgres tables | Neo4j AuraDB |
| Supabase Auth (Google/GitHub) | Firebase Auth |
| `@supabase/supabase-js` client | `@apollo/client` (GraphQL) |
| Supabase RLS | JWT verification in Cloud Function |
| Supabase Realtime | Not replaced (polling or drop feature) |
| Supabase Storage | Firebase Storage (if needed) |

---

## Migration Steps

### Step 1 — Provision

1. Create Neo4j AuraDB Free instance at [console.neo4j.io](https://console.neo4j.io)
2. Save connection URI, username, and password to `.env`
3. Enable Google and GitHub providers in Firebase Console → Authentication → Sign-in method

### Step 2 — Data migration script

Run once from a local Node script (not from the browser):

```ts
// scripts/migrate-to-neo4j.ts
import neo4j from "neo4j-driver";
import { createClient } from "@supabase/supabase-js";

const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const session = driver.session();

// 1. Ingredients
const { data: ingredients } = await supabase.from("sss_ingredients").select("*");
await session.run(
  `UNWIND $rows AS row
   MERGE (i:Ingredient { ingredient_id: row.ingredient_id })
   SET i.ingredient_name = row.ingredient_name`,
  { rows: ingredients }
);

// 2. Products
const { data: products } = await supabase.from("sss_products").select("*");
await session.run(
  `UNWIND $rows AS row
   MERGE (p:Product { product_id: row.product_id })
   SET p.product_name = row.product_name, p.image_url = row.image_url`,
  { rows: products }
);

// 3. IS_IN edges (batch in chunks if > 50k rows)
const { data: joins } = await supabase.from("sss_product_ingredients_join").select("*");
await session.run(
  `UNWIND $rows AS row
   MATCH (i:Ingredient { ingredient_id: row.ingredient_id })
   MATCH (p:Product    { product_id:    row.product_id })
   MERGE (i)-[:IS_IN { position: row.position }]->(p)`,
  { rows: joins }
);

// 4. Papers
const { data: papers } = await supabase.from("papers").select("*");
await session.run(
  `UNWIND $rows AS row
   MERGE (p:Paper { paper_id: row.id })
   SET p.title = row.title, p.doi = row.doi, p.authors = row.authors`,
  { rows: papers }
);

// 5. REFERENCED_IN edges
const { data: ingredientPapers } = await supabase.from("sss_ingredients_papers").select("*");
await session.run(
  `UNWIND $rows AS row
   MATCH (i:Ingredient { ingredient_id: row.ingredient_id })
   MATCH (p:Paper      { paper_id:      row.paper_id })
   MERGE (i)-[:REFERENCED_IN { relation_type: row.relation_type, notes: row.notes }]->(p)`,
  { rows: ingredientPapers }
);

// 6. Users (profiles)
const { data: profiles } = await supabase.from("profiles").select("*");
await session.run(
  `UNWIND $rows AS row
   MERGE (u:User { user_id: row.id })
   SET u.username = row.username, u.email = row.email,
       u.skin_type = row.skin_type, u.skin_concerns = row.skin_concerns`,
  { rows: profiles }
);

// 7. LIKES edges
const { data: favorites } = await supabase.from("product_favorites").select("*");
await session.run(
  `UNWIND $rows AS row
   MATCH (u:User    { user_id:    row.user_id })
   MATCH (p:Product { product_id: row.product_id })
   MERGE (u)-[:LIKES { notes: row.notes }]->(p)`,
  { rows: favorites }
);

await session.close();
await driver.close();
```

### Step 3 — API layer (Firebase Cloud Function)

```
functions/
├── src/
│   └── index.ts    ← Neo4j GraphQL server
├── package.json
└── tsconfig.json
```

```ts
// functions/src/index.ts
import { Neo4jGraphQL } from "@neo4j/graphql";
import neo4j from "neo4j-driver";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import cors from "cors";

admin.initializeApp();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

const typeDefs = `#graphql
  type Ingredient {
    ingredient_id: ID! @id
    ingredient_name: String
    products: [Product!]! @relationship(type: "IS_IN", direction: OUT, properties: "IsInProps")
    papers: [Paper!]! @relationship(type: "REFERENCED_IN", direction: OUT, properties: "ReferencedInProps")
  }

  type Product {
    product_id: ID! @id
    product_name: String
    image_url: String
    ingredients: [Ingredient!]! @relationship(type: "IS_IN", direction: IN, properties: "IsInProps")
    likedBy: [User!]! @relationship(type: "LIKES", direction: IN, properties: "LikesProps")
  }

  type User {
    user_id: ID! @id
    username: String
    email: String
    skin_type: [String]
    skin_concerns: [String]
    favorites: [Product!]! @relationship(type: "LIKES", direction: OUT, properties: "LikesProps")
  }

  type Paper {
    paper_id: ID! @id
    title: String
    doi: String
    arxiv_id: String
    authors: [String]
    published_at: Date
    journal: String
  }

  interface IsInProps @relationshipProperties {
    position: Int
  }

  interface LikesProps @relationshipProperties {
    notes: String
    created_at: DateTime
  }

  interface ReferencedInProps @relationshipProperties {
    relation_type: String
    notes: String
  }
`;

const neoSchema = new Neo4jGraphQL({ typeDefs, driver });
const schema = await neoSchema.getSchema();
const server = new ApolloServer({ schema });
await server.start();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(
  "/graphql",
  expressMiddleware(server, {
    context: async ({ req }) => {
      const token = req.headers.authorization?.split("Bearer ")[1];
      const user = token ? await admin.auth().verifyIdToken(token) : null;
      return { driver, req, user };
    },
  })
);

export const api = onRequest(app);
```

```json
// functions/package.json (key deps)
{
  "dependencies": {
    "neo4j-driver": "^5.0.0",
    "@neo4j/graphql": "^5.0.0",
    "@apollo/server": "^4.0.0",
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.0.0",
    "express": "^4.18.0",
    "cors": "^2.8.5"
  }
}
```

### Step 4 — Client: replace Supabase with Apollo

```ts
// src/lib/apollo.ts
import { ApolloClient, InMemoryCache, createHttpLink } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { getAuth } from "firebase/auth";

const httpLink = createHttpLink({
  uri: import.meta.env.VITE_GRAPHQL_URL, // Cloud Function URL
});

const authLink = setContext(async (_, { headers }) => {
  const token = await getAuth().currentUser?.getIdToken();
  return {
    headers: { ...headers, authorization: token ? `Bearer ${token}` : "" },
  };
});

export const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
});
```

```tsx
// src/main.tsx — wrap app
import { ApolloProvider } from "@apollo/client";
import { apolloClient } from "./lib/apollo";

root.render(
  <ApolloProvider client={apolloClient}>
    <App />
  </ApolloProvider>
);
```

### Step 5 — Replace Supabase Auth with Firebase Auth

```ts
// src/contexts/AuthContext.tsx
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
} from "firebase/auth";
import { createContext, useContext, useEffect, useState } from "react";

const app = initializeApp({
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
});

const auth = getAuth(app);

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  return (
    <AuthContext.Provider value={{
      user,
      signInWithGoogle: () => signInWithPopup(auth, new GoogleAuthProvider()),
      signInWithGithub: () => signInWithPopup(auth, new GithubAuthProvider()),
      signOut: () => auth.signOut(),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

### Step 6 — Replace hook queries

Example: `useIngredientProducts` before and after.

```ts
// BEFORE (Supabase)
const { data } = await supabase
  .from("sss_product_ingredients_join")
  .select("position, sss_products(product_id, product_name, image_url)")
  .eq("ingredient_id", ingredientId);

// AFTER (Apollo)
const GET_INGREDIENT_PRODUCTS = gql`
  query GetIngredientProducts($ingredientId: ID!) {
    ingredients(where: { ingredient_id: $ingredientId }) {
      productsConnection {
        edges {
          properties { position }
          node { product_id product_name image_url }
        }
      }
    }
  }
`;
const { data } = useQuery(GET_INGREDIENT_PRODUCTS, { variables: { ingredientId } });
```

---

## File changelist

```
New
├── functions/                        ← Firebase Cloud Functions (new service)
│   ├── src/index.ts                  ← Neo4j GraphQL API
│   └── package.json
├── scripts/migrate-to-neo4j.ts       ← one-time data migration
├── src/lib/apollo.ts                 ← replaces supabase/client.ts
└── docs/neo4j-migration-plan.md      ← this file

Rewritten
├── src/contexts/AuthContext.tsx      ← Firebase Auth replaces Supabase Auth
├── src/hooks/useIngredients.ts
├── src/hooks/useIngredientProducts.ts
└── src/main.tsx                      ← ApolloProvider wrapper

Deleted
├── src/integrations/supabase/client.ts
├── src/integrations/supabase/publicClient.ts
└── src/integrations/supabase/types.ts

Modified
├── package.json                      ← add @apollo/client, firebase; remove @supabase/supabase-js
├── .env                              ← add NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, Firebase config
└── firebase.json                     ← add functions to hosting config
```

---

## Environment variables

```bash
# .env (client)
VITE_GRAPHQL_URL=https://us-central1-YOUR_PROJECT.cloudfunctions.net/api/graphql
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=

# functions/.env (server)
NEO4J_URI=neo4j+s://XXXX.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=
```

---

## Decision log

| Decision | Rationale |
|---|---|
| Firebase Cloud Functions as API layer | Already on Firebase Hosting; avoids new infra |
| `@neo4j/graphql` over hand-written resolvers | Auto-generates CRUD; significant less boilerplate |
| Firebase Auth over Auth0/Clerk | Same project as hosting/functions; Google + GitHub already supported |
| Drop `product_count`, `avg_position`, `ingredient_count` stored fields | Computed via traversal; eliminates sync bugs |
| Keep table UI unchanged | Graph → flat row conversion is free in Cypher; no UI cost |

---

## When to reconsider

The migration pays off when any of these features are added:
- Ingredient similarity ("users who liked this also used...")
- Skin concern → ingredient recommendation paths
- Cross-product ingredient overlap analysis
- Variable-length traversal (ingredient → paper → cited-by)

If the product stays a flat table with one-hop product lookups, Supabase with indexed FKs matches or exceeds Neo4j read performance for those patterns.
