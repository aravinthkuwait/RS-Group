-- v4: strip count on medicines (tablets/capsules per strip)
SET search_path TO rsgroup;
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS strip_count INTEGER DEFAULT 1;
