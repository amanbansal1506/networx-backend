-- NetworX database schema + legacy-compatible migration. Run: npm run repair
-- PostgreSQL 13+ recommended. Safe to run again; never drops data.
-- gen_random_uuid() is built into PostgreSQL 13+; no extension is required.

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(40) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'person' CHECK (type IN ('person', 'company')),
  headline VARCHAR(200) NOT NULL DEFAULT '',
  profile_picture TEXT,
  cover_pic TEXT,
  about TEXT NOT NULL DEFAULT '',
  website TEXT,
  industry VARCHAR(120),
  companysize VARCHAR(60),
  hq VARCHAR(160),
  location VARCHAR(160),
  skills TEXT[] NOT NULL DEFAULT '{}',
  isverified BOOLEAN NOT NULL DEFAULT FALSE,
  isbrand BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Non-destructive compatibility upgrade for an existing users table.
-- The original NetworX backend already had users for login, but it did not
-- necessarily include every column required by profiles, feed and network.
-- CREATE TABLE IF NOT EXISTS alone does not add missing columns.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'person',
  ADD COLUMN IF NOT EXISTS headline VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS profile_picture TEXT,
  ADD COLUMN IF NOT EXISTS cover_pic TEXT,
  ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS industry VARCHAR(120),
  ADD COLUMN IF NOT EXISTS companysize VARCHAR(60),
  ADD COLUMN IF NOT EXISTS hq VARCHAR(160),
  ADD COLUMN IF NOT EXISTS location VARCHAR(160),
  ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS isverified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS isbrand BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_ci ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_ci ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS users_full_name_lookup ON users (LOWER(full_name));

CREATE TABLE IF NOT EXISTS networx_connections (
  connection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (requester_id <> recipient_id)
);
-- A connection can exist only once, independent of who originally requested it.
CREATE UNIQUE INDEX IF NOT EXISTS networx_connections_pair_unique
  ON networx_connections (LEAST(requester_id, recipient_id), GREATEST(requester_id, recipient_id));
CREATE INDEX IF NOT EXISTS networx_connections_requester_status ON networx_connections (requester_id, status);
CREATE INDEX IF NOT EXISTS networx_connections_recipient_status ON networx_connections (recipient_id, status);

-- Import previous NetworX connections without changing or deleting the old tables.
-- Earlier NetworX stored accepted links in connections(user_id, connection_id)
-- and pending invites in connection_requests(sender_id, receiver_id).
-- Some previous rebuilds have connections(requester_id, recipient_id).
DO $legacy_connections$
BEGIN
  IF to_regclass('connections') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='connections' AND column_name='user_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='connections' AND column_name='connection_id')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='connections' AND column_name='requester_id') THEN
    EXECUTE $copy$
      INSERT INTO networx_connections (requester_id, recipient_id, status, created_at, updated_at)
      SELECT LEAST(c.user_id, c.connection_id), GREATEST(c.user_id, c.connection_id), 'accepted',
             MIN(COALESCE(c.connected_at, NOW())), NOW()
      FROM connections c WHERE c.user_id <> c.connection_id
      GROUP BY LEAST(c.user_id, c.connection_id), GREATEST(c.user_id, c.connection_id)
      ON CONFLICT DO NOTHING
    $copy$;
  ELSIF to_regclass('connections') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='connections' AND column_name='requester_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='connections' AND column_name='recipient_id') THEN
    EXECUTE $copy$
      INSERT INTO networx_connections (connection_id, requester_id, recipient_id, status, created_at, updated_at)
      SELECT connection_id, requester_id, recipient_id, status, created_at, updated_at
      FROM connections WHERE requester_id <> recipient_id
      ON CONFLICT DO NOTHING
    $copy$;
  END IF;

  IF to_regclass('connection_requests') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='connection_requests' AND column_name='sender_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='connection_requests' AND column_name='receiver_id') THEN
    EXECUTE $copy$
      INSERT INTO networx_connections (requester_id, recipient_id, status, created_at, updated_at)
      SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
        sender_id, receiver_id,
        CASE WHEN status IN ('accepted','rejected') THEN status ELSE 'pending' END,
        COALESCE(created_at, NOW()), NOW()
      FROM connection_requests WHERE sender_id <> receiver_id
      ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC NULLS LAST
      ON CONFLICT DO NOTHING
    $copy$;
  END IF;
END
$legacy_connections$;


CREATE TABLE IF NOT EXISTS posts (
  post_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  visibility VARCHAR(12) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'connections')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(content)) > 0 OR media_url IS NOT NULL)
);

