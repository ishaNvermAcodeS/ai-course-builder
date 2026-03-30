from datetime import datetime, timedelta, timezone
from fastapi import Cookie, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv
from groq import Groq
from services.youtube_service import search_youtube_videos
import hashlib
import html
import json
import os
import re
import requests
import secrets
import sqlite3
try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - postgres dependency is optional locally
    psycopg = None
    dict_row = None

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "kirigumi.db")
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
SESSION_COOKIE = "kirigumi_session"
SESSION_DAYS = 30
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = (os.getenv("COOKIE_SAMESITE", "lax").strip().lower() or "lax")

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").strip() or "http://localhost:3000"
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:8000/auth/callback").strip()
GOOGLE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
]
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CLASSROOM_API = "https://classroom.googleapis.com/v1"
CLASSROOM_URGENT_DAYS = 2
oauth_state_store = {}
VIDEO_HOST_BLOCKLIST = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "vimeo.com",
    "www.vimeo.com",
    "dailymotion.com",
    "www.dailymotion.com",
}
difficulty_guide = {
    "Beginner":     "Explain concepts simply. Avoid heavy math. Use 4 to 6 chapters with 3 to 5 topics each.",
    "Intermediate": "Assume some background knowledge and include practical techniques. Use 6 to 9 chapters with 4 to 6 topics each.",
    "Advanced":     "Include deeper theory, optimization techniques and advanced ideas. Use 9 to 14 chapters with 5 to 7 topics each.",
}
goal_guide = {
    "Exam Preparation": "Optimize for exam outcomes: high-yield concepts, likely questions, past-pattern style coverage, and fast retention.",
    "Deep Learning": "Optimize for deep understanding of the chosen topic: richer explanations, intuition, rigor, worked examples, and long-term retention. Treat this as learning in depth, not the machine learning field unless the topic itself is Deep Learning.",
    "Quick Revision": "Optimize for compact refreshers, summaries, memory cues, and the fastest path to competence.",
}
INACTIVITY_HOURS = 24
CLASSROOM_DEADLINE_WINDOW_DAYS = 7

QUANTITATIVE_KEYWORDS = {
    "algebra", "calculus", "geometry", "trigonometry", "statistics", "probability",
    "arithmetic", "number theory", "linear algebra", "differential equations",
    "integral", "derivative", "matrix", "matrices", "vector", "eigenvalue",
    "fourier", "laplace", "complex numbers", "polynomial", "equation", "inequality",
    "physics", "mechanics", "thermodynamics", "electromagnetism", "circuit",
    "signal processing", "control systems", "statics", "dynamics", "kinematics",
    "fluid", "optics", "quantum", "relativity", "electrostatics",
    "accounting", "financial mathematics", "quantitative finance", "actuarial",
    "econometrics", "time value", "interest rate", "compound interest",
    "present value", "future value",
    "data structures", "algorithms", "complexity", "sorting", "graph theory",
    "cryptography", "numerical methods", "computational",
    "stoichiometry", "chemical equations", "molar", "titration", "thermochemistry",
    "numerical", "calculation", "computation", "formula", "solve", "problem solving",
    "quantitative", "mathematical", "maths", "math", "mathematics",
}


# ── Database ──────────────────────────────────────────────────────────────────

def uses_postgres() -> bool:
    return bool(DATABASE_URL)


def normalize_sql(query: str) -> str:
    return query.replace("?", "%s") if uses_postgres() else query


def get_db():
    if uses_postgres():
        if psycopg is None:
            raise RuntimeError("DATABASE_URL is set, but psycopg is not installed.")
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def db_execute(conn, query: str, params=()):
    if uses_postgres():
        cur = conn.cursor()
        cur.execute(normalize_sql(query), params)
        return cur
    return conn.execute(query, params)


def db_fetchone(conn, query: str, params=()):
    return db_execute(conn, query, params).fetchone()


def db_fetchall(conn, query: str, params=()):
    return db_execute(conn, query, params).fetchall()


