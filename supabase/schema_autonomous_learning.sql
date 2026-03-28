create table if not exists public.user_progress (
  user_id bigint not null,
  course_topic text not null,
  topic text not null,
  score numeric not null,
  mastery text not null check (mastery in ('weak', 'moderate', 'strong')),
  last_updated timestamptz not null default timezone('utc', now()),
  primary key (user_id, course_topic, topic)
);

create table if not exists public.learner_state (
  user_id bigint primary key,
  last_active_time timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.revision_lessons (
  user_id bigint not null,
  course_topic text not null,
  topic text not null,
  level text not null,
  revision_text text not null,
  trigger_reason text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, course_topic, topic, level)
);

create table if not exists public.classroom_connections (
  user_id bigint primary key,
  provider text not null default 'google_classroom',
  is_connected boolean not null default true,
  is_mock boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.classroom_courses (
  user_id bigint not null,
  classroom_course_id text not null,
  name text not null,
  section text not null default '',
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, classroom_course_id)
);

create table if not exists public.classroom_assignments (
  user_id bigint not null,
  assignment_id text not null,
  classroom_course_id text not null,
  course_name text not null,
  title text not null,
  topic_hint text not null default '',
  due_at timestamptz null,
  raw_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, assignment_id)
);

create index if not exists idx_user_progress_user_course on public.user_progress (user_id, course_topic);
create index if not exists idx_user_progress_mastery on public.user_progress (user_id, mastery, score);
create index if not exists idx_classroom_assignments_due_at on public.classroom_assignments (user_id, due_at);