-- Legacy posts had id + owner and a JSON media_url. The API now uses
-- post_id + user_id and accepts ordinary URL strings. Retain the original
-- columns, primary key, FK references, and every existing post.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS post_id UUID,
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(12) NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $legacy_posts$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema=current_schema() AND table_name='posts' AND column_name='id')
    AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema=current_schema() AND table_name='posts' AND column_name='owner') THEN
    EXECUTE 'UPDATE posts SET post_id=id WHERE post_id IS NULL';
    EXECUTE 'UPDATE posts SET user_id=owner WHERE user_id IS NULL';
    -- Keep legacy owner/id synchronized for new posts. This runs before the
    -- legacy owner NOT NULL constraint and lets comments keep referencing id.
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION networx_sync_legacy_post() RETURNS trigger AS $body$
      BEGIN
        IF NEW.id IS NULL THEN NEW.id := gen_random_uuid(); END IF;
        IF NEW.post_id IS NULL THEN NEW.post_id := NEW.id; END IF;
        IF NEW.user_id IS NULL THEN NEW.user_id := NEW.owner; END IF;
        IF NEW.owner IS NULL THEN NEW.owner := NEW.user_id; END IF;
        RETURN NEW;
      END;
      $body$ LANGUAGE plpgsql
    $fn$;
    EXECUTE 'DROP TRIGGER IF EXISTS networx_sync_legacy_post_trigger ON posts';
    EXECUTE 'CREATE TRIGGER networx_sync_legacy_post_trigger BEFORE INSERT OR UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION networx_sync_legacy_post()';
  END IF;
END
$legacy_posts$;

-- Permit post_likes / comments to reference the new post_id. On legacy
-- databases, posts.id stays the primary key and post_id is its mirror.
CREATE UNIQUE INDEX IF NOT EXISTS posts_post_id_unique ON posts (post_id);

-- Original media_url was JSON, new frontend submits a plain URL. For JSON
-- string values, unwrap their quotes; for objects/arrays, preserve JSON text.
DO $legacy_post_media$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema=current_schema() AND table_name='posts'
               AND column_name='media_url' AND udt_name IN ('json','jsonb')) THEN
    EXECUTE $change$
      ALTER TABLE posts ALTER COLUMN media_url TYPE TEXT USING
        CASE WHEN jsonb_typeof(media_url::jsonb)='string' THEN media_url #>> '{}'
             ELSE media_url::text END
    $change$;
  END IF;
END
$legacy_post_media$;

CREATE INDEX IF NOT EXISTS posts_created_at ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_user_created ON posts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id UUID NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS post_likes_by_user ON post_likes (user_id);

-- Import legacy liked_by UUID arrays into normalized likes without deleting
-- or rewriting the original liked_by column or posts.likes counter.
DO $legacy_likes$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
             AND table_name='posts' AND column_name='liked_by' AND udt_name='_uuid') THEN
    EXECUTE $copy$
      INSERT INTO post_likes (post_id, user_id)
      SELECT p.post_id, u.user_id
      FROM posts p
      CROSS JOIN LATERAL unnest(p.liked_by) AS actor(user_id)
      JOIN users u ON u.user_id=actor.user_id
      WHERE p.post_id IS NOT NULL
      ON CONFLICT DO NOTHING
    $copy$;
  END IF;
END
$legacy_likes$;


CREATE TABLE IF NOT EXISTS comments (
  comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comments_post_created ON comments (post_id, created_at ASC);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('connection_request', 'connection_accepted', 'post_like', 'post_comment')),
  entity_id UUID,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread ON notifications (user_id, is_read) WHERE is_read = FALSE;

CREATE TABLE IF NOT EXISTS experiences (
  experience_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  company VARCHAR(160) NOT NULL,
  location VARCHAR(160),
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (NOT is_current OR end_date IS NULL)
);
CREATE INDEX IF NOT EXISTS experiences_user ON experiences (user_id);

CREATE TABLE IF NOT EXISTS educations (
  education_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  school VARCHAR(200) NOT NULL,
  degree VARCHAR(160),
  field_of_study VARCHAR(160),
  start_date DATE,
  end_date DATE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS educations_user ON educations (user_id);


-- Copy legacy education records into the simplified profile history API.
-- Legacy education remains unchanged; repeated repairs skip already-copied IDs.
DO $legacy_education$
BEGIN
  IF to_regclass('education') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='education' AND column_name='school_name') THEN
    EXECUTE $copy$
      INSERT INTO educations (education_id, user_id, school, degree, field_of_study,
                              start_date, end_date, description, created_at)
      SELECT education_id, user_id, school_name, degree, field_of_study,
             start_date, end_date, COALESCE(description, ''), COALESCE(created_at, NOW())
      FROM education ON CONFLICT (education_id) DO NOTHING
    $copy$;
  END IF;
END
$legacy_education$;
