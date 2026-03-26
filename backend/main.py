from datetime import datetime, timedelta, timezone
from fastapi import Cookie, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
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

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
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
            """
        )
    conn.commit()
    conn.close()


init_db()


# ── Utility helpers ───────────────────────────────────────────────────────────

def utc_now():
    return datetime.now(timezone.utc)


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


def build_lesson_prompt(topic: str, module: str, level: str) -> str:
    course_type = classify_course_type(topic, [module])
    numerical_note = ""
    if course_type == "quantitative":
        numerical_note = """
Since this is a quantitative topic, make sure the lesson includes:
- At least 2-3 worked examples with actual numbers/values and step-by-step solutions
- Any relevant formulas clearly stated and explained
- A practice problem (with solution) at the end
"""
    return f"""
Create a {level} level lesson.

Course Topic: {topic}
Lesson Topic: {module}

Difficulty guideline: {difficulty_guide[level]}
{numerical_note}
Format using: ## for headings, **bold** for key terms, __underline__ for definitions,
- bullets, numbered lists, `code` for technical terms/expressions.

Structure: Introduction, Core Explanation, Worked Examples, Key Points, Summary.
"""


def generate_lesson_text(topic: str, module: str, level: str) -> str:
    return call_llm(build_lesson_prompt(topic, module, level))


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


# ── Request Models ────────────────────────────────────────────────────────────

class CourseRequest(BaseModel):
    topic: str
    level: str

class LessonRequest(BaseModel):
    topic: str
    module: str
    level: str

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


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Kirigumi AI Course Builder backend running"}


# ── Auth ──────────────────────────────────────────────────────────────────────

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


# ── Course generation ─────────────────────────────────────────────────────────

@app.post("/generate-course")
def generate_course(request: CourseRequest):
    prompt = f"""
You are a curriculum designer. Create a complete, well-structured course for the topic below.

Topic: {request.topic}
Level: {request.level}

Difficulty guideline:
{difficulty_guide[request.level]}

Rules:
- Each chapter should have a clear, descriptive title.
- Each topic inside a chapter should be a short, specific lesson title (under 8 words).
- Topics within a chapter should flow logically.
- Do NOT repeat topics across chapters.

Return ONLY valid JSON — no markdown fences, no explanation:

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
    return parse_json_object(call_llm(prompt))


@app.post("/generate-lesson")
def generate_lesson(request: LessonRequest):
    return {"lesson": generate_lesson_text(request.topic, request.module, request.level)}


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
    topics_preview = ", ".join(request.all_topics[:15]) if request.all_topics else "various topics"
    system_prompt = f"""You are an expert AI tutor for "{request.course_topic}" at {request.level} level.
Teaching style: {request.teaching_style}
Topics in course: {topics_preview}{ctx}{quant}

Rules:
- Adapt to the teaching style at all times
- Be encouraging, patient, and clear
- Use concrete examples relevant to {request.course_topic}
- For quizzes: ask 2-3 questions and wait for answers before revealing them
- Use **bold** for key terms; use bullet points when helpful
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
