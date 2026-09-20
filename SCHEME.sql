BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "ARTICLE" (
	"content_id"	TEXT NOT NULL,
	"source_id"	INTEGER NOT NULL,
	"title"	TEXT NOT NULL,
	"url"	TEXT NOT NULL,
	"published_at"	TEXT,
	"cover_art"	TEXT,
	"summary"	TEXT,
	"hashtags"	TEXT,
	"transcript_vtt"	TEXT DEFAULT NULL,
	"llm_summary"	TEXT DEFAULT NULL,
	"llm_tags"	TEXT DEFAULT NULL,
	"llm_hashtags"	TEXT DEFAULT NULL,
	PRIMARY KEY("content_id"),
	FOREIGN KEY("source_id") REFERENCES "SOURCE"("id")
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS "SOURCE" (
	"id"	INTEGER,
	"source_cn"	TEXT NOT NULL,
	"source_name"	TEXT NOT NULL,
	"source_type"	TEXT NOT NULL,
	"url"	TEXT,
	"cover_art"	TEXT,
	PRIMARY KEY("id"),
	UNIQUE("source_type","source_cn")
) WITHOUT ROWID;
CREATE VIEW article_list AS
SELECT
    a.content_id,
    a.title,
    a.url,
    a.published_at,
    COALESCE(
        NULLIF(TRIM(a.cover_art), ''),
        NULLIF(TRIM(s.cover_art), '')
    ) AS cover_art,
    a.summary,
    a.hashtags,
    s.source_type,
    s.source_cn,
    s.source_name
FROM ARTICLE AS a
INNER JOIN SOURCE AS s
    ON s.id = a.source_id
WHERE COALESCE(
    NULLIF(TRIM(a.cover_art), ''),
    NULLIF(TRIM(s.cover_art), '')
) IS NOT NULL;
CREATE VIEW link_item_list AS
SELECT
    a.content_id,
    a.title,
    a.url,
    a.published_at,
    COALESCE(
        NULLIF(TRIM(a.cover_art), ''),
        NULLIF(TRIM(s.cover_art), '')
    ) AS cover_art,
    a.summary,
    a.hashtags,
    s.id AS source_id,
    s.source_type,
    s.source_cn,
    s.source_name,
    s.url AS source_url
FROM ARTICLE AS a
INNER JOIN SOURCE AS s
    ON s.id = a.source_id
WHERE COALESCE(
    NULLIF(TRIM(a.cover_art), ''),
    NULLIF(TRIM(s.cover_art), '')
) IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_article_published_at" ON "ARTICLE" (
	"published_at"	DESC
);
CREATE INDEX IF NOT EXISTS "idx_article_source_published_at" ON "ARTICLE" (
	"source_id",
	"published_at"	DESC
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_source_type_source_id" ON "SOURCE" (
	"source_type",
	"source_cn"
);
COMMIT;
