-- Down migration: Cover HTML (4ª vista de portada).
ALTER TABLE "EvaluationBundle"
  DROP COLUMN IF EXISTS "coverLiveProject",
  DROP COLUMN IF EXISTS "coverLiveUpdatedAt";