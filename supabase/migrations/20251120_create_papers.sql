-- Research papers and their links to ingredients

CREATE TABLE IF NOT EXISTS papers (
  id UUID PRIMARY KEY,
  doi TEXT,
  arxiv_id TEXT,
  url TEXT,
  title TEXT,
  authors JSONB,
  published_at DATE,
  journal TEXT,
  volume TEXT,
  issue TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  ingredient_name TEXT
);

CREATE TABLE IF NOT EXISTS sss_ingredients_papers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ingredient_id TEXT NOT NULL REFERENCES sss_ingredients(ingredient_id),
  paper_id UUID NOT NULL,
  relation_type TEXT DEFAULT 'reference',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sss_ingredients_papers_ingredient_id
  ON sss_ingredients_papers(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_sss_ingredients_papers_paper_id
  ON sss_ingredients_papers(paper_id);
