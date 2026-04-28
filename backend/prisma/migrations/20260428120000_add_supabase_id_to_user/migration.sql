-- Add new required column safely for existing rows
ALTER TABLE "User" ADD COLUMN "supabaseId" TEXT;

-- Backfill existing rows before enforcing NOT NULL
UPDATE "User"
SET "supabaseId" = "id"
WHERE "supabaseId" IS NULL;

-- Enforce the required constraint after data is populated
ALTER TABLE "User" ALTER COLUMN "supabaseId" SET NOT NULL;