def init_db():
    conn = get_db()
    if uses_postgres():
        statements = [
            """
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS saved_courses (
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                topic TEXT NOT NULL,
                level TEXT NOT NULL,
                course_title TEXT NOT NULL,
                all_topics_json TEXT NOT NULL,
                added_at BIGINT NOT NULL,
                PRIMARY KEY (user_id, topic, level)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS course_progress (
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                topic TEXT NOT NULL,
                level TEXT NOT NULL,
                completed_lessons_json TEXT NOT NULL,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY (user_id, topic, level)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS course_test_results (
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                topic TEXT NOT NULL,
                level TEXT NOT NULL,
                result_json TEXT NOT NULL,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY (user_id, topic, level)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS user_progress (
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                course_topic TEXT NOT NULL,
                topic TEXT NOT NULL,
                score REAL NOT NULL,
                mastery TEXT NOT NULL,
                last_updated TEXT NOT NULL,
                PRIMARY KEY (user_id, course_topic, topic)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS learner_state (
                user_id BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
                last_active_time TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS revision_lessons (
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                course_topic TEXT NOT NULL,
                topic TEXT NOT NULL,
                level TEXT NOT NULL,
                revision_text TEXT NOT NULL,
                trigger_reason TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, course_topic, topic, level)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS classroom_connections (
                user_id BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
                provider TEXT NOT NULL,
                is_connected BOOLEAN NOT NULL DEFAULT TRUE,
                is_mock BOOLEAN NOT NULL DEFAULT FALSE,
                access_token TEXT NOT NULL DEFAULT '',
                refresh_token TEXT NOT NULL DEFAULT '',
                token_expires_at TEXT,
                scope TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS classroom_courses (
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                classroom_course_id TEXT NOT NULL,
                name TEXT NOT NULL,
                section TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, classroom_course_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS classroom_assignments (
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                assignment_id TEXT NOT NULL,
                classroom_course_id TEXT NOT NULL,
                course_name TEXT NOT NULL,
                title TEXT NOT NULL,
                topic_hint TEXT NOT NULL DEFAULT '',
                due_at TEXT,
                raw_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, assignment_id)
            )
            """,
        ]
        for statement in statements:
            db_execute(conn, statement)
    else:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS saved_courses (
                user_id INTEGER NOT NULL,
                topic TEXT NOT NULL,
                level TEXT NOT NULL,
                course_title TEXT NOT NULL,
                all_topics_json TEXT NOT NULL,
                added_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, topic, level),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS course_progress (
                user_id INTEGER NOT NULL,
                topic TEXT NOT NULL,
                level TEXT NOT NULL,
                completed_lessons_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, topic, level),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS course_test_results (
                user_id INTEGER NOT NULL,
                topic TEXT NOT NULL,
                level TEXT NOT NULL,
                result_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, topic, level),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_progress (
                user_id INTEGER NOT NULL,
                course_topic TEXT NOT NULL,
                topic TEXT NOT NULL,
                score REAL NOT NULL,
                mastery TEXT NOT NULL,
                last_updated TEXT NOT NULL,
                PRIMARY KEY (user_id, course_topic, topic),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS learner_state (
                user_id INTEGER PRIMARY KEY,
                last_active_time TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS revision_lessons (
                user_id INTEGER NOT NULL,
                course_topic TEXT NOT NULL,
                topic TEXT NOT NULL,
                level TEXT NOT NULL,
                revision_text TEXT NOT NULL,
                trigger_reason TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, course_topic, topic, level),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS classroom_connections (
                user_id INTEGER PRIMARY KEY,
                provider TEXT NOT NULL,
                is_connected INTEGER NOT NULL DEFAULT 1,
                is_mock INTEGER NOT NULL DEFAULT 0,
                access_token TEXT NOT NULL DEFAULT '',
                refresh_token TEXT NOT NULL DEFAULT '',
                token_expires_at TEXT,
                scope TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS classroom_courses (
                user_id INTEGER NOT NULL,
                classroom_course_id TEXT NOT NULL,
                name TEXT NOT NULL,
                section TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, classroom_course_id),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS classroom_assignments (
                user_id INTEGER NOT NULL,
                assignment_id TEXT NOT NULL,
                classroom_course_id TEXT NOT NULL,
                course_name TEXT NOT NULL,
                title TEXT NOT NULL,
                topic_hint TEXT NOT NULL DEFAULT '',
                due_at TEXT,
                raw_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, assignment_id),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );
            """
        )
    conn.commit()
    ensure_classroom_connection_columns(conn)
    conn.close()


def ensure_classroom_connection_columns(conn):
    existing = set()
    if uses_postgres():
        info = db_fetchall(
            conn,
            """SELECT column_name
               FROM information_schema.columns
               WHERE table_name = 'classroom_connections'""",
        )
        existing = {row["column_name"] for row in info}
    else:
        info = db_fetchall(conn, "PRAGMA table_info(classroom_connections)")
        existing = {row["name"] for row in info}
    additions = [
        ("access_token", "TEXT NOT NULL DEFAULT ''"),
        ("refresh_token", "TEXT NOT NULL DEFAULT ''"),
        ("token_expires_at", "TEXT"),
        ("scope", "TEXT NOT NULL DEFAULT ''"),
    ]
    for column_name, definition in additions:
        if column_name in existing:
            continue
        db_execute(conn, f"ALTER TABLE classroom_connections ADD COLUMN {column_name} {definition}")


init_db()


# ── Utility helpers ───────────────────────────────────────────────────────────

def utc_now():
    return datetime.now(timezone.utc)


def safe_topic(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", safe_topic(text).lower()).strip()


def mastery_bucket(score: float) -> str:
    if score < 60:
        return "weak"
    if score <= 80:
        return "moderate"
    return "strong"


def parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def require_google_oauth_config():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google Classroom OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")


def clean_oauth_states():
    now = utc_now()
    expired = [key for key, value in oauth_state_store.items() if value["expires_at"] <= now]
    for key in expired:
        oauth_state_store.pop(key, None)


def create_google_oauth_state(user_id: int) -> str:
    clean_oauth_states()
    state = secrets.token_urlsafe(24)
    oauth_state_store[state] = {"user_id": int(user_id), "expires_at": utc_now() + timedelta(minutes=15)}
    return state


def consume_google_oauth_state(state: str) -> int:
    clean_oauth_states()
    item = oauth_state_store.pop(state, None)
    if not item:
        raise HTTPException(status_code=400, detail="Google sign-in state is invalid or expired.")
    return int(item["user_id"])


def build_google_due_at(due_date: Optional[dict], due_time: Optional[dict]) -> Optional[str]:
    if not due_date:
        return None
    year = due_date.get("year")
    month = due_date.get("month")
    day = due_date.get("day")
    if not year or not month or not day:
        return None
    hour = (due_time or {}).get("hours", 23)
    minute = (due_time or {}).get("minutes", 59)
    dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    return dt.isoformat()


def strip_fences(text: str) -> str:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def parse_json_object(text: str):
    cleaned = strip_fences(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise HTTPException(status_code=502, detail="Model returned invalid JSON.")
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Model returned malformed JSON.") from exc


def call_llm(prompt: str, max_tokens: Optional[int] = None, messages: Optional[list] = None):
    if client is None:
        raise HTTPException(status_code=500, detail="Groq API key is missing. Set GROQ_API_KEY in backend/.env.")
    payload = messages if messages is not None else [{"role": "user", "content": prompt}]
    kwargs = {"model": "llama-3.3-70b-versatile", "messages": payload}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    try:
        completion = client.chat.completions.create(**kwargs)
        return completion.choices[0].message.content.strip()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}") from exc


def classify_course_type(topic: str, all_topics: list) -> str:
    combined = (topic + " " + " ".join(all_topics[:20])).lower()
    combined = re.sub(r"[^\w\s]", " ", combined)
    words = set(combined.split())
    for kw in QUANTITATIVE_KEYWORDS:
        if " " in kw:
            if kw in combined:
                return "quantitative"
        else:
            if kw in words:
                return "quantitative"
    return "theoretical"


def build_numerical_quiz_instruction(course_type: str, topic: str) -> str:
    if course_type == "quantitative":
        return f"""
IMPORTANT — This is a quantitative/numerical course ({topic}).
At least 60% of questions MUST be numerical problem-solving questions, NOT just theory.
Examples:
- Calculation: "Calculate the value of...", "Solve for x in...", "Find the derivative of..."
- Word problems: "A train travels at 60 km/h for 2 hours. What distance does it cover?"
- Multi-step: "Given f(x) = 3x² + 2x - 5, find f'(x) and evaluate at x = 2"
For MCQ options on numerical questions, use actual numbers/expressions as choices.
The remaining questions may test conceptual understanding.
"""
    return ""


def build_numerical_practice_instruction(course_type: str, topic: str) -> str:
    if course_type == "quantitative":
        return f"""
IMPORTANT — This is a quantitative/numerical course ({topic}).
At least 6 out of 10 questions MUST be numerical/computational problems.
For each numerical question, the model answer MUST show the full working/steps.
The remaining questions may be conceptual/analytical.
"""
    return ""


def build_lesson_prompt(topic: str, module: str, level: str, goal: str = "Deep Learning") -> str:
    course_type = classify_course_type(topic, [module])
    numerical_note = ""
    if course_type == "quantitative":
        numerical_note = """
Since this is a quantitative topic, make sure the lesson includes:
- At least 2-3 worked examples with actual numbers/values and step-by-step solutions
- Any relevant formulas clearly stated and explained
- A practice problem (with solution) at the end
"""
    goal_key = goal if goal in goal_guide else "Deep Learning"
    goal_instruction = goal_guide[goal_key]
    goal_clarifier = ""
    if goal_key == "Deep Learning":
        goal_clarifier = """
Interpret "Deep Learning" as "deep study mode" for the requested topic.
Do not switch the subject to machine learning unless the course topic itself is about ML or deep learning.
"""
    return f"""
Create a {level} level lesson.

Course Topic: {topic}
Lesson Topic: {module}

Difficulty guideline: {difficulty_guide[level]}
Goal guidance: {goal_instruction}
{goal_clarifier}
{numerical_note}
Format using: ## for headings, **bold** for key terms, __underline__ for definitions,
- bullets, numbered lists, `code` for technical terms/expressions.

Structure: Introduction, Core Explanation, Worked Examples, Key Points, Summary.
"""


def generate_lesson_text(topic: str, module: str, level: str, goal: str = "Deep Learning") -> str:
    primary_prompt = build_lesson_prompt(topic, module, level, goal)
    try:
        return call_llm(primary_prompt, max_tokens=1600)
    except HTTPException:
        fallback_prompt = f"""
Create a clean, useful lesson for this topic.

Course Topic: {topic}
Lesson Topic: {module}
Level: {level}
Goal: {goal}

Rules:
- Stay on the requested subject
- Use short sections with headings
- Explain core ideas clearly
- Include at least one example
- End with a brief summary
- No markdown fences
"""
        return call_llm(fallback_prompt, max_tokens=1200)


def parse_search_snippet(snippet: str) -> str:
    return re.sub(r"<[^>]+>", "", html.unescape(snippet or "")).strip()


def parse_json_array(raw: str) -> list:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 3:
            cleaned = "\n".join(lines[1:-1])
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", cleaned)
        if match:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, list):
                return parsed
    raise HTTPException(status_code=502, detail="Model returned invalid JSON array.")


def sanitize_course_outline(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Model returned an invalid course format.")

    course_title = safe_topic(payload.get("course_title") or "AI Generated Course")
    chapters = payload.get("chapters")
    if not isinstance(chapters, list) or not chapters:
        raise HTTPException(status_code=502, detail="Model returned a course without chapters.")

    clean_chapters = []
    for index, chapter in enumerate(chapters, start=1):
        if not isinstance(chapter, dict):
            continue
        title = safe_topic(chapter.get("title") or f"Chapter {index}")
        raw_topics = chapter.get("topics")
        if not isinstance(raw_topics, list):
            continue
        topics = []
        seen = set()
        for topic in raw_topics:
            cleaned = safe_topic(str(topic))
            key = normalize_key(cleaned)
            if not cleaned or not key or key in seen:
                continue
            seen.add(key)
            topics.append(cleaned[:80])
        if topics:
            clean_chapters.append({"chapter": index, "title": title, "topics": topics})

    if not clean_chapters:
        raise HTTPException(status_code=502, detail="Model returned empty course topics.")

    return {"course_title": course_title, "chapters": clean_chapters}


def generate_course_outline(topic: str, level: str, goal: str, classroom_context: str) -> dict:
    prompt = f"""
You are a curriculum designer. Create a complete, well-structured course for the topic below.

Topic: {topic}
Level: {level}
Goal: {goal}

Difficulty guideline:
{difficulty_guide[level]}

Goal guidance:
{goal_guide[goal]}{classroom_context}

Rules:
- Each chapter should have a clear, descriptive title.
- Each topic inside a chapter should be a short, specific lesson title (under 8 words).
- Topics within a chapter should flow logically.
- Do NOT repeat topics across chapters.
- Make the topic ordering match the goal. For exam preparation, front-load high-yield topics. For quick revision, front-load foundational refreshers.
- If the goal is "Deep Learning", interpret it as deep understanding of THIS topic, not the ML domain unless the requested topic is actually about deep learning or neural networks.

Return ONLY valid JSON in this exact shape:
{{
  "course_title": "<descriptive course title>",
  "chapters": [
    {{
      "chapter": 1,
      "title": "<chapter title>",
      "topics": ["Topic 1", "Topic 2", "Topic 3"]
    }}
  ]
}}
"""

    first_pass = call_llm(prompt, max_tokens=1400)
    try:
        return sanitize_course_outline(parse_json_object(first_pass))
    except HTTPException:
        repair_prompt = f"""
Convert the following course draft into valid JSON only.

Rules:
- Keep the same academic meaning
- Output ONLY valid JSON
- Use this exact shape:
{{
  "course_title": "<descriptive course title>",
  "chapters": [
    {{
      "chapter": 1,
      "title": "<chapter title>",
      "topics": ["Topic 1", "Topic 2", "Topic 3"]
    }}
  ]
}}

Draft:
{first_pass}
"""
        repaired = call_llm(repair_prompt, max_tokens=1400)
        return sanitize_course_outline(parse_json_object(repaired))


def is_probably_english(text: str) -> bool:
    sample = (text or "").strip()
    if not sample:
        return False
    letters = [ch for ch in sample if ch.isalpha()]
    if not letters:
        return True
    ascii_letters = [ch for ch in letters if ch.isascii()]
    return (len(ascii_letters) / max(len(letters), 1)) >= 0.85


def compact_resource_description(text: str, limit: int = 360) -> str:
    compact = re.sub(r"\s+", " ", (text or "")).strip()
    if len(compact) <= limit:
        return compact
    truncated = compact[:limit].rsplit(" ", 1)[0].strip()
    return f"{truncated}..."


def summarize_web_resources(resources: list, topic: str, level: str) -> list:
    if not resources:
        return resources

    prompt_items = []
    for idx, item in enumerate(resources, start=1):
        prompt_items.append(
            f"{idx}. TITLE: {item['title']}\n"
            f"SOURCE: {item['source']}\n"
            f"SNIPPET: {item['description']}\n"
        )

    prompt = f"""
You are preparing concise study-friendly article summaries for a learning sidebar.

Topic: {topic}
Level: {level}

For each resource below, write a short English-only summary suitable for a narrow sidebar.
- Keep each summary to 2-3 crisp sentences
- It should read like about 5-6 short lines in a sidebar
- Focus on what the learner will gain from the resource
- No markdown

Return ONLY valid JSON array in this exact shape:
[
  {{"index": 1, "summary": "..." }}
]

Resources:
{chr(10).join(prompt_items)}
"""

    try:
        summary_items = parse_json_array(call_llm(prompt, max_tokens=900))
        summary_map = {
            item.get("index"): compact_resource_description(item.get("summary", ""), 360)
            for item in summary_items
            if isinstance(item, dict)
        }
        for idx, item in enumerate(resources, start=1):
            summary = summary_map.get(idx)
            if summary:
                item["description"] = summary
    except Exception:
        for item in resources:
            item["description"] = compact_resource_description(item.get("description", ""), 360)

    return resources


def touch_learner_activity(user_id: int):
    now = utc_now().isoformat()
    conn = get_db()
    db_execute(
        conn,
        """INSERT INTO learner_state (user_id, last_active_time, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET last_active_time=excluded.last_active_time, updated_at=excluded.updated_at""",
        (user_id, now, now),
    )
    conn.commit()
    conn.close()


def get_learner_state(user_id: int):
    conn = get_db()
    row = db_fetchone(
        conn,
        "SELECT last_active_time, updated_at FROM learner_state WHERE user_id = ?",
        (user_id,),
    )
    conn.close()
    return row


def get_user_progress_rows(user_id: int, course_topic: str):
    conn = get_db()
    rows = db_fetchall(
        conn,
        """SELECT topic, score, mastery, last_updated
           FROM user_progress
           WHERE user_id = ? AND course_topic = ?""",
        (user_id, safe_topic(course_topic)),
    )
    conn.close()
    return rows


def save_user_progress_row(user_id: int, course_topic: str, topic: str, score: float):
    score = max(0.0, min(float(score), 100.0))
    mastery = mastery_bucket(score)
    now = utc_now().isoformat()
    conn = get_db()
    db_execute(
        conn,
        """INSERT INTO user_progress (user_id, course_topic, topic, score, mastery, last_updated)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, course_topic, topic) DO UPDATE SET
               score=excluded.score,
               mastery=excluded.mastery,
               last_updated=excluded.last_updated""",
        (user_id, safe_topic(course_topic), safe_topic(topic), score, mastery, now),
    )
    conn.commit()
    conn.close()
    return {"topic": safe_topic(topic), "score": round(score, 1), "mastery": mastery, "last_updated": now}


def get_revision_entry(user_id: int, course_topic: str, topic: str, level: str):
    conn = get_db()
    row = db_fetchone(
        conn,
        """SELECT revision_text, trigger_reason, updated_at
           FROM revision_lessons
           WHERE user_id = ? AND course_topic = ? AND topic = ? AND level = ?""",
        (user_id, safe_topic(course_topic), safe_topic(topic), safe_topic(level)),
    )
    conn.close()
    return row


def generate_revision_text(course_topic: str, topic: str, level: str, goal: str = "Quick Revision") -> str:
    prompt = f"""
Create a compressed revision lesson for a student who needs fast improvement.

Course: {course_topic}
Focus topic: {topic}
Level: {level}
Goal: {goal}

Rules:
- Prioritize exam-relevant concepts and common mistakes
- Keep it concise, high-impact, and actionable
- Include:
  1. Top 3 must-know ideas
  2. 2 common traps/mistakes
  3. 1 fast recall checklist
  4. 2 quick self-test prompts
- No markdown fences
- Keep it under 350 words
"""
    return call_llm(prompt, max_tokens=700)


def ensure_revision_lesson(user_id: int, course_topic: str, topic: str, level: str, trigger_reason: str, force: bool = False):
    existing = get_revision_entry(user_id, course_topic, topic, level)
    existing_updated = parse_dt(existing["updated_at"]) if existing else None
    if existing and existing_updated and not force:
        if (utc_now() - existing_updated) < timedelta(hours=12):
            return {
                "topic": safe_topic(topic),
                "revision": existing["revision_text"],
                "trigger_reason": existing["trigger_reason"],
                "updated_at": existing["updated_at"],
            }

    revision_text = generate_revision_text(course_topic, topic, level)
    now = utc_now().isoformat()
    conn = get_db()
    db_execute(
        conn,
        """INSERT INTO revision_lessons (user_id, course_topic, topic, level, revision_text, trigger_reason, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, course_topic, topic, level) DO UPDATE SET
               revision_text=excluded.revision_text,
               trigger_reason=excluded.trigger_reason,
               updated_at=excluded.updated_at""",
        (user_id, safe_topic(course_topic), safe_topic(topic), safe_topic(level), revision_text, trigger_reason, now),
    )
    conn.commit()
    conn.close()
    return {
        "topic": safe_topic(topic),
        "revision": revision_text,
        "trigger_reason": trigger_reason,
        "updated_at": now,
    }


def build_mock_classroom_payload(course_topic: str = "General Studies"):
    now = utc_now()
    courses = [
        {"id": "mock-course-1", "name": f"{course_topic} Classroom", "section": "Section A"},
        {"id": "mock-course-2", "name": "Weekly Revision Hub", "section": "Self-study"},
    ]
    assignments = [
        {
            "id": "mock-assignment-1",
            "course_id": "mock-course-1",
            "course_name": f"{course_topic} Classroom",
            "title": f"{course_topic} fundamentals worksheet",
            "topic_hint": course_topic,
            "due_at": (now + timedelta(days=2)).isoformat(),
        },
        {
            "id": "mock-assignment-2",
            "course_id": "mock-course-2",
            "course_name": "Weekly Revision Hub",
            "title": "Quick revision checkpoint",
            "topic_hint": "revision",
            "due_at": (now + timedelta(days=5)).isoformat(),
        },
    ]
    return {"courses": courses, "assignments": assignments}


def save_classroom_connection_tokens(user_id: int, *, access_token: str, refresh_token: str = "", token_expires_at: Optional[str] = None, scope: str = "", is_mock: bool = False):
    now = utc_now().isoformat()
    conn = get_db()
    db_execute(
        conn,
        """INSERT INTO classroom_connections (user_id, provider, is_connected, is_mock, access_token, refresh_token, token_expires_at, scope, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
               provider=excluded.provider,
               is_connected=excluded.is_connected,
               is_mock=excluded.is_mock,
               access_token=excluded.access_token,
               refresh_token=CASE WHEN excluded.refresh_token <> '' THEN excluded.refresh_token ELSE classroom_connections.refresh_token END,
               token_expires_at=excluded.token_expires_at,
               scope=excluded.scope,
               updated_at=excluded.updated_at""",
        (user_id, "google_classroom", True, is_mock, access_token, refresh_token, token_expires_at, scope, now),
    )
    conn.commit()
    conn.close()


def store_classroom_payload(user_id: int, payload: dict, is_mock: bool):
    now = utc_now().isoformat()
    courses = payload.get("courses", [])
    assignments = payload.get("assignments", [])
    connection = payload.get("connection", {})
    conn = get_db()
    db_execute(
        conn,
        """INSERT INTO classroom_connections (user_id, provider, is_connected, is_mock, access_token, refresh_token, token_expires_at, scope, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
               provider=excluded.provider,
               is_connected=excluded.is_connected,
               is_mock=excluded.is_mock,
               access_token=CASE WHEN excluded.access_token <> '' THEN excluded.access_token ELSE classroom_connections.access_token END,
               refresh_token=CASE WHEN excluded.refresh_token <> '' THEN excluded.refresh_token ELSE classroom_connections.refresh_token END,
               token_expires_at=COALESCE(excluded.token_expires_at, classroom_connections.token_expires_at),
               scope=CASE WHEN excluded.scope <> '' THEN excluded.scope ELSE classroom_connections.scope END,
               updated_at=excluded.updated_at""",
        (
            user_id,
            "google_classroom",
            True,
            is_mock,
            connection.get("access_token", ""),
            connection.get("refresh_token", ""),
            connection.get("token_expires_at"),
            connection.get("scope", ""),
            now,
        ),
    )
    db_execute(conn, "DELETE FROM classroom_courses WHERE user_id = ?", (user_id,))
    db_execute(conn, "DELETE FROM classroom_assignments WHERE user_id = ?", (user_id,))
    for course in courses:
        db_execute(
            conn,
            """INSERT INTO classroom_courses (user_id, classroom_course_id, name, section, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id, classroom_course_id) DO UPDATE SET
                   name=excluded.name, section=excluded.section, updated_at=excluded.updated_at""",
            (user_id, safe_topic(course.get("id")), safe_topic(course.get("name")), safe_topic(course.get("section")), now),
        )
    for assignment in assignments:
        db_execute(
            conn,
            """INSERT INTO classroom_assignments (user_id, assignment_id, classroom_course_id, course_name, title, topic_hint, due_at, raw_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, assignment_id) DO UPDATE SET
                   classroom_course_id=excluded.classroom_course_id,
                   course_name=excluded.course_name,
                   title=excluded.title,
                   topic_hint=excluded.topic_hint,
                   due_at=excluded.due_at,
                   raw_json=excluded.raw_json,
                   updated_at=excluded.updated_at""",
            (
                user_id,
                safe_topic(assignment.get("id")),
                safe_topic(assignment.get("course_id")),
                safe_topic(assignment.get("course_name")),
                safe_topic(assignment.get("title")),
                safe_topic(assignment.get("topic_hint")),
                assignment.get("due_at"),
                json.dumps(assignment),
                now,
            ),
        )
    conn.commit()
    conn.close()


def get_classroom_connection_row(user_id: int):
    conn = get_db()
    row = db_fetchone(
        conn,
        """SELECT user_id, provider, is_connected, is_mock, access_token, refresh_token, token_expires_at, scope, updated_at
           FROM classroom_connections
           WHERE user_id = ?""",
        (user_id,),
    )
    conn.close()
    return row


def exchange_google_code_for_tokens(code: str) -> dict:
    require_google_oauth_config()
    try:
        response = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Google token exchange failed: {exc}") from exc
    if not response.ok:
        raise HTTPException(status_code=502, detail=f"Google token exchange failed: {response.text}")
    return response.json()


def refresh_google_access_token(user_id: int, refresh_token: str) -> str:
    require_google_oauth_config()
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Google Classroom connection expired. Please reconnect your account.")
    try:
        response = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Google token refresh failed: {exc}") from exc
    if not response.ok:
        raise HTTPException(status_code=502, detail=f"Google token refresh failed: {response.text}")
    token_data = response.json()
    expires_at = utc_now() + timedelta(seconds=int(token_data.get("expires_in", 3600)))
    save_classroom_connection_tokens(
        user_id,
        access_token=token_data.get("access_token", ""),
        refresh_token=token_data.get("refresh_token", ""),
        token_expires_at=expires_at.isoformat(),
        scope=token_data.get("scope", ""),
        is_mock=False,
    )
    return token_data.get("access_token", "")


def get_google_access_token(user_id: int) -> str:
    connection = get_classroom_connection_row(user_id)
    if not connection or not connection["is_connected"]:
        raise HTTPException(status_code=404, detail="Google Classroom is not connected for this account.")
    access_token = connection["access_token"] or ""
    token_expires_at = parse_dt(connection["token_expires_at"])
    if access_token and token_expires_at and token_expires_at > utc_now() + timedelta(minutes=1):
        return access_token
    if access_token and not token_expires_at:
        return access_token
    return refresh_google_access_token(user_id, connection["refresh_token"] or "")


def google_classroom_get(user_id: int, path: str, params: Optional[dict] = None):
    access_token = get_google_access_token(user_id)
    url = f"{GOOGLE_CLASSROOM_API}{path}"
    try:
        response = requests.get(
            url,
            params=params or {},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Google Classroom request failed: {exc}") from exc
    if response.status_code == 401:
        access_token = refresh_google_access_token(user_id, get_classroom_connection_row(user_id)["refresh_token"] or "")
        try:
            response = requests.get(
                url,
                params=params or {},
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=20,
            )
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"Google Classroom request failed: {exc}") from exc
    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail=f"Google Classroom API error: {response.text}")
    return response.json()


def fetch_google_classroom_courses(user_id: int) -> list:
    payload = google_classroom_get(user_id, "/courses", {"courseStates": "ACTIVE"})
    courses = []
    for course in payload.get("courses", []):
        courses.append({
            "id": safe_topic(course.get("id")),
            "name": safe_topic(course.get("name") or "Untitled Course"),
            "section": safe_topic(course.get("section")),
            "description": safe_topic(course.get("descriptionHeading") or course.get("description")),
        })
    return courses


def fetch_google_classroom_coursework(user_id: int, course_id: str) -> list:
    payload = google_classroom_get(user_id, f"/courses/{course_id}/courseWork")
    items = []
    for work in payload.get("courseWork", []):
        items.append({
            "id": safe_topic(work.get("id")),
            "course_id": safe_topic(course_id),
            "title": safe_topic(work.get("title") or "Untitled Coursework"),
            "description": safe_topic(work.get("description")),
            "due_at": build_google_due_at(work.get("dueDate"), work.get("dueTime")),
            "alternate_link": work.get("alternateLink", ""),
            "raw": work,
        })
    return items


def fetch_google_classroom_announcements(user_id: int, course_id: str) -> list:
    payload = google_classroom_get(user_id, f"/courses/{course_id}/announcements")
    items = []
    for announcement in payload.get("announcements", []):
        items.append({
            "id": safe_topic(announcement.get("id")),
            "course_id": safe_topic(course_id),
            "text": safe_topic(announcement.get("text")),
            "update_time": announcement.get("updateTime") or announcement.get("creationTime"),
            "alternate_link": announcement.get("alternateLink", ""),
        })
    return items


def sync_google_classroom_snapshot(user_id: int):
    courses = fetch_google_classroom_courses(user_id)
    assignments = []
    for course in courses:
        coursework = fetch_google_classroom_coursework(user_id, course["id"])
        for work in coursework:
            assignments.append({
                "id": work["id"],
                "course_id": course["id"],
                "course_name": course["name"],
                "title": work["title"],
                "topic_hint": work["title"],
                "description": work["description"],
                "due_at": work["due_at"],
                "alternate_link": work["alternate_link"],
                "raw": work["raw"],
            })
    connection = get_classroom_connection_row(user_id)
    store_classroom_payload(
        user_id,
        {
            "connection": {
                "access_token": connection["access_token"] if connection else "",
                "refresh_token": connection["refresh_token"] if connection else "",
                "token_expires_at": connection["token_expires_at"] if connection else None,
                "scope": connection["scope"] if connection else "",
            },
            "courses": courses,
            "assignments": assignments,
        },
        is_mock=False,
    )
    snapshot = get_classroom_snapshot(user_id)
    snapshot["alerts"] = build_classroom_alerts(snapshot.get("assignments", []))
    snapshot["notifications"] = build_classroom_notifications(snapshot.get("assignments", []))
    return snapshot


def get_classroom_snapshot(user_id: int):
    conn = get_db()
    connection = db_fetchone(
        conn,
        """SELECT provider, is_connected, is_mock, access_token, refresh_token, token_expires_at, scope, updated_at
           FROM classroom_connections WHERE user_id = ?""",
        (user_id,),
    )
    courses = db_fetchall(
        conn,
        "SELECT classroom_course_id, name, section, updated_at FROM classroom_courses WHERE user_id = ? ORDER BY name ASC",
        (user_id,),
    )
    assignments = db_fetchall(
        conn,
        """SELECT assignment_id, classroom_course_id, course_name, title, topic_hint, due_at, raw_json, updated_at
           FROM classroom_assignments
           WHERE user_id = ?
           ORDER BY COALESCE(due_at, '9999-12-31T00:00:00+00:00') ASC, title ASC""",
        (user_id,),
    )
    conn.close()
    course_items = [
        {
            "id": row["classroom_course_id"],
            "name": row["name"],
            "section": row["section"],
            "updated_at": row["updated_at"],
        }
        for row in courses
    ]
    assignment_items = []
    for row in assignments:
        due_at = row["due_at"]
        due_dt = parse_dt(due_at)
        days_until_due = None
        if due_dt:
            days_until_due = max(0, int((due_dt - utc_now()).total_seconds() // 86400))
        assignment_items.append(
            {
                "id": row["assignment_id"],
                "course_id": row["classroom_course_id"],
                "course_name": row["course_name"],
                "title": row["title"],
                "topic_hint": row["topic_hint"],
                "due_at": due_at,
                "days_until_due": days_until_due,
                "raw": json.loads(row["raw_json"]),
                "updated_at": row["updated_at"],
            }
        )
    return {
        "connected": bool(connection["is_connected"]) if connection else False,
        "is_mock": bool(connection["is_mock"]) if connection else False,
        "updated_at": connection["updated_at"] if connection else None,
        "provider": connection["provider"] if connection else "google_classroom",
        "scope": connection["scope"] if connection else "",
        "courses": course_items,
        "assignments": assignment_items,
    }


def build_classroom_alerts(assignments: list):
    alerts = []
    for item in assignments:
        days = item.get("days_until_due")
        if days is None or days > CLASSROOM_DEADLINE_WINDOW_DAYS:
            continue
        title = item.get("title") or "Assignment"
        topic_hint = item.get("topic_hint") or item.get("course_name") or "this topic"
        alerts.append(
            {
                "assignment": title,
                "topic_hint": topic_hint,
                "days_until_due": days,
                "message": f'Assignment deadline approaching. "{title}" is due in {days} day{"s" if days != 1 else ""}. Focus on {topic_hint}.',
            }
        )
    return alerts


def build_classroom_notifications(assignments: list):
    now = utc_now()
    buckets = {"urgent": [], "upcoming": [], "overdue": []}
    for item in assignments:
        due_at = item.get("due_at")
        due_dt = parse_dt(due_at)
        if not due_dt:
            continue
        summary = {
            "id": item.get("id"),
            "title": item.get("title"),
            "course_name": item.get("course_name"),
            "description": item.get("raw", {}).get("description") if isinstance(item.get("raw"), dict) else item.get("description", ""),
            "due_at": due_at,
        }
        if due_dt < now:
            buckets["overdue"].append(summary)
        elif due_dt <= now + timedelta(days=CLASSROOM_URGENT_DAYS):
            buckets["urgent"].append(summary)
        else:
            buckets["upcoming"].append(summary)
    return buckets


def topic_priority_key(topic: str, progress_map: dict, alerts: list):
    key = normalize_key(topic)
    row = progress_map.get(key)
    score = float(row["score"]) if row else 50.0
    mastery_rank = {"weak": 0, "moderate": 1, "strong": 2}.get(row["mastery"], 1) if row else 1
    deadline_rank = 99
    for alert in alerts:
        hint = normalize_key(alert.get("topic_hint"))
        if hint and (hint in key or key in hint):
            deadline_rank = min(deadline_rank, alert.get("days_until_due", 99))
    return (deadline_rank, mastery_rank, score, topic.lower())


def build_short_task(topic: str, level: str, weak: bool):
    if weak:
        return f"Spend 10 minutes revisiting '{topic}' at {level} level, then answer 3 self-check questions."
    return f"Do a 5-minute recap of '{topic}' and write one key takeaway from memory."


def build_recommendations_payload(user_id: int, course_topic: str, level: str, all_topics: list, use_classroom_data: bool):
    topic_list = [safe_topic(item) for item in all_topics if safe_topic(item)]
    progress_rows = get_user_progress_rows(user_id, course_topic)
    progress_map = {normalize_key(row["topic"]): row for row in progress_rows}
    weak_topics = []
    moderate_topics = []
    strong_topics = []
    for topic in topic_list:
        row = progress_map.get(normalize_key(topic))
        if not row:
            continue
        item = {"topic": topic, "score": round(float(row["score"]), 1), "mastery": row["mastery"]}
        if row["mastery"] == "weak":
            weak_topics.append(item)
        elif row["mastery"] == "moderate":
            moderate_topics.append(item)
        else:
            strong_topics.append(item)

    classroom = get_classroom_snapshot(user_id) if use_classroom_data else {"connected": False, "assignments": [], "courses": [], "updated_at": None, "is_mock": False}
    alerts = build_classroom_alerts(classroom.get("assignments", [])) if classroom.get("connected") else []
    reordered_topics = sorted(topic_list, key=lambda topic: topic_priority_key(topic, progress_map, alerts))
    next_topic = reordered_topics[0] if reordered_topics else None

    learner_state = get_learner_state(user_id)
    last_active_time = learner_state["last_active_time"] if learner_state else None
    inactive_hours = 0.0
    short_task = None
    if last_active_time:
        last_active_dt = parse_dt(last_active_time)
        if last_active_dt:
            inactive_hours = max(0.0, (utc_now() - last_active_dt).total_seconds() / 3600)
    if inactive_hours >= INACTIVITY_HOURS and next_topic:
        short_task = build_short_task(next_topic, level, any(normalize_key(next_topic) == normalize_key(item["topic"]) for item in weak_topics))

    skip_topics = [item["topic"] for item in strong_topics if item["score"] > 80]
    revision_candidates = []
    conn = get_db()
    for item in weak_topics[:3]:
        row = db_fetchone(
            conn,
            """SELECT revision_text, trigger_reason, updated_at
               FROM revision_lessons
               WHERE user_id = ? AND course_topic = ? AND topic = ? AND level = ?""",
            (user_id, safe_topic(course_topic), safe_topic(item["topic"]), safe_topic(level)),
        )
        if row:
            revision_candidates.append(
                {
                    "topic": item["topic"],
                    "revision": row["revision_text"],
                    "trigger_reason": row["trigger_reason"],
                    "updated_at": row["updated_at"],
                }
            )
    conn.close()

    recommendation_lines = []
    if alerts:
        recommendation_lines.append(alerts[0]["message"])
    if weak_topics:
        recommendation_lines.append(f"Prioritize weak topics first: {', '.join(item['topic'] for item in weak_topics[:3])}.")
    elif next_topic:
        recommendation_lines.append(f"Continue with {next_topic} to maintain momentum.")
    if skip_topics:
        recommendation_lines.append(f"Strong topics can be skimmed for now: {', '.join(skip_topics[:3])}.")
    if short_task:
        recommendation_lines.append(short_task)
    if not progress_rows:
        recommendation_lines.append("Take topic quizzes regularly so the system can detect weak areas and build revision lessons automatically.")

    return {
        "course_topic": safe_topic(course_topic),
        "level": safe_topic(level),
        "next_recommended_step": next_topic,
        "weak_topics": weak_topics,
        "moderate_topics": moderate_topics,
        "strong_topics": strong_topics,
        "skip_topics": skip_topics,
        "reordered_topics": reordered_topics,
        "short_task": short_task,
        "inactive_hours": round(inactive_hours, 1),
        "classroom_alerts": alerts,
        "revision_lessons": revision_candidates,
        "summary": " ".join(recommendation_lines[:3]).strip(),
        "classroom_connected": classroom.get("connected", False),
        "classroom_is_mock": classroom.get("is_mock", False),
        "classroom_updated_at": classroom.get("updated_at"),
        "has_progress": bool(progress_rows),
        "tracking_hint": "Keep taking topic quizzes so the AI can identify weak topics, prioritize revision, and adapt the learning path.",
    }


def trigger_autonomous_updates(user_id: int, course_topic: str, level: str, all_topics: list, use_classroom_data: bool):
    payload = build_recommendations_payload(user_id, course_topic, level, all_topics, use_classroom_data)
    for item in payload["weak_topics"][:2]:
        if float(item["score"]) < 70:
            ensure_revision_lesson(
                user_id=user_id,
                course_topic=course_topic,
                topic=item["topic"],
                level=level,
                trigger_reason="low_topic_score",
                force=False,
            )
    return build_recommendations_payload(user_id, course_topic, level, all_topics, use_classroom_data)


# ── Auth helpers ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, expected = stored_hash.split("$", 1)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
        return secrets.compare_digest(actual, expected)
    except ValueError:
        return False


def create_session_token(user_id: int) -> str:
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    now = utc_now()
    expires = now + timedelta(days=SESSION_DAYS)
    conn = get_db()
    db_execute(
        conn,
        "INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (user_id, token_hash, expires.isoformat(), now.isoformat()),
    )
    conn.commit()
    conn.close()
    return raw


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key=SESSION_COOKIE, value=token,
        httponly=True, samesite=COOKIE_SAMESITE, secure=COOKIE_SECURE,
        max_age=SESSION_DAYS * 24 * 60 * 60,
    )


def clear_session_cookie(response: Response):
    response.delete_cookie(key=SESSION_COOKIE)


def serialize_user(row) -> dict:
    return {"id": str(row["id"]), "name": row["name"], "email": row["email"]}


def get_current_user(session_token: Optional[str]):
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    token_hash = hashlib.sha256(session_token.encode()).hexdigest()
    conn = get_db()
    row = db_fetchone(
        conn,
        """SELECT users.id, users.name, users.email
           FROM sessions JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
        (token_hash, utc_now().isoformat()),
    )
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="Session expired or invalid.")
    return row


def get_current_user_optional(session_token: Optional[str]):
    try:
        return get_current_user(session_token)
    except HTTPException:
        return None


# ── Request Models ────────────────────────────────────────────────────────────

class CourseRequest(BaseModel):
    topic: str
    level: str
    goal: Optional[str] = "Deep Learning"
    use_classroom_data: Optional[bool] = False

class LessonRequest(BaseModel):
    topic: str
    module: str
    level: str
    goal: Optional[str] = "Deep Learning"

class QuizRequest(BaseModel):
    topic: str
    module: str
    level: str

class FullCourseTestRequest(BaseModel):
    topic: str
    level: str
    all_topics: list

class ExplanationRequest(BaseModel):
    question: str
    user_answer: str
    correct_answer: str
    correct_text: str
    module_name: str
    course_topic: str
    level: str
    is_correct: bool

class AdaptiveReportRequest(BaseModel):
    module_name: str
    course_topic: str
    level: str
    score: int
    total: int
    wrong_items: list
    all_topics: list

class CourseAnalysisRequest(BaseModel):
    course_topic: str
    level: str
    all_topics: list
    results: list

class PracticeModeRequest(BaseModel):
    topic: str
    level: str
    all_topics: list

class RevisionModeRequest(BaseModel):
    topic: str
    level: str
    all_topics: list

class NotesRequest(BaseModel):
    topic: str
    level: str
    all_topics: list

class ChatMessage(BaseModel):
    role: str
    content: str

class TutorChatRequest(BaseModel):
    messages: List[ChatMessage]
    course_topic: str
    current_topic: Optional[str] = ""
    level: str
    teaching_style: str
    all_topics: Optional[list] = []
    selected_text: Optional[str] = ""
    selected_context: Optional[str] = ""
    selection_question: Optional[str] = ""

class AuthRequest(BaseModel):
    email: str
    password: str

class SignupRequest(AuthRequest):
    name: str

class SavedCourseRequest(BaseModel):
    topic: str
    level: str
    course_title: str
    all_topics: list
    added_at: Optional[int] = None

class ProgressRequest(BaseModel):
    topic: str
    level: str
    completed_lessons: list

class TestResultRequest(BaseModel):
    topic: str
    level: str
    result: dict

class StudySuggestionRequest(BaseModel):
    course_topic: str
    module_name: str
    level: str

class FullCourseContentRequest(BaseModel):
    topic: str
    level: str
    course_title: str
    chapters: list


class UpdateProgressRequest(BaseModel):
    course_topic: str
    topic: str
    level: str
    score: float
    total_questions: Optional[int] = None
    use_classroom_data: Optional[bool] = False
    all_topics: Optional[list] = []


class RecommendationRequest(BaseModel):
    course_topic: str
    level: str
    all_topics: list
    use_classroom_data: Optional[bool] = False


class ExamModeRequest(BaseModel):
    topic: str
    level: str
    goal: Optional[str] = "Exam Preparation"
    use_classroom_data: Optional[bool] = False
    all_topics: Optional[list] = []


class ClassroomDataRequest(BaseModel):
    use_mock: Optional[bool] = True
    course_topic: Optional[str] = "General Studies"


class ClassroomAnalyzeRequest(BaseModel):
    course_id: Optional[str] = ""


class AutonomousTriggerRequest(BaseModel):
    course_topic: str
    level: str
    all_topics: list
    use_classroom_data: Optional[bool] = False


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Kirigumi AI Course Builder backend running"}


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.get("/auth/google")
def google_auth(kirigumi_session: Optional[str] = Cookie(default=None)):
    require_google_oauth_config()
    user = get_current_user(kirigumi_session)
    state = create_google_oauth_state(user["id"])
    auth_url = requests.Request(
        "GET",
        GOOGLE_AUTH_URL,
        params={
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": " ".join(GOOGLE_OAUTH_SCOPES),
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
        },
    ).prepare().url
    return RedirectResponse(auth_url)


@app.get("/auth/callback")
def google_auth_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    if error:
        return RedirectResponse(f"{FRONTEND_URL}?classroom=error&reason={error}")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing Google OAuth code or state.")
    user_id = consume_google_oauth_state(state)
    token_data = exchange_google_code_for_tokens(code)
    expires_at = utc_now() + timedelta(seconds=int(token_data.get("expires_in", 3600)))
    save_classroom_connection_tokens(
        user_id,
        access_token=token_data.get("access_token", ""),
        refresh_token=token_data.get("refresh_token", ""),
        token_expires_at=expires_at.isoformat(),
        scope=token_data.get("scope", ""),
        is_mock=False,
    )
    sync_google_classroom_snapshot(user_id)
    return RedirectResponse(f"{FRONTEND_URL}?classroom=connected")

@app.post("/auth/signup")
def signup(request: SignupRequest, response: Response):
    name = request.name.strip()
    email = request.email.strip().lower()
    if not name:
        raise HTTPException(status_code=400, detail="Please enter your name.")
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email.")
    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    conn = get_db()
    if db_fetchone(conn, "SELECT id FROM users WHERE email = ?", (email,)):
        conn.close()
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    now = utc_now().isoformat()
    db_execute(
        conn,
        "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (name, email, hash_password(request.password), now),
    )
    conn.commit()
    user = db_fetchone(conn, "SELECT id, name, email FROM users WHERE email = ?", (email,))
    conn.close()
    token = create_session_token(user["id"])
    set_session_cookie(response, token)
    return {"user": serialize_user(user)}


@app.post("/auth/signin")
def signin(request: AuthRequest, response: Response):
    email = request.email.strip().lower()
    conn = get_db()
    user = db_fetchone(
        conn,
        "SELECT id, name, email, password_hash FROM users WHERE email = ?", (email,)
    )
    conn.close()
    if not user or not verify_password(request.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    token = create_session_token(user["id"])
    set_session_cookie(response, token)
    return {"user": {"id": str(user["id"]), "name": user["name"], "email": user["email"]}}


@app.get("/auth/me")
def auth_me(kirigumi_session: Optional[str] = Cookie(default=None)):
    return {"user": serialize_user(get_current_user(kirigumi_session))}


@app.post("/auth/logout")
def logout(response: Response, kirigumi_session: Optional[str] = Cookie(default=None)):
    if kirigumi_session:
        th = hashlib.sha256(kirigumi_session.encode()).hexdigest()
        conn = get_db()
        db_execute(conn, "DELETE FROM sessions WHERE token_hash = ?", (th,))
        conn.commit()
        conn.close()
    clear_session_cookie(response)
    return {"ok": True}


# ── Profile / Cloud sync ──────────────────────────────────────────────────────

@app.get("/profile/courses")
def get_saved_courses(kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    conn = get_db()
    rows = db_fetchall(
        conn,
        "SELECT topic, level, course_title, all_topics_json, added_at FROM saved_courses WHERE user_id = ? ORDER BY added_at DESC",
        (user["id"],),
    )
    conn.close()
    return {"courses": [{"topic": r["topic"], "level": r["level"], "courseTitle": r["course_title"], "allTopics": json.loads(r["all_topics_json"]), "addedAt": r["added_at"]} for r in rows]}


@app.post("/profile/courses")
def save_course(request: SavedCourseRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    added_at = request.added_at or int(datetime.now().timestamp() * 1000)
    conn = get_db()
    db_execute(
        conn,
        """INSERT INTO saved_courses (user_id, topic, level, course_title, all_topics_json, added_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, topic, level) DO UPDATE SET
               course_title=excluded.course_title, all_topics_json=excluded.all_topics_json, added_at=excluded.added_at""",
        (user["id"], request.topic.strip(), request.level.strip(), request.course_title.strip(), json.dumps(request.all_topics), added_at),
    )
    conn.commit(); conn.close()
    return {"ok": True}


@app.delete("/profile/courses")
def delete_course(topic: str, level: str, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    conn = get_db()
    db_execute(conn, "DELETE FROM saved_courses WHERE user_id=? AND topic=? AND level=?", (user["id"], topic.strip(), level.strip()))
    conn.commit(); conn.close()
    return {"ok": True}


@app.get("/profile/progress")
def get_progress(topic: str, level: str, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    conn = get_db()
    row = db_fetchone(conn, "SELECT completed_lessons_json FROM course_progress WHERE user_id=? AND topic=? AND level=?", (user["id"], topic.strip(), level.strip()))
    conn.close()
    return {"completed_lessons": json.loads(row["completed_lessons_json"]) if row else []}


@app.put("/profile/progress")
def save_progress(request: ProgressRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    ts = int(datetime.now().timestamp() * 1000)
    conn = get_db()
    db_execute(
        conn,
        """INSERT INTO course_progress (user_id, topic, level, completed_lessons_json, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, topic, level) DO UPDATE SET completed_lessons_json=excluded.completed_lessons_json, updated_at=excluded.updated_at""",
        (user["id"], request.topic.strip(), request.level.strip(), json.dumps(request.completed_lessons), ts),
    )
    conn.commit(); conn.close()
    return {"ok": True}


@app.get("/profile/test-result")
def get_test_result(topic: str, level: str, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    conn = get_db()
    row = db_fetchone(conn, "SELECT result_json FROM course_test_results WHERE user_id=? AND topic=? AND level=?", (user["id"], topic.strip(), level.strip()))
    conn.close()
    return {"result": json.loads(row["result_json"]) if row else None}


@app.put("/profile/test-result")
def save_test_result(request: TestResultRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    ts = int(datetime.now().timestamp() * 1000)
    conn = get_db()
    db_execute(
        conn,
        """INSERT INTO course_test_results (user_id, topic, level, result_json, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, topic, level) DO UPDATE SET result_json=excluded.result_json, updated_at=excluded.updated_at""",
        (user["id"], request.topic.strip(), request.level.strip(), json.dumps(request.result), ts),
    )
    conn.commit(); conn.close()
    return {"ok": True}


@app.post("/update-progress")
def update_progress(request: UpdateProgressRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    progress = save_user_progress_row(user["id"], request.course_topic, request.topic, request.score)
    revision = None
    if float(request.score) < 70:
        revision = ensure_revision_lesson(
            user_id=user["id"],
            course_topic=request.course_topic,
            topic=request.topic,
            level=request.level,
            trigger_reason="quiz_score_below_70",
            force=True,
        )
    recommendations = trigger_autonomous_updates(
        user_id=user["id"],
        course_topic=request.course_topic,
        level=request.level,
        all_topics=request.all_topics or [request.topic],
        use_classroom_data=bool(request.use_classroom_data),
    )
    return {
        "ok": True,
        "progress": progress,
        "revision_lesson": revision,
        "recommendations": recommendations,
    }


@app.post("/get-recommendations")
def get_recommendations(request: RecommendationRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    recommendations = trigger_autonomous_updates(
        user_id=user["id"],
        course_topic=request.course_topic,
        level=request.level,
        all_topics=request.all_topics,
        use_classroom_data=bool(request.use_classroom_data),
    )
    touch_learner_activity(user["id"])
    return recommendations


@app.post("/run-autonomous-triggers")
def run_autonomous_triggers(request: AutonomousTriggerRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    recommendations = trigger_autonomous_updates(
        user_id=user["id"],
        course_topic=request.course_topic,
        level=request.level,
        all_topics=request.all_topics,
        use_classroom_data=bool(request.use_classroom_data),
    )
    touch_learner_activity(user["id"])
    return {
        "ok": True,
        "recommendations": recommendations,
    }


@app.get("/classroom-data")
def get_classroom_data(refresh: bool = Query(default=False), kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    if refresh and get_classroom_connection_row(user["id"]) and not get_classroom_snapshot(user["id"]).get("is_mock"):
        snapshot = sync_google_classroom_snapshot(user["id"])
    else:
        snapshot = get_classroom_snapshot(user["id"])
    snapshot["alerts"] = build_classroom_alerts(snapshot.get("assignments", []))
    snapshot["notifications"] = build_classroom_notifications(snapshot.get("assignments", []))
    return snapshot


@app.post("/classroom-data")
def sync_classroom_data(request: ClassroomDataRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    payload = build_mock_classroom_payload(request.course_topic or "General Studies")
    store_classroom_payload(user["id"], payload, is_mock=bool(request.use_mock))
    snapshot = get_classroom_snapshot(user["id"])
    snapshot["alerts"] = build_classroom_alerts(snapshot.get("assignments", []))
    snapshot["notifications"] = build_classroom_notifications(snapshot.get("assignments", []))
    return snapshot


@app.get("/classroom/courses")
def classroom_courses(kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    snapshot = sync_google_classroom_snapshot(user["id"])
    return {"courses": snapshot.get("courses", []), "notifications": snapshot.get("notifications", {})}


@app.get("/classroom/coursework/{course_id}")
def classroom_coursework(course_id: str, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    coursework = fetch_google_classroom_coursework(user["id"], course_id)
    return {"course_id": course_id, "coursework": coursework, "notifications": build_classroom_notifications(coursework)}


@app.get("/classroom/announcements/{course_id}")
def classroom_announcements(course_id: str, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    return {"course_id": course_id, "announcements": fetch_google_classroom_announcements(user["id"], course_id)}


@app.post("/classroom/analyze")
def classroom_analyze(request: ClassroomAnalyzeRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user(kirigumi_session)
    touch_learner_activity(user["id"])
    snapshot = sync_google_classroom_snapshot(user["id"])
    courses = snapshot.get("courses", [])
    assignments = snapshot.get("assignments", [])
    if request.course_id:
        course_id = safe_topic(request.course_id)
        courses = [course for course in courses if course.get("id") == course_id]
        assignments = [item for item in assignments if item.get("course_id") == course_id]
    notifications = build_classroom_notifications(assignments)
    prompt = f"""
You are an academic planning assistant.
Use the classroom data below to produce a JSON object with:
- study_plan: array of 4 to 6 concise steps
- reminders: array of short reminders
- key_topics: array of likely key topics to study
- summary: one short paragraph

Courses:
{json.dumps(courses, indent=2)}

Assignments:
{json.dumps(assignments, indent=2)}

Notifications:
{json.dumps(notifications, indent=2)}
"""
    insights = parse_json_object(call_llm(prompt, max_tokens=900))
    return {
        "courses": courses,
        "assignments": assignments,
        "notifications": notifications,
        "insights": insights,
    }


# ── Course generation ─────────────────────────────────────────────────────────

@app.post("/generate-course")
def generate_course(request: CourseRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    goal = request.goal if request.goal in goal_guide else "Deep Learning"
    classroom_context = ""
    user = get_current_user_optional(kirigumi_session)
    if user and request.use_classroom_data:
        classroom = get_classroom_snapshot(user["id"])
        alerts = build_classroom_alerts(classroom.get("assignments", []))
        if alerts:
            classroom_context = "\nUpcoming classroom priorities:\n" + "\n".join(
                f"- {item['message']}" for item in alerts[:3]
            )
    course = generate_course_outline(request.topic, request.level, goal, classroom_context)
    if user:
        recommendations = build_recommendations_payload(
            user_id=user["id"],
            course_topic=request.topic,
            level=request.level,
            all_topics=[item for chapter in course.get("chapters", []) for item in chapter.get("topics", [])],
            use_classroom_data=bool(request.use_classroom_data),
        )
        course["recommendations"] = recommendations
        touch_learner_activity(user["id"])
    return course


@app.post("/generate-lesson")
def generate_lesson(request: LessonRequest):
    return {"lesson": generate_lesson_text(request.topic, request.module, request.level, request.goal or "Deep Learning")}


@app.post("/generate-full-course-content")
def generate_full_course_content(request: FullCourseContentRequest):
    """Generates a printable text export of the entire course with all lessons."""
    lines = [
        f"COURSE: {request.course_title}",
        "=" * 70, "",
        f"Topic: {request.topic}",
        f"Level: {request.level}", "",
    ]
    for ci, chapter in enumerate(request.chapters, 1):
        lines += [f"CHAPTER {ci}: {chapter.get('title', f'Chapter {ci}')}", "-" * 70, ""]
        for ti, t in enumerate(chapter.get("topics", []), 1):
            lesson = generate_lesson_text(request.topic, t, request.level)
            lines += [f"{ci}.{ti}  {t}", "", strip_fences(lesson), "", ""]
    return {"content": "\n".join(lines).strip()}


@app.post("/generate-quiz")
def generate_quiz(request: QuizRequest):
    course_type = classify_course_type(request.topic, [request.module])
    prompt = f"""
Generate a {request.level} level multiple-choice quiz.

Course Topic: {request.topic}
Lesson Topic: {request.module}
{build_numerical_quiz_instruction(course_type, request.topic)}
Create exactly 5 questions. Use this EXACT format:

1. <Question text>
A) <Option>
B) <Option>
C) <Option>
D) <Option>
Answer: <single letter>

Rules:
- Exactly 4 options labeled A) B) C) D)
- Answer: X on its own line (X is just the letter)
- No explanations, no markdown inside options
- Start directly with "1." — no preamble
"""
    return {"quiz": call_llm(prompt)}


@app.post("/generate-full-course-test")
def generate_full_course_test(request: FullCourseTestRequest):
    course_type = classify_course_type(request.topic, request.all_topics)
    topics_str = "\n".join([f"- {t}" for t in request.all_topics[:30]])
    prompt = f"""
You are creating a comprehensive final exam for a full course.

Course Topic: {request.topic}
Difficulty Level: {request.level}
{build_numerical_quiz_instruction(course_type, request.topic)}
The course covers these topics:
{topics_str}

Generate exactly 30 multiple-choice questions spread across ALL topics.

Use this EXACT format:

1. [TOPIC: <exact topic name>] <Question text>
A) <Option>
B) <Option>
C) <Option>
D) <Option>
Answer: <single letter>

Rules:
- Exactly 30 questions numbered 1–30
- Every question MUST start with [TOPIC: <topic name>]
- No extra text, no markdown, start directly with "1."
"""
    return {"test": call_llm(prompt, max_tokens=4000)}


@app.post("/generate-explanation")
def generate_explanation(request: ExplanationRequest):
    course_type = classify_course_type(request.course_topic, [request.module_name])
    num = " Show the correct working/steps if this is a numerical question." if course_type == "quantitative" else ""
    if request.is_correct:
        prompt = f'The student answered correctly.\nQuestion: "{request.question}"\nCorrect answer: "{request.correct_text}"\n\nIn 1-2 sentences, give an encouraging insight that deepens understanding of WHY this is correct.{num} No bullet points.'
    else:
        prompt = f'The student answered incorrectly.\nCourse: {request.course_topic} | Lesson: {request.module_name} | Level: {request.level}\nQuestion: "{request.question}"\nStudent chose: "{request.user_answer}"\nCorrect: "{request.correct_answer}) {request.correct_text}"\n\n2-3 sentences: explain why the correct answer is right and point out the likely misconception.{num} Be concise and encouraging. No bullets.'
    return {"explanation": call_llm(prompt)}


@app.post("/generate-adaptive-report")
def generate_adaptive_report(request: AdaptiveReportRequest):
    pct = round((request.score / max(request.total, 1)) * 100)
    wrong_summary = "\n".join([f"Q{i['idx']+1}: \"{i['question']}\" — chose {i['userAnswer']}, correct was {i['correctAnswer']}) {i['correctText']}" for i in request.wrong_items]) if request.wrong_items else "All correct!"
    course_type = classify_course_type(request.course_topic, request.all_topics)
    num = "\nNote: quantitative course — identify conceptual vs computational errors." if course_type == "quantitative" else ""
    prompt = f"""Adaptive learning coach. Analyze quiz performance.

Course: {request.course_topic} | Lesson: {request.module_name} | Level: {request.level}{num}
Score: {request.score}/{request.total} ({pct}%)
{"Wrong:\n" + wrong_summary if request.wrong_items else "All correct!"}
Available topics: {", ".join(request.all_topics[:20])}

Write using EXACT labels:
PERFORMANCE_SUMMARY: (1 sentence)
WEAK_AREAS: (1-2 gaps if score<80%, else "None identified")
RECOMMENDATIONS: (2-3 bullet points starting with -)
NEXT_TOPIC: (one topic name from list, or "Level Up")
CONFIDENCE_LEVEL: (Struggling/Building/Proficient/Mastery)

Under 200 words."""
    return {"report": call_llm(prompt)}


@app.post("/generate-course-analysis")
def generate_course_analysis(request: CourseAnalysisRequest):
    topic_scores: dict = {}
    for r in request.results:
        t = r.get("topic", "Unknown")
        topic_scores.setdefault(t, {"correct": 0, "total": 0})
        topic_scores[t]["total"] += 1
        if r.get("correct"):
            topic_scores[t]["correct"] += 1
    overall_correct = sum(r.get("correct", False) for r in request.results)
    overall_total = len(request.results)
    overall_pct = round((overall_correct / max(overall_total, 1)) * 100)
    topic_lines = [f"- {t}: {s['correct']}/{s['total']} ({round(s['correct']/max(s['total'],1)*100)}%)" for t, s in topic_scores.items()]
    course_type = classify_course_type(request.course_topic, request.all_topics)
    num = "\nNote: quantitative course — distinguish conceptual gaps from computational errors." if course_type == "quantitative" else ""
    prompt = f"""Expert learning analyst. Student completed a full-course test.

Course: {request.course_topic} | Level: {request.level}{num}
Score: {overall_correct}/{overall_total} ({overall_pct}%)
Per-topic:
{chr(10).join(topic_lines)}

Write using EXACT labels:
OVERALL_VERDICT: (1-2 honest sentences)
STRONG_TOPICS: (topics >= 70%, bullet list. "None yet" if all below)
WEAK_TOPICS: (topics < 70%, bullet list. "None" if all above)
STUDY_PLAN: (3-4 bullet points)
MASTERY_LEVEL: (Novice/Developing/Competent/Proficient/Expert)

Under 250 words."""
    return {"analysis": call_llm(prompt), "topic_scores": topic_scores, "overall_correct": overall_correct, "overall_total": overall_total}


@app.post("/generate-practice-questions")
def generate_practice_questions(request: PracticeModeRequest):
    course_type = classify_course_type(request.topic, request.all_topics)
    q_types = "- Direct calculation / word problems / proof / step-by-step algorithm / hybrid\n" if course_type == "quantitative" else "- Explain / compare / example / why / analytical\n"
    prompt = f"""You are creating exam-style practice questions for a student.

Course: {request.topic}
Level: {request.level}
Topics: {", ".join(request.all_topics[:25])}
{build_numerical_practice_instruction(course_type, request.topic)}
Question types:
{q_types}
Generate exactly 10 exam-style questions with detailed model answers.

Format:
Q1: <Question>
ANSWER: <Detailed answer — show working for numerical>

Rules:
- Use exactly the labels `Q1:` through `Q10:`
- Every question must be followed by one `ANSWER:` line or paragraph
- No markdown fences
- Start directly with Q1, no preamble
"""
    return {"practice": call_llm(prompt, max_tokens=2200)}


@app.post("/generate-revision")
def generate_revision(request: RevisionModeRequest):
    course_type = classify_course_type(request.topic, request.all_topics)
    topics_str = "\n".join([f"- {t}" for t in request.all_topics[:30]])
    formula_section = "\n## Key Formulas & Methods\n(Most important formulas with when-to-use notes.)\n" if course_type == "quantitative" else ""
    prompt = f"""Create a comprehensive revision summary.

Course: {request.topic} | Level: {request.level}

Topics:
{topics_str}

## Course Overview
(2-3 sentences)

## Key Concepts
(Short paragraph per topic cluster)
{formula_section}
## Important Points to Remember
(10-15 bullet points)

## Common Exam Areas
(5-7 bullet points)

## Quick Reference
(Most important terms/formulas)

Rules:
- Keep it focused and revision-optimised
- No markdown fences
- Keep total length compact enough to load quickly in a study panel
"""
    return {"revision": call_llm(prompt, max_tokens=1600)}


@app.post("/exam-mode")
def exam_mode(request: ExamModeRequest, kirigumi_session: Optional[str] = Cookie(default=None)):
    user = get_current_user_optional(kirigumi_session)
    topic_list = [safe_topic(item) for item in (request.all_topics or []) if safe_topic(item)]
    if user:
        touch_learner_activity(user["id"])
        if not topic_list:
            conn = get_db()
            saved = db_fetchone(
                conn,
                """SELECT all_topics_json
                   FROM saved_courses
                   WHERE user_id = ? AND topic = ? AND level = ?""",
                (user["id"], safe_topic(request.topic), safe_topic(request.level)),
            )
            conn.close()
            if saved:
                topic_list = json.loads(saved["all_topics_json"])
    if not topic_list:
        topic_list = [safe_topic(request.topic)]

    recommendations = None
    selected_topics = topic_list[:5]
    if user:
        recommendations = build_recommendations_payload(
            user_id=user["id"],
            course_topic=request.topic,
            level=request.level,
            all_topics=topic_list,
            use_classroom_data=bool(request.use_classroom_data),
        )
        selected_topics = recommendations["reordered_topics"][:5] or selected_topics

    topics_str = "\n".join(f"- {item}" for item in selected_topics)
    revision_prompt = f"""
You are in Exam Tomorrow mode.

Course: {request.topic}
Level: {request.level}
Goal: Exam Preparation
Priority topics:
{topics_str}

Write a compressed, high-yield revision pack.

Rules:
- Focus on what is most likely to help in the next 24 hours
- Use short sections with clear memory hooks
- Highlight weak areas first if any
- Include likely exam traps and rapid recall bullets
- No markdown fences
- Keep it under 500 words
"""
    quiz_prompt = f"""
You are in Exam Tomorrow mode.

Course: {request.topic}
Level: {request.level}
Priority topics:
{topics_str}

Generate exactly 5 quick exam-focused multiple-choice questions.

Use this exact format:
1. [TOPIC: <topic>] <Question text>
A) <Option>
B) <Option>
C) <Option>
D) <Option>
Answer: <single letter>

Rules:
- High-yield only
- Mix recall and application
- No preamble
"""
    return {
        "selected_topics": selected_topics,
        "recommendations": recommendations,
        "revision": call_llm(revision_prompt, max_tokens=900),
        "quiz": call_llm(quiz_prompt, max_tokens=1200),
    }


@app.post("/generate-notes")
def generate_notes(request: NotesRequest):
    course_type = classify_course_type(request.topic, request.all_topics)
    topics_str = "\n".join([f"- {t}" for t in request.all_topics[:30]])
    extras = ("\n**Formula:** (key formula if applicable)\n**Example:** (brief worked example)" if course_type == "quantitative" else "")
    prompt = f"""Expert note-taker. Create crisp, well-structured study notes.

Course: {request.topic} | Level: {request.level}

Topics:
{topics_str}

# {request.topic} — Study Notes

## Introduction
(3-4 sentences)

For each topic group:
## [Topic Name]
**Core Idea:** (1 sentence)
- Key point 1
- Key point 2
- Key point 3{extras}
**Remember:** (single most important takeaway)

## Summary of Key Principles
(7-10 bullet points)

Rules:
- Crisp and self-contained
- Use **bold** for key terms
- No markdown fences
- Keep the response concise enough for a modal notes view
"""
    return {"notes": call_llm(prompt, max_tokens=1800)}


@app.post("/generate-study-suggestion")
def generate_study_suggestion(request: StudySuggestionRequest):
    course_type = classify_course_type(request.course_topic, [request.module_name])
    quant = " Mention focus on worked examples, formulas, step-by-step problem solving." if course_type == "quantitative" else ""
    prompt = f"""Study coach. Short actionable suggestion for one lesson.

Course: {request.course_topic} | Lesson: {request.module_name} | Level: {request.level}{quant}

**Difficulty:** <one honest sentence>
**Prerequisites:** <1 sentence or "None beyond the basics.">
**Study Approach:** <2 concise sentences>
**Focus Tip:** <1 sentence>

Under 120 words."""
    return {"suggestion": call_llm(prompt)}


@app.post("/tutor-chat")
def tutor_chat(request: TutorChatRequest):
    course_type = classify_course_type(request.course_topic, request.all_topics)
    quant = " For numerical questions, always show full working steps." if course_type == "quantitative" else ""
    ctx = f"\nStudent currently has open: {request.current_topic}." if request.current_topic else ""
    selection_ctx = ""
    if request.selected_text:
        selection_ctx += f'\nSelected passage: "{request.selected_text}".'
    if request.selected_context:
        selection_ctx += f"\nNearby lesson context: {request.selected_context}"
    if request.selection_question:
        selection_ctx += f"\nSpecific doubt from the student: {request.selection_question}"
    topics_preview = ", ".join(request.all_topics[:15]) if request.all_topics else "various topics"
    system_prompt = f"""You are an expert AI tutor for "{request.course_topic}" at {request.level} level.
Teaching style: {request.teaching_style}
Topics in course: {topics_preview}{ctx}{selection_ctx}{quant}

Rules:
- Adapt to the teaching style at all times
- Be encouraging, patient, and clear
- Use concrete examples relevant to {request.course_topic}
- For quizzes: ask 2-3 questions and wait for answers before revealing them
- Use **bold** for key terms; use bullet points when helpful
- If selected text/context is provided, explain that exact passage first before broadening out
- Never refuse to explain a topic"""
    msgs = [{"role": "system", "content": system_prompt}]
    for m in request.messages[-20:]:
        msgs.append({"role": m.role, "content": m.content})
    return {"reply": call_llm("", max_tokens=1000, messages=msgs)}


# ── Resource endpoints ────────────────────────────────────────────────────────

@app.get("/youtube-resources")
def get_youtube_resources(topic: str, level: str):
    videos = search_youtube_videos(topic, level)
    return {"topic": topic, "level": level, "videos": videos}


@app.get("/web-resources")
def get_web_resources(topic: str, level: str):
    if not TAVILY_API_KEY:
        return {
            "topic": topic,
            "level": level,
            "articles": [],
            "error": "Tavily API key is not configured.",
        }

    queries = [
        f"{topic} {level} tutorial guide explained in English -site:youtube.com -site:youtu.be",
        f"{topic} {level} official documentation beginner guide in English -site:youtube.com -site:youtu.be",
    ]

    seen_urls = set()
    articles = []
    last_error = None

    for query in queries:
        try:
            from urllib.parse import urlparse
        except Exception:
            urlparse = None

        try:
            resp = requests.post(
                "https://api.tavily.com/search",
                headers={
                    "Authorization": f"Bearer {TAVILY_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "query": query,
                    "topic": "general",
                    "search_depth": "advanced",
                    "max_results": 10,
                    "include_answer": False,
                    "include_raw_content": False,
                    "include_images": False,
                },
                timeout=15,
            )
            data = resp.json()
        except Exception as exc:
            last_error = f"Unable to reach Tavily: {exc}"
            continue

        if resp.status_code >= 400:
            last_error = (
                data.get("detail")
                or data.get("error")
                or data.get("message")
                or f"Tavily returned HTTP {resp.status_code}."
            )
            continue

        for item in data.get("results", []):
            title = (item.get("title") or "").strip()
            url = (item.get("url") or "").strip()
            if not title or not url or url in seen_urls:
                continue

            domain = ""
            if urlparse is not None:
                try:
                    domain = urlparse(url).netloc.lower().replace("www.", "")
                except Exception:
                    domain = ""
            if domain in VIDEO_HOST_BLOCKLIST:
                continue

            raw_snippet = parse_search_snippet(item.get("content") or "")
            if not raw_snippet or not is_probably_english(f"{title} {raw_snippet}"):
                continue

            source = domain or "web"
            articles.append({
                "title": title,
                "url": url,
                "description": compact_resource_description(raw_snippet, 520),
                "source": source,
            })
            seen_urls.add(url)
            if len(articles) >= 4:
                break

        if len(articles) >= 4:
            break

    articles = summarize_web_resources(articles[:4], topic, level)

    if articles:
        return {"topic": topic, "level": level, "articles": articles}

    return {
        "topic": topic,
        "level": level,
        "articles": [],
        "error": last_error or "Tavily found no English web resources for this topic.",
    }
