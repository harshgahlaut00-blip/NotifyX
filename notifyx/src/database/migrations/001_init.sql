-- NotifyX initial schema.
-- All Discord IDs (snowflakes) are stored as TEXT: they exceed JavaScript's safe integer range.

CREATE TABLE guilds (
  guild_id              text PRIMARY KEY,
  name                  text,
  notifications_enabled boolean     NOT NULL DEFAULT true,
  default_channel_id    text,
  default_category_id   text,
  default_role_id       text,
  emoji_overrides       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  installed_at          timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  left_at               timestamptz
);

-- One row per external account (a YouTube channel today; Twitch/TikTok/... later),
-- shared by every guild that follows it, so it is polled exactly once.
CREATE TABLE platform_accounts (
  id                   bigserial PRIMARY KEY,
  platform             text        NOT NULL,
  external_id          text        NOT NULL,
  name                 text        NOT NULL,
  handle               text,
  url                  text,
  avatar_url           text,
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  baselined_at         timestamptz,
  last_checked_at      timestamptz,
  last_success_at      timestamptz,
  next_check_at        timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer     NOT NULL DEFAULT 0,
  last_error           text,
  push_expires_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);
CREATE INDEX idx_accounts_due ON platform_accounts (platform, next_check_at);

-- A guild following an account.
CREATE TABLE subscriptions (
  id         bigserial PRIMARY KEY,
  guild_id   text        NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  account_id bigint      NOT NULL REFERENCES platform_accounts (id) ON DELETE CASCADE,
  enabled    boolean     NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, account_id)
);
CREATE INDEX idx_subscriptions_account ON subscriptions (account_id);

-- One rule per (subscription, event type). NULL text fields mean "use the built-in default";
-- '' means "explicitly empty".
CREATE TABLE notification_rules (
  id                   bigserial PRIMARY KEY,
  subscription_id      bigint  NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  event_type           text    NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  category_id          text,
  channel_id           text,
  role_id              text,
  message              text,
  embed_title          text,
  embed_description    text,
  embed_color          text,
  image_mode           text    NOT NULL DEFAULT 'large' CHECK (image_mode IN ('large', 'small', 'none')),
  custom_image_url     text,
  footer_text          text,
  show_timestamp       boolean NOT NULL DEFAULT true,
  button_label         text,
  channel_button_label text,
  custom_button_label  text,
  custom_button_url    text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, event_type)
);

-- Reusable message/embed designs, per guild.
CREATE TABLE templates (
  id         bigserial PRIMARY KEY,
  guild_id   text        NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  name       text        NOT NULL,
  event_type text,
  config     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_templates_guild_name ON templates (guild_id, lower(name));

-- Every piece of content ever seen for an account. Drives state-transition detection
-- (upcoming → live) and is the reference for notification_history.
CREATE TABLE content_items (
  id                 bigserial PRIMARY KEY,
  account_id         bigint      NOT NULL REFERENCES platform_accounts (id) ON DELETE CASCADE,
  external_id        text        NOT NULL,
  kind               text        NOT NULL,
  state              text        NOT NULL,
  title              text,
  description        text,
  url                text,
  thumbnail_url      text,
  duration_seconds   integer,
  published_at       timestamptz,
  scheduled_start_at timestamptz,
  actual_start_at    timestamptz,
  actual_end_at      timestamptz,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_checked_at    timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id)
);
CREATE INDEX idx_content_tracked ON content_items (state) WHERE state IN ('upcoming', 'live');

-- Delivery queue + audit log + duplicate protection in one table.
-- UNIQUE (subscription_id, content_id, event_type) guarantees a notification for a given
-- event is enqueued at most once, no matter how many times it is detected.
CREATE TABLE notification_history (
  id              bigserial PRIMARY KEY,
  guild_id        text        NOT NULL,
  subscription_id bigint      NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  content_id      bigint      NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  event_type      text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz DEFAULT now(),
  locked_at       timestamptz,
  channel_id      text,
  message_id      text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (subscription_id, content_id, event_type)
);
CREATE INDEX idx_history_queue ON notification_history (status, next_attempt_at);
CREATE INDEX idx_history_guild ON notification_history (guild_id, id DESC);

CREATE TABLE bot_state (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
