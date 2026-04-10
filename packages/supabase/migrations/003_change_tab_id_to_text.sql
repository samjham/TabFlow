-- Change tabs.id from uuid to text.
-- The Chrome extension uses "chrome-{tabId}" identifiers which are not
-- valid UUIDs. Switching the column to text keeps the schema compatible
-- with whatever ID format the client generates.
--
-- Steps:
--   1. Drop the primary key constraint (it references the uuid type).
--   2. Alter the column type to text.
--   3. Re-add the primary key on the text column.
--   4. Drop the default (gen_random_uuid) since IDs are now client-provided.

ALTER TABLE public.tabs DROP CONSTRAINT tabs_pkey;
ALTER TABLE public.tabs ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.tabs ALTER COLUMN id TYPE text USING id::text;
ALTER TABLE public.tabs ADD PRIMARY KEY (id);
