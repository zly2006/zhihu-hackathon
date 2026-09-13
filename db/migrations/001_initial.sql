CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zhihu_accounts (
  id text PRIMARY KEY,
  provider_user_id text NOT NULL UNIQUE,
  display_name text,
  avatar_url text,
  headline text,
  profile_url text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id uuid PRIMARY KEY,
  account_id text REFERENCES zhihu_accounts(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('live','demo')),
  background_id text,
  player_name text,
  player_gender text,
  state jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE TABLE IF NOT EXISTS interaction_events (
  id bigserial PRIMARY KEY,
  account_id text REFERENCES zhihu_accounts(id) ON DELETE SET NULL,
  game_session_id uuid REFERENCES game_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS interaction_events_expiry_idx ON interaction_events (expires_at);
CREATE INDEX IF NOT EXISTS interaction_events_session_idx ON interaction_events (game_session_id, occurred_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  account_id text REFERENCES zhihu_accounts(id) ON DELETE SET NULL,
  game_session_id uuid REFERENCES game_sessions(id) ON DELETE CASCADE,
  character_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  message_text text NOT NULL,
  sequence_no integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE TABLE IF NOT EXISTS story_nodes (
  id bigserial PRIMARY KEY,
  game_session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  node_index integer NOT NULL,
  node jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_session_id, node_index)
);

CREATE TABLE IF NOT EXISTS story_choices (
  id bigserial PRIMARY KEY,
  game_session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  node_index integer NOT NULL,
  choice_index integer NOT NULL,
  choice_text text NOT NULL,
  expected_node integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS save_slots (
  id bigserial PRIMARY KEY,
  account_id text REFERENCES zhihu_accounts(id) ON DELETE CASCADE,
  game_session_id uuid REFERENCES game_sessions(id) ON DELETE CASCADE,
  slot_index integer NOT NULL CHECK (slot_index BETWEEN 0 AND 5),
  snapshot jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  UNIQUE (account_id, slot_index)
);

CREATE OR REPLACE FUNCTION cleanup_lamplight_demo_data() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM interaction_events WHERE expires_at < now();
  DELETE FROM chat_messages WHERE expires_at < now();
  DELETE FROM save_slots WHERE expires_at < now();
  DELETE FROM game_sessions WHERE expires_at < now();
  DELETE FROM zhihu_accounts WHERE expires_at < now();
END;
$$;

GRANT USAGE ON SCHEMA public TO svc_lamplight_app, svc_lamplight_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO svc_lamplight_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO svc_lamplight_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO svc_lamplight_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE svc_lamplight_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_lamplight_app;
ALTER DEFAULT PRIVILEGES FOR ROLE svc_lamplight_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO svc_lamplight_app;
ALTER DEFAULT PRIVILEGES FOR ROLE svc_lamplight_owner IN SCHEMA public GRANT SELECT ON TABLES TO svc_lamplight_ro;
