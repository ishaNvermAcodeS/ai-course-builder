"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import axios from "axios";

const API_HOST =
  typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || `http://${API_HOST}:8000`;

axios.defaults.withCredentials = true;

// ─── Scroll Lock ──────────────────────────────────────────────────────────────
function useScrollLock() {
  useLayoutEffect(() => {
    const prev = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyPaddingRight: document.body.style.paddingRight,
      touchAction: document.body.style.touchAction,
    };
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.touchAction = "none";
    return () => {
      document.documentElement.style.overflow = prev.htmlOverflow;
      document.body.style.overflow = prev.bodyOverflow;
      document.body.style.paddingRight = prev.bodyPaddingRight;
      document.body.style.touchAction = prev.touchAction;
    };
  }, []);
}

// ─── Typewriter ───────────────────────────────────────────────────────────────
function useTypewriter(text, speed = 8, skip = false) {
  const [displayed, setDisplayed] = useState(skip ? text : "");
  const [done, setDone] = useState(skip);
  const rafRef = useRef(null);
  const indexRef = useRef(skip ? (text ? text.length : 0) : 0);
  const lastTimeRef = useRef(null);
  useEffect(() => {
    let resetFrame = null;
    if (!text) {
      resetFrame = requestAnimationFrame(() => { setDisplayed(""); setDone(false); });
      return () => { if (resetFrame) cancelAnimationFrame(resetFrame); };
    }
    if (skip) {
      resetFrame = requestAnimationFrame(() => { setDisplayed(text); setDone(true); });
      return () => { if (resetFrame) cancelAnimationFrame(resetFrame); };
    }
    indexRef.current = 0; lastTimeRef.current = null;
    const tick = (ts) => {
      if (!lastTimeRef.current) lastTimeRef.current = ts;
      const elapsed = ts - lastTimeRef.current;
      const add = Math.floor(elapsed / speed);
      if (add > 0) {
        indexRef.current = Math.min(indexRef.current + add, text.length);
        setDisplayed(text.slice(0, indexRef.current));
        lastTimeRef.current = ts;
        if (indexRef.current >= text.length) { setDone(true); return; }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    resetFrame = requestAnimationFrame(() => {
      setDisplayed("");
      setDone(false);
      rafRef.current = requestAnimationFrame(tick);
    });
    return () => {
      if (resetFrame) cancelAnimationFrame(resetFrame);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [text, skip, speed]);
  return { displayed, done };
}

// ─── API helpers ──────────────────────────────────────────────────────────────
function profileCourseKey(topic, level) { return `${topic.trim().toLowerCase()}||${level}`; }

function getErrorMessage(error, fallback) {
  return error?.response?.data?.detail || fallback;
}

async function loadProfile() {
  try {
    const res = await axios.get(`${API_BASE}/profile/courses`);
    return res.data.courses || [];
  } catch {
    return [];
  }
}

async function saveProfile(entry) {
  await axios.post(`${API_BASE}/profile/courses`, {
    topic: entry.topic,
    level: entry.level,
    course_title: entry.courseTitle,
    all_topics: entry.allTopics,
    added_at: entry.addedAt,
  });
}

async function removeProfileCourse(topic, level) {
  await axios.delete(`${API_BASE}/profile/courses`, { params: { topic, level } });
}

async function loadProgress(topic, level) {
  try {
    const res = await axios.get(`${API_BASE}/profile/progress`, { params: { topic, level } });
    return res.data.completed_lessons || [];
  } catch {
    return [];
  }
}

async function saveProgress(topic, level, lessons) {
  await axios.put(`${API_BASE}/profile/progress`, {
    topic,
    level,
    completed_lessons: lessons,
  });
}

async function loadTestResult(topic, level) {
  try {
    const res = await axios.get(`${API_BASE}/profile/test-result`, { params: { topic, level } });
    return res.data.result || null;
  } catch {
    return null;
  }
}

async function saveTestResult(topic, level, result) {
  await axios.put(`${API_BASE}/profile/test-result`, {
    topic,
    level,
    result,
  });
}

async function updateMasteryProgress(payload) {
  const res = await axios.post(`${API_BASE}/update-progress`, payload);
  return res.data;
}

async function loadRecommendations(payload) {
  const res = await axios.post(`${API_BASE}/get-recommendations`, payload);
  return res.data;
}

async function loadClassroomData() {
  const res = await axios.get(`${API_BASE}/classroom-data`);
  return res.data;
}

async function connectClassroom(topic) {
  const res = await axios.post(`${API_BASE}/classroom-data`, {
    use_mock: true,
    course_topic: topic || "General Studies",
  });
  return res.data;
}

async function runExamMode(payload) {
  const res = await axios.post(`${API_BASE}/exam-mode`, payload);
  return res.data;
}

async function loadSession() {
  try {
    const res = await axios.get(`${API_BASE}/auth/me`);
    return res.data.user || null;
  } catch {
    return null;
  }
}

async function signUpUser({ name, email, password }) {
  const res = await axios.post(`${API_BASE}/auth/signup`, { name, email, password });
  return res.data.user;
}

async function signInUser({ email, password }) {
  const res = await axios.post(`${API_BASE}/auth/signin`, { email, password });
  return res.data.user;
}

async function clearSession() {
  try {
    await axios.post(`${API_BASE}/auth/logout`);
  } catch {}
}

// ─── PDF download utilities ───────────────────────────────────────────────────
// Generates a clean text layout then opens browser print dialog targeting a hidden iframe
function downloadContentAsPDF(title, bodyText, printWin = null) {
  const targetWin = printWin || window.open("", "_blank", "width=800,height=900");
  const printTarget = targetWin;
  if (!printTarget) { alert("Please allow pop-ups to download PDF."); return; }
  const escaped = bodyText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  printTarget.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>${title}</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;color:#111;background:#fff;margin:0;padding:32px 48px;font-size:14px;line-height:1.7}
  h1{font-size:22px;font-weight:800;margin-bottom:4px;color:#0a1a24}
  .meta{font-size:11px;color:#666;letter-spacing:.06em;text-transform:uppercase;margin-bottom:28px;border-bottom:1px solid #e0e0e0;padding-bottom:12px}
  .body{white-space:pre-wrap;font-size:13px;color:#222}
  @media print{body{padding:20px 30px}}
</style></head>
<body>
<h1>${title}</h1>
<div class="meta">Generated by KIRIGUMI · ${new Date().toLocaleDateString()}</div>
<div class="body">${escaped}</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}<\/script>
</body></html>`);
  printTarget.document.close();
}

async function fetchExplanation({ question, userAnswer, correctAnswer, correctText, moduleName, courseTopic, level }) {
  try {
    const res = await axios.post(`${API_BASE}/generate-explanation`, {
      question, user_answer: userAnswer, correct_answer: correctAnswer, correct_text: correctText,
      module_name: moduleName, course_topic: courseTopic, level, is_correct: userAnswer === correctAnswer,
    });
    return res.data.explanation || null;
  } catch { return null; }
}

async function fetchAdaptiveReport({ questions, results, moduleName, courseTopic, level, allTopics }) {
  const correctCount = results.filter(r => r.correct).length;
  const wrongItems = results.filter(r => !r.correct);
  try {
    const res = await axios.post(`${API_BASE}/generate-adaptive-report`, {
      module_name: moduleName, course_topic: courseTopic, level,
      score: correctCount, total: questions.length,
      wrong_items: wrongItems.map(r => ({ idx: r.idx, question: r.question, userAnswer: r.userAnswer, correctAnswer: r.correctAnswer, correctText: r.correctText })),
      all_topics: allTopics.slice(0, 20),
    });
    return res.data.report || null;
  } catch { return null; }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseQuizText(raw) {
  if (!raw) return [];
  const questions = [];
  const blocks = raw.split(/\n(?=\d+[\.\)])/);
  for (const block of blocks) {
    const lines = block.trim().split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const rawQ = lines[0].replace(/^\d+[\.\)]\s*/, "").trim();
    const topicMatch = rawQ.match(/^\[TOPIC:\s*([^\]]+)\]\s*/i);
    const topic = topicMatch ? topicMatch[1].trim() : null;
    const qLine = topicMatch ? rawQ.replace(topicMatch[0], "").trim() : rawQ;
    if (!qLine) continue;
    const optionLines = lines.filter(l => /^[A-Da-d][\.\)]\s+/.test(l));
    const options = optionLines.map(l => ({ letter: l[0].toUpperCase(), text: l.replace(/^[A-Da-d][\.\)]\s+/, "").trim() }));
    const answerLine = lines.find(l => /^\**\s*(?:correct\s+)?answer\s*[:–\-]/i.test(l));
    let correctLetter = null;
    if (answerLine) {
      const afterColon = answerLine.replace(/^\**\s*(?:correct\s+)?answer\s*[:–\-]\s*/i, "").replace(/\*+/g, "").trim();
      const m = afterColon.match(/^([A-Da-d])[\.\)\s]/);
      if (m) correctLetter = m[1].toUpperCase();
      else if (/^[A-Da-d]$/.test(afterColon[0])) correctLetter = afterColon[0].toUpperCase();
    }
    if (options.length >= 2) questions.push({ question: qLine, options, correctLetter, topic });
  }
  return questions;
}

function parsePracticeQuestions(raw) {
  if (!raw) return [];
  const questions = [];
  const blocks = raw.split(/\n(?=Q\d+:)/);
  for (const block of blocks) {
    const lines = block.trim().split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const qMatch = lines[0].match(/^Q\d+:\s*(.+)/);
    if (!qMatch) continue;
    const question = qMatch[1].trim();
    const answerStart = lines.findIndex(l => /^ANSWER:/i.test(l));
    if (answerStart === -1) continue;
    const answer = lines.slice(answerStart).join(" ").replace(/^ANSWER:\s*/i, "").trim();
    if (question && answer) questions.push({ question, answer });
  }
  return questions;
}

function parseAdaptiveReport(raw) {
  if (!raw) return null;
  const extract = (key) => { const m = raw.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`)); return m ? m[1].trim() : null; };
  return { summary: extract("PERFORMANCE_SUMMARY"), weakAreas: extract("WEAK_AREAS"), recommendations: extract("RECOMMENDATIONS"), nextTopic: extract("NEXT_TOPIC"), confidence: extract("CONFIDENCE_LEVEL") };
}

function parseCourseAnalysis(raw) {
  if (!raw) return null;
  const extract = (key) => { const m = raw.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`)); return m ? m[1].trim() : null; };
  return { verdict: extract("OVERALL_VERDICT"), strongTopics: extract("STRONG_TOPICS"), weakTopics: extract("WEAK_TOPICS"), studyPlan: extract("STUDY_PLAN"), mastery: extract("MASTERY_LEVEL") };
}

// ─── Text rendering ───────────────────────────────────────────────────────────
function parseInline(text) {
  const parts = []; const re = /(\*\*(.+?)\*\*|__(.+?)__|`(.+?)`)/g; let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={m.index}>{m[2]}</strong>);
    else if (m[3]) parts.push(<u key={m.index}>{m[3]}</u>);
    else if (m[4]) parts.push(<code key={m.index} className="lt-code">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function LessonText({ text }) {
  if (!text) return null;
  return (
    <div className="lesson-text">
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="lesson-spacer" />;
        const hMatch = line.match(/^(#{1,3})\s+(.+)/);
        if (hMatch) return <div key={i} className={`lt-h lt-h${hMatch[1].length}`}>{parseInline(hMatch[2])}</div>;
        if (line.match(/^[-*]\s+/)) return <div key={i} className="lt-bullet"><span className="lt-bullet-dot">—</span><span>{parseInline(line.replace(/^[-*]\s+/, ""))}</span></div>;
        const nm = line.match(/^(\d+)\.\s+(.+)/);
        if (nm) return <div key={i} className="lt-numbered"><span className="lt-num">{nm[1]}.</span><span>{parseInline(nm[2])}</span></div>;
        return <p key={i} className="lt-para">{parseInline(line)}</p>;
      })}
    </div>
  );
}

function renderMsg(text) {
  return text.split("\n").map((line, i) => {
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
    const parts = []; const re = /\*\*(.+?)\*\*/g; let last = 0, m;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(<strong key={m.index} style={{ color: "#fff", fontWeight: 700 }}>{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    if (line.match(/^[-*•]\s+/)) return <div key={i} style={{ display: "flex", gap: 8, marginBottom: 2 }}><span style={{ color: "var(--accent)", flexShrink: 0 }}>—</span><span>{parts.length ? parts : line.replace(/^[-*•]\s+/, "")}</span></div>;
    const nm = line.match(/^(\d+)\.\s+/);
    if (nm) return <div key={i} style={{ display: "flex", gap: 8, marginBottom: 2 }}><span style={{ color: "var(--accent)", fontFamily: "var(--ff-mono)", fontSize: "0.8rem", flexShrink: 0, marginTop: 2 }}>{nm[1]}.</span><span>{parts.length ? parts : line.replace(/^\d+\.\s+/, "")}</span></div>;
    return <p key={i} style={{ margin: "2px 0", lineHeight: 1.75 }}>{parts.length ? parts : line}</p>;
  });
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
function AuthModal({ onClose, onAuthSuccess }) {
  useScrollLock();
  const [tab, setTab] = useState("signin"); // "signin" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === "signup") {
        const user = await signUpUser({ name, email, password });
        onAuthSuccess(user);
      } else {
        const user = await signInUser({ email, password });
        onAuthSuccess(user);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Unable to authenticate right now."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal">
        <button className="qm-close-btn auth-close" onClick={onClose}>✕</button>
        <div className="auth-logo">KIRIGUMI</div>
        <div className="auth-tabs">
          <button className={`auth-tab ${tab === "signin" ? "at-active" : ""}`} onClick={() => { setTab("signin"); setError(""); }}>Sign In</button>
          <button className={`auth-tab ${tab === "signup" ? "at-active" : ""}`} onClick={() => { setTab("signup"); setError(""); }}>Create Account</button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {tab === "signup" && (
            <div className="auth-field">
              <label className="auth-label">Your Name</label>
              <input className="auth-input" type="text" placeholder="e.g. Alex Johnson" value={name} onChange={e => setName(e.target.value)} autoFocus />
            </div>
          )}
          <div className="auth-field">
            <label className="auth-label">Email</label>
            <input className="auth-input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus={tab === "signin"} />
          </div>
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input className="auth-input" type="password" placeholder={tab === "signup" ? "Min. 6 characters" : "Your password"} value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? <span className="spin spin-white" /> : tab === "signup" ? "Create Account →" : "Sign In →"}
          </button>
        </form>
        <p className="auth-switch">
          {tab === "signin" ? "Don't have an account? " : "Already have an account? "}
          <button className="auth-switch-btn" onClick={() => { setTab(tab === "signin" ? "signup" : "signin"); setError(""); }}>
            {tab === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ─── AI Tutor ─────────────────────────────────────────────────────────────────
const TEACHING_STYLES = [
  { id: "default",  label: "Normal",          prompt: "Explain clearly and concisely." },
  { id: "eli5",     label: "Like I'm 5",       prompt: "Explain like I am 5 years old, using very simple language and fun analogies." },
  { id: "student",  label: "High School",      prompt: "Explain like I am a high school student. Use relatable examples." },
  { id: "expert",   label: "Expert Level",     prompt: "Explain at an expert level with technical depth and precision." },
  { id: "analogy",  label: "Use Analogies",    prompt: "Always explain using real-world analogies and metaphors. Make abstract things tangible." },
  { id: "story",    label: "Tell a Story",     prompt: "Explain through a short narrative or story that makes the concept memorable." },
  { id: "stepstep", label: "Step by Step",     prompt: "Break everything down into clear numbered steps. Go one step at a time." },
  { id: "socratic", label: "Ask Me Questions", prompt: "Use the Socratic method — guide me to the answer by asking me questions rather than just telling me." },
];

const QUICK_PROMPTS = [
  "I didn't understand this topic at all. Explain from scratch.",
  "Give me a real-world example of this.",
  "What are the most common mistakes beginners make here?",
  "Summarise this in 3 bullet points.",
  "How does this connect to what I learned earlier?",
  "Quiz me on this topic right now.",
  "What should I learn next after this?",
  "Why does this matter in the real world?",
];

const HERO_TEXT_LOOPS = [
  "Personalized lessons that expand with you.",
  "Adaptive quizzes that reveal what to revise next.",
  "Smart notes, practice sets, and final mastery checks.",
];

const STARTUP_LOADING_MESSAGES = [
  "Waking up servers...",
  "Preparing your course...",
  "Almost there...",
];

function AiTutorPanel({ courseTopic, level, currentTopic, allTopics, onClose, persistedMessages, onMessagesChange }) {
  useScrollLock();

  const makeWelcome = useCallback(() => ([{
    role: "assistant",
    content: `Hi! I'm your AI Tutor for **${courseTopic}**.\n\nAsk me anything — I'll explain topics, give examples, quiz you, or adapt to whatever style works for you.\n\nWhat would you like help with?`,
    id: Date.now()
  }]), [courseTopic]);

  const [messages, setMessages] = useState(() =>
    persistedMessages && persistedMessages.length > 0 ? persistedMessages : makeWelcome()
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [style, setStyle] = useState("default");
  const [showStyles, setShowStyles] = useState(false);
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const styleObj = TEACHING_STYLES.find(s => s.id === style) || TEACHING_STYLES[0];

  useEffect(() => {
    if (onMessagesChange) onMessagesChange(messages);
  }, [messages, onMessagesChange]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const sendMessage = async (text) => {
    const userText = (text || input).trim();
    if (!userText || loading) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setShowQuickPrompts(false);
    const userMsg = { role: "user", content: userText, id: Date.now() };
    const history = [...messages, userMsg];
    setMessages(history);
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/tutor-chat`, {
        messages: history.map(m => ({ role: m.role, content: m.content })),
        course_topic: courseTopic, current_topic: currentTopic || "",
        level, teaching_style: styleObj.prompt, all_topics: allTopics.slice(0, 20)
      });
      setMessages(prev => [...prev, { role: "assistant", content: res.data.reply || "Sorry, try again.", id: Date.now() }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please check your backend is running.", id: Date.now() }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  const clearChat = () => setMessages(makeWelcome());

  return (
    <div className="tutor-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tutor-panel">
        <div className="tutor-header">
          <div className="tutor-header-left">
            <div className="tutor-avatar">✦</div>
            <div><div className="tutor-header-title">AI Smart Tutor</div><div className="tutor-header-sub">{courseTopic} · {level}</div></div>
          </div>
          <div className="tutor-header-actions">
            <button className="tutor-clear-btn" onClick={clearChat} title="Clear chat">↺</button>
            <button className="qm-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="tutor-style-bar">
          <button className="tutor-style-toggle" onClick={() => setShowStyles(s => !s)}>
            <span className="tutor-style-icon">🎓</span><span>Style: <strong>{styleObj.label}</strong></span>
            <span className="tutor-style-chevron" style={{ transform: showStyles ? "rotate(180deg)" : "none" }}>▾</span>
          </button>
          {currentTopic && <div className="tutor-context-tag"><span>📍</span><span>{currentTopic}</span></div>}
        </div>
        {showStyles && <div className="tutor-styles-grid">{TEACHING_STYLES.map(s => <button key={s.id} className={`tutor-style-chip ${style === s.id ? "tsc-active" : ""}`} onClick={() => { setStyle(s.id); setShowStyles(false); }}>{s.label}</button>)}</div>}
        <div className="tutor-body" ref={bodyRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`tutor-msg ${msg.role === "user" ? "tm-user" : "tm-ai"}`}>
              {msg.role === "assistant" && <div className="tm-ai-avatar">✦</div>}
              <div className="tm-bubble"><div className="tm-text">{renderMsg(msg.content)}</div></div>
            </div>
          ))}
          {loading && <div className="tutor-msg tm-ai"><div className="tm-ai-avatar">✦</div><div className="tm-bubble tm-thinking"><span className="tm-dot" style={{ animationDelay: "0s" }} /><span className="tm-dot" style={{ animationDelay: "0.2s" }} /><span className="tm-dot" style={{ animationDelay: "0.4s" }} /></div></div>}
        </div>
        {showQuickPrompts && <div className="tutor-quick-wrap"><div className="tutor-quick-label">Quick prompts</div><div className="tutor-quick-list">{QUICK_PROMPTS.map((p, i) => <button key={i} className="tutor-quick-chip" onClick={() => sendMessage(p)}>{p}</button>)}</div></div>}
        <div className="tutor-input-bar">
          <button className="tutor-quick-btn" onClick={() => setShowQuickPrompts(s => !s)}>⚡</button>
          <textarea ref={inputRef} className="tutor-input" placeholder={`Ask anything about ${courseTopic}…`} value={input} onChange={handleInputChange} onKeyDown={handleKey} rows={1} style={{ resize: "none" }} />
          <button className="tutor-send-btn" onClick={() => sendMessage()} disabled={!input.trim() || loading}>{loading ? <span className="spin spin-sm" style={{ borderTopColor: "#fff" }} /> : "↑"}</button>
        </div>
      </div>
    </div>
  );
}

function AiTutorFab({ onClick }) {
  return (
    <button className="tutor-fab" onClick={onClick} title="Open AI Smart Tutor">
      <span className="tutor-fab-icon">✦</span>
      <span className="tutor-fab-label">AI Tutor</span>
      <span className="tutor-fab-pulse" />
    </button>
  );
}

// ─── Loaders ──────────────────────────────────────────────────────────────────
function CinematicLoader({ label, sublabel }) {
  return (
    <div className="cin-loader">
      <div className="cin-ring-wrap">
        <div className="cin-ring cin-r1" /><div className="cin-ring cin-r2" /><div className="cin-ring cin-r3" />
        <div className="cin-core">✦</div>
      </div>
      <div className="cin-label">{label}</div>
      {sublabel && <div className="cin-sublabel">{sublabel}</div>}
    </div>
  );
}

function CourseLoadingOverlay({ topic, level }) {
  useScrollLock();
  return (
    <div className="clo-overlay">
      <div className="clo-content">
        <div className="clo-ring-wrap">
          <div className="clo-ring clo-ring1" /><div className="clo-ring clo-ring2" /><div className="clo-ring clo-ring3" />
          <div className="clo-icon">✦</div>
        </div>
        <div className="clo-topic">{topic || "Building your course"}</div>
        <div className="clo-level">{level} · AI-powered curriculum</div>
        <div className="clo-dots">
          <span className="clo-dot" style={{ animationDelay: "0s" }} /><span className="clo-dot" style={{ animationDelay: "0.2s" }} /><span className="clo-dot" style={{ animationDelay: "0.4s" }} />
        </div>
      </div>
    </div>
  );
}

const TOOL_MODAL_OVERLAY_STYLE = {
  position: "fixed",
  inset: 0,
  zIndex: 1200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "rgba(230, 248, 255, 0.82)",
  backdropFilter: "blur(12px)",
  overflowY: "auto",
  overflowX: "hidden",
};

const TOOL_MODAL_PANEL_STYLE = {
  width: "min(820px, calc(100vw - 48px))",
  maxHeight: "min(88vh, 920px)",
  background: "#ffffff",
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: "24px",
  boxShadow: "0 30px 80px rgba(8,145,178,.18)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  margin: "auto",
};

function ToolModalShell({ children, onClose, wide = false }) {
  useScrollLock();
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={TOOL_MODAL_OVERLAY_STYLE}
    >
      <div
        style={{
          ...TOOL_MODAL_PANEL_STYLE,
          width: wide ? "min(900px, calc(100vw - 48px))" : "min(760px, calc(100vw - 48px))",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

function StartupLoadingOverlay() {
  useScrollLock();
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % STARTUP_LOADING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="startup-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="startup-card">
        <div className="startup-clock" aria-hidden="true">
          <div className="startup-clock-face">
            <span className="startup-clock-mark startup-clock-mark-top" />
            <span className="startup-clock-mark startup-clock-mark-right" />
            <span className="startup-clock-mark startup-clock-mark-bottom" />
            <span className="startup-clock-mark startup-clock-mark-left" />
            <span className="startup-clock-hand startup-clock-hour" />
            <span className="startup-clock-hand startup-clock-minute" />
            <span className="startup-clock-center" />
          </div>
        </div>
        <div className="startup-title">Please wait for sometime Do not refresh or leave</div>
        <div className="startup-message-wrap">
          {STARTUP_LOADING_MESSAGES.map((message, index) => (
            <p
              key={message}
              className={`startup-message ${index === messageIndex ? "startup-message-visible" : ""}`}
            >
              {message}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Panel scroll helper ───────────────────────────────────────────────────────
function usePanelScrollTop(triggerKey) {
  const ref = useRef(null);
  const doScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
  }, []);
  useLayoutEffect(() => { doScroll(); }, [doScroll]);
  useEffect(() => {
    doScroll();
    const t = setTimeout(doScroll, 60);
    return () => clearTimeout(t);
  }, [triggerKey, doScroll]);
  return ref;
}

// ─── Mode Panels ──────────────────────────────────────────────────────────────
function PracticePanel({ courseTopic, level, allTopics, onClose }) {
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const bodyRef = usePanelScrollTop(loading);

  useEffect(() => {
    const gen = async () => {
      try {
        const res = await axios.post(`${API_BASE}/generate-practice-questions`, { topic: courseTopic, level, all_topics: allTopics });
        const parsedQuestions = parsePracticeQuestions(res.data.practice);
        if (parsedQuestions.length === 0) {
          throw new Error("No practice questions were generated.");
        }
        setQuestions(parsedQuestions);
        setError("");
      } catch (e) {
        console.error(e);
        setError(getErrorMessage(e, "Could not generate practice questions right now. Please try again."));
      }
      finally { setLoading(false); }
    };
    gen();
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [courseTopic, level, allTopics, onClose]);

  const toggle = (i) => setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <ToolModalShell onClose={onClose}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "min(88vh, 920px)",
          maxHeight: "min(88vh, 920px)",
        }}
      >
        <div className="mode-header">
          <div>
            <span className="mode-eyebrow">Practice Mode</span>
            <h2 className="mode-title">{courseTopic}</h2>
            <span className="mode-subtitle">10 exam-style questions · tap to reveal answer</span>
          </div>
          <button className="qm-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="mode-body" ref={bodyRef}>
          {loading
            ? <CinematicLoader label="Crafting exam questions…" sublabel="Analysing course topics" />
            : error
              ? <div className="mode-empty">{error}</div>
              : questions.length === 0
                ? <div className="mode-empty">Could not generate questions. Please try again.</div>
              : <div className="practice-cards">{questions.map((q, i) => { const isOpen = expanded.has(i); return (<div key={i} className={`pq-card ${isOpen ? "pq-open" : ""}`} onClick={() => toggle(i)}><div className="pq-card-top"><span className="pq-num">Q{i + 1}</span><span className="pq-question">{q.question}</span><span className="pq-chevron" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▾</span></div>{isOpen && <div className="pq-answer" onClick={(e) => e.stopPropagation()}><div className="pq-answer-label">Model Answer</div><p className="pq-answer-text">{q.answer}</p></div>}</div>); })}</div>
          }
        </div>
      </div>
    </ToolModalShell>
  );
}

function RevisionPanel({ courseTopic, level, allTopics, onClose }) {
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState("");
  const [error, setError] = useState("");
  const bodyRef = usePanelScrollTop(loading);

  useEffect(() => {
    const gen = async () => {
      try {
        const res = await axios.post(`${API_BASE}/generate-revision`, { topic: courseTopic, level, all_topics: allTopics });
        const revisionText = (res.data.revision || "").trim();
        if (!revisionText) {
          throw new Error("Revision summary was empty.");
        }
        setRevision(revisionText);
        setError("");
      } catch (e) {
        console.error(e);
        setError(getErrorMessage(e, "Could not generate revision notes right now. Please try again."));
      }
      finally { setLoading(false); }
    };
    gen();
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [courseTopic, level, allTopics, onClose]);

  return (
    <ToolModalShell onClose={onClose} wide>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "min(88vh, 920px)",
          maxHeight: "min(88vh, 920px)",
        }}
      >
        <div className="mode-header">
          <div>
            <span className="mode-eyebrow">Revision Mode</span>
            <h2 className="mode-title">{courseTopic}</h2>
            <span className="mode-subtitle">Full course summary · key concepts</span>
          </div>
          <button className="qm-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="mode-body" ref={bodyRef}>
          {loading
            ? <CinematicLoader label="Compiling revision notes…" sublabel="Summarising all course topics" />
            : error
              ? <div className="mode-empty">{error}</div>
              : <div className="revision-content"><LessonText text={revision} /></div>
          }
        </div>
      </div>
    </ToolModalShell>
  );
}

function NotesPanel({ courseTopic, level, allTopics, onClose }) {
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const bodyRef = usePanelScrollTop(loading);

  useEffect(() => {
    const gen = async () => {
      try {
        const res = await axios.post(`${API_BASE}/generate-notes`, { topic: courseTopic, level, all_topics: allTopics });
        const notesText = (res.data.notes || "").trim();
        if (!notesText) {
          throw new Error("Notes response was empty.");
        }
        setNotes(notesText);
        setError("");
      } catch (e) {
        console.error(e);
        setError(getErrorMessage(e, "Could not generate AI notes right now. Please try again."));
      }
      finally { setLoading(false); }
    };
    gen();
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [courseTopic, level, allTopics, onClose]);

  const handleDownload = () => {
    if (!notes) return;
    // Download as PDF via print dialog
    downloadContentAsPDF(`${courseTopic} — AI Notes`, notes);
  };
  const handleDownloadTxt = () => {
    const blob = new Blob([notes], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${courseTopic.replace(/\s+/g, "_")}_Notes.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ToolModalShell onClose={onClose} wide>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "min(88vh, 920px)",
          maxHeight: "min(88vh, 920px)",
        }}
      >
        <div className="mode-header">
          <div>
            <span className="mode-eyebrow">AI Notes</span>
            <h2 className="mode-title">{courseTopic}</h2>
            <span className="mode-subtitle">Crisp structured notes for the entire course</span>
          </div>
          <button className="qm-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="mode-body" ref={bodyRef}>
          {loading
            ? <CinematicLoader label="Generating AI notes…" sublabel="Structuring key concepts" />
            : error
              ? <div className="mode-empty">{error}</div>
              : (
              <>
                <div className="notes-content"><LessonText text={notes} /></div>
                <div className="notes-download-row">
                  <div className="notes-download-info">
                    <span className="notes-download-icon">📄</span>
                    <div><div className="notes-download-title">Download Notes</div><div className="notes-download-sub">Save as PDF or plain text</div></div>
                  </div>
                  <div style={{ display:"flex", gap:8, flexShrink:0 }}>
                    <button className="notes-download-btn" onClick={handleDownload}>PDF ↓</button>
                    <button className="notes-download-btn" style={{ background:"var(--surface2)", borderColor:"var(--border2)", color:"var(--text2)" }} onClick={handleDownloadTxt}>TXT ↓</button>
                  </div>
                </div>
              </>
            )
          }
        </div>
      </div>
    </ToolModalShell>
  );
}

function RecommendationPanel({ recommendations, classroomData, onConnectClassroom, classroomLoading, onOpenTopic, onOpenRevisionTopic, onOpenExamMode, hideClassroom = false }) {
  const weakTopics = recommendations?.weak_topics || [];
  const alerts = recommendations?.classroom_alerts?.length ? recommendations.classroom_alerts : (classroomData?.alerts || []);
  const priorityPath = recommendations?.reordered_topics?.slice(0, 5) || [];
  const revisionLessons = recommendations?.revision_lessons || [];
  const nextTopic = recommendations?.next_recommended_step || "";

  return (
    <div className="rec-panel">
      <div className="rec-header">
        <div>
          <div className="rec-eyebrow">Autonomous Guidance</div>
          <h3 className="rec-title">Next Recommended Step</h3>
        </div>
        <div className="rec-next-pill">{recommendations?.next_recommended_step || "Generate a course to begin"}</div>
      </div>
      {recommendations?.summary && <p className="rec-summary">{recommendations.summary}</p>}
      <div className="rec-actions-row">
        <button className="rec-primary-btn" onClick={() => nextTopic && onOpenTopic?.(nextTopic)} disabled={!nextTopic}>Open Recommended Topic</button>
        <button className="rec-secondary-btn" onClick={onOpenExamMode}>Exam Tomorrow?</button>
      </div>
      <div className="rec-grid">
        <div className="rec-card">
          <div className="rec-card-label">Weak Topics</div>
          {weakTopics.length > 0
            ? weakTopics.map((item) => (
                <div key={item.topic} className="rec-chip-row">
                  <span>{item.topic}</span>
                  <div className="rec-chip-actions">
                    <strong>{Math.round(item.score)}%</strong>
                    <button className="rec-mini-btn" onClick={() => onOpenTopic?.(item.topic)}>Open</button>
                  </div>
                </div>
              ))
            : <div className="rec-empty">Weak topics will appear after topic quiz activity. Keep attempting quizzes so the AI can identify what needs revision.</div>}
        </div>
        <div className="rec-card">
          <div className="rec-card-label">Priority Path</div>
          {priorityPath.length > 0
            ? priorityPath.map((item, index) => (
              <div key={item} className="rec-line">
                <span>{index + 1}. {item}</span>
                <button className="rec-mini-btn" onClick={() => onOpenTopic?.(item)}>Go</button>
              </div>
            ))
            : <div className="rec-empty">No reordered path yet.</div>}
        </div>
        <div className="rec-card">
          <div className="rec-card-label">Behavior Trigger</div>
          {recommendations?.short_task
            ? <div className="rec-line">{recommendations.short_task}</div>
            : <div className="rec-empty">Short tasks appear after about 24 hours of inactivity and point you to the next best quick study action.</div>}
        </div>
        {!hideClassroom && (
          <div className="rec-card">
            <div className="rec-card-label">Classroom Deadlines</div>
            {classroomData?.connected
              ? (
                <>
                  <div className="rec-line">{classroomData.is_mock ? "Mock classroom connected" : "Google Classroom connected"}</div>
                  {alerts.length > 0
                    ? alerts.slice(0, 2).map((alert) => <div key={`${alert.assignment}-${alert.days_until_due}`} className="rec-alert">{alert.message}</div>)
                    : <div className="rec-empty">No urgent deadlines right now.</div>}
                </>
              )
              : (
                <>
                  <div className="rec-empty">Connect Classroom to prioritize deadlines automatically.</div>
                  <button className="rec-connect-btn" onClick={onConnectClassroom} disabled={classroomLoading}>
                    {classroomLoading ? "Connecting…" : "Connect Google Classroom"}
                  </button>
                </>
              )}
          </div>
        )}
        <div className="rec-card rec-card-wide">
          <div className="rec-card-label">Autonomous Revision Queue</div>
          {revisionLessons.length > 0
            ? revisionLessons.map((item) => (
              <div key={`${item.topic}-${item.updated_at}`} className="rec-revision-row">
                <div>
                  <div className="rec-revision-title">{item.topic}</div>
                  <div className="rec-revision-sub">{item.trigger_reason === "quiz_score_below_70" ? "Triggered by low quiz score" : "Triggered by weak mastery"}</div>
                </div>
                <button className="rec-mini-btn" onClick={() => onOpenRevisionTopic?.(item.topic)}>Review</button>
              </div>
            ))
            : <div className="rec-empty">Revision lessons will appear here when weak areas are detected from quiz performance. Keep giving topic quizzes so the AI can learn what to revisit.</div>}
        </div>
        <div className="rec-card rec-card-wide">
          <div className="rec-card-label">Tracking Note</div>
          <div className="rec-line">{recommendations?.tracking_hint || "Keep taking topic quizzes so the AI can detect weak topics, adapt your path, and generate targeted revision."}</div>
        </div>
      </div>
    </div>
  );
}

function ExamModePanel({ courseTopic, level, allTopics, goal, useClassroomData, onClose }) {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [examSelected, setExamSelected] = useState({});
  const [examChecked, setExamChecked] = useState({});
  const [examFinished, setExamFinished] = useState(false);
  const bodyRef = usePanelScrollTop(loading);

  useEffect(() => {
    const exec = async () => {
      try {
        const res = await runExamMode({
          topic: courseTopic,
          level,
          goal,
          use_classroom_data: useClassroomData,
          all_topics: allTopics,
        });
        setPayload(res);
        setError("");
      } catch (e) {
        console.error(e);
        setError(getErrorMessage(e, "Could not build Exam Tomorrow mode right now."));
      } finally {
        setLoading(false);
      }
    };
    exec();
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [courseTopic, level, allTopics, goal, useClassroomData, onClose]);

  const quickQuestions = parseQuizText(payload?.quiz || "");
  const examScore = examFinished ? Object.entries(examChecked).filter(([idx]) => examSelected[idx] === quickQuestions[idx]?.correctLetter).length : 0;

  const handleExamCheck = (qIdx) => {
    if (examChecked[qIdx]) return;
    setExamChecked(prev => ({ ...prev, [qIdx]: true }));
    const allDone = quickQuestions.length > 0 && quickQuestions.every((_, i) => i === qIdx || examChecked[i]);
    if (allDone) setExamFinished(true);
  };

  return (
    <ToolModalShell onClose={onClose} wide>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "min(88vh, 920px)", maxHeight: "min(88vh, 920px)" }}>
        <div className="mode-header">
          <div>
            <span className="mode-eyebrow">Exam Tomorrow?</span>
            <h2 className="mode-title">{courseTopic}</h2>
            <span className="mode-subtitle">Compressed revision for the next 24 hours</span>
          </div>
          <button className="qm-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="mode-body" ref={bodyRef}>
          {loading
            ? <CinematicLoader label="Compressing the highest-yield topics…" sublabel="Focusing weak areas and deadlines" />
            : error
              ? <div className="mode-empty">{error}</div>
              : (
                <div className="exam-mode-wrap">
                  <div className="exam-priority-list">
                    <div className="exam-block-title">Priority Topics</div>
                    <div className="exam-chip-list">
                      {(payload?.selected_topics || []).map((item) => <span key={item} className="exam-chip">{item}</span>)}
                    </div>
                  </div>
                  <div className="exam-revision-card">
                    <div className="exam-block-title">Rapid Revision Pack</div>
                    <LessonText text={payload?.revision || ""} />
                  </div>
                  <div className="exam-quiz-card">
                    <div className="exam-block-title">Quick Quiz {examFinished && <span style={{ color: "var(--green)", fontSize: ".85rem", marginLeft: 10 }}>Score: {examScore}/{quickQuestions.length}</span>}</div>
                    <div className="qm-questions" style={{ gap: 14 }}>
                      {quickQuestions.map((q, qIdx) => {
                        const isSub = !!examChecked[qIdx];
                        const userAns = examSelected[qIdx];
                        const isCorrect = userAns === q.correctLetter;
                        const correctOpt = q.options.find(o => o.letter === q.correctLetter);
                        return (
                          <div key={`${q.question}-${qIdx}`} className={`qm-question ${isSub ? (isCorrect ? "qm-q-correct" : "qm-q-wrong") : ""}`}>
                            <div className="qm-q-top">
                              <span className="qm-q-num">{String(qIdx + 1).padStart(2, "0")}</span>
                              <div className="qm-q-right">
                                {q.topic && <span className="fct-q-topic">{q.topic}</span>}
                                <span className="qm-q-text">{q.question}</span>
                              </div>
                              {isSub && <span className={`qm-q-badge ${isCorrect ? "qb-correct" : "qb-wrong"}`}>{isCorrect ? "✓" : "✗"}</span>}
                            </div>
                            <div className="qm-opts">
                              {q.options.map(opt => {
                                const isSel = userAns === opt.letter;
                                const isOptCorrect = opt.letter === q.correctLetter;
                                let cls = "qm-opt";
                                if (!isSub && isSel) cls += " qo-selected";
                                if (isSub) { if (isOptCorrect) cls += " qo-correct"; else if (isSel) cls += " qo-wrong"; else cls += " qo-dim"; }
                                return (
                                  <button key={opt.letter} className={cls} onClick={() => { if (!examChecked[qIdx]) setExamSelected(p => ({ ...p, [qIdx]: opt.letter })); }} disabled={isSub}>
                                    <span className="qo-letter">{opt.letter}</span>
                                    <span className="qo-text">{opt.text}</span>
                                    {isSub && isOptCorrect && <span className="qo-icon qo-icon-ok">✓</span>}
                                    {isSub && isSel && !isOptCorrect && <span className="qo-icon qo-icon-bad">✗</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {!isSub && <button className="qm-check-btn" onClick={() => handleExamCheck(qIdx)} disabled={!examSelected[qIdx]}>Check Answer</button>}
                            {isSub && !isCorrect && <div className="qe-top" style={{ marginTop: 8 }}><span className="qe-result-label">{`✗ Correct: ${q.correctLetter}) ${correctOpt?.text || ""}`}</span></div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
        </div>
      </div>
    </ToolModalShell>
  );
}

function CourseBottomActions({ courseTopic, level, allTopics, goal, useClassroomData }) {
  const [show, setShow] = useState(null);
  return (
    <>
      <div className="cba-wrap">
        <div className="cba-divider"><div className="cba-divider-line" /><span className="cba-divider-label">Course Tools</span><div className="cba-divider-line" /></div>
        <div className="cba-buttons">
          <button className="cba-btn cba-practice" onClick={() => setShow("practice")}><span className="cba-btn-icon">✏️</span><div className="cba-btn-text"><span className="cba-btn-label">Practice</span><span className="cba-btn-sub">10 exam-style questions</span></div></button>
          <button className="cba-btn cba-revise" onClick={() => setShow("revision")}><span className="cba-btn-icon">📖</span><div className="cba-btn-text"><span className="cba-btn-label">Revise</span><span className="cba-btn-sub">Full course summary</span></div></button>
          <button className="cba-btn cba-notes" onClick={() => setShow("notes")}><span className="cba-btn-icon">🤖</span><div className="cba-btn-text"><span className="cba-btn-label">AI Notes</span><span className="cba-btn-sub">Crisp structured notes</span></div></button>
          <button className="cba-btn cba-exam" onClick={() => setShow("exam")}><span className="cba-btn-icon">⏰</span><div className="cba-btn-text"><span className="cba-btn-label">Exam Tomorrow?</span><span className="cba-btn-sub">High-yield revision sprint</span></div></button>
        </div>
      </div>
      {show === "practice" && <PracticePanel courseTopic={courseTopic} level={level} allTopics={allTopics} onClose={() => setShow(null)} />}
      {show === "revision" && <RevisionPanel courseTopic={courseTopic} level={level} allTopics={allTopics} onClose={() => setShow(null)} />}
      {show === "notes" && <NotesPanel courseTopic={courseTopic} level={level} allTopics={allTopics} onClose={() => setShow(null)} />}
      {show === "exam" && <ExamModePanel courseTopic={courseTopic} level={level} allTopics={allTopics} goal={goal} useClassroomData={useClassroomData} onClose={() => setShow(null)} />}
    </>
  );
}

// ─── Full Course Test ─────────────────────────────────────────────────────────
function FullCourseTestModal({ courseTopic, level, allTopics, onClose, onComplete }) {
  useScrollLock();
  const [questions, setQuestions] = useState([]);
  const [selected, setSelected] = useState({});
  const [generating, setGenerating] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const bodyRef = usePanelScrollTop(generating);

  useEffect(() => {
    const gen = async () => {
      try {
        const res = await axios.post(`${API_BASE}/generate-full-course-test`, { topic: courseTopic, level, all_topics: allTopics });
        setQuestions(parseQuizText(res.data.test));
      } catch (e) { console.error(e); }
      finally { setGenerating(false); }
    };
    gen();
    const h = (e) => { if (e.key === "Escape" && !submitted) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [courseTopic, level, allTopics, onClose, submitted]);

  const answeredCount = Object.keys(selected).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  const handleSubmit = async () => {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    let correct = 0;
    const results = questions.map((q, i) => {
      const isCorrect = q.correctLetter && selected[i] === q.correctLetter;
      if (isCorrect) correct++;
      return { topic: q.topic || "General", question: q.question, userAnswer: selected[i] || "?", correctAnswer: q.correctLetter, correctText: q.options.find(o => o.letter === q.correctLetter)?.text || "", correct: isCorrect };
    });
    let analysis = null, topicScores = {};
    try {
      const res = await axios.post(`${API_BASE}/generate-course-analysis`, { course_topic: courseTopic, level, all_topics: allTopics, results });
      analysis = res.data.analysis; topicScores = res.data.topic_scores || {};
    } catch (e) { console.error(e); }
    onComplete({ score: correct, total: questions.length, results, analysis, topicScores, completedAt: Date.now() });
    setSubmitted(true); setSubmitting(false);
  };

  return (
    <div className="fct-overlay" onClick={(e) => { if (e.target === e.currentTarget && !submitted) onClose(); }}>
      <div className="fct-panel">
        <div className="fct-header">
          <div className="fct-header-left">
            <span className="fct-eyebrow">Full Course Test</span>
            <h2 className="fct-title">{courseTopic}</h2>
            <span className="fct-meta">{level} · 30 Questions · One attempt only</span>
          </div>
          {!submitted && <button className="qm-close-btn" onClick={onClose}>✕</button>}
        </div>
        <div className="qm-prog">
          <div className="qm-prog-bar" style={{ width: questions.length ? `${(answeredCount / questions.length) * 100}%` : "0%" }} />
          <div className="qm-prog-meta">{!generating && <span>{answeredCount}/{questions.length} answered</span>}</div>
        </div>
        <div className="fct-body" ref={bodyRef}>
          {generating
            ? <CinematicLoader label="Building 30-question final exam…" sublabel="Covering all course topics" />
            : submitted
              ? (<div className="fct-done"><div className="fct-done-icon">🎓</div><div className="fct-done-title">Test Submitted!</div><div className="fct-done-sub">Results saved. Open your profile to view the analysis.</div><button className="fct-done-btn" onClick={onClose}>Close →</button></div>)
              : (<div className="fct-questions">{questions.map((q, qIdx) => { const userSel = selected[qIdx]; return (<div key={qIdx} className="fct-question"><div className="fct-q-top"><span className="fct-q-num">{String(qIdx + 1).padStart(2, "0")}</span><div className="fct-q-right">{q.topic && <span className="fct-q-topic">{q.topic}</span>}<span className="fct-q-text">{q.question}</span></div></div><div className="fct-opts">{q.options.map(opt => (<button key={opt.letter} className={`fct-opt ${userSel === opt.letter ? "fco-selected" : ""}`} onClick={() => setSelected(prev => ({ ...prev, [qIdx]: opt.letter }))}><span className="fco-letter">{opt.letter}</span><span className="fco-text">{opt.text}</span></button>))}</div></div>); })}</div>)
          }
        </div>
        {!generating && !submitted && (
          <div className="fct-footer">
            {!allAnswered && <span className="fct-footer-hint">{questions.length - answeredCount} remaining</span>}
            <button className="fct-submit-btn" onClick={handleSubmit} disabled={!allAnswered || submitting}>
              {submitting ? <><span className="spin" style={{ borderTopColor: "#fff" }} /> Analysing…</> : "Submit & Get Analysis ↗"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Course Analysis Panel ────────────────────────────────────────────────────
function CourseAnalysisPanel({ testResult, courseTopic, onClose }) {
  useScrollLock();
  const bodyRef = usePanelScrollTop(null);
  if (!testResult) return null;
  const parsed = parseCourseAnalysis(testResult.analysis);
  const pct = Math.round((testResult.score / testResult.total) * 100);
  const masteryColor = { Novice: "var(--red)", Developing: "var(--orange)", Competent: "var(--accent)", Proficient: "var(--green)", Expert: "#7ee8c8" }[parsed?.mastery] || "var(--text2)";
  const masteryBg = { Novice: "var(--red-dim)", Developing: "var(--orange-dim)", Competent: "var(--accent-glow)", Proficient: "var(--green-dim)", Expert: "rgba(126,232,200,0.12)" }[parsed?.mastery] || "var(--surface2)";
  const strongLines = parsed?.strongTopics ? parsed.strongTopics.split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean) : [];
  const weakLines = parsed?.weakTopics && parsed.weakTopics !== "None" ? parsed.weakTopics.split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean) : [];
  const planLines = parsed?.studyPlan ? parsed.studyPlan.split("\n").map(l => l.replace(/^[-•*\d.]\s*/, "").trim()).filter(Boolean) : [];
  const scores = Object.entries(testResult.topicScores || {});
  return (
    <div className="ca-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ca-panel">
        <div className="ca-header"><div><span className="ca-eyebrow">Course Analysis</span><h2 className="ca-title">{courseTopic}</h2></div><button className="qm-close-btn" onClick={onClose}>✕</button></div>
        <div className="ca-body" ref={bodyRef}>
          <div className="ca-score-hero"><div className="ca-score-big">{testResult.score}<span className="ca-score-denom">/{testResult.total}</span></div><div className="ca-score-right"><span className="ca-score-pct">{pct}%</span>{parsed?.mastery && <span className="ca-mastery-badge" style={{ color: masteryColor, background: masteryBg }}>{parsed.mastery}</span>}<span className="ca-score-sub">Full Course Test</span></div></div>
          {parsed?.verdict && <p className="ca-verdict">{parsed.verdict}</p>}
          {scores.length > 0 && (<div className="ca-section"><div className="ca-section-label">Per-Topic Performance</div><div className="ca-topic-bars">{[...scores].sort((a, b) => (b[1].correct / Math.max(b[1].total, 1)) - (a[1].correct / Math.max(a[1].total, 1))).map(([topic, s]) => { const p = Math.round((s.correct / Math.max(s.total, 1)) * 100); const col = p >= 70 ? "var(--green)" : p >= 40 ? "var(--orange)" : "var(--red)"; return (<div key={topic} className="ca-topic-bar-row"><span className="ca-topic-bar-name">{topic}</span><div className="ca-topic-bar-track"><div className="ca-topic-bar-fill" style={{ width: `${p}%`, background: col }} /></div><span className="ca-topic-bar-pct" style={{ color: col }}>{p}%</span></div>); })}</div></div>)}
          {strongLines.length > 0 && <div className="ca-section"><div className="ca-section-label"><span className="ca-dot" style={{ background: "var(--green)" }} />Strong Areas</div>{strongLines.map((l, i) => <div key={i} className="ca-list-item ca-strong-item"><span>✓</span><span>{l}</span></div>)}</div>}
          {weakLines.length > 0 && <div className="ca-section"><div className="ca-section-label"><span className="ca-dot" style={{ background: "var(--red)" }} />Needs Work</div>{weakLines.map((l, i) => <div key={i} className="ca-list-item ca-weak-item"><span>◦</span><span>{l}</span></div>)}</div>}
          {planLines.length > 0 && <div className="ca-section"><div className="ca-section-label"><span className="ca-dot" style={{ background: "var(--accent)" }} />Study Plan</div>{planLines.map((l, i) => <div key={i} className="ca-list-item ca-plan-item"><span className="ca-plan-num">{i + 1}</span><span>{l}</span></div>)}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Panel ────────────────────────────────────────────────────────────
function ProfilePanel({ onClose, onNavigateToCourse, currentUser, onSignOut, courses, onCoursesRefresh }) {
  useScrollLock();
  const [courseMeta, setCourseMeta] = useState({});
  const [showAnalysis, setShowAnalysis] = useState(null);
  const [showTestConfirm, setShowTestConfirm] = useState(null);
  const [showFullTest, setShowFullTest] = useState(null);
  const bodyRef = usePanelScrollTop(null);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const entries = await Promise.all(
        courses.map(async (course) => {
          const [progress, testResult] = await Promise.all([
            loadProgress(course.topic, course.level),
            loadTestResult(course.topic, course.level),
          ]);
          return [profileCourseKey(course.topic, course.level), { progress, testResult }];
        })
      );
      if (!cancelled) setCourseMeta(Object.fromEntries(entries));
    };
    hydrate();
    return () => { cancelled = true; };
  }, [courses]);

  const removeCourse = async (course) => {
    await removeProfileCourse(course.topic, course.level);
    onCoursesRefresh?.();
  };

  const handleAnalysisOrTest = async (c) => {
    const testResult = await loadTestResult(c.topic, c.level);
    if (testResult) { setShowAnalysis({ topic: c.topic, level: c.level, testResult }); }
    else { setShowTestConfirm({ topic: c.topic, level: c.level, allTopics: c.allTopics, courseTitle: c.courseTitle }); }
  };

  return (
    <>
      <div className="prof-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="prof-panel">
          <div className="prof-header">
            <div>
              <span className="prof-eyebrow">My Profile</span>
              {currentUser && <div className="prof-user-name">👤 {currentUser.name}</div>}
              <h2 className="prof-title">Saved Courses</h2>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
              {currentUser && (
                <button className="prof-signout-btn" onClick={onSignOut} title="Sign out">Sign Out</button>
              )}
              <button className="qm-close-btn" onClick={onClose}>✕</button>
            </div>
          </div>
          <div className="prof-body" ref={bodyRef}>
            {courses.length === 0
              ? (<div className="prof-empty"><div className="prof-empty-icon">📚</div><div className="prof-empty-title">No courses saved yet</div><div className="prof-empty-sub">Generate a course and tap &quot;Add to Profile&quot; to save it here.</div></div>)
              : (<div className="prof-courses">{courses.map(c => { const key = profileCourseKey(c.topic, c.level); const meta = courseMeta[key] || { progress: [], testResult: null }; const total = c.allTopics?.length || 0; const completed = (meta.progress || []).filter(t => c.allTopics?.includes(t)).length; const pct = total ? Math.round((completed / total) * 100) : 0; const testPct = meta.testResult ? Math.round((meta.testResult.score / meta.testResult.total) * 100) : null; const hasTakenTest = !!meta.testResult; return (<div key={key} className="prof-course-card"><div className="prof-card-top"><div className="prof-card-info"><div className="prof-card-title">{c.courseTitle}</div><div className="prof-card-meta"><span>{c.level}</span><span>·</span><span>{total} topics</span>{hasTakenTest && <><span>·</span><span className="prof-card-tested">Test: {testPct}%</span></>}</div></div><button className="prof-remove-btn" onClick={() => removeCourse(c)} title="Remove">✕</button></div><div className="prof-prog-wrap"><div className="prof-prog-track"><div className="prof-prog-fill" style={{ width: `${pct}%` }} /></div><span className="prof-prog-label">{pct}% complete · {completed}/{total}</span></div><div className="prof-card-actions"><button className="prof-action-btn prof-open-btn" onClick={() => { onClose(); onNavigateToCourse(c); }}>Open Course →</button><button className={`prof-action-btn ${hasTakenTest ? "prof-analysis-btn" : "prof-test-btn"}`} onClick={() => handleAnalysisOrTest(c)}>Get Analysis 📊</button></div></div>); })}</div>)
            }
          </div>
        </div>
      </div>
      {showTestConfirm && (<div className="gate-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowTestConfirm(null); }}><div className="gate-modal"><div className="gate-icon">🎯</div><div className="gate-title">Full Course Test Required</div><div className="gate-sub">Complete the full course test to unlock your personalized analysis.</div><div className="gate-meta"><span>30 MCQs</span><span>·</span><span>One attempt only</span><span>·</span><span>Answers revealed at end</span></div><div className="gate-actions"><button className="gate-cancel-btn" onClick={() => setShowTestConfirm(null)}>Cancel</button><button className="gate-start-btn" onClick={() => { setShowFullTest(showTestConfirm); setShowTestConfirm(null); }}>Give Full Course Test →</button></div></div></div>)}
      {showFullTest && (<FullCourseTestModal courseTopic={showFullTest.topic} level={showFullTest.level} allTopics={showFullTest.allTopics} onClose={() => setShowFullTest(null)} onComplete={async (testResult) => { await saveTestResult(showFullTest.topic, showFullTest.level, testResult); setShowFullTest(null); onCoursesRefresh?.(); }} />)}
      {showAnalysis && (<CourseAnalysisPanel testResult={showAnalysis.testResult} courseTopic={showAnalysis.topic} onClose={() => setShowAnalysis(null)} />)}
    </>
  );
}

// ─── Adaptive ─────────────────────────────────────────────────────────────────
function AdaptiveAlert({ wrongCount, total, onRevisit }) {
  if (wrongCount < 2) return null;
  const isStruggling = wrongCount / Math.max(total, 1) >= 0.6;
  return (<div className={`adaptive-alert ${isStruggling ? "aa-struggling" : "aa-building"}`}><div className="aa-icon">{isStruggling ? "⚠" : "💡"}</div><div className="aa-content"><div className="aa-title">{isStruggling ? `${wrongCount} incorrect — consider revisiting the lesson` : `${wrongCount} wrong — keep going, you're building understanding`}</div><div className="aa-sub">{isStruggling ? "Review core concepts before finishing." : "Read explanations after each wrong answer."}</div></div>{isStruggling && <button className="aa-btn" onClick={onRevisit}>Review Lesson ↩</button>}</div>);
}

function AdaptiveReportCard({ report, loading, score, total, onClose }) {
  if (loading) return <div className="arc-wrap arc-loading"><div className="arc-spinner-row"><span className="spin spin-sm spin-accent" style={{ width: 16, height: 16 }} /><span className="arc-loading-text">Analyzing your performance…</span></div></div>;
  if (!report) return null;
  const pct = Math.round((score / total) * 100);
  const parsed = parseAdaptiveReport(report);
  if (!parsed) return null;
  const confColor = { Struggling: "var(--red)", Building: "var(--orange)", Proficient: "var(--accent)", Mastery: "var(--green)" }[parsed.confidence] || "var(--text2)";
  const confBg = { Struggling: "var(--red-dim)", Building: "var(--orange-dim)", Proficient: "var(--accent-glow)", Mastery: "var(--green-dim)" }[parsed.confidence] || "var(--surface2)";
  const recLines = parsed.recommendations ? parsed.recommendations.split(/\n|(?:^|\n)\s*[-•*]\s*/).map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean) : [];
  const weakLines = parsed.weakAreas && parsed.weakAreas !== "None identified" ? parsed.weakAreas.split(/\n/).map(l => l.replace(/^[-•*\d.]\s*/, "").trim()).filter(Boolean) : [];
  return (<div className="arc-wrap"><div className="arc-header"><div className="arc-header-left"><span className="arc-eyebrow">Adaptive Analysis</span><div className="arc-score-row"><span className="arc-score">{score}/{total}</span><span className="arc-pct">{pct}%</span>{parsed.confidence && <span className="arc-conf-badge" style={{ color: confColor, background: confBg }}>{parsed.confidence}</span>}</div></div><button className="arc-close" onClick={onClose}>✕</button></div>{parsed.summary && <div className="arc-section"><p className="arc-summary">{parsed.summary}</p></div>}{weakLines.length > 0 && <div className="arc-section"><div className="arc-section-label"><span className="arc-label-dot" style={{ background: "var(--red)" }} />Knowledge Gaps</div><div className="arc-weak-list">{weakLines.map((l, i) => <div key={i} className="arc-weak-item"><span className="arc-weak-bullet">◦</span><span>{l}</span></div>)}</div></div>}{recLines.length > 0 && <div className="arc-section"><div className="arc-section-label"><span className="arc-label-dot" style={{ background: "var(--accent)" }} />Recommendations</div><div className="arc-rec-list">{recLines.map((l, i) => <div key={i} className="arc-rec-item"><span className="arc-rec-num">{i + 1}</span><span>{l}</span></div>)}</div></div>}{parsed.nextTopic && parsed.nextTopic !== "None" && <div className="arc-next"><div className="arc-next-label">Suggested next step</div><div className="arc-next-btn"><span className="arc-next-icon">→</span><span>{parsed.nextTopic}</span></div></div>}</div>);
}

// ─── Quiz Modal ───────────────────────────────────────────────────────────────
function QuizModal({ rawQuiz, moduleName, courseTopic, level, allTopics, onClose, onGenerateMore, generating, onRevisitLesson, currentUser, useClassroomData, onRecommendationsUpdate }) {
  useScrollLock();
  const [questions, setQuestions] = useState([]);
  const [selected, setSelected] = useState({});
  const [submitted, setSubmitted] = useState({});
  const [score, setScore] = useState(null);
  const [finished, setFinished] = useState(false);
  const [adaptiveReport, setAdaptiveReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const bodyRef = usePanelScrollTop(rawQuiz);

  useEffect(() => {
    setQuestions(parseQuizText(rawQuiz));
    setSelected({}); setSubmitted({});
    setScore(null); setFinished(false); setAdaptiveReport(null);
  }, [rawQuiz]);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const handleFinish = async () => {
    let correct = 0;
    const results = questions.map((q, i) => {
      const isCorrect = q.correctLetter && selected[i] === q.correctLetter;
      if (isCorrect) correct++;
      const correctOpt = q.options.find(o => o.letter === q.correctLetter);
      return { idx: i, question: q.question, userAnswer: selected[i] || "?", correctAnswer: q.correctLetter, correctText: correctOpt?.text || "", correct: isCorrect };
    });
    setSubmitted(Object.fromEntries(questions.map((_, i) => [i, true])));
    setScore(correct); setFinished(true);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    setReportLoading(true);
    const report = await fetchAdaptiveReport({ questions, results, moduleName, courseTopic, level, allTopics });
    if (currentUser) {
      try {
        const progressUpdate = await updateMasteryProgress({
          course_topic: courseTopic,
          topic: moduleName,
          level,
          score: questions.length ? (correct / questions.length) * 100 : 0,
          total_questions: questions.length,
          use_classroom_data: useClassroomData,
          all_topics: allTopics,
        });
        onRecommendationsUpdate?.(progressUpdate.recommendations, progressUpdate.revision_lesson || null);
      } catch (e) {
        console.error(e);
      }
    }
    setAdaptiveReport(report); setReportLoading(false);
  };

  const answeredCount = Object.keys(selected).length;
  const submittedCount = finished ? questions.length : answeredCount;
  const wrongCount = finished ? questions.filter((q, idx) => selected[idx] !== q.correctLetter).length : 0;
  const allAnswered = questions.length > 0 && questions.every((_, i) => !!selected[i]);
  const pct = questions.length ? (submittedCount / questions.length) * 100 : 0;

  return (
    <div className="qm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qm-panel">
        <div className="qm-header">
          <div className="qm-header-left"><span className="qm-eyebrow">Quiz · Adaptive</span><h2 className="qm-title">{moduleName}</h2></div>
          <div className="qm-header-actions">
            <button className="qm-more-btn" onClick={onGenerateMore} disabled={generating}>{generating ? <><span className="spin spin-sm spin-accent" /> Generating…</> : "New Questions ↻"}</button>
            <button className="qm-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="qm-prog">
          <div className="qm-prog-bar" style={{ width: `${pct}%` }} />
          <div className="qm-prog-meta"><span>{submittedCount}/{questions.length} answered</span>{finished && submittedCount > 0 && <span style={{ color: wrongCount > submittedCount / 2 ? "var(--red)" : "var(--green)" }}>{submittedCount - wrongCount} correct · {wrongCount} wrong</span>}</div>
        </div>
        <div className="qm-body" ref={bodyRef}>
          {finished && <AdaptiveReportCard report={adaptiveReport} loading={reportLoading} score={score} total={questions.length} onClose={() => setAdaptiveReport(null)} />}
          {finished && score !== null && !reportLoading && (<div className={`qm-score-banner ${score === questions.length ? "sb-perfect" : score >= Math.ceil(questions.length / 2) ? "sb-pass" : "sb-fail"}`}><span className="sb-emoji">{score === questions.length ? "🏆" : score >= Math.ceil(questions.length / 2) ? "✓" : "↻"}</span><div className="sb-text"><span className="sb-main">{score}/{questions.length} Correct</span><span className="sb-sub">{score === questions.length ? "Perfect!" : score >= Math.ceil(questions.length / 2) ? "Good job!" : "Keep studying!"}</span></div></div>)}
          <div className="qm-questions" style={{ marginTop: finished ? 16 : 0 }}>
            {questions.map((q, qIdx) => {
              const isSub = !!submitted[qIdx]; const userAns = selected[qIdx]; const correctOpt = q.options.find(o => o.letter === q.correctLetter); const isCorrect = userAns === q.correctLetter;
              return (<div key={qIdx} className={`qm-question ${isSub ? (isCorrect ? "qm-q-correct" : "qm-q-wrong") : ""}`} style={{ animationDelay: `${qIdx * 0.05}s` }}><div className="qm-q-top"><span className="qm-q-num">{String(qIdx + 1).padStart(2, "0")}</span><span className="qm-q-text">{q.question}</span>{isSub && <span className={`qm-q-badge ${isCorrect ? "qb-correct" : "qb-wrong"}`}>{isCorrect ? "✓ Correct" : "✗ Wrong"}</span>}</div><div className="qm-opts">{q.options.map(opt => { const isSel = userAns === opt.letter; const isOptCorrect = opt.letter === q.correctLetter; let cls = "qm-opt"; if (!isSub && isSel) cls += " qo-selected"; if (isSub) { if (isOptCorrect) cls += " qo-correct"; else if (isSel) cls += " qo-wrong"; else cls += " qo-dim"; } return (<button key={opt.letter} className={cls} onClick={() => { if (!finished) setSelected(p => ({ ...p, [qIdx]: opt.letter })); }} disabled={finished}><span className="qo-letter">{opt.letter}</span><span className="qo-text">{opt.text}</span>{isSub && isOptCorrect && <span className="qo-icon qo-icon-ok">✓</span>}{isSub && isSel && !isOptCorrect && <span className="qo-icon qo-icon-bad">✗</span>}</button>); })}</div>{isSub && (<div className={`qm-explanation ${isCorrect ? "qe-correct" : "qe-wrong"}`}><div className="qe-top"><span className="qe-result-label">{isCorrect ? "✓ Correct" : `✗ Incorrect — answer: ${q.correctLetter}) ${correctOpt?.text || q.correctLetter}`}</span>{!isCorrect && <button className="qe-revisit-btn" onClick={() => { onClose(); onRevisitLesson?.(); }}>Revisit Lesson ↩</button>}</div><div className="qe-body"><p className="qe-text qe-fallback">{isCorrect ? "Great work!" : `Review the "${moduleName}" lesson.`}</p></div></div>)}</div>);
            })}
          </div>
        </div>
        {!finished && allAnswered && <div className="qm-footer"><button className="qm-finish-btn" onClick={handleFinish}>Get Adaptive Analysis ↗</button></div>}
      </div>
    </div>
  );
}

// ─── Compact Bar ──────────────────────────────────────────────────────────────
function ClassroomStatusWidget({ visible, onShowNotifications, disclaimerOpen, onToggleDisclaimer }) {
  if (!visible) return null;
  return (
    <div className="classroom-status-wrap">
      <button className="classroom-status-pill classroom-status-pill-btn" onClick={onShowNotifications}>Google Classroom Connected</button>
      <button className="classroom-status-info-btn" onClick={onToggleDisclaimer}>Mock</button>
      {disclaimerOpen && <div className="classroom-status-disclaimer">This is a mock Google Classroom for showing the concept. Real Classroom will be connected soon.</div>}
    </div>
  );
}

function ThemeToggle({ darkMode, onToggle }) {
  return (
    <button className="theme-toggle-btn" onClick={onToggle} title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
      <span>{darkMode ? "Light" : "Dark"}</span>
    </button>
  );
}

function ClassroomLiveToasts({ alerts, visible, resetKey }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!visible) {
      setItems([]);
      return;
    }
    const source = alerts?.length
      ? alerts.map((alert, index) => ({ id: `${alert.assignment || "alert"}-${index}`, message: alert.message }))
      : [
          { id: "fake-deadline", message: "Assignment deadline approaching. Your DSA worksheet is due in 2 days." },
          { id: "fake-exam", message: "Exam reminder. Your Set Theory exam may be in 3 days." },
          { id: "fake-assignment", message: "New study reminder. Please revise Linked Lists tonight." },
        ];
    setItems(source);
  }, [alerts, visible, resetKey]);

  useEffect(() => {
    if (!items.length) return;
    const timers = items.map((item, index) => setTimeout(() => {
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
    }, 6500 + (index * 1200)));
    return () => timers.forEach(clearTimeout);
  }, [items]);

  if (!visible || !items.length) return null;
  return (
    <div className="classroom-live-toasts">
      {items.map((item) => (
        <div key={item.id} className="classroom-live-toast">
          <div className="classroom-live-toast-title">Google Classroom</div>
          <div className="classroom-live-toast-text">{item.message}</div>
          <button className="classroom-live-toast-close" onClick={() => setItems((prev) => prev.filter((entry) => entry.id !== item.id))}>✕</button>
        </div>
      ))}
    </div>
  );
}

function CompactBar({ topic, setTopic, level, setLevel, goal, setGoal, useClassroomData, setUseClassroomData, classroomConnected, onConnectClassroom, classroomLoading, onGenerate, loading, onProfileOpen, profileCount, showClassroomStatus, darkMode, onToggleTheme, onGoHome, onShowNotifications, disclaimerOpen, onToggleDisclaimer }) {
  return (
    <div className="compact-bar">
      <div className="compact-inner">
        <button className="compact-logo-kiri compact-logo-btn" onClick={onGoHome}>KIRIGUMI</button>
        <input className="compact-input" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === "Enter" && onGenerate()} placeholder="What do you want to learn?" />
        <select className="compact-select" value={goal} onChange={e => setGoal(e.target.value)}>
          <option>Exam Preparation</option><option>Deep Learning</option><option>Quick Revision</option>
        </select>
        <select className="compact-select" value={level} onChange={e => setLevel(e.target.value)}>
          <option>Beginner</option><option>Intermediate</option><option>Advanced</option>
        </select>
        <label className="classroom-toggle">
          <input type="checkbox" checked={useClassroomData && classroomConnected} onChange={e => setUseClassroomData(e.target.checked)} disabled={!classroomConnected} />
          <span>Use Classroom Data</span>
        </label>
        {!classroomConnected && <button className="classroom-connect-btn compact-classroom-btn" onClick={onConnectClassroom} disabled={classroomLoading}>{classroomLoading ? "Connecting…" : "Connect Classroom"}</button>}
        <button className="compact-generate-btn" onClick={onGenerate} disabled={loading || !topic.trim()}>{loading ? <span className="spin spin-white" /> : "Build Course"}</button>
        <ClassroomStatusWidget visible={showClassroomStatus} onShowNotifications={onShowNotifications} disclaimerOpen={disclaimerOpen} onToggleDisclaimer={onToggleDisclaimer} />
        <ThemeToggle darkMode={darkMode} onToggle={onToggleTheme} />
        <button className="navbar-profile compact-profile" onClick={onProfileOpen} title="My Profile">
          <span className="navbar-profile-ring" />
          {profileCount > 0 && <span className="navbar-badge">{profileCount}</span>}
        </button>
      </div>
    </div>
  );
}

// ─── Hero Input ───────────────────────────────────────────────────────────────
function HeroInput({ topic, setTopic, level, setLevel, goal, setGoal, useClassroomData, setUseClassroomData, classroomConnected, onConnectClassroom, classroomLoading, onGenerate, loading, onProfileOpen, profileCount, generateError, showClassroomStatus, darkMode, onToggleTheme, onGoHome, onShowNotifications, disclaimerOpen, onToggleDisclaimer }) {
  return (
    <div className="hero-wrap">
      <nav className="navbar">
        <button className="navbar-kiri-logo navbar-kiri-btn" onClick={onGoHome}>KIRIGUMI</button>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ClassroomStatusWidget visible={showClassroomStatus} onShowNotifications={onShowNotifications} disclaimerOpen={disclaimerOpen} onToggleDisclaimer={onToggleDisclaimer} />
          <ThemeToggle darkMode={darkMode} onToggle={onToggleTheme} />
          <button className="navbar-profile" onClick={onProfileOpen} title="My Profile">
            <span className="navbar-profile-ring" />
            {profileCount > 0 && <span className="navbar-badge">{profileCount}</span>}
          </button>
        </div>
      </nav>

      <div className="hero-blob hero-blob-1" /><div className="hero-blob hero-blob-2" />

      <div className="hero-center">
        <div className="hero-shell hero-float hero-float-2">
          <div className="hero-badge">Adaptive AI Learning System</div>
          <h1 className="hero-title hero-brand-title">KIRIGUMI</h1>
          <p className="hero-sub">
            Build a course, track mastery, and let the system recommend what to study next based on performance, behavior, and deadlines.
          </p>

          <div className="hero-form-card">
            <input className="hero-topic-input" type="text" placeholder="Enter a topic, subject, or exam area" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === "Enter" && onGenerate()} autoFocus />

            <div className="hero-controls-row">
              <select className="hero-control" value={goal} onChange={e => setGoal(e.target.value)}>
                <option>Exam Preparation</option><option>Deep Learning</option><option>Quick Revision</option>
              </select>
              <select className="hero-control" value={level} onChange={e => setLevel(e.target.value)}>
                <option>Beginner</option><option>Intermediate</option><option>Advanced</option>
              </select>
            </div>

            <div className="hero-controls-row hero-controls-row-bottom">
              <div className="hero-classroom-toggle-wrap">
                <label className="classroom-toggle hero-classroom-toggle">
                  <input type="checkbox" checked={useClassroomData && classroomConnected} onChange={e => setUseClassroomData(e.target.checked)} disabled={!classroomConnected} />
                  <span>Use Google Classroom Data</span>
                </label>
                <div className="classroom-toggle-note">Used only when Classroom data matches the searched topic.</div>
              </div>
              {!classroomConnected && <button className="classroom-connect-btn" onClick={onConnectClassroom} disabled={classroomLoading}>{classroomLoading ? "Connecting…" : "Connect Google Classroom"}</button>}
            </div>

            <button className="hero-generate-btn" onClick={onGenerate} disabled={loading || !topic.trim()}>
              {loading ? <><span className="spin spin-white" /> Building…</> : "Build Course"}
            </button>
            {generateError && <div className="hero-error">{generateError}</div>}
          </div>

          <div className="hero-guidance-strip">
            <span>Tracks weak topics</span>
            <span>Regenerates revision automatically</span>
            <span>Reorders path by mastery</span>
            <span>Supports exam mode</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Progress Strip ───────────────────────────────────────────────────────────
function ProgressStrip({ completed, total, topic, level }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="prog-strip-wrap">
      <div className="prog-pct-label">{pct}%</div>
      <div className="prog-strip"><div className="prog-bar" style={{ width: `${pct}%` }} /></div>
      <div className="prog-right-meta"><span>{topic}</span><span>{level}</span><span>{completed}/{total} topics</span></div>
    </div>
  );
}

function ClassroomAdvisory({ classroomConnected }) {
  return (
    <div className="classroom-advisory">
      <div className="classroom-advisory-title">
        {classroomConnected ? "Google Classroom Demo Connected" : "Google Classroom Demo"}
      </div>
      <p className="classroom-advisory-text">
        This is currently a simulated Google Classroom integration to demonstrate the concept and usefulness. Live Classroom sync will be added in the next few days.
      </p>
      <p className="classroom-advisory-text">
        Classroom-based prioritization only helps when matching material, assignments, or deadlines exist for your entered topic or subject. If there is no matching classroom material, the course content comes directly from the AI.
      </p>
    </div>
  );
}

function ClassroomSnapshotCard({ classroomData, onConnectClassroom, classroomLoading }) {
  const alerts = classroomData?.alerts || [];
  const assignments = classroomData?.assignments || [];

  return (
    <div className="home-classroom-card">
      <div className="home-classroom-header">
        <div>
          <div className="home-classroom-eyebrow">Google Classroom</div>
          <div className="home-classroom-title">
            {classroomData?.connected ? "Connected classroom snapshot" : "Connect mock classroom data"}
          </div>
        </div>
        {!classroomData?.connected && (
          <button className="classroom-connect-btn" onClick={onConnectClassroom} disabled={classroomLoading}>
            {classroomLoading ? "Connecting…" : "Connect Google Classroom"}
          </button>
        )}
      </div>
      <ClassroomAdvisory classroomConnected={!!classroomData?.connected} />
      {classroomData?.connected && (
        <div className="home-classroom-grid">
          <div className="home-classroom-block">
            <div className="home-classroom-block-label">Urgent Alerts</div>
            {alerts.length > 0
              ? alerts.slice(0, 3).map((alert) => (
                <div key={`${alert.assignment}-${alert.days_until_due}`} className="home-classroom-alert">
                  {alert.message}
                </div>
              ))
              : <div className="home-classroom-empty">No urgent deadlines yet. New alerts will show here automatically.</div>}
          </div>
          <div className="home-classroom-block">
            <div className="home-classroom-block-label">Assignments</div>
            {assignments.length > 0
              ? assignments.slice(0, 3).map((item) => (
                <div key={item.id} className="home-classroom-assignment">
                  <strong>{item.title}</strong>
                  <span>{item.course_name}</span>
                  <span>{item.days_until_due === null ? "No due date" : `Due in ${item.days_until_due} day${item.days_until_due === 1 ? "" : "s"}`}</span>
                </div>
              ))
              : <div className="home-classroom-empty">Assignments and deadlines will show up here after connection.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline Lesson ────────────────────────────────────────────────────────────
function InlineLesson({ lesson, lessonVideos, webResources, webResourcesError, suggestion, isCompleted, onToggleComplete, skipTypewriter, onTyped, onOpenQuiz, hasQuiz }) {
  const { displayed, done: typeDone } = useTypewriter(lesson, 6, skipTypewriter);
  const getYoutubeId = (url) => { if (!url) return null; const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/); return m ? m[1] : null; };
  useEffect(() => { if (typeDone && !skipTypewriter && onTyped) onTyped(); }, [typeDone, skipTypewriter, onTyped]);
  const hasSidebar = lessonVideos.length > 0 || webResources.length > 0 || suggestion;
  return (
    <div className="inline-lesson">
      <div className="il-main">
        <div className="il-eyebrow">Lesson</div>
        {/* White card with pencil-style handwritten text */}
        <div className="il-lesson-card">
          <div className="il-body"><LessonText text={displayed} />{!typeDone && <span className="cursor-blink">▌</span>}</div>
        </div>
        <div className="il-actions">
          <button className={`il-btn ${isCompleted ? "il-btn-done" : "il-btn-complete"}`} onClick={onToggleComplete}>{isCompleted ? "✓ Completed — Undo?" : "Mark Complete"}</button>
          <button className="il-btn il-btn-quiz" onClick={onOpenQuiz}>{hasQuiz ? "Open Quiz ⚡" : "Generate Quiz ⚡"}</button>
        </div>
      </div>
      {hasSidebar && (
        <div className="il-sidebar">
          {suggestion && (
            <>
              <div className="ils-label">Suggestion</div>
              <div className="ils-suggestion-card">
                <LessonText text={suggestion} />
              </div>
            </>
          )}
          <div className="ils-label" style={{ marginTop: suggestion ? 14 : 0 }}>Video Resources</div>
          {lessonVideos.length > 0
            ? <div className="ils-videos">{lessonVideos.slice(0, 3).map((video, i) => { const id = getYoutubeId(video.url || video.link || video); return id ? <div className="ils-video" key={i}><iframe src={`https://www.youtube.com/embed/${id}`} title={`Video ${i + 1}`} allowFullScreen /></div> : null; })}</div>
            : <div className="ils-empty">No video resources found yet.</div>}
          <div className="ils-label" style={{ marginTop: 14 }}>Web Resources</div>
          {webResources.length > 0
            ? (
              <div className="ils-web-list">
                {webResources.slice(0, 5).map((resource, i) => (
                  <a key={`${resource.url}-${i}`} className="ils-web-card" href={resource.url} target="_blank" rel="noreferrer">
                    <div className="ils-web-title">{resource.title}</div>
                    {resource.description && <div className="ils-web-desc">{resource.description}</div>}
                    <div className="ils-web-meta">
                      <strong className="ils-web-meta-label">Source</strong>
                      <span className="ils-web-meta-value">{resource.source || "Web"}</span>
                    </div>
                  </a>
                ))}
              </div>
            )
            : <div className="ils-empty">{webResourcesError || "English web resources will appear here when matches are found."}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Short Task Toast ─────────────────────────────────────────────────────────
function ShortTaskToast({ message, onDismiss }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => { setVisible(false); setTimeout(onDismiss, 400); }, 12000);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  if (!message) return null;
  return (
    <div className={`short-task-toast ${visible ? "stt-visible" : "stt-hidden"}`}>
      <div className="stt-icon">💡</div>
      <div className="stt-content">
        <div className="stt-label">Suggested Activity</div>
        <div className="stt-message">{message}</div>
      </div>
      <button className="stt-close" onClick={() => { setVisible(false); setTimeout(onDismiss, 400); }}>✕</button>
    </div>
  );
}

// ─── Chapter Section ──────────────────────────────────────────────────────────
function ChapterSection({ chapter, chapterIndex, completedLessons, onToggleComplete, lessonCache, typedTopics, topic, level, onOpenQuiz, expandedTopics, onTopicExpand, ensureLessonLoaded, masteryMap, nextRecommended }) {
  const [open, setOpen] = useState(true);
  const [loadingTopics, setLoadingTopics] = useState(new Set());
  const doneCount = chapter.topics.filter(t => completedLessons.includes(t)).length;
  const allDone = doneCount === chapter.topics.length;

  const toggleTopic = async (topicItem) => {
    onTopicExpand(topicItem);
    if (expandedTopics.has(topicItem) || lessonCache.current[topicItem]) return;
    setLoadingTopics(prev => new Set(prev).add(topicItem));
    try {
      await ensureLessonLoaded(topicItem, topic, level);
    } catch (e) { console.error(e); }
    finally { setLoadingTopics(prev => { const n = new Set(prev); n.delete(topicItem); return n; }); }
  };

  const getMasteryBadge = (topicItem) => {
    if (!masteryMap) return null;
    const key = topicItem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const entry = masteryMap[key];
    if (!entry) return null;
    const colors = { weak: { color: "var(--red)", bg: "var(--red-dim)" }, moderate: { color: "var(--orange)", bg: "var(--orange-dim)" }, strong: { color: "var(--green)", bg: "var(--green-dim)" } };
    const c = colors[entry.mastery] || colors.moderate;
    return <span className="t-badge" style={{ color: c.color, background: c.bg, border: `1px solid ${c.color}`, fontWeight: 600 }}>{Math.round(entry.score)}% · {entry.mastery}</span>;
  };

  return (
    <div className={`ch-section ${allDone ? "ch-all-done" : ""}`}>
      <button className="ch-header" onClick={() => setOpen(o => !o)}>
        <span className="ch-num">{allDone ? "✓" : String(chapterIndex + 1).padStart(2, "0")}</span>
        <span className="ch-title">{chapter.title}</span>
        <span className="ch-meta">{doneCount}/{chapter.topics.length}</span>
        <span className="ch-chevron" style={{ transform: open ? "rotate(90deg)" : "rotate(0)" }}>›</span>
      </button>
      {open && (
        <div className="ch-topics">
          {chapter.topics.map((topicItem, idx) => {
            const done = completedLessons.includes(topicItem);
            const isExpanded = expandedTopics.has(topicItem);
            const isLoading = loadingTopics.has(topicItem);
            const cached = lessonCache.current[topicItem];
            const alreadyTyped = typedTopics.current.has(topicItem);
            const isRecommended = nextRecommended && topicItem === nextRecommended;
            return (
              <div key={idx} className="topic-block">
                <div data-topic-name={topicItem} className={`topic-row ${done ? "t-done" : ""} ${isExpanded ? "t-active" : ""} ${isRecommended ? "t-recommended" : ""}`} onClick={() => toggleTopic(topicItem)}>
                  <span className="t-dot">{done ? "✓" : isExpanded ? "▸" : isRecommended ? "→" : "◦"}</span>
                  <span className="t-name">{topicItem}</span>
                  {isRecommended && !done && <span className="t-badge" style={{ color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--accent-mid)", fontWeight: 700, fontSize: "8px" }}>AI RECOMMENDS</span>}
                  {getMasteryBadge(topicItem)}
                  {done && <span className="t-badge done-b">Done</span>}
                  {isLoading && <span className="t-badge loading-b">Loading…</span>}
                  {isExpanded && !done && !isLoading && <span className="t-badge active-b">Open</span>}
                </div>
                {isExpanded && isLoading && <div className="inline-loading"><span className="spin spin-sm" /> Generating lesson…</div>}
                {isExpanded && !isLoading && cached?.lessonError && (
                  <div className="inline-lesson-error">
                    <div className="inline-lesson-error-title">Lesson unavailable right now</div>
                    <div>{cached.lessonError}</div>
                  </div>
                )}
                {isExpanded && !isLoading && cached?.lesson && (
                  <InlineLesson
                    lesson={cached.lesson} lessonVideos={cached.videos || []} webResources={cached.webResources || []} webResourcesError={cached.webResourcesError || ""} suggestion={cached.suggestion || ""}
                    isCompleted={done} onToggleComplete={() => onToggleComplete(topicItem)}
                    skipTypewriter={alreadyTyped} onTyped={() => typedTopics.current.add(topicItem)}
                    onOpenQuiz={() => onOpenQuiz(topicItem)} hasQuiz={!!cached.quiz}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const APP_STATE_KEY = "kirigumi_app_state_v1";
  const THEME_KEY = "kirigumi_theme_v1";
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("Beginner");
  const [goal, setGoal] = useState("Deep Learning");
  const [course, setCourse] = useState(null);
  const [completedLessons, setCompletedLessons] = useState([]);
  const [activeTopic, setActiveTopic] = useState("");
  const [activeLevel, setActiveLevel] = useState("Beginner");
  const [loading, setLoading] = useState(false);
  const [quizModal, setQuizModal] = useState(null);
  const [quizGenerating, setQuizGenerating] = useState(false);
  const [quizTick, setQuizTick] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileCourses, setProfileCourses] = useState([]);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorMessages, setTutorMessages] = useState([]);
  const [expandedTopics, setExpandedTopics] = useState(new Set());

  // Auth state
  const [currentUser, setCurrentUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [recommendations, setRecommendations] = useState(null);
  const [classroomData, setClassroomData] = useState(null);
  const [classroomLoading, setClassroomLoading] = useState(false);
  const [useClassroomData, setUseClassroomData] = useState(false);
  const [classroomInfoOpen, setClassroomInfoOpen] = useState(false);
  const [classroomToastTick, setClassroomToastTick] = useState(0);
  const [revisionAlert, setRevisionAlert] = useState(null);
  const [showExamMode, setShowExamMode] = useState(false);
  const [shortTaskToast, setShortTaskToast] = useState(null);
  const [darkMode, setDarkMode] = useState(false);

  // Dark mode: default is false (light/cyan theme)
  const lessonCache = useRef({});
  const typedTopics = useRef(new Set());
  const [viewState, setViewState] = useState("home");

  const getTotalTopics = (c) => c?.chapters?.reduce((a, ch) => a + ch.topics.length, 0) ?? 0;
  const getAllTopics = (c) => c?.chapters?.flatMap(ch => ch.topics) ?? [];

  // Build mastery lookup map from recommendations
  const masteryMap = useMemo(() => {
    if (!recommendations) return null;
    const map = {};
    const addEntries = (list, mastery) => {
      if (!Array.isArray(list)) return;
      list.forEach(item => {
        const name = typeof item === "string" ? item : item?.topic || item?.name || "";
        const score = typeof item === "object" ? (item?.score ?? item?.avg_score ?? 0) : 0;
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (key) map[key] = { mastery, score: score || (mastery === "weak" ? 40 : mastery === "moderate" ? 70 : 90) };
      });
    };
    addEntries(recommendations.weak_topics, "weak");
    addEntries(recommendations.moderate_topics, "moderate");
    addEntries(recommendations.strong_topics, "strong");
    return Object.keys(map).length > 0 ? map : null;
  }, [recommendations]);

  const nextRecommended = recommendations?.next_recommended_step || null;
  const showClassroomStatus = !!currentUser && !!classroomData?.connected;

  const handleTopicExpand = useCallback((topicItem) => {
    setExpandedTopics(prev => {
      const n = new Set(prev);
      n.has(topicItem) ? n.delete(topicItem) : n.add(topicItem);
      return n;
    });
  }, []);

  const ensureLessonLoaded = useCallback(async (topicItem, courseTopicArg = activeTopic, courseLevelArg = activeLevel) => {
    if (!topicItem) return;
    if (lessonCache.current[topicItem]) return;
    const [lessonRes, videoRes, webRes, suggestionRes] = await Promise.allSettled([
      axios.post(`${API_BASE}/generate-lesson`, { topic: courseTopicArg, module: topicItem, level: courseLevelArg, goal }),
      axios.get(`${API_BASE}/youtube-resources`, { params: { topic: topicItem, level: courseLevelArg } }),
      axios.get(`${API_BASE}/web-resources`, { params: { topic: topicItem, level: courseLevelArg } }),
      axios.post(`${API_BASE}/generate-study-suggestion`, {
        course_topic: courseTopicArg,
        module_name: topicItem,
        level: courseLevelArg,
      }),
    ]);

    const lessonFailed = lessonRes.status === "rejected";
    const lessonText = lessonRes.status === "fulfilled" ? lessonRes.value.data.lesson : "";
    const lessonError = lessonFailed ? getErrorMessage(lessonRes.reason, "Could not generate this lesson right now. Please try opening it again.") : "";

    lessonCache.current[topicItem] = {
      lesson: lessonText,
      lessonError,
      videos: videoRes.status === "fulfilled" ? (videoRes.value.data.videos || []) : [],
      webResources: webRes.status === "fulfilled" ? (webRes.value.data.articles || []) : [],
      webResourcesError: webRes.status === "fulfilled" ? (webRes.value.data.error || "") : "Unable to load web resources right now.",
      suggestion: suggestionRes.status === "fulfilled" ? (suggestionRes.value.data.suggestion || "") : "",
      quiz: lessonCache.current[topicItem]?.quiz || null,
    };
  }, [activeTopic, activeLevel, goal]);

  const openTopicByName = useCallback(async (topicItem) => {
    if (!course || !topicItem) return;
    try {
      await ensureLessonLoaded(topicItem);
      setExpandedTopics(new Set([topicItem]));
      setTimeout(() => {
        const el = document.querySelector(`[data-topic-name="${CSS.escape(topicItem)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    } catch (e) {
      console.error(e);
    }
  }, [course, ensureLessonLoaded]);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_KEY);
      if (savedTheme === "dark") setDarkMode(true);
      const rawState = window.localStorage.getItem(APP_STATE_KEY);
      if (rawState) {
        const saved = JSON.parse(rawState);
        setTopic(saved.topic || "");
        setLevel(saved.level || "Beginner");
        setGoal(saved.goal || "Deep Learning");
        setUseClassroomData(!!saved.useClassroomData);
        if (saved.view === "course" && saved.courseData) {
          setCourse(saved.courseData);
          setActiveTopic(saved.activeTopic || saved.topic || "");
          setActiveLevel(saved.activeLevel || saved.level || "Beginner");
          setRecommendations(saved.recommendations || saved.courseData.recommendations || null);
          setViewState("course");
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const restoreSession = async () => {
      const session = await loadSession();
      if (session) setCurrentUser(session);
      setAuthLoading(false);
    };
    restoreSession();
  }, []);

  const refreshProfileCourses = useCallback(async () => {
    if (!currentUser) {
      setProfileCourses([]);
      return;
    }
    const courses = await loadProfile();
    setProfileCourses(courses);
  }, [currentUser]);

  const refreshRecommendations = useCallback(async (courseTopic, courseLevel, topics, shouldUseClassroom = useClassroomData) => {
    if (!currentUser || !courseTopic || !topics?.length) return null;
    try {
      const data = await loadRecommendations({
        course_topic: courseTopic,
        level: courseLevel,
        all_topics: topics,
        use_classroom_data: shouldUseClassroom,
      });
      setRecommendations(data);
      return data;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [currentUser, useClassroomData]);

  const handleConnectClassroom = useCallback(async () => {
    if (!currentUser) {
      setShowAuth(true);
      return;
    }
    setClassroomLoading(true);
    try {
      const data = await connectClassroom(topic || activeTopic || "General Studies");
      setClassroomData(data);
      setUseClassroomData(true);
      setClassroomInfoOpen(true);
      setClassroomToastTick((prev) => prev + 1);
      if (course && activeTopic) {
        await refreshRecommendations(activeTopic, activeLevel, getAllTopics(course), true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setClassroomLoading(false);
    }
  }, [currentUser, topic, activeTopic, activeLevel, course, refreshRecommendations]);

  useEffect(() => {
    refreshProfileCourses();
  }, [refreshProfileCourses]);

  useEffect(() => {
    const hydrateClassroom = async () => {
      if (!currentUser) {
        setClassroomData(null);
        setUseClassroomData(false);
        return;
      }
      try {
        const data = await loadClassroomData();
        setClassroomData(data);
      } catch {
        setClassroomData(null);
      }
    };
    hydrateClassroom();
  }, [currentUser]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, darkMode ? "dark" : "light");
      window.localStorage.setItem(APP_STATE_KEY, JSON.stringify({
        view: course ? "course" : "home",
        topic,
        level,
        goal,
        activeTopic,
        activeLevel,
        useClassroomData,
        courseData: course,
        recommendations,
      }));
    } catch {}
  }, [APP_STATE_KEY, THEME_KEY, darkMode, topic, level, goal, activeTopic, activeLevel, useClassroomData, course, recommendations]);

  useEffect(() => {
    if (!course || !activeTopic) return;
    if (!currentUser) {
      setCompletedLessons([]);
      return;
    }
    let cancelled = false;
    const restoreProgress = async () => {
      const progress = await loadProgress(activeTopic, activeLevel);
      if (!cancelled) setCompletedLessons(progress);
    };
    restoreProgress();
    return () => { cancelled = true; };
  }, [course, activeTopic, activeLevel, currentUser]);

  useEffect(() => {
    if (!course || !activeTopic || !currentUser) return;
    if (recommendations) return;
    refreshRecommendations(activeTopic, activeLevel, getAllTopics(course), useClassroomData);
  }, [course, activeTopic, activeLevel, currentUser, useClassroomData, recommendations, refreshRecommendations]);

  // Browser back/forward — FIX 3
  useEffect(() => {
    const onPopState = (e) => {
      const state = e.state;
      if (!state || state.view === "home") {
        setCourse(null); setViewState("home"); setQuizModal(null); setTutorOpen(false);
        setRecommendations(null); setRevisionAlert(null);
        setExpandedTopics(new Set());
        lessonCache.current = {}; typedTopics.current = new Set();
      } else if (state.view === "course" && state.courseData) {
        setTopic(state.topic); setLevel(state.level); setGoal(state.goal || "Deep Learning");
        setUseClassroomData(!!state.useClassroomData);
        setActiveTopic(state.activeTopic || state.topic); setActiveLevel(state.activeLevel || state.level);
        setCourse(state.courseData); setViewState("course"); setQuizModal(null);
        setRecommendations(state.recommendations || state.courseData.recommendations || null);
        setExpandedTopics(new Set());
        lessonCache.current = {}; typedTopics.current = new Set();
      }
    };
    window.addEventListener("popstate", onPopState);
    if (!window.history.state) {
      window.history.replaceState(
        course
          ? { view: "course", topic, level, goal, activeTopic, activeLevel, useClassroomData, courseData: course, recommendations }
          : { view: "home" },
        "",
        window.location.pathname
      );
    }
    return () => window.removeEventListener("popstate", onPopState);
  }, [course, topic, level, goal, activeTopic, activeLevel, useClassroomData, recommendations]);

  const toggleLessonComplete = useCallback((moduleTitle) => {
    setCompletedLessons(prev => {
      const updated = prev.includes(moduleTitle) ? prev.filter(t => t !== moduleTitle) : [...prev, moduleTitle];
      if (currentUser) saveProgress(activeTopic, activeLevel, updated).catch(() => {});
      return updated;
    });
    if (currentUser && course) {
      setTimeout(() => {
        refreshRecommendations(activeTopic, activeLevel, getAllTopics(course), useClassroomData);
      }, 0);
    }
  }, [activeTopic, activeLevel, currentUser, course, refreshRecommendations, useClassroomData]);

  const isInProfile = course ? profileCourses.some(c => profileCourseKey(c.topic, c.level) === profileCourseKey(activeTopic, activeLevel)) : false;

  const addToProfile = async () => {
    if (!currentUser) { setShowAuth(true); return; }
    if (!course || isInProfile) return;
    const entry = { topic: activeTopic, level: activeLevel, courseTitle: course.course_title, allTopics: getAllTopics(course), addedAt: Date.now() };
    try {
      await saveProfile(entry);
      await refreshProfileCourses();
    } catch (e) {
      console.error(e);
    }
  };

  const generateCourse = async () => {
    if (!topic.trim()) return;
    setLoading(true); setCourse(null); setQuizModal(null); setViewState("home");
    setTutorMessages([]); setExpandedTopics(new Set());
    setRevisionAlert(null); setShortTaskToast(null);
    setGenerateError("");
    lessonCache.current = {}; typedTopics.current = new Set();
    try {
      const res = await axios.post(`${API_BASE}/generate-course`, { topic, level, goal, use_classroom_data: useClassroomData });
      const courseData = res.data;
      setActiveTopic(topic.trim()); setActiveLevel(level); setCourse(courseData); setViewState("course");
      const recs = courseData.recommendations || null;
      setRecommendations(recs);
      window.history.pushState({ view: "course", topic: topic.trim(), level, goal, activeTopic: topic.trim(), activeLevel: level, useClassroomData, courseData, recommendations: recs }, "", window.location.pathname);
      // Auto-scroll to recommended topic after render
      if (recs?.next_recommended_step) {
        setTimeout(() => {
          const el = document.querySelector(`[data-topic-name="${CSS.escape(recs.next_recommended_step)}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 600);
      }
      // Show short-task toast if returned
      if (recs?.short_task) setShortTaskToast(recs.short_task);
    } catch (e) {
      console.error(e);
      setGenerateError(getErrorMessage(e, "Could not generate the course right now. Please try again."));
    }
    finally { setLoading(false); }
  };

  const generateQuizFor = async (moduleTitle) => {
    setQuizGenerating(true);
    try {
      const res = await axios.post(`${API_BASE}/generate-quiz`, { topic, module: moduleTitle, level });
      if (!lessonCache.current[moduleTitle]) lessonCache.current[moduleTitle] = { lesson: "", videos: [], webResources: [], suggestion: "", quiz: null };
      lessonCache.current[moduleTitle].quiz = res.data.quiz;
      setQuizTick(t => t + 1);
    } catch (e) { console.error(e); }
    finally { setQuizGenerating(false); }
  };

  const openQuiz = async (moduleTitle) => {
    setQuizModal({ moduleTitle });
    if (!lessonCache.current[moduleTitle]?.quiz) await generateQuizFor(moduleTitle);
  };

  const handleNavigateToCourse = async (savedCourse) => {
    setLoading(true); setTopic(savedCourse.topic); setLevel(savedCourse.level);
    setTutorMessages([]); setExpandedTopics(new Set());
    setRevisionAlert(null);
    lessonCache.current = {}; typedTopics.current = new Set();
    try {
      const res = await axios.post(`${API_BASE}/generate-course`, { topic: savedCourse.topic, level: savedCourse.level, goal, use_classroom_data: useClassroomData });
      const courseData = res.data;
      setActiveTopic(savedCourse.topic); setActiveLevel(savedCourse.level);
      setCourse(courseData); setViewState("course");
      const recs = courseData.recommendations || null;
      setRecommendations(recs);
      window.history.pushState({ view: "course", topic: savedCourse.topic, level: savedCourse.level, goal, activeTopic: savedCourse.topic, activeLevel: savedCourse.level, useClassroomData, courseData, recommendations: recs }, "", window.location.pathname);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleGoHome = useCallback(() => {
    setCourse(null);
    setViewState("home");
    setQuizModal(null);
    setTutorOpen(false);
    setRecommendations(null);
    setRevisionAlert(null);
    setExpandedTopics(new Set());
    lessonCache.current = {};
    typedTopics.current = new Set();
    window.history.pushState({ view: "home" }, "", window.location.pathname);
  }, []);

  const handleDownloadFullCourse = async () => {
    if (!course || pdfDownloading) return;
    const printWin = window.open("", "_blank", "width=800,height=900");
    if (!printWin) {
      alert("Please allow pop-ups to download PDF.");
      return;
    }
    printWin.document.write("<!DOCTYPE html><html><head><title>Preparing PDF</title></head><body style=\"font-family:Arial,sans-serif;padding:32px;color:#111\">Preparing your full course PDF…</body></html>");
    printWin.document.close();
    setPdfDownloading(true);
    try {
      let text = `COURSE: ${course.course_title}\n${"=".repeat(70)}\n\n`;
      text += `Topic: ${activeTopic}\nLevel: ${activeLevel}\n\n`;

      let lessonNumber = 0;
      const totalLessonCount = course.chapters.reduce((sum, chapter) => sum + chapter.topics.length, 0);

      for (let ci = 0; ci < course.chapters.length; ci++) {
        const chapter = course.chapters[ci];
        text += `CHAPTER ${ci + 1}: ${chapter.title}\n${"-".repeat(70)}\n\n`;

        for (let ti = 0; ti < chapter.topics.length; ti++) {
          const topicItem = chapter.topics[ti];
          lessonNumber += 1;

          try {
            if (printWin.document?.body) {
              printWin.document.body.innerHTML = `<div style="font-family:Arial,sans-serif;padding:32px;color:#111">
                <h2 style="margin:0 0 12px">Preparing your full course PDF…</h2>
                <p style="margin:0 0 8px">Loading lesson ${lessonNumber} of ${totalLessonCount}</p>
                <p style="margin:0;color:#555">${topicItem}</p>
              </div>`;
            }
          } catch {}

          let lessonText = lessonCache.current[topicItem]?.lesson;
          if (!lessonText) {
            const lessonRes = await axios.post(`${API_BASE}/generate-lesson`, {
              topic: activeTopic,
              module: topicItem,
              level: activeLevel,
            });
            lessonText = lessonRes.data.lesson || "";
            lessonCache.current[topicItem] = {
              ...(lessonCache.current[topicItem] || { videos: [], webResources: [], suggestion: "", quiz: null }),
              lesson: lessonText,
            };
          }

          text += `${ci + 1}.${ti + 1} ${topicItem}\n\n${lessonText}\n\n\n`;
        }
      }

      downloadContentAsPDF(`${course.course_title} — Full Course`, text, printWin);
    } catch (e) {
      console.error(e);
      printWin.close();
      alert(`Could not generate the full course PDF right now. ${getErrorMessage(e, "Please try again.")}`);
    } finally {
      setPdfDownloading(false);
    }
  };

  const totalTopics = getTotalTopics(course);
  const currentQuizText = quizModal ? lessonCache.current[quizModal.moduleTitle]?.quiz : null;
  const showHome = !course && !loading && !authLoading;
  const showCourse = course && !loading && !authLoading;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500&family=DM+Serif+Display:ital@0;1&family=Kalam:wght@400;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

        /* ══ THEME VARIABLES ══ */
        /* Default = LIGHT / CYAN mode */
        :root {
          --bg: #f0faff;
          --bg2: #e0f4fc;
          --surface: rgba(0,0,0,0.04);
          --surface2: rgba(0,0,0,0.07);
          --border: rgba(0,0,0,0.09);
          --border2: rgba(0,0,0,0.16);
          --text: #0a1a24;
          --text2: #2a5a72;
          --text3: #5a8aa0;
          --accent: #0891b2;
          --accent-mid: #06b6d4;
          --accent-light: #22d3ee;
          --accent-glow: rgba(8,145,178,0.3);
          --accent-glow2: rgba(6,182,212,0.15);
          --accent-dim: rgba(8,145,178,0.12);
          --orange: #f97316;
          --orange-dim: rgba(249,115,22,0.12);
          --logo-blue: #0d5ea8;
          --green: #10b981; --green-dim: rgba(16,185,129,0.14);
          --red: #ef4444; --red-dim: rgba(239,68,68,0.14);
          --blue: #38bdf8; --blue-dim: rgba(56,189,248,0.12);
          --ff-head: 'Outfit', sans-serif;
          --ff-chapter: 'DM Serif Display', serif;
          --ff-body: 'Outfit', sans-serif;
          --ff-mono: 'IBM Plex Mono', monospace;
          --ff-hand: 'Kalam', cursive;
          --ease: cubic-bezier(0.22,1,0.36,1);
          --ease2: cubic-bezier(0.16,1,0.3,1);
          /* hero bg in light mode: cyan→white gradient */
          --hero-bg: linear-gradient(160deg, #cff5fc 0%, #e8f8ff 40%, #ffffff 100%);
        }

        /* Dark mode overrides */
        body.dark-mode {
          --bg: #07111b;
          --bg2: #0d1c2b;
          --surface: rgba(255,255,255,0.04);
          --surface2: rgba(255,255,255,0.07);
          --border: rgba(255,255,255,0.08);
          --border2: rgba(255,255,255,0.14);
          --text: #eef8ff;
          --text2: #94b8cc;
          --text3: #5d7f91;
          --accent: #14b8a6;
          --accent-mid: #22d3ee;
          --accent-light: #67e8f9;
          --accent-glow: rgba(34,211,238,0.22);
          --accent-glow2: rgba(20,184,166,0.14);
          --accent-dim: rgba(34,211,238,0.12);
          --orange: #fb923c;
          --orange-dim: rgba(251,146,60,0.12);
          --logo-blue: #22d3ee;
          --green: #22d3a0; --green-dim: rgba(34,211,160,0.14);
          --red: #f87171; --red-dim: rgba(248,113,113,0.14);
          --blue: #60a5fa; --blue-dim: rgba(96,165,250,0.12);
          --hero-bg: #07111b;
        }

        html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
        body {
          font-family: var(--ff-body);
          color: var(--text);
          min-height: 100vh;
          overflow-x: hidden;
          background: var(--bg);
          transition: background 0.4s ease, color 0.4s ease;
        }
        button,input,select,textarea { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }

        /* ══ BLOCK WIPE TRANSITION ══ */
        .theme-wipe {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: 0;
          background: var(--accent);
          z-index: 9999;
          pointer-events: none;
          transition: height 0.5s cubic-bezier(0.4,0,0.2,1);
        }
        .theme-wipe.active { height: 100vh; }

        /* ══ THEME TOGGLE BUTTON ══ */
        .theme-toggle {
          width: 38px; height: 38px;
          border-radius: 50%;
          border: 2px solid var(--accent-mid);
          background: var(--accent-dim);
          color: var(--accent);
          font-size: 1.1rem;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
          flex-shrink: 0;
        }
        .theme-toggle:hover {
          background: var(--accent-mid);
          color: #fff;
          transform: scale(1.08);
          box-shadow: 0 4px 14px var(--accent-glow);
        }

        /* ══ NAVBAR (hero) ══ */
        .navbar {
          position: fixed; top: 0; left: 0; right: 0; z-index: 200;
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 28px;
          background: transparent;
          pointer-events: none;
          gap: 10px;
        }
        .navbar > * { pointer-events: all; }

        /* Navbar KIRIGUMI text logo — top-left, moderate size */
        .navbar-kiri-logo {
          font-family: var(--ff-head);
          font-weight: 850;
          font-size: .95rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--orange);
          pointer-events: all;
          user-select: none;
          text-shadow: none;
        }
        .navbar-kiri-btn,
        .compact-logo-btn {
          background: transparent;
          border: none;
          cursor: pointer;
        }

        .navbar-profile {
          position: relative; width: 42px; height: 42px; border-radius: 50%;
          background: var(--accent-dim);
          border: 2px solid var(--accent-mid);
          cursor: pointer; pointer-events: all;
          transition: background 0.2s, border-color 0.2s, transform 0.15s;
          display: flex; align-items: center; justify-content: center;
        }
        .navbar-profile:hover { background: var(--accent-glow2); border-color: var(--accent); transform: scale(1.06); }
        .navbar-profile-ring {
          width: 22px; height: 22px; border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, var(--accent-light), var(--accent));
          box-shadow: 0 0 12px var(--accent-glow);
        }
        .navbar-badge {
          position: absolute; top: -4px; right: -4px;
          width: 18px; height: 18px; border-radius: 50%;
          background: var(--orange); color: #fff;
          font-family: var(--ff-mono); font-size: 9px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          border: 2px solid var(--bg);
        }
        .classroom-status-wrap {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .classroom-status-pill {
          padding: 9px 12px;
          border-radius: 999px;
          background: var(--green-dim);
          color: var(--green);
          border: 1px solid rgba(16,185,129,.22);
          font-family: var(--ff-mono);
          font-size: 9px;
          letter-spacing: .08em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .classroom-status-pill-btn,
        .classroom-status-info-btn {
          cursor: pointer;
        }
        .classroom-status-pill-btn {
          border: 1px solid rgba(16,185,129,.22);
        }
        .classroom-status-info-btn {
          padding: 9px 10px;
          border-radius: 999px;
          border: 1px solid var(--orange);
          background: var(--orange-dim);
          color: var(--orange);
          font-family: var(--ff-mono);
          font-size: 9px;
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .classroom-status-disclaimer {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          width: min(270px, 76vw);
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,.96);
          color: var(--text2);
          line-height: 1.6;
          box-shadow: 0 18px 44px rgba(8,145,178,.12);
          z-index: 20;
        }
        body.dark-mode .classroom-status-disclaimer {
          background: rgba(8,18,28,.96);
        }
        .theme-toggle-btn {
          min-width: 84px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid var(--border2);
          background: rgba(255,255,255,.78);
          color: var(--text);
          font-family: var(--ff-mono);
          font-size: 10px;
          letter-spacing: .12em;
          text-transform: uppercase;
          cursor: pointer;
          transition: transform .16s ease, border-color .2s ease, background .2s ease;
        }
        .theme-toggle-btn:hover {
          transform: translateY(-1px);
          border-color: var(--accent);
        }
        body.dark-mode .theme-toggle-btn {
          background: rgba(255,255,255,.06);
          color: #f4fbff;
        }

        /* ══ HERO ══ */
        @keyframes heroIn { from { opacity:0; transform:translateY(28px); } to { opacity:1; transform:none; } }
        @keyframes heroFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes heroTextIn { from{opacity:0;transform:translateY(26px)} to{opacity:1;transform:translateY(0)} }
        @keyframes blobDrift1 { 0%{transform:translate(0,0) scale(1)} 100%{transform:translate(60px,40px) scale(1.1)} }
        @keyframes blobDrift2 { 0%{transform:translate(0,0) scale(1)} 100%{transform:translate(-50px,-30px) scale(1.08)} }
        @keyframes blobDrift3 { 0%{transform:translate(-50%,-50%) scale(1)} 100%{transform:translate(-50%,-50%) scale(1.15)} }
        @keyframes kirigumiIn { from{opacity:0;letter-spacing:0.05em;} to{opacity:1;letter-spacing:clamp(0.3em,3vw,0.7em);} }
        @keyframes marqueeSlide { from{transform:translateX(0)} to{transform:translateX(-50%)} }

        .hero-wrap {
          min-height: 100vh;
          display: flex; flex-direction: column;
          position: relative; overflow: hidden;
          background:
            radial-gradient(circle at top left, rgba(34,211,238,.16), transparent 36%),
            linear-gradient(180deg, #f7fcff 0%, #eef8fd 52%, #ffffff 100%);
        }
        body.dark-mode .hero-wrap {
          background:
            radial-gradient(circle at top left, rgba(45,212,191,.14), transparent 34%),
            radial-gradient(circle at bottom right, rgba(249,115,22,.12), transparent 30%),
            linear-gradient(180deg, #07111b 0%, #0a1522 45%, #0d1c2b 100%);
        }
        .hero-blob { position:absolute; border-radius:50%; pointer-events:none; filter:blur(90px); }
        .hero-blob-1 {
          width:420px; height:420px;
          background: radial-gradient(circle, rgba(8,145,178,.14) 0%, transparent 70%);
          top:-80px; left:-80px;
          animation: blobDrift1 14s ease-in-out infinite alternate;
        }
        body.dark-mode .hero-blob-1 { background: radial-gradient(circle, rgba(57,160,255,.16) 0%, transparent 70%); }
        .hero-blob-2 {
          width:320px; height:320px;
          background: radial-gradient(circle, rgba(6,182,212,.09) 0%, transparent 70%);
          bottom:-50px; right:-50px;
          animation: blobDrift2 17s ease-in-out infinite alternate;
        }
        body.dark-mode .hero-blob-2 { background: radial-gradient(circle, rgba(57,160,255,.12) 0%, transparent 70%); }

        .hero-center {
          flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
          padding: 96px 24px 60px;
          position:relative; z-index:1;
          animation: heroIn .9s var(--ease2) both;
        }
        .hero-float { opacity:0; animation:heroTextIn 1s var(--ease2) forwards; }
        .hero-float-1 { animation-delay:.08s; }
        .hero-float-2 { animation-delay:.18s; }
        .hero-float-3 { animation-delay:.3s; }
        .hero-float-4 { animation-delay:.42s; }
        .hero-float-5 { animation-delay:.56s; }

        .hero-shell {
          width:min(760px, calc(100vw - 32px));
          text-align:center;
        }
        .hero-badge {
          display:inline-flex;
          padding:8px 14px;
          border-radius:999px;
          border:1px solid rgba(8,145,178,.18);
          background:rgba(255,255,255,.72);
          color:var(--accent);
          font-family:var(--ff-mono);
          font-size:10px;
          letter-spacing:.14em;
          text-transform:uppercase;
          margin-bottom:18px;
        }
        body.dark-mode .hero-badge { background:rgba(255,255,255,.04); }
        .hero-title {
          font-family: var(--ff-head);
          font-size: clamp(2.2rem, 5.6vw, 4.4rem);
          line-height: 1.05;
          letter-spacing: -.04em;
          color: var(--text);
          margin-bottom: 16px;
        }
        .hero-brand-title {
          font-size: clamp(3.1rem, 9vw, 6.2rem);
          letter-spacing: .16em;
          text-transform: uppercase;
          color: var(--orange);
          font-weight: 850;
          text-shadow: 0 14px 34px rgba(249,115,22,.14);
        }
        body.dark-mode .hero-brand-title {
          color: transparent;
          background: linear-gradient(135deg, var(--orange), var(--accent), #22d3ee);
          -webkit-background-clip: text;
          background-clip: text;
          text-shadow: 0 14px 34px rgba(8,145,178,.12);
        }
        .hero-sub {
          font-size: 1rem;
          color: var(--text2);
          text-align: center;
          line-height: 1.75;
          margin: 0 auto 28px;
          max-width: 700px;
        }
        .hero-form-card {
          display:flex;
          flex-direction:column;
          gap:14px;
          padding:20px;
          border-radius:24px;
          border:1px solid rgba(8,145,178,.2);
          background:rgba(255,255,255,.84);
          box-shadow:0 24px 70px rgba(8,145,178,.09);
          backdrop-filter: blur(16px);
        }
        body.dark-mode .hero-form-card {
          background:rgba(12,18,32,.9);
          border-color:rgba(57,160,255,.2);
          box-shadow:0 24px 70px rgba(0,0,0,.24);
        }
        .hero-topic-input {
          width:100%;
          padding:18px 20px;
          border-radius:18px;
          border:1px solid var(--border2);
          background:var(--bg);
          color:var(--text);
          font-family:var(--ff-body);
          font-size:1rem;
          outline:none;
        }
        .hero-topic-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
        .hero-controls-row {
          display:grid;
          grid-template-columns:repeat(2, minmax(0, 1fr));
          gap:12px;
        }
        .hero-controls-row-bottom {
          grid-template-columns: 1fr auto;
          align-items:center;
        }
        .hero-control {
          width:100%;
          min-height:48px;
          border-radius:14px;
          border:1px solid var(--border);
          background:var(--surface);
          color:var(--text);
          font-family:var(--ff-body);
          font-size:.95rem;
          padding:0 14px;
          outline:none;
        }
        .hero-control option { background: var(--bg); }
        .classroom-toggle {
          display:flex; align-items:center; gap:8px; flex-shrink:0;
          padding:13px 14px; border:1px solid var(--border); border-radius:14px;
          background:var(--surface); color:var(--text2); font-size:.92rem;
          min-height:48px;
        }
        .classroom-toggle input { accent-color: var(--accent); }
        .hero-classroom-toggle { width:100%; justify-content:flex-start; }
        .hero-classroom-toggle-wrap { display:flex; flex-direction:column; gap:6px; width:100%; }
        .classroom-toggle-note {
          padding-left: 2px;
          color: var(--text3);
          font-size: .78rem;
          line-height: 1.4;
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .classroom-connect-btn {
          flex-shrink:0; border:1px solid var(--orange); background:var(--orange-dim);
          color:var(--orange); border-radius:14px; padding:13px 16px; cursor:pointer;
          font-family:var(--ff-mono); font-size:10px; letter-spacing:.08em; text-transform:uppercase;
        }
        .classroom-connect-btn:disabled { opacity:.6; cursor:not-allowed; }
        .hero-generate-btn {
          width:100%;
          min-height:54px;
          border:none;
          border-radius:16px;
          background:linear-gradient(135deg, var(--accent), var(--accent-mid));
          color:#fff;
          font-family:var(--ff-head);
          font-size:1rem;
          font-weight:800;
          cursor:pointer;
          transition:transform .15s, box-shadow .2s, opacity .2s;
        }
        .hero-generate-btn:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 14px 30px var(--accent-glow); }
        .hero-generate-btn:disabled { opacity:.55; cursor:not-allowed; }
        .hero-error {
          border:1px solid rgba(239,68,68,.24);
          background:rgba(239,68,68,.08);
          color:var(--red);
          border-radius:14px;
          padding:12px 14px;
          line-height:1.6;
          text-align:left;
          font-size:.92rem;
        }
        .hero-guidance-strip {
          display:flex;
          flex-wrap:wrap;
          justify-content:center;
          gap:10px 18px;
          margin-top:18px;
          color:var(--text3);
          font-family:var(--ff-mono);
          font-size:10px;
          letter-spacing:.12em;
          text-transform:uppercase;
        }
        .home-lower-wrap {
          max-width:1100px;
          margin:0 auto;
          padding:0 24px 40px;
          position:relative;
          z-index:1;
        }
        .classroom-live-toasts {
          position: fixed;
          top: 96px;
          right: 24px;
          z-index: 80;
          display: flex;
          flex-direction: column;
          gap: 12px;
          pointer-events: none;
        }
        .classroom-live-toast {
          position: relative;
          width: min(320px, calc(100vw - 32px));
          padding: 14px 42px 14px 16px;
          border-radius: 16px;
          border: 1px solid rgba(8,145,178,.18);
          background: rgba(255,255,255,.94);
          box-shadow: 0 20px 50px rgba(8,145,178,.14);
          pointer-events: auto;
          animation: toastSlideIn .55s var(--ease2) both;
        }
        body.dark-mode .classroom-live-toast {
          background: rgba(8,18,28,.94);
          border-color: rgba(34,211,238,.16);
          box-shadow: 0 20px 50px rgba(0,0,0,.3);
        }
        .classroom-live-toast-title {
          font-family: var(--ff-mono);
          font-size: 9px;
          letter-spacing: .18em;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 6px;
        }
        .classroom-live-toast-text {
          color: var(--text);
          line-height: 1.55;
          font-size: .9rem;
        }
        .classroom-live-toast-close {
          position: absolute;
          top: 10px;
          right: 10px;
          border: none;
          background: transparent;
          color: var(--text3);
          cursor: pointer;
        }
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(42px) scale(.96); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        .home-classroom-card,
        .classroom-advisory {
          border:1px solid var(--border);
          border-radius:20px;
          background:rgba(255,255,255,.72);
          box-shadow:0 18px 50px rgba(8,145,178,.08);
        }
        body.dark-mode .home-classroom-card,
        body.dark-mode .classroom-advisory {
          background:rgba(255,255,255,.03);
          box-shadow:none;
        }
        .home-classroom-card {
          padding:22px;
          margin-top:-16px;
        }
        .home-classroom-header {
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:16px;
          margin-bottom:16px;
        }
        .home-classroom-eyebrow,
        .classroom-advisory-title {
          font-family:var(--ff-mono);
          font-size:10px;
          letter-spacing:.18em;
          text-transform:uppercase;
          color:var(--accent);
        }
        .home-classroom-title {
          margin-top:8px;
          font-family:var(--ff-head);
          font-size:1.15rem;
          font-weight:800;
          color:var(--text);
        }
        .home-classroom-grid {
          display:grid;
          grid-template-columns:repeat(2, minmax(0, 1fr));
          gap:14px;
          margin-top:16px;
        }
        .home-classroom-block {
          border:1px solid var(--border);
          border-radius:16px;
          padding:16px;
          background:var(--surface);
        }
        .home-classroom-block-label {
          font-family:var(--ff-mono);
          font-size:9px;
          letter-spacing:.16em;
          text-transform:uppercase;
          color:var(--text3);
          margin-bottom:10px;
        }
        .home-classroom-alert,
        .home-classroom-assignment {
          display:flex;
          flex-direction:column;
          gap:4px;
          padding:12px;
          border-radius:12px;
          background:rgba(255,255,255,.72);
          color:var(--text);
          margin-bottom:10px;
        }
        body.dark-mode .home-classroom-alert,
        body.dark-mode .home-classroom-assignment {
          background:rgba(255,255,255,.04);
        }
        .home-classroom-alert {
          border:1px solid rgba(249,115,22,.18);
          color:var(--orange);
        }
        .home-classroom-assignment span,
        .home-classroom-empty,
        .classroom-advisory-text {
          color:var(--text2);
          line-height:1.65;
        }
        .classroom-advisory {
          margin:18px 0 24px;
          padding:18px 20px;
        }
        .classroom-advisory-title {
          margin-bottom:8px;
        }
        .classroom-advisory-text + .classroom-advisory-text {
          margin-top:8px;
        }
        .hero-guidance-strip span::before {
          content:"";
          display:inline-block;
          width:6px;
          height:6px;
          border-radius:999px;
          background:var(--accent);
          margin-right:8px;
          vertical-align:middle;
        }

        /* ══ COMPACT BAR ══ */
        .compact-bar {
          position:sticky; top:0; z-index:100;
          background: rgba(250,253,255,0.94);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border);
          padding: 10px 24px;
          animation: slideDown .4s var(--ease) both;
        }
        body.dark-mode .compact-bar { background: rgba(8,8,16,.92); }
        @keyframes slideDown { from{opacity:0;transform:translateY(-100%)} to{opacity:1;transform:none} }
        .compact-inner { max-width:1280px; margin:0 auto; display:flex; align-items:center; gap:10px; }
        /* KIRIGUMI compact logo */
        .compact-logo-kiri {
          font-family: var(--ff-head);
          font-weight: 850;
          font-size: .9rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--orange);
          flex-shrink: 0;
          padding-right: 14px;
          border-right: 1px solid var(--border);
          user-select: none;
        }
        .compact-input {
          flex:1; background:var(--surface); border:1px solid var(--border);
          border-radius:8px; padding:8px 14px; color:var(--text);
          font-family:var(--ff-body); font-size:.88rem; outline:none; transition:border-color .2s;
        }
        .compact-input:focus { border-color: var(--accent-mid); }
        .compact-select {
          background:var(--surface); border:1px solid var(--border);
          border-radius:8px; padding:8px 12px; color:var(--text);
          font-family:var(--ff-body); font-size:.88rem; outline:none; appearance:none; cursor:pointer;
        }
        .compact-classroom-btn { padding:8px 10px; border-radius:8px; }
        .compact-btn {
          background: var(--accent); border:none; border-radius:8px;
          width:36px; height:36px; display:flex; align-items:center; justify-content:center;
          color:#fff; font-size:1.1rem; font-weight:700; cursor:pointer;
          transition:transform .15s,background .15s; flex-shrink:0;
        }
        .compact-btn:hover { transform:scale(1.08); background:var(--accent-mid); }
        .compact-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }
        .compact-generate-btn {
          min-height:36px;
          padding:0 16px;
          border:none;
          border-radius:10px;
          background:linear-gradient(135deg, var(--accent), var(--accent-mid));
          color:#fff;
          font-family:var(--ff-head);
          font-size:.88rem;
          font-weight:800;
          cursor:pointer;
          flex-shrink:0;
        }
        .compact-generate-btn:disabled { opacity:.55; cursor:not-allowed; }
        .compact-profile { width:34px!important; height:34px!important; margin-left:4px; }

        /* ══ LOADING ══ */
        @keyframes ringSpin { to{transform:rotate(360deg)} }
        @keyframes iconPulse { 0%,100%{opacity:.5;transform:scale(.9)} 50%{opacity:1;transform:scale(1.1)} }
        @keyframes dotPop { 0%,100%{opacity:.2;transform:scale(.7)} 50%{opacity:1;transform:scale(1.2)} }
        @keyframes cloIn { from{opacity:0} to{opacity:1} }
        @keyframes cloUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }
        @keyframes startupGlow { 0%,100%{transform:scale(1); box-shadow:0 0 0 0 rgba(8,145,178,.14);} 50%{transform:scale(1.03); box-shadow:0 0 0 16px rgba(8,145,178,0);} }
        @keyframes startupTickHour { from{transform:translateX(-50%) rotate(0deg)} to{transform:translateX(-50%) rotate(360deg)} }
        @keyframes startupTickMinute { from{transform:translateX(-50%) rotate(0deg)} to{transform:translateX(-50%) rotate(360deg)} }
        @keyframes startupMessageIn { from{opacity:0; transform:translateY(10px)} to{opacity:1; transform:translateY(0)} }

        .startup-overlay {
          position: fixed; inset: 0; z-index: 1200;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          background:
            radial-gradient(circle at top, rgba(34,211,238,.22), transparent 42%),
            linear-gradient(180deg, rgba(240,250,255,.96), rgba(224,244,252,.98));
          backdrop-filter: blur(14px);
          animation: cloIn .35s var(--ease2) both;
        }
        body.dark-mode .startup-overlay {
          background:
            radial-gradient(circle at top, rgba(124,58,237,.25), transparent 42%),
            linear-gradient(180deg, rgba(8,8,16,.96), rgba(13,13,26,.98));
        }
        .startup-card {
          width: min(560px, 100%);
          padding: 34px 28px;
          border-radius: 28px;
          border: 1px solid var(--border2);
          background: rgba(255,255,255,.74);
          box-shadow: 0 24px 70px rgba(8,145,178,.16);
          display: flex; flex-direction: column; align-items: center;
          text-align: center;
          gap: 18px;
          animation: cloUp .5s var(--ease2) both;
        }
        body.dark-mode .startup-card {
          background: rgba(12,12,24,.86);
          box-shadow: 0 24px 70px rgba(0,0,0,.35);
        }
        .startup-clock {
          width: 108px; height: 108px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, rgba(255,255,255,.92), rgba(34,211,238,.16));
          animation: startupGlow 2.4s ease-in-out infinite;
        }
        body.dark-mode .startup-clock {
          background: linear-gradient(135deg, rgba(255,255,255,.1), rgba(124,58,237,.18));
        }
        .startup-clock-face {
          position: relative;
          width: 78px; height: 78px;
          border-radius: 50%;
          border: 3px solid var(--accent);
          background: rgba(255,255,255,.86);
        }
        body.dark-mode .startup-clock-face { background: rgba(8,8,16,.95); }
        .startup-clock-mark {
          position: absolute;
          background: var(--accent-mid);
          border-radius: 999px;
        }
        .startup-clock-mark-top,
        .startup-clock-mark-bottom {
          width: 4px; height: 10px; left: 50%; transform: translateX(-50%);
        }
        .startup-clock-mark-top { top: 7px; }
        .startup-clock-mark-bottom { bottom: 7px; }
        .startup-clock-mark-left,
        .startup-clock-mark-right {
          width: 10px; height: 4px; top: 50%; transform: translateY(-50%);
        }
        .startup-clock-mark-left { left: 7px; }
        .startup-clock-mark-right { right: 7px; }
        .startup-clock-hand {
          position: absolute;
          left: 50%;
          bottom: 50%;
          transform-origin: bottom center;
          border-radius: 999px;
        }
        .startup-clock-hour {
          width: 4px; height: 20px;
          background: var(--text);
          animation: startupTickHour 9s linear infinite;
        }
        .startup-clock-minute {
          width: 2px; height: 28px;
          background: var(--orange);
          animation: startupTickMinute 3s linear infinite;
        }
        .startup-clock-center {
          position: absolute;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: var(--orange);
          top: 50%; left: 50%; transform: translate(-50%, -50%);
          box-shadow: 0 0 0 4px rgba(249,115,22,.14);
        }
        .startup-title {
          font-family: var(--ff-head);
          font-size: clamp(1.3rem, 3vw, 1.9rem);
          font-weight: 800;
          line-height: 1.25;
          color: var(--text);
          max-width: 18ch;
        }
        .startup-message-wrap {
          position: relative;
          min-height: 28px;
          width: 100%;
        }
        .startup-message {
          position: absolute;
          inset: 0;
          margin: 0;
          opacity: 0;
          transform: translateY(10px);
          font-family: var(--ff-mono);
          font-size: 11px;
          letter-spacing: .18em;
          text-transform: uppercase;
          color: var(--text2);
          transition: opacity .35s ease, transform .35s ease;
        }
        .startup-message-visible {
          opacity: 1;
          transform: translateY(0);
          animation: startupMessageIn .35s ease;
        }

        .clo-overlay { position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; background:rgba(240,250,255,.93); backdrop-filter:blur(18px); animation:cloIn .4s var(--ease2) both; }
        body.dark-mode .clo-overlay { background: rgba(8,8,16,.92); }
        .clo-content { display:flex; flex-direction:column; align-items:center; gap:20px; animation:cloUp .6s var(--ease2) both; }
        .clo-ring-wrap { position:relative; width:90px; height:90px; display:flex; align-items:center; justify-content:center; }
        .clo-ring { position:absolute; border-radius:50%; border:1.5px solid transparent; }
        .clo-ring1 { inset:0; border-top-color:var(--accent-light); border-right-color:var(--accent-dim); animation:ringSpin 1.4s linear infinite; }
        .clo-ring2 { inset:10px; border-top-color:var(--accent-mid); border-left-color:var(--accent-dim); animation:ringSpin 1.9s linear infinite reverse; }
        .clo-ring3 { inset:20px; border-bottom-color:var(--accent); border-right-color:var(--accent-dim); animation:ringSpin 2.5s linear infinite; }
        .clo-icon { font-size:1.3rem; color:var(--accent-light); animation:iconPulse 2s ease-in-out infinite; }
        .clo-topic { font-family:var(--ff-head); font-size:1.1rem; font-weight:700; color:var(--text); text-align:center; max-width:300px; line-height:1.3; }
        .clo-level { font-family:var(--ff-mono); font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:var(--text3); }
        .clo-dots { display:flex; gap:6px; align-items:center; margin-top:4px; }
        .clo-dot { width:5px; height:5px; border-radius:50%; background:var(--accent-light); animation:dotPop .9s ease-in-out infinite; }

        .cin-loader { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; min-height:260px; padding:40px 20px; }
        .cin-ring-wrap { position:relative; width:60px; height:60px; display:flex; align-items:center; justify-content:center; }
        .cin-ring { position:absolute; border-radius:50%; border:1.5px solid transparent; }
        .cin-r1 { inset:0; border-top-color:var(--accent-light); animation:ringSpin 1.4s linear infinite; }
        .cin-r2 { inset:8px; border-right-color:var(--accent-mid); animation:ringSpin 2s linear infinite reverse; }
        .cin-r3 { inset:16px; border-bottom-color:var(--accent); animation:ringSpin 2.8s linear infinite; }
        .cin-core { font-size:.75rem; color:var(--accent-light); animation:iconPulse 2s ease-in-out infinite; }
        .cin-label { font-family:var(--ff-head); font-size:.92rem; font-weight:600; color:var(--text); text-align:center; }
        .cin-sublabel { font-family:var(--ff-mono); font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--text3); text-align:center; }

        /* ══ COURSE PAGE ══ */
        @keyframes fadeUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:none} }
        @keyframes chIn { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:none} }
        @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes expandIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:none} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

        .course-page { max-width:1100px; margin:0 auto; padding:36px 24px 100px; position:relative; z-index:1; animation:fadeUp .6s var(--ease2) both; }
        .course-header { margin-bottom:28px; padding-bottom:24px; border-bottom:1px solid var(--border); }
        .course-kicker { font-family:var(--ff-mono); font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--accent); margin-bottom:12px; }
        .course-main-title { font-family:var(--ff-head); font-size:clamp(1.9rem,4vw,3rem); font-weight:900; line-height:1.1; color:var(--text); margin-bottom:16px; }
        .course-stats { display:flex; gap:24px; flex-wrap:wrap; font-family:var(--ff-mono); font-size:12px; color:var(--text2); letter-spacing:.07em; margin-bottom:16px; }
        .course-stat-item { display:flex; align-items:center; gap:8px; font-weight:500; }
        .course-stat-item::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--accent-light); display:block; flex-shrink:0; }
        .add-profile-btn { display:inline-flex; align-items:center; gap:8px; font-family:var(--ff-mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; padding:9px 18px; border-radius:8px; border:1px solid var(--accent-mid); background:var(--accent-dim); color:var(--accent); cursor:pointer; transition:background .2s,transform .15s; font-weight:600; }
        .add-profile-btn:hover { background:var(--accent-glow2); transform:translateY(-1px); }
        .add-profile-btn.in-profile { border-color:var(--green); background:var(--green-dim); color:var(--green); cursor:default; transform:none; }

        .prog-strip-wrap { display:flex; align-items:center; gap:16px; margin-bottom:32px; }
        .prog-pct-label { font-family:var(--ff-head); font-size:1.5rem; font-weight:900; color:var(--accent); min-width:58px; flex-shrink:0; }
        .prog-strip { flex:1; position:relative; height:4px; background:var(--surface2); border-radius:999px; overflow:hidden; }
        .prog-bar { position:absolute; left:0; top:0; height:100%; background:linear-gradient(90deg,var(--accent),var(--accent-light)); border-radius:999px; transition:width .8s cubic-bezier(.34,1.56,.64,1); box-shadow:0 0 10px var(--accent-glow); }
        .prog-right-meta { display:flex; gap:14px; font-family:var(--ff-mono); font-size:10px; color:var(--text3); letter-spacing:.1em; flex-shrink:0; }

        /* Chapters */
        .chapters-wrap { display:flex; flex-direction:column; gap:5px; }
        .ch-section { border:1px solid var(--border); border-radius:12px; overflow:hidden; background:var(--surface); transition:border-color .3s; animation:chIn .5s var(--ease2) both; }
        .ch-section:hover { border-color:var(--border2); }
        .ch-section.ch-all-done { border-color:var(--green-dim); }
        .ch-header { width:100%; display:flex; align-items:center; gap:14px; padding:16px 20px; background:none; border:none; cursor:pointer; color:var(--text); text-align:left; transition:background .18s; }
        .ch-header:hover { background:var(--surface2); }
        .ch-num { font-family:var(--ff-mono); font-size:.75rem; font-weight:500; color:var(--accent); letter-spacing:.1em; min-width:26px; flex-shrink:0; }
        .ch-section.ch-all-done .ch-num { color:var(--green); }
        .ch-title { font-family:var(--ff-chapter); font-size:1.1rem; font-weight:400; flex:1; color:var(--text); line-height:1.3; }
        .ch-meta { font-family:var(--ff-mono); font-size:10px; color:var(--text3); letter-spacing:.08em; flex-shrink:0; }
        .ch-chevron { color:var(--text3); font-size:1.1rem; flex-shrink:0; transition:transform .25s var(--ease); display:inline-block; }
        .ch-topics { border-top:1px solid var(--border); background:rgba(0,0,0,.03); }
        body.dark-mode .ch-topics { background:rgba(0,0,0,.2); }
        .topic-block { border-bottom:1px solid rgba(0,0,0,.05); }
        body.dark-mode .topic-block { border-bottom-color:rgba(255,255,255,.03); }
        .topic-block:last-child { border-bottom:none; }
        .topic-row { display:flex; align-items:center; gap:12px; padding:12px 20px 12px 38px; cursor:pointer; transition:background .15s, padding-left .2s var(--ease); }
        .topic-row:hover { background:var(--accent-dim); padding-left:44px; }
        .topic-row.t-active { background:var(--accent-dim); padding-left:44px; }
        .topic-row.t-done { opacity:.55; }
        .topic-row.t-done:hover { opacity:.8; }
        .t-dot { font-size:10px; color:var(--text3); flex-shrink:0; width:14px; text-align:center; }
        .topic-row.t-active .t-dot { color:var(--accent); }
        .topic-row.t-done .t-dot { color:var(--green); }
        .t-name { flex:1; font-size:.975rem; color:var(--text); line-height:1.4; font-weight:500; }
        .t-badge { font-family:var(--ff-mono); font-size:9px; font-weight:500; letter-spacing:.1em; padding:2px 7px; border-radius:4px; text-transform:uppercase; flex-shrink:0; }
        .done-b { color:var(--green); background:var(--green-dim); }
        .active-b { color:var(--accent); background:var(--accent-dim); }
        .loading-b { color:var(--text3); background:var(--surface2); animation:pulse 1.2s ease-in-out infinite; }

        /* ══ INLINE LESSON — white card + handwritten text ══ */
        .inline-lesson { display:grid; grid-template-columns:1fr auto; border-top:1px solid var(--border2); background:rgba(8,145,178,.02); animation:expandIn .4s var(--ease2) both; }
        body.dark-mode .inline-lesson { background:linear-gradient(135deg,rgba(124,58,237,.03),rgba(8,8,16,.8)); }
        .il-main { padding:22px 24px 20px; min-width:0; }
        .il-eyebrow { font-family:var(--ff-mono); font-size:9px; letter-spacing:.25em; text-transform:uppercase; color:var(--accent); margin-bottom:12px; display:flex; align-items:center; gap:8px; }
        .il-eyebrow::after { content:''; flex:1; height:1px; background:var(--border2); }

        /* White lesson card (light mode) */
        .il-lesson-card {
          background: #ffffff;
          border-radius: 12px;
          padding: 22px 26px;
          margin-bottom: 16px;
          box-shadow: 0 2px 16px rgba(0,0,0,.12), 0 1px 3px rgba(0,0,0,.08);
          border: 1px solid rgba(8,145,178,.15);
          position: relative;
          /* Subtle ruled lines for notebook feel */
          background-image: repeating-linear-gradient(transparent, transparent 29px, rgba(8,145,178,.07) 29px, rgba(8,145,178,.07) 30px);
          transition: box-shadow .2s, background-color .2s;
        }
        .il-lesson-card:hover { box-shadow: 0 4px 24px rgba(0,0,0,.16), 0 1px 3px rgba(0,0,0,.1); background-color: #f8f8f8; }

        /* Dark mode lesson card — purple theme */
        body.dark-mode .il-lesson-card {
          background: linear-gradient(135deg, rgba(124,58,237,.08), rgba(8,8,22,.9));
          background-image: repeating-linear-gradient(
            linear-gradient(135deg, rgba(124,58,237,.08), rgba(8,8,22,.9)),
            transparent
          );
          /* Can't combine background + background-image shorthand elegantly, use box approach */
          background: rgba(18, 10, 40, 0.85);
          border: 1px solid rgba(139,92,246,.3);
          box-shadow: 0 2px 20px rgba(124,58,237,.15), inset 0 1px 0 rgba(139,92,246,.15);
        }
        body.dark-mode .il-lesson-card:hover {
          background: rgba(25, 14, 55, 0.9);
          box-shadow: 0 4px 28px rgba(124,58,237,.22), inset 0 1px 0 rgba(139,92,246,.2);
          border-color: rgba(139,92,246,.5);
        }

        /* Handwritten font inside card — dark in light mode, light in dark mode */
        .il-body { font-family:var(--ff-hand); font-size:1.05rem; line-height:2.1; color:#1a1a2e; position:relative; min-height:60px; }
        body.dark-mode .il-body { color: #d0d0e8; font-family: var(--ff-body); font-size: .97rem; line-height: 1.95; }
        .cursor-blink { display:inline-block; color:var(--accent); animation:blink .8s step-end infinite; font-size:.9rem; margin-left:1px; }

        /* Lesson text — light mode (handwritten, dark ink) */
        .lesson-text { display:flex; flex-direction:column; gap:5px; }
        .lt-h1 { font-family:var(--ff-hand); font-size:1.35rem; font-weight:700; color:#0a1520; margin:12px 0 5px; border-bottom:2px solid rgba(8,145,178,.2); padding-bottom:3px; }
        .lt-h2 { font-family:var(--ff-hand); font-size:1.15rem; font-weight:700; color:#0a1520; margin:10px 0 4px; }
        .lt-h3 { font-family:var(--ff-hand); font-size:1rem; font-weight:700; color:#0b5e7a; margin:8px 0 3px; }
        .lt-para { font-family:var(--ff-hand); font-size:1.05rem; color:#1a2030; line-height:2.1; }
        .lt-bullet { display:flex; gap:10px; font-family:var(--ff-hand); font-size:1.05rem; color:#1a2030; line-height:1.9; }
        .lt-bullet-dot { color:var(--accent); flex-shrink:0; font-size:1.1rem; }
        .lt-numbered { display:flex; gap:10px; font-family:var(--ff-hand); font-size:1.05rem; color:#1a2030; line-height:1.9; }
        .lt-num { color:var(--accent); font-family:var(--ff-mono); font-size:.8rem; flex-shrink:0; width:22px; text-align:right; padding-top:3px; }
        .lt-code { font-family:var(--ff-mono); font-size:.85rem; background:rgba(8,145,178,.1); color:#0b5e7a; padding:2px 7px; border-radius:4px; border:1px solid rgba(8,145,178,.18); }
        .lesson-spacer { height:10px; }
        /* Bold/highlights — light mode */
        strong { display:inline-block; color:#0a2535; font-weight:700; background:rgba(8,145,178,.1); padding:1px 6px; border-radius:4px; font-family:var(--ff-hand); }
        u { color:#0b5e7a; text-decoration-color:var(--accent); text-underline-offset:3px; font-weight:700; }

        /* Dark mode lesson text overrides — purple palette */
        body.dark-mode .lt-h1 { font-family:var(--ff-head); color:#e0d0ff; border-bottom-color:rgba(139,92,246,.35); }
        body.dark-mode .lt-h2 { font-family:var(--ff-head); color:#e0d0ff; }
        body.dark-mode .lt-h3 { font-family:var(--ff-head); color:var(--accent-light); }
        body.dark-mode .lt-para { font-family:var(--ff-body); color:#c8c0e0; line-height:1.95; }
        body.dark-mode .lt-bullet { font-family:var(--ff-body); color:#c8c0e0; }
        body.dark-mode .lt-bullet-dot { color:var(--accent-light); }
        body.dark-mode .lt-numbered { font-family:var(--ff-body); color:#c8c0e0; }
        body.dark-mode .lt-num { color:var(--accent-light); }
        body.dark-mode .lt-code { background:rgba(124,58,237,.2); color:#c4b5fd; border-color:rgba(139,92,246,.3); }
        body.dark-mode strong { color:#e0d0ff; background:rgba(124,58,237,.2); font-family:var(--ff-body); }
        body.dark-mode u { color:#c4b5fd; text-decoration-color:var(--accent-light); }

        .il-actions { display:flex; gap:10px; flex-wrap:wrap; }
        .il-btn { font-family:var(--ff-mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; padding:9px 18px; border-radius:6px; border:1px solid; cursor:pointer; transition:transform .15s,background .15s,color .15s; font-weight:500; white-space:nowrap; }
        .il-btn:hover { transform:translateY(-1px); }
        .il-btn-complete { background:transparent; border-color:var(--accent-mid); color:var(--accent); }
        .il-btn-complete:hover { background:var(--accent-dim); }
        .il-btn-done { background:var(--green-dim); border-color:var(--green); color:var(--green); }
        .il-btn-done:hover { background:var(--red-dim); border-color:var(--red); color:var(--red); }
        .il-btn-quiz { background:transparent; border-color:var(--border2); color:var(--text2); }
        .il-btn-quiz:hover { background:var(--surface2); border-color:var(--accent-mid); color:var(--accent); }
        .il-sidebar { padding:20px 20px 20px 0; display:flex; flex-direction:column; gap:10px; width:300px; }
        .ils-label { font-family:var(--ff-mono); font-size:9px; font-weight:700; letter-spacing:.22em; text-transform:uppercase; color:#111; margin-bottom:8px; }
        body.dark-mode .ils-label { color:#f0f0ff; }
        .ils-videos { display:flex; flex-direction:column; gap:8px; }
        .ils-video { border-radius:8px; overflow:hidden; aspect-ratio:16/9; border:1px solid var(--border); }
        .ils-video iframe { width:100%; height:100%; border:none; display:block; }
        .ils-web-list { display:flex; flex-direction:column; gap:8px; }
        .ils-web-card { display:flex; flex-direction:column; gap:5px; padding:10px 12px; border:1px solid var(--border); border-radius:10px; background:var(--surface); text-decoration:none; transition:background .15s,border-color .15s,transform .15s; }
        .ils-web-card:hover { background:var(--surface2); border-color:var(--accent-mid); transform:translateY(-1px); }
        .ils-web-title { font-family:var(--ff-head); font-size:.82rem; font-weight:700; color:var(--text); line-height:1.35; }
        .ils-web-desc { font-size:.76rem; color:var(--text2); line-height:1.6; display:-webkit-box; -webkit-line-clamp:6; -webkit-box-orient:vertical; overflow:hidden; }
        .ils-web-meta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .ils-web-meta-label { font-family:var(--ff-head); font-size:.72rem; font-weight:800; color:var(--text); letter-spacing:.02em; }
        .ils-web-meta-value { font-family:var(--ff-mono); font-size:8px; letter-spacing:.12em; text-transform:uppercase; color:var(--logo-blue); }
        .ils-suggestion-card { border:1px solid rgba(13,94,168,.14); border-radius:10px; background:rgba(13,94,168,.06); padding:12px 14px; }
        body.dark-mode .ils-suggestion-card { border-color:rgba(57,160,255,.18); background:rgba(57,160,255,.08); }
        .ils-empty { padding:10px 12px; border:1px dashed var(--border2); border-radius:10px; font-size:.78rem; color:var(--text3); line-height:1.55; }
        .inline-loading { display:flex; align-items:center; gap:10px; padding:16px 18px 16px 38px; font-family:var(--ff-mono); font-size:11px; color:var(--text3); letter-spacing:.1em; border-top:1px solid var(--border); animation:pulse 1.5s ease-in-out infinite; }
        .inline-lesson-error {
          margin:0 14px 14px 38px;
          padding:14px 16px;
          border-radius:14px;
          border:1px solid rgba(239,68,68,.22);
          background:rgba(239,68,68,.08);
          color:var(--red);
          line-height:1.6;
        }
        .inline-lesson-error-title {
          font-family:var(--ff-mono);
          font-size:10px;
          letter-spacing:.16em;
          text-transform:uppercase;
          margin-bottom:6px;
        }

        /* ══ RECOMMENDED TOPIC HIGHLIGHT ══ */
        .topic-row.t-recommended { background:var(--accent-dim); border-left:3px solid var(--accent-mid); }
        .topic-row.t-recommended:hover { background:rgba(8,145,178,.18); }
        body.dark-mode .topic-row.t-recommended { background:rgba(124,58,237,.1); border-left-color:var(--accent-mid); }

        /* ══ SHORT TASK TOAST ══ */
        @keyframes sttIn { from{opacity:0;transform:translateY(20px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes sttOut { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(20px) scale(0.95)} }
        .short-task-toast {
          position:fixed; bottom:28px; right:28px; z-index:1100;
          display:flex; align-items:flex-start; gap:14px;
          max-width:420px; padding:16px 20px;
          border-radius:16px; border:1px solid var(--accent-mid);
          background:rgba(255,255,255,.95); backdrop-filter:blur(16px);
          box-shadow:0 12px 40px rgba(8,145,178,.18);
        }
        body.dark-mode .short-task-toast { background:rgba(12,12,24,.94); box-shadow:0 12px 40px rgba(0,0,0,.35); }
        .stt-visible { animation:sttIn .4s var(--ease2) both; }
        .stt-hidden { animation:sttOut .35s ease both; pointer-events:none; }
        .stt-icon { font-size:1.3rem; flex-shrink:0; margin-top:2px; }
        .stt-content { flex:1; min-width:0; }
        .stt-label { font-family:var(--ff-mono); font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--accent); margin-bottom:5px; }
        .stt-message { font-size:.9rem; color:var(--text); line-height:1.55; }
        .stt-close { background:none; border:none; color:var(--text3); font-size:.9rem; cursor:pointer; padding:4px; flex-shrink:0; transition:color .2s; }
        .stt-close:hover { color:var(--text); }

        /* ══ CLASSROOM CONNECTED BADGE ══ */
        .classroom-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:6px; background:var(--green-dim); color:var(--green); font-family:var(--ff-mono); font-size:8px; letter-spacing:.1em; text-transform:uppercase; font-weight:600; flex-shrink:0; }

        /* ══ COURSE TOOLS ══ */
        .cba-wrap { margin-top:40px; padding-top:32px; }
        .cba-divider { display:flex; align-items:center; gap:16px; margin-bottom:24px; }
        .cba-divider-line { flex:1; height:1px; background:var(--border); }
        .cba-divider-label { font-family:var(--ff-mono); font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:var(--text3); white-space:nowrap; flex-shrink:0; }
        .cba-buttons { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        .cba-btn { display:flex; align-items:center; gap:14px; padding:18px 20px; border-radius:14px; border:1px solid var(--border); background:var(--surface); cursor:pointer; text-align:left; transition:background .2s,border-color .2s,transform .15s; }
        .cba-btn:hover { background:var(--surface2); transform:translateY(-2px); }
        .cba-btn-icon { font-size:1.6rem; flex-shrink:0; }
        .cba-btn-text { display:flex; flex-direction:column; gap:3px; min-width:0; }
        .cba-btn-label { font-family:var(--ff-head); font-size:.95rem; font-weight:700; color:var(--text); white-space:nowrap; }
        .cba-btn-sub { font-family:var(--ff-mono); font-size:8.5px; letter-spacing:.08em; color:var(--text3); text-transform:uppercase; white-space:nowrap; }
        .cba-practice { border-color:var(--accent-dim); background:rgba(8,145,178,.05); }
        body.dark-mode .cba-practice { background:rgba(124,58,237,.06); border-color:rgba(124,58,237,.25); }
        .cba-practice:hover { border-color:var(--accent-mid); background:rgba(8,145,178,.1); }
        .cba-revise { border-color:var(--green-dim); background:rgba(16,185,129,.04); }
        .cba-revise:hover { border-color:var(--green); background:rgba(16,185,129,.08); }
        .cba-notes { border-color:var(--blue-dim); background:rgba(56,189,248,.04); }
        .cba-notes:hover { border-color:var(--blue); background:rgba(56,189,248,.08); }
        .cba-exam { border-color:var(--orange-dim); background:rgba(249,115,22,.05); }
        .cba-exam:hover { border-color:var(--orange); background:rgba(249,115,22,.11); }

        .rec-panel {
          margin: 26px 0 22px;
          border:1px solid var(--border);
          border-radius:22px;
          padding:22px;
          background:linear-gradient(145deg, rgba(255,255,255,.72), rgba(8,145,178,.05));
          box-shadow:0 18px 50px rgba(8,145,178,.08);
        }
        body.dark-mode .rec-panel {
          background:linear-gradient(145deg, rgba(18,18,34,.9), rgba(57,160,255,.06));
          box-shadow:0 18px 50px rgba(0,0,0,.22);
        }
        .rec-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:12px; }
        .rec-eyebrow { font-family:var(--ff-mono); font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--accent); margin-bottom:6px; }
        .rec-title { font-family:var(--ff-head); font-size:1.25rem; color:var(--text); }
        .rec-next-pill {
          padding:10px 14px; border-radius:999px; background:var(--accent-dim);
          color:var(--accent); font-family:var(--ff-head); font-weight:700; font-size:.88rem;
        }
        .rec-summary { color:var(--text2); line-height:1.7; margin-bottom:16px; }
        .rec-actions-row { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
        .rec-primary-btn, .rec-secondary-btn, .rec-mini-btn {
          border:none; border-radius:10px; cursor:pointer; font-weight:700;
        }
        .rec-primary-btn {
          background:var(--accent); color:#fff; padding:11px 14px;
        }
        .rec-secondary-btn {
          background:var(--surface2); color:var(--text); padding:11px 14px; border:1px solid var(--border2);
        }
        .rec-mini-btn {
          background:transparent; color:var(--accent); padding:6px 10px; border:1px solid var(--accent-mid); font-size:.78rem;
        }
        .rec-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; }
        .rec-card {
          border:1px solid var(--border); border-radius:16px; padding:16px;
          background:rgba(255,255,255,.65);
          height: fit-content;
        }
        .rec-card-wide { grid-column:1 / -1; }
        .rec-card-label + .rec-empty,
        .rec-card-label + .rec-line,
        .rec-card-label + .rec-chip-row,
        .rec-card-label + .rec-revision-row {
          margin-top: 0;
        }
        .rec-card:nth-child(1),
        .rec-card.rec-card-wide {
          align-self: start;
        }
        body.dark-mode .rec-card { background:rgba(255,255,255,.03); }
        .rec-card-label { font-family:var(--ff-mono); font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--text3); margin-bottom:10px; }
        .rec-chip-row, .rec-line, .rec-alert {
          display:flex; align-items:center; justify-content:space-between; gap:12px;
          padding:10px 12px; border-radius:12px; background:var(--surface); color:var(--text);
          margin-bottom:8px; line-height:1.5;
        }
        .rec-chip-actions { display:flex; align-items:center; gap:8px; }
        .rec-alert { justify-content:flex-start; color:var(--orange); background:var(--orange-dim); }
        .rec-empty { color:var(--text3); line-height:1.6; }
        .rec-empty-note { margin-bottom:8px; }
        .rec-connect-btn {
          margin-top:12px; border:1px solid var(--accent); background:var(--accent);
          color:#fff; padding:10px 14px; border-radius:10px; cursor:pointer; font-weight:700;
        }
        .rec-revision-row {
          display:flex; align-items:center; justify-content:space-between; gap:14px;
          padding:12px 14px; border-radius:12px; background:var(--surface); margin-bottom:8px;
        }
        .rec-revision-title { font-weight:700; color:var(--text); margin-bottom:4px; }
        .rec-revision-sub { color:var(--text3); font-size:.82rem; }

        .revision-alert-card {
          margin-bottom:24px; border:1px solid rgba(249,115,22,.28); border-radius:20px;
          background:linear-gradient(145deg, rgba(249,115,22,.08), rgba(255,255,255,.72)); padding:20px;
        }
        body.dark-mode .revision-alert-card { background:linear-gradient(145deg, rgba(249,115,22,.12), rgba(18,18,34,.92)); }
        .revision-alert-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:14px; }
        .revision-alert-body { border-radius:14px; background:rgba(255,255,255,.65); padding:14px; }
        body.dark-mode .revision-alert-body { background:rgba(255,255,255,.04); }

        .exam-mode-wrap { display:flex; flex-direction:column; gap:18px; }
        .exam-priority-list, .exam-revision-card, .exam-quiz-card {
          border:1px solid var(--border); border-radius:18px; padding:18px; background:var(--surface);
        }
        .exam-block-title {
          font-family:var(--ff-mono); font-size:10px; letter-spacing:.18em; text-transform:uppercase;
          color:var(--accent); margin-bottom:12px;
        }
        .exam-chip-list { display:flex; flex-wrap:wrap; gap:10px; }
        .exam-chip {
          padding:8px 12px; border-radius:999px; background:var(--accent-dim); color:var(--accent);
          font-weight:600; font-size:.86rem;
        }

        /* ══ PANELS — fixed-height flex + scroll-behavior:auto ══ */
        @keyframes overlayIn { from{opacity:0} to{opacity:1} }
        @keyframes panelIn { from{transform:translateX(64px);opacity:0} to{transform:none;opacity:1} }
        @keyframes popIn { from{opacity:0;transform:scale(.9)} to{opacity:1;transform:none} }
        @keyframes qIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes cardIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }
        @keyframes alertIn { from{opacity:0;transform:translateY(-8px) scale(.97)} to{opacity:1;transform:none} }
        @keyframes arcIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
        @keyframes fctIn { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:none} }
        @keyframes spinAnim { to{transform:rotate(360deg)} }
        @keyframes fabIn { from{opacity:0;transform:translateY(20px) scale(.9)} to{opacity:1;transform:none} }
        @keyframes pulseDot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }
        @keyframes msgIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes tmDot { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.2)} }
        @keyframes revealDown { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
        @keyframes starSpin { 0%,100%{transform:rotate(0deg) scale(1)} 50%{transform:rotate(180deg) scale(1.15)} }

        .mode-overlay { position:fixed; inset:0; z-index:1000; background:rgba(230,248,255,.82); backdrop-filter:blur(12px); display:flex; align-items:flex-start; justify-content:center; animation:overlayIn .3s ease both; overflow-y:auto; overflow-x:hidden; padding:88px 24px 24px; }
        body.dark-mode .mode-overlay { background:rgba(5,5,14,.9); }
        .mode-panel { width:min(740px, calc(100vw - 48px)); background:#ffffff; border:1px solid var(--border2); border-radius:24px; box-shadow:0 30px 80px rgba(8,145,178,.18); display:flex; flex-direction:column; height:min(86vh, 880px); max-height:calc(100vh - 112px); animation:popIn .32s var(--ease2) both; overflow:hidden; position:relative; flex-shrink:0; margin:0 auto; }
        body.dark-mode .mode-panel { background:#0c0c1e; }
        .mode-panel-wide { width:min(820px, calc(100vw - 48px)); }
        .mode-header { flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:24px 28px 18px; border-bottom:1px solid var(--border); }
        .mode-eyebrow { font-family:var(--ff-mono); font-size:9px; letter-spacing:.25em; text-transform:uppercase; color:var(--accent); display:block; margin-bottom:4px; }
        .mode-title { font-family:var(--ff-chapter); font-size:1.35rem; color:var(--text); line-height:1.2; margin-bottom:5px; }
        .mode-subtitle { font-family:var(--ff-mono); font-size:9px; color:var(--text3); letter-spacing:.08em; }
        .mode-body { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; padding:22px 28px 28px; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; scroll-behavior:auto; }
        .mode-body::-webkit-scrollbar { width:4px; }
        .mode-body::-webkit-scrollbar-thumb { background:var(--border2); border-radius:999px; }
        .mode-empty { text-align:center; padding:40px; font-family:var(--ff-mono); font-size:11px; color:var(--text3); }

        .practice-cards { display:flex; flex-direction:column; gap:12px; }
        .pq-card { background:var(--surface); border:1px solid var(--border); border-radius:12px; cursor:pointer; transition:border-color .2s,background .2s; animation:qIn .4s var(--ease2) both; overflow:hidden; }
        .pq-card:hover { border-color:var(--border2); background:var(--surface2); }
        .pq-card.pq-open { border-color:var(--accent-mid); background:var(--accent-dim); }
        .pq-card-top { display:flex; align-items:flex-start; gap:12px; padding:16px 18px; }
        .pq-num { font-family:var(--ff-mono); font-size:9px; font-weight:700; color:var(--accent); letter-spacing:.1em; flex-shrink:0; margin-top:2px; min-width:20px; }
        .pq-question { flex:1; font-size:.93rem; color:var(--text); line-height:1.6; font-weight:500; }
        .pq-chevron { font-size:1rem; color:var(--text3); flex-shrink:0; transition:transform .25s var(--ease); display:inline-block; margin-top:2px; }
        .pq-answer { padding:0 18px 18px; border-top:1px solid var(--border); }
        .pq-answer-label { font-family:var(--ff-mono); font-size:8.5px; letter-spacing:.2em; text-transform:uppercase; color:var(--accent); margin:12px 0 8px; display:block; }
        .pq-answer-text { font-size:.9rem; color:var(--text2); line-height:1.8; }
        .revision-content,.notes-content { line-height:1.8; }
        .notes-download-row { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:32px; padding:18px 20px; border-radius:12px; border:1px solid var(--border2); background:var(--blue-dim); }
        .notes-download-info { display:flex; align-items:center; gap:14px; }
        .notes-download-icon { font-size:1.5rem; flex-shrink:0; }
        .notes-download-title { font-family:var(--ff-head); font-size:.95rem; font-weight:700; color:var(--text); margin-bottom:3px; }
        .notes-download-sub { font-family:var(--ff-mono); font-size:9px; color:var(--text3); letter-spacing:.07em; }
        .notes-download-btn { font-family:var(--ff-mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; padding:10px 20px; border-radius:7px; border:1px solid var(--blue); background:var(--blue-dim); color:var(--blue); cursor:pointer; transition:background .2s,transform .15s; white-space:nowrap; font-weight:600; flex-shrink:0; }
        .notes-download-btn:hover { background:rgba(56,189,248,.18); transform:translateY(-1px); }

        /* Profile */
        .prof-overlay { position:fixed; inset:0; z-index:1000; overflow:hidden; background:rgba(230,248,255,.92); backdrop-filter:blur(16px); display:flex; align-items:stretch; justify-content:flex-end; animation:overlayIn .3s ease both; }
        body.dark-mode .prof-overlay { background:rgba(5,5,14,.9); }
        .prof-panel { width:min(520px,100vw); background:#ffffff; border-left:1px solid var(--border2); display:flex; flex-direction:column; height:100dvh; max-height:100vh; animation:panelIn .38s var(--ease2) both; overflow:hidden; }
        body.dark-mode .prof-panel { background:#0c0c1e; }
        .prof-header { flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:24px 26px 20px; border-bottom:1px solid var(--border); }
        .prof-eyebrow { font-family:var(--ff-mono); font-size:9px; letter-spacing:.25em; text-transform:uppercase; color:var(--accent); display:block; margin-bottom:4px; }
        .prof-title { font-family:var(--ff-chapter); font-size:1.5rem; color:var(--text); }
        .prof-body { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; padding:20px 26px 28px; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; scroll-behavior:auto; }
        .prof-body::-webkit-scrollbar { width:4px; }
        .prof-body::-webkit-scrollbar-thumb { background:var(--border2); border-radius:999px; }
        .prof-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:60px 20px; text-align:center; }
        .prof-empty-icon { font-size:2.5rem; opacity:.5; }
        .prof-empty-title { font-family:var(--ff-head); font-size:1.1rem; font-weight:700; color:var(--text2); }
        .prof-empty-sub { font-size:.88rem; color:var(--text3); line-height:1.65; max-width:260px; }
        .prof-courses { display:flex; flex-direction:column; gap:14px; }
        .prof-course-card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:18px; transition:border-color .2s; animation:cardIn .4s var(--ease2) both; }
        .prof-course-card:hover { border-color:var(--border2); }
        .prof-card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:12px; }
        .prof-card-info { flex:1; min-width:0; }
        .prof-card-title { font-family:var(--ff-head); font-size:.97rem; font-weight:700; color:var(--text); margin-bottom:5px; line-height:1.3; }
        .prof-card-meta { display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-family:var(--ff-mono); font-size:10px; color:var(--text3); letter-spacing:.06em; }
        .prof-card-tested { color:var(--green); font-weight:600; }
        .prof-remove-btn { width:26px; height:26px; border-radius:5px; border:1px solid var(--border); background:transparent; color:var(--text3); font-size:.8rem; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:background .15s,color .15s,border-color .15s; }
        .prof-remove-btn:hover { background:var(--red-dim); border-color:var(--red); color:var(--red); }
        .prof-prog-wrap { margin-bottom:14px; }
        .prof-prog-track { height:3px; background:var(--surface2); border-radius:999px; overflow:hidden; margin-bottom:5px; }
        .prof-prog-fill { height:100%; background:linear-gradient(90deg,var(--accent),var(--accent-light)); border-radius:999px; transition:width .6s var(--ease); }
        .prof-prog-label { font-family:var(--ff-mono); font-size:9px; color:var(--text3); letter-spacing:.08em; }
        .prof-card-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .prof-action-btn { font-family:var(--ff-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; padding:7px 13px; border-radius:6px; cursor:pointer; transition:background .2s,transform .15s,color .2s; white-space:nowrap; flex-shrink:0; font-weight:600; }
        .prof-action-btn:hover { transform:translateY(-1px); }
        .prof-open-btn { background:var(--surface2); border:1px solid var(--border2); color:var(--text2); }
        .prof-open-btn:hover { background:var(--surface); border-color:var(--accent-mid); color:var(--accent); }
        .prof-analysis-btn { background:var(--green-dim); border:1px solid var(--green); color:var(--green); }
        .prof-analysis-btn:hover { background:rgba(16,185,129,.22); }
        .prof-test-btn { background:var(--accent-dim); border:1px solid var(--accent-mid); color:var(--accent); }
        .prof-test-btn:hover { background:var(--accent-glow2); }

        /* Gate */
        .gate-overlay { position:fixed; inset:0; z-index:1200; overflow:hidden; background:rgba(230,248,255,.9); backdrop-filter:blur(16px); display:flex; align-items:center; justify-content:center; animation:overlayIn .25s ease both; }
        body.dark-mode .gate-overlay { background:rgba(5,5,14,.9); }
        .gate-modal { background:#ffffff; border:1px solid var(--border2); border-radius:16px; padding:36px 32px; max-width:420px; width:90%; text-align:center; animation:popIn .4s var(--ease2) both; display:flex; flex-direction:column; align-items:center; gap:14px; }
        body.dark-mode .gate-modal { background:#0e0e22; }
        .gate-icon { font-size:2.5rem; }
        .gate-title { font-family:var(--ff-head); font-size:1.3rem; font-weight:800; color:var(--text); }
        .gate-sub { font-size:.9rem; color:var(--text2); line-height:1.7; max-width:320px; }
        .gate-meta { display:flex; gap:10px; align-items:center; font-family:var(--ff-mono); font-size:9.5px; color:var(--text3); letter-spacing:.1em; flex-wrap:wrap; justify-content:center; }
        .gate-actions { display:flex; gap:10px; margin-top:6px; }
        .gate-cancel-btn { padding:10px 20px; border-radius:8px; border:1px solid var(--border2); background:transparent; color:var(--text3); font-family:var(--ff-mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; cursor:pointer; transition:background .2s,color .2s; }
        .gate-cancel-btn:hover { background:var(--surface2); color:var(--text); }
        .gate-start-btn { padding:10px 22px; border-radius:8px; border:none; background:var(--accent); color:#fff; font-family:var(--ff-head); font-size:.9rem; font-weight:700; cursor:pointer; transition:background .2s,transform .15s,box-shadow .2s; }
        .gate-start-btn:hover { background:var(--accent-mid); transform:translateY(-1px); box-shadow:0 8px 24px var(--accent-glow); }

        /* Full course test */
        .fct-overlay { position:fixed; inset:0; z-index:1100; overflow:hidden; background:rgba(230,248,255,.95); backdrop-filter:blur(16px); display:flex; align-items:stretch; justify-content:center; animation:overlayIn .3s ease both; }
        body.dark-mode .fct-overlay { background:rgba(5,5,14,.95); }
        .fct-panel { width:min(760px,100vw); background:#ffffff; display:flex; flex-direction:column; height:100dvh; max-height:100vh; animation:fctIn .4s var(--ease2) both; overflow:hidden; }
        body.dark-mode .fct-panel { background:#0c0c1e; }
        .fct-header { flex:0 0 auto; padding:24px 32px 20px; border-bottom:1px solid var(--border); display:flex; align-items:flex-start; justify-content:space-between; gap:16px; background:var(--accent-dim); }
        .fct-header-left { display:flex; flex-direction:column; gap:4px; min-width:0; }
        .fct-eyebrow { font-family:var(--ff-mono); font-size:9px; letter-spacing:.25em; text-transform:uppercase; color:var(--accent); }
        .fct-title { font-family:var(--ff-chapter); font-size:1.5rem; color:var(--text); line-height:1.2; }
        .fct-meta { font-family:var(--ff-mono); font-size:9px; color:var(--text3); letter-spacing:.08em; margin-top:2px; }
        .fct-body { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; padding:24px 32px 28px; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; scroll-behavior:auto; }
        .fct-body::-webkit-scrollbar { width:4px; }
        .fct-body::-webkit-scrollbar-thumb { background:var(--border2); border-radius:999px; }
        .fct-done { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:60px 20px; text-align:center; }
        .fct-done-icon { font-size:3rem; }
        .fct-done-title { font-family:var(--ff-head); font-size:1.4rem; font-weight:800; color:var(--text); }
        .fct-done-sub { font-size:.9rem; color:var(--text2); line-height:1.65; }
        .fct-done-btn { margin-top:8px; padding:12px 24px; border-radius:9px; border:none; background:var(--accent); color:#fff; font-family:var(--ff-head); font-size:.95rem; font-weight:700; cursor:pointer; transition:background .2s,transform .15s; }
        .fct-done-btn:hover { background:var(--accent-mid); transform:translateY(-1px); }
        .fct-questions { display:flex; flex-direction:column; gap:18px; }
        .fct-question { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:18px; transition:border-color .2s; animation:qIn .35s var(--ease2) both; }
        .fct-question:hover { border-color:var(--border2); }
        .fct-q-top { display:flex; gap:12px; align-items:flex-start; margin-bottom:13px; }
        .fct-q-num { font-family:var(--ff-mono); font-size:9px; font-weight:700; color:var(--accent); letter-spacing:.1em; flex-shrink:0; min-width:24px; margin-top:2px; }
        .fct-q-right { display:flex; flex-direction:column; gap:4px; flex:1; min-width:0; }
        .fct-q-topic { font-family:var(--ff-mono); font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--text3); padding:2px 7px; background:var(--surface2); border-radius:3px; display:inline-flex; align-self:flex-start; }
        .fct-q-text { font-size:.92rem; color:var(--text); line-height:1.6; font-weight:500; }
        .fct-opts { display:flex; flex-direction:column; gap:6px; }
        .fct-opt { width:100%; display:flex; align-items:center; gap:11px; padding:10px 13px; border-radius:8px; background:transparent; border:1px solid var(--border); color:var(--text2); font-family:var(--ff-body); font-size:.875rem; cursor:pointer; text-align:left; transition:background .12s,border-color .12s,color .12s,transform .1s; }
        .fct-opt:hover { background:var(--surface2); border-color:var(--border2); color:var(--text); transform:translateX(2px); }
        .fco-selected { background:var(--accent-dim)!important; border-color:var(--accent-mid)!important; color:var(--text)!important; }
        .fco-letter { font-family:var(--ff-mono); font-size:9px; font-weight:700; flex-shrink:0; width:22px; height:22px; border-radius:4px; display:flex; align-items:center; justify-content:center; background:var(--surface2); transition:background .12s,color .12s; }
        .fco-selected .fco-letter { background:var(--accent); color:#fff; }
        .fco-text { flex:1; line-height:1.45; }
        .fct-footer { flex:0 0 auto; padding:16px 32px; border-top:1px solid var(--border); display:flex; align-items:center; gap:16px; background:var(--surface); }
        .fct-footer-hint { font-family:var(--ff-mono); font-size:10px; color:var(--text3); letter-spacing:.08em; flex:1; }
        .fct-submit-btn { padding:13px 28px; border-radius:9px; border:none; background:var(--accent); color:#fff; font-family:var(--ff-head); font-size:.95rem; font-weight:700; cursor:pointer; transition:background .15s,transform .15s,box-shadow .15s; display:flex; align-items:center; gap:8px; flex-shrink:0; }
        .fct-submit-btn:hover:not(:disabled) { background:var(--accent-mid); transform:translateY(-1px); box-shadow:0 8px 24px var(--accent-glow); }
        .fct-submit-btn:disabled { opacity:.45; cursor:not-allowed; }

        /* Course analysis */
        .ca-overlay { position:fixed; inset:0; z-index:1100; overflow:hidden; background:rgba(230,248,255,.9); backdrop-filter:blur(14px); display:flex; align-items:stretch; justify-content:flex-end; animation:overlayIn .3s ease both; }
        body.dark-mode .ca-overlay { background:rgba(5,5,14,.9); }
        .ca-panel { width:min(640px,100vw); background:#ffffff; border-left:1px solid var(--border2); display:flex; flex-direction:column; height:100dvh; max-height:100vh; animation:panelIn .38s var(--ease2) both; overflow:hidden; }
        body.dark-mode .ca-panel { background:#0c0c1e; }
        .ca-header { flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:24px 28px 20px; border-bottom:1px solid var(--border); }
        .ca-eyebrow { font-family:var(--ff-mono); font-size:9px; letter-spacing:.25em; text-transform:uppercase; color:var(--accent); display:block; margin-bottom:4px; }
        .ca-title { font-family:var(--ff-chapter); font-size:1.3rem; color:var(--text); line-height:1.2; }
        .ca-body { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; padding:22px 28px 28px; display:flex; flex-direction:column; gap:20px; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; scroll-behavior:auto; }
        .ca-body::-webkit-scrollbar { width:4px; }
        .ca-body::-webkit-scrollbar-thumb { background:var(--border2); border-radius:999px; }
        .ca-score-hero { display:flex; align-items:center; gap:20px; padding:20px; background:var(--accent-dim); border:1px solid var(--accent-mid); border-radius:14px; }
        .ca-score-big { font-family:var(--ff-head); font-size:3rem; font-weight:900; color:var(--text); letter-spacing:-.03em; line-height:1; }
        .ca-score-denom { font-size:1.4rem; color:var(--text3); font-weight:400; }
        .ca-score-right { display:flex; flex-direction:column; gap:6px; }
        .ca-score-pct { font-family:var(--ff-mono); font-size:1.1rem; font-weight:700; color:var(--accent); }
        .ca-mastery-badge { font-family:var(--ff-mono); font-size:9px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; padding:4px 10px; border-radius:999px; display:inline-flex; align-self:flex-start; }
        .ca-score-sub { font-family:var(--ff-mono); font-size:9px; color:var(--text3); letter-spacing:.1em; text-transform:uppercase; }
        .ca-verdict { font-size:.9rem; color:var(--text2); line-height:1.75; }
        .ca-section { display:flex; flex-direction:column; gap:10px; }
        .ca-section-label { display:flex; align-items:center; gap:8px; font-family:var(--ff-mono); font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--text3); }
        .ca-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
        .ca-topic-bars { display:flex; flex-direction:column; gap:8px; }
        .ca-topic-bar-row { display:flex; align-items:center; gap:10px; }
        .ca-topic-bar-name { font-size:.8rem; color:var(--text2); flex:0 0 160px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ca-topic-bar-track { flex:1; height:6px; background:var(--surface2); border-radius:999px; overflow:hidden; }
        .ca-topic-bar-fill { height:100%; border-radius:999px; transition:width .8s var(--ease); }
        .ca-topic-bar-pct { font-family:var(--ff-mono); font-size:9px; font-weight:600; min-width:32px; text-align:right; }
        .ca-list-item { display:flex; gap:9px; align-items:flex-start; font-size:.875rem; line-height:1.65; padding:4px 0; }
        .ca-strong-item { color:var(--green); } .ca-strong-item>span:first-child { font-weight:700; flex-shrink:0; margin-top:1px; }
        .ca-weak-item { color:var(--red); } .ca-weak-item>span:first-child { flex-shrink:0; margin-top:2px; font-size:.7rem; }
        .ca-plan-item { color:var(--text2); }
        .ca-plan-num { font-family:var(--ff-mono); font-size:9px; font-weight:700; color:var(--accent); background:var(--accent-dim); width:20px; height:20px; border-radius:4px; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }

        /* Quiz */
        .qm-overlay { position:fixed; inset:0; z-index:1000; overflow:hidden; background:rgba(230,248,255,.9); backdrop-filter:blur(14px); display:flex; align-items:stretch; justify-content:flex-end; animation:overlayIn .3s ease both; }
        body.dark-mode .qm-overlay { background:rgba(5,5,14,.9); }
        .qm-panel { width:min(720px,100vw); background:#ffffff; border-left:1px solid var(--border2); display:flex; flex-direction:column; height:100dvh; max-height:100vh; animation:panelIn .38s var(--ease2) both; overflow:hidden; }
        body.dark-mode .qm-panel { background:#0c0c1e; }
        .qm-header { flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:24px 28px 20px; border-bottom:1px solid var(--border); }
        .qm-header-left { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }
        .qm-eyebrow { font-family:var(--ff-mono); font-size:9px; letter-spacing:.25em; text-transform:uppercase; color:var(--accent); }
        .qm-title { font-family:var(--ff-chapter); font-size:1.35rem; color:var(--text); line-height:1.3; word-break:break-word; }
        .qm-header-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
        .qm-more-btn { font-family:var(--ff-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; padding:8px 14px; border-radius:6px; border:1px solid var(--accent-mid); background:var(--accent-dim); color:var(--accent); cursor:pointer; transition:background .2s,transform .15s; white-space:nowrap; display:flex; align-items:center; gap:6px; }
        .qm-more-btn:hover:not(:disabled) { background:var(--accent-glow2); transform:translateY(-1px); }
        .qm-more-btn:disabled { opacity:.5; cursor:not-allowed; }
        .qm-reset-btn { font-family:var(--ff-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; padding:8px 14px; border-radius:6px; border:1px solid var(--border2); background:transparent; color:var(--text3); cursor:pointer; transition:background .2s,color .2s; white-space:nowrap; }
        .qm-reset-btn:hover { background:var(--surface2); color:var(--text); }
        .qm-close-btn { width:34px; height:34px; border-radius:6px; border:1px solid var(--border); background:transparent; color:var(--text3); font-size:1rem; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s,color .15s; flex-shrink:0; }
        .qm-close-btn:hover { background:var(--surface2); color:var(--text); }
        .qm-prog { flex:0 0 auto; position:relative; height:3px; background:var(--surface2); }
        .qm-prog-bar { position:absolute; left:0; top:0; height:100%; background:linear-gradient(90deg,var(--accent),var(--accent-light)); transition:width .5s var(--ease2); }
        .qm-prog-meta { position:absolute; right:14px; top:7px; display:flex; gap:16px; align-items:center; font-family:var(--ff-mono); font-size:9px; color:var(--text3); letter-spacing:.1em; }
        .qm-body { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; padding:20px 28px 28px; display:flex; flex-direction:column; gap:16px; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; scroll-behavior:auto; }
        .qm-body::-webkit-scrollbar { width:4px; }
        .qm-body::-webkit-scrollbar-thumb { background:var(--border2); border-radius:999px; }
        .qm-questions { display:flex; flex-direction:column; gap:14px; }
        .qm-question { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:18px 18px 14px; transition:border-color .25s; animation:qIn .4s var(--ease2) both; }
        .qm-q-correct { border-color:var(--green); background:var(--green-dim); }
        .qm-q-wrong { border-color:var(--red); background:var(--red-dim); }
        .qm-q-top { display:flex; gap:10px; align-items:flex-start; margin-bottom:14px; }
        .qm-q-num { font-family:var(--ff-mono); font-size:9px; font-weight:600; color:var(--accent); letter-spacing:.1em; flex-shrink:0; margin-top:3px; min-width:24px; }
        .qm-q-text { flex:1; font-size:.95rem; color:var(--text); line-height:1.6; font-weight:500; }
        .qm-q-badge { font-family:var(--ff-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; padding:3px 8px; border-radius:4px; flex-shrink:0; margin-top:2px; white-space:nowrap; }
        .qb-correct { color:var(--green); background:var(--green-dim); }
        .qb-wrong { color:var(--red); background:var(--red-dim); }
        .qm-opts { display:flex; flex-direction:column; gap:7px; margin-bottom:14px; }
        .qm-opt { width:100%; display:flex; align-items:center; gap:12px; padding:11px 14px; border-radius:9px; background:transparent; border:1px solid var(--border); color:var(--text2); font-family:var(--ff-body); font-size:.9rem; cursor:pointer; text-align:left; transition:background .15s,border-color .15s,color .15s,transform .12s; }
        .qm-opt:hover:not(:disabled) { background:var(--surface2); border-color:var(--border2); color:var(--text); transform:translateX(3px); }
        .qm-opt:disabled { cursor:default; transform:none; }
        .qo-selected { background:var(--accent-dim)!important; border-color:var(--accent-mid)!important; color:var(--text)!important; }
        .qo-correct { background:var(--green-dim)!important; border-color:var(--green)!important; color:var(--green)!important; }
        .qo-wrong { background:var(--red-dim)!important; border-color:var(--red)!important; color:var(--red)!important; }
        .qo-dim { opacity:.28; }
        .qo-letter { font-family:var(--ff-mono); font-size:9px; font-weight:700; flex-shrink:0; width:24px; height:24px; border-radius:5px; display:flex; align-items:center; justify-content:center; background:var(--surface2); transition:background .15s,color .15s; }
        .qo-selected .qo-letter { background:var(--accent); color:#fff; }
        .qo-correct .qo-letter { background:var(--green); color:#fff; }
        .qo-wrong .qo-letter { background:var(--red); color:#fff; }
        .qo-text { flex:1; line-height:1.5; }
        .qo-icon { font-size:.9rem; font-weight:700; flex-shrink:0; }
        .qo-icon-ok { color:var(--green); } .qo-icon-bad { color:var(--red); }
        .qm-check-btn { font-family:var(--ff-mono); font-size:9px; letter-spacing:.12em; text-transform:uppercase; padding:7px 14px; border-radius:6px; border:1px solid var(--border2); background:transparent; color:var(--text3); cursor:pointer; transition:background .2s,color .2s,border-color .2s; }
        .qm-check-btn:not(:disabled):hover { background:var(--surface2); color:var(--text); border-color:var(--accent-mid); }
        .qm-check-btn:disabled { opacity:.3; cursor:not-allowed; }
        .qm-explanation { margin-top:12px; border-radius:10px; overflow:hidden; animation:slideIn .35s var(--ease2) both; }
        .qe-correct { border:1px solid var(--green); background:var(--green-dim); }
        .qe-wrong { border:1px solid var(--red); background:var(--red-dim); }
        .qe-top { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border); }
        .qe-result-label { font-family:var(--ff-mono); font-size:9.5px; letter-spacing:.08em; font-weight:600; }
        .qe-correct .qe-result-label { color:var(--green); } .qe-wrong .qe-result-label { color:var(--red); }
        .qe-revisit-btn { font-family:var(--ff-mono); font-size:8.5px; letter-spacing:.1em; text-transform:uppercase; padding:5px 10px; border-radius:5px; border:1px solid var(--red); background:transparent; color:var(--red); cursor:pointer; transition:background .2s; white-space:nowrap; flex-shrink:0; }
        .qe-revisit-btn:hover { background:var(--red-dim); }
        .qe-body { padding:11px 14px; }
        .qe-text { font-family:var(--ff-body); font-size:.875rem; line-height:1.75; }
        .qe-correct .qe-text { color:var(--green); } .qe-wrong .qe-text { color:var(--red); }
        .qe-fallback { opacity:.7; font-style:italic; }
        .qe-loading { display:flex; align-items:center; gap:8px; font-family:var(--ff-mono); font-size:10px; color:var(--text3); }
        .qm-score-banner { display:flex; align-items:center; gap:14px; padding:16px 20px; border-radius:12px; animation:popIn .4s var(--ease2) both; }
        .sb-perfect { background:var(--green-dim); border:1px solid var(--green); }
        .sb-pass { background:var(--accent-dim); border:1px solid var(--accent-mid); }
        .sb-fail { background:var(--red-dim); border:1px solid var(--red); }
        .sb-emoji { font-size:1.7rem; flex-shrink:0; }
        .sb-text { flex:1; display:flex; flex-direction:column; gap:3px; }
        .sb-main { font-family:var(--ff-head); font-size:1.25rem; font-weight:800; }
        .sb-perfect .sb-main { color:var(--green); } .sb-pass .sb-main { color:var(--accent); } .sb-fail .sb-main { color:var(--red); }
        .sb-sub { font-family:var(--ff-mono); font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:var(--text3); }
        .sb-retry { font-family:var(--ff-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; padding:9px 15px; border-radius:6px; border:1px solid var(--border2); background:transparent; color:var(--text2); cursor:pointer; transition:background .2s,color .2s; white-space:nowrap; flex-shrink:0; }
        .sb-retry:hover { background:var(--surface2); color:var(--text); }
        .qm-footer { flex:0 0 auto; padding:16px 28px; border-top:1px solid var(--border); }
        .qm-finish-btn { width:100%; padding:13px 20px; background:var(--accent); border:none; border-radius:9px; color:#fff; font-family:var(--ff-head); font-size:.95rem; font-weight:700; cursor:pointer; transition:transform .15s,background .15s,box-shadow .15s; }
        .qm-finish-btn:hover { transform:translateY(-2px); background:var(--accent-mid); box-shadow:0 8px 24px var(--accent-glow); }

        /* Adaptive */
        .adaptive-alert { display:flex; align-items:flex-start; gap:12px; padding:14px 16px; border-radius:10px; animation:alertIn .4s var(--ease2) both; }
        .aa-struggling { background:var(--red-dim); border:1px solid var(--red); }
        .aa-building { background:var(--orange-dim); border:1px solid var(--orange); }
        .aa-icon { font-size:1.1rem; flex-shrink:0; margin-top:1px; }
        .aa-content { flex:1; min-width:0; }
        .aa-title { font-size:.875rem; font-weight:600; color:var(--text); line-height:1.45; margin-bottom:4px; }
        .aa-sub { font-family:var(--ff-mono); font-size:9px; letter-spacing:.07em; color:var(--text3); line-height:1.5; }
        .aa-btn { font-family:var(--ff-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; padding:7px 12px; border-radius:6px; border:1px solid var(--red); background:transparent; color:var(--red); cursor:pointer; white-space:nowrap; flex-shrink:0; transition:background .2s; }
        .aa-btn:hover { background:var(--red-dim); }
        .arc-wrap { border-radius:14px; overflow:hidden; border:1px solid var(--border2); background:var(--surface); animation:arcIn .5s var(--ease2) both; }
        .arc-loading { padding:20px 22px; display:flex; align-items:center; }
        .arc-spinner-row { display:flex; align-items:center; gap:10px; }
        .arc-loading-text { font-family:var(--ff-mono); font-size:10px; letter-spacing:.15em; text-transform:uppercase; color:var(--text3); }
        .arc-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:18px 20px 14px; border-bottom:1px solid var(--border); }
        .arc-header-left { display:flex; flex-direction:column; gap:8px; }
        .arc-eyebrow { font-family:var(--ff-mono); font-size:8.5px; letter-spacing:.25em; text-transform:uppercase; color:var(--accent); }
        .arc-score-row { display:flex; align-items:baseline; gap:10px; }
        .arc-score { font-family:var(--ff-head); font-size:1.6rem; font-weight:900; color:var(--text); letter-spacing:-.02em; }
        .arc-pct { font-family:var(--ff-mono); font-size:.9rem; font-weight:600; color:var(--accent); }
        .arc-conf-badge { font-family:var(--ff-mono); font-size:9px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; padding:4px 10px; border-radius:999px; }
        .arc-close { width:28px; height:28px; border-radius:6px; border:1px solid var(--border); background:transparent; color:var(--text3); font-size:.85rem; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:background .15s,color .15s; }
        .arc-close:hover { background:var(--surface2); color:var(--text); }
        .arc-section { padding:14px 20px; border-bottom:1px solid var(--border); }
        .arc-section:last-child { border-bottom:none; }
        .arc-summary { font-size:.9rem; color:var(--text2); line-height:1.7; }
        .arc-section-label { display:flex; align-items:center; gap:8px; font-family:var(--ff-mono); font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--text3); margin-bottom:10px; }
        .arc-label-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
        .arc-weak-list { display:flex; flex-direction:column; gap:6px; }
        .arc-weak-item { display:flex; gap:8px; align-items:flex-start; font-size:.875rem; color:var(--red); line-height:1.6; }
        .arc-weak-bullet { color:var(--red); flex-shrink:0; margin-top:2px; font-size:.75rem; }
        .arc-rec-list { display:flex; flex-direction:column; gap:8px; }
        .arc-rec-item { display:flex; gap:10px; align-items:flex-start; font-size:.875rem; color:var(--text2); line-height:1.65; }
        .arc-rec-num { font-family:var(--ff-mono); font-size:9px; font-weight:700; color:var(--accent); background:var(--accent-dim); width:20px; height:20px; border-radius:4px; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }
        .arc-next { padding:14px 20px; background:var(--accent-dim); border-top:1px solid var(--border); }
        .arc-next-label { font-family:var(--ff-mono); font-size:8.5px; letter-spacing:.2em; text-transform:uppercase; color:var(--text3); margin-bottom:8px; }
        .arc-next-btn { display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:8px; border:1px solid var(--border2); background:var(--surface); color:var(--text2); font-size:.88rem; }
        .arc-next-icon { font-size:1rem; flex-shrink:0; color:var(--accent); }

        /* Spinners */
        .spin { display:inline-block; width:16px; height:16px; border:2px solid rgba(0,0,0,.1); border-top-color:var(--accent); border-radius:50%; animation:spinAnim .6s linear infinite; vertical-align:middle; }
        body.dark-mode .spin { border-color:rgba(255,255,255,.15); border-top-color:#fff; }
        .spin-dark { border-color:rgba(0,0,0,.2); border-top-color:#0a1a24; }
        .spin-white { border-color:rgba(255,255,255,.2); border-top-color:#fff; }
        .spin-sm { width:11px; height:11px; border-width:1.5px; border-color:var(--border2); border-top-color:var(--text3); }
        .spin-accent { border-color:var(--accent-dim); border-top-color:var(--accent); }

        /* AI Tutor */
        .tutor-fab { position:fixed; bottom:28px; right:28px; z-index:900; display:flex; align-items:center; gap:8px; padding:12px 20px 12px 16px; background:var(--accent); border:1px solid var(--accent-mid); border-radius:999px; cursor:pointer; box-shadow:0 4px 24px var(--accent-glow); transition:transform .2s var(--ease),box-shadow .2s,background .2s; animation:fabIn .6s var(--ease2) both; }
        body.dark-mode .tutor-fab { background:linear-gradient(135deg,#1a1230,#120d22); }
        .tutor-fab:hover { transform:translateY(-3px) scale(1.03); box-shadow:0 8px 32px var(--accent-glow); }
        .tutor-fab-icon { font-size:1.05rem; color:#fff; animation:starSpin 4s linear infinite; }
        .tutor-fab-label { font-family:var(--ff-head); font-size:.88rem; font-weight:700; color:#fff; letter-spacing:.02em; }
        .tutor-fab-pulse { position:absolute; top:-3px; right:-3px; width:10px; height:10px; border-radius:50%; background:var(--green); border:2px solid var(--bg); animation:pulseDot 2s ease-in-out infinite; }
        .tutor-overlay { position:fixed; inset:0; z-index:1050; background:rgba(230,248,255,.88); backdrop-filter:blur(14px); display:flex; align-items:stretch; justify-content:flex-end; animation:overlayIn .3s ease both; overflow:hidden; }
        body.dark-mode .tutor-overlay { background:rgba(5,5,14,.88); }
        .tutor-panel { width:min(560px,100vw); background:#ffffff; border-left:1px solid var(--border2); display:flex; flex-direction:column; height:100dvh; max-height:100vh; animation:panelIn .38s var(--ease2) both; overflow:hidden; }
        body.dark-mode .tutor-panel { background:#0a0a1a; }
        .tutor-header { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:18px 20px 16px; border-bottom:1px solid var(--border); background:var(--accent-dim); }
        .tutor-header-left { display:flex; align-items:center; gap:12px; }
        .tutor-avatar { width:38px; height:38px; border-radius:50%; background:var(--accent); border:1px solid var(--accent-mid); display:flex; align-items:center; justify-content:center; font-size:1rem; color:#fff; flex-shrink:0; animation:starSpin 6s linear infinite; }
        .tutor-header-title { font-family:var(--ff-head); font-size:1rem; font-weight:800; color:var(--text); }
        .tutor-header-sub { font-family:var(--ff-mono); font-size:9px; color:var(--text3); letter-spacing:.1em; margin-top:2px; }
        .tutor-header-actions { display:flex; gap:6px; align-items:center; }
        .tutor-clear-btn { width:30px; height:30px; border-radius:6px; border:1px solid var(--border); background:transparent; color:var(--text3); font-size:1rem; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s,color .15s; }
        .tutor-clear-btn:hover { background:var(--surface2); color:var(--text); }
        .tutor-style-bar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 20px; border-bottom:1px solid var(--border); background:var(--surface); }
        .tutor-style-toggle { display:flex; align-items:center; gap:7px; background:transparent; border:none; cursor:pointer; font-family:var(--ff-body); font-size:.82rem; color:var(--text2); transition:color .15s; padding:0; }
        .tutor-style-toggle:hover { color:var(--text); }
        .tutor-style-toggle strong { color:var(--accent); font-weight:600; }
        .tutor-style-icon { font-size:.85rem; }
        .tutor-style-chevron { color:var(--text3); font-size:.75rem; transition:transform .2s var(--ease); display:inline-block; margin-left:2px; }
        .tutor-context-tag { display:flex; align-items:center; gap:5px; font-family:var(--ff-mono); font-size:8.5px; letter-spacing:.1em; color:var(--text3); padding:3px 8px; border-radius:4px; background:var(--surface2); border:1px solid var(--border); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .tutor-styles-grid { flex:0 0 auto; display:flex; flex-wrap:wrap; gap:6px; padding:10px 20px 12px; border-bottom:1px solid var(--border); background:var(--surface); animation:revealDown .2s var(--ease2) both; }
        .tutor-style-chip { font-family:var(--ff-mono); font-size:9px; letter-spacing:.08em; padding:5px 11px; border-radius:999px; cursor:pointer; border:1px solid var(--border2); background:transparent; color:var(--text2); transition:background .15s,color .15s,border-color .15s; white-space:nowrap; }
        .tutor-style-chip:hover { background:var(--surface2); color:var(--text); }
        .tutor-style-chip.tsc-active { background:var(--accent-dim); border-color:var(--accent-mid); color:var(--accent); font-weight:600; }
        .tutor-body { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; padding:18px 20px; display:flex; flex-direction:column; gap:14px; overscroll-behavior:contain; scroll-behavior:smooth; -webkit-overflow-scrolling:touch; }
        .tutor-body::-webkit-scrollbar { width:4px; }
        .tutor-body::-webkit-scrollbar-thumb { background:var(--border2); border-radius:999px; }
        .tutor-msg { display:flex; gap:10px; align-items:flex-start; animation:msgIn .3s var(--ease2) both; }
        .tm-user { flex-direction:row-reverse; }
        .tm-ai-avatar { width:28px; height:28px; border-radius:50%; background:var(--accent-dim); border:1px solid var(--accent-mid); display:flex; align-items:center; justify-content:center; font-size:.7rem; color:var(--accent); flex-shrink:0; margin-top:2px; }
        .tm-bubble { max-width:85%; padding:12px 15px; border-radius:14px; font-family:var(--ff-body); font-size:.875rem; line-height:1.7; }
        .tm-ai .tm-bubble { background:var(--surface); border:1px solid var(--border); color:var(--text); border-radius:4px 14px 14px 14px; }
        .tm-user .tm-bubble { background:var(--accent); border:1px solid var(--accent-mid); color:#fff; border-radius:14px 4px 14px 14px; }
        .tm-text { display:flex; flex-direction:column; gap:2px; }
        .tm-thinking { display:flex; align-items:center; gap:5px; padding:14px 18px; }
        .tm-dot { width:7px; height:7px; border-radius:50%; background:var(--accent); opacity:.4; animation:tmDot 1.2s ease-in-out infinite; }
        .tutor-quick-wrap { flex:0 0 auto; padding:10px 20px 12px; border-top:1px solid var(--border); background:var(--surface); animation:revealDown .2s var(--ease2) both; max-height:200px; overflow-y:auto; }
        .tutor-quick-label { font-family:var(--ff-mono); font-size:8.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--text3); margin-bottom:8px; }
        .tutor-quick-list { display:flex; flex-direction:column; gap:5px; }
        .tutor-quick-chip { text-align:left; padding:8px 12px; border-radius:8px; border:1px solid var(--border); background:transparent; color:var(--text2); font-family:var(--ff-body); font-size:.82rem; cursor:pointer; transition:background .15s,color .15s,border-color .15s; line-height:1.4; }
        .tutor-quick-chip:hover { background:var(--surface2); border-color:var(--accent-mid); color:var(--text); }
        .tutor-input-bar { flex:0 0 auto; display:flex; align-items:flex-end; gap:8px; padding:12px 16px 16px; border-top:1px solid var(--border); background:var(--surface); }
        .tutor-quick-btn { width:36px; height:36px; border-radius:8px; border:1px solid var(--border2); background:transparent; color:var(--text3); font-size:1rem; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:background .15s,color .15s,border-color .15s; }
        .tutor-quick-btn:hover { background:var(--surface2); color:var(--accent); border-color:var(--accent-mid); }
        .tutor-input { flex:1; min-height:36px; max-height:120px; background:var(--bg); border:1.5px solid var(--border2); border-radius:10px; padding:8px 14px; color:var(--text); font-family:var(--ff-body); font-size:.9rem; outline:none; transition:border-color .2s,box-shadow .2s; line-height:1.5; overflow-y:auto; }
        .tutor-input:focus { border-color:var(--accent-mid); box-shadow:0 0 0 2px var(--accent-dim); }
        .tutor-input::placeholder { color:var(--text3); }
        .tutor-send-btn { width:36px; height:36px; border-radius:8px; border:none; background:var(--accent); color:#fff; font-size:1.1rem; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:background .15s,transform .15s,box-shadow .15s; }
        .tutor-send-btn:hover:not(:disabled) { background:var(--accent-mid); transform:scale(1.08); box-shadow:0 4px 14px var(--accent-glow); }
        .tutor-send-btn:disabled { opacity:.4; cursor:not-allowed; }

        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:var(--border2); border-radius:999px; }

        /* ══ COURSE HEADER ACTIONS ══ */
        .course-header-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:4px; }
        .course-dl-btn {
          display:inline-flex; align-items:center; gap:7px;
          font-family:var(--ff-mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase;
          padding:9px 16px; border-radius:8px;
          border:1px solid var(--orange); background:rgba(249,115,22,.08);
          color:var(--orange); cursor:pointer; transition:background .2s,transform .15s; font-weight:600;
        }
        .course-dl-btn:hover { background:rgba(249,115,22,.16); transform:translateY(-1px); }
        .course-dl-btn:disabled { opacity:.72; cursor:wait; transform:none; }

        /* ══ AUTH MODAL ══ */
        .auth-overlay {
          position:fixed; inset:0; z-index:1400;
          background:rgba(0,0,0,.45); backdrop-filter:blur(10px);
          display:flex; align-items:center; justify-content:center;
          animation:overlayIn .25s ease both;
        }
        .auth-modal {
          background:var(--bg);
          border:1px solid var(--border2);
          border-radius:20px;
          padding:36px 32px 28px;
          width:min(420px,calc(100vw - 32px));
          position:relative;
          animation:popIn .35s var(--ease2) both;
          box-shadow:0 20px 60px rgba(0,0,0,.25);
        }
        .auth-close { position:absolute; top:16px; right:16px; }
        .auth-logo {
          font-family:var(--ff-head); font-weight:900; font-size:1.4rem;
          letter-spacing:.18em; text-transform:uppercase; color:var(--orange);
          text-align:center; margin-bottom:20px;
        }
        .auth-tabs { display:flex; gap:0; border:1px solid var(--border2); border-radius:10px; overflow:hidden; margin-bottom:24px; }
        .auth-tab {
          flex:1; padding:10px; background:transparent; border:none; cursor:pointer;
          font-family:var(--ff-mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase;
          color:var(--text3); transition:background .18s,color .18s;
        }
        .auth-tab.at-active { background:var(--accent); color:#fff; font-weight:700; }
        .auth-form { display:flex; flex-direction:column; gap:14px; }
        .auth-field { display:flex; flex-direction:column; gap:5px; }
        .auth-label { font-family:var(--ff-mono); font-size:9px; letter-spacing:.14em; text-transform:uppercase; color:var(--text3); }
        .auth-input {
          background:var(--surface); border:1.5px solid var(--border2);
          border-radius:9px; padding:11px 14px; color:var(--text);
          font-family:var(--ff-body); font-size:.9rem; outline:none;
          transition:border-color .2s, box-shadow .2s;
        }
        .auth-input:focus { border-color:var(--accent-mid); box-shadow:0 0 0 2px var(--accent-dim); }
        .auth-error {
          font-family:var(--ff-mono); font-size:10px; letter-spacing:.06em;
          color:var(--red); background:var(--red-dim); border:1px solid var(--red);
          border-radius:7px; padding:8px 12px;
        }
        .auth-submit {
          padding:13px 20px; border-radius:10px; border:none;
          background:var(--accent); color:#fff;
          font-family:var(--ff-head); font-size:.95rem; font-weight:700;
          cursor:pointer; transition:background .2s,transform .15s,box-shadow .2s;
          display:flex; align-items:center; justify-content:center; gap:8px; margin-top:4px;
        }
        .auth-submit:hover:not(:disabled) { background:var(--accent-mid); transform:translateY(-1px); box-shadow:0 8px 20px var(--accent-glow); }
        .auth-submit:disabled { opacity:.5; cursor:not-allowed; }
        .auth-switch { font-size:.82rem; color:var(--text3); text-align:center; margin-top:14px; }
        .auth-switch-btn { background:none; border:none; cursor:pointer; color:var(--accent); font-weight:700; font-size:.82rem; text-decoration:underline; padding:0; }

        /* ══ PROFILE USER INFO ══ */
        .prof-user-name { font-family:var(--ff-mono); font-size:10px; color:var(--accent); letter-spacing:.08em; margin-bottom:2px; margin-top:3px; }
        .prof-signout-btn {
          font-family:var(--ff-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase;
          padding:6px 12px; border-radius:6px; border:1px solid var(--border2);
          background:transparent; color:var(--text3); cursor:pointer; white-space:nowrap;
          transition:background .15s,color .15s,border-color .15s;
        }
        .prof-signout-btn:hover { background:var(--red-dim); border-color:var(--red); color:var(--red); }

        /* ══ RESPONSIVE ══ */
        @media(max-width:1024px){
          .course-page{padding:28px 20px 80px}
          .il-sidebar{width:260px}
          .ca-topic-bar-name{flex:0 0 130px}
        }
        @media(max-width:768px){
          .navbar{padding:16px 20px}
          .classroom-status-pill{display:none}
          .classroom-live-toasts{top:88px;right:14px}
          .theme-toggle-btn{min-width:auto;padding:10px 12px}
          .hero-title{font-size:clamp(2rem,8vw,3rem)}
          .hero-sub{font-size:.92rem;padding:0 8px}
          .hero-center{padding:80px 16px 50px}
          .hero-shell{width:calc(100vw - 24px)}
          .hero-form-card{padding:16px;border-radius:20px}
          .home-lower-wrap{padding:0 14px 28px}
          .home-classroom-card{padding:16px;margin-top:-6px}
          .home-classroom-grid{grid-template-columns:1fr}
          .home-classroom-header{flex-direction:column;align-items:stretch}
          .hero-controls-row,.hero-controls-row-bottom{grid-template-columns:1fr}
          .hero-topic-input,.hero-control,.classroom-toggle,.classroom-connect-btn,.hero-generate-btn{width:100%}
          .classroom-toggle-note{white-space:normal}
          .compact-bar{padding:8px 14px}
          .compact-inner{flex-wrap:wrap}
          .compact-logo-kiri{border-right:none;padding-right:0;width:100%}
          .compact-input{font-size:.85rem;padding:7px 10px;min-width:0;flex:1 1 220px}.compact-select{padding:7px 10px;font-size:.82rem}
          .compact-classroom-btn,.compact-generate-btn{flex:1 1 100%}
          .course-page{padding:20px 14px 80px}.course-main-title{font-size:1.5rem}
          .course-stats{gap:14px;font-size:11px}.prog-right-meta{display:none}
          .prog-pct-label{font-size:1.2rem;min-width:48px}
          .ch-header{padding:14px 14px}.ch-title{font-size:1rem}
          .topic-row{padding:11px 14px 11px 28px}
          .topic-row:hover,.topic-row.t-active{padding-left:34px}
          .inline-lesson{display:flex;flex-direction:column}
          .il-main{padding:18px 14px 16px}.il-sidebar{width:100%;padding:0 14px 16px}
          .il-actions{flex-direction:column;gap:8px}.il-btn{width:100%;text-align:center;padding:11px}
          .cba-buttons,.rec-grid{grid-template-columns:1fr;gap:8px}.cba-btn{padding:14px 16px}
          .mode-panel,.mode-panel-wide,.qm-panel,.prof-panel,.ca-panel,.fct-panel,.tutor-panel{width:100vw;border-left:none;border-top:1px solid var(--border2)}
          .mode-panel,.mode-panel-wide{height:100dvh;max-height:100vh;border-radius:0;box-shadow:none}
          .mode-overlay,.prof-overlay,.qm-overlay,.ca-overlay,.fct-overlay,.tutor-overlay{align-items:flex-end;justify-content:stretch}
          .mode-overlay{padding:0;align-items:flex-end;overflow:hidden}
          @keyframes panelIn{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
          .mode-header,.qm-header,.fct-header,.ca-header,.prof-header,.tutor-header{padding:18px 18px 14px}
          .mode-body,.qm-body,.fct-body,.ca-body,.prof-body{padding:16px 16px 20px}
          .fct-footer,.qm-footer{padding:12px 16px}
          .tutor-fab{bottom:14px;right:14px;padding:10px 16px 10px 12px}.tutor-fab-label{font-size:.82rem}
          .tutor-input-bar{padding:10px 12px 14px}
          .ca-topic-bar-name{flex:0 0 90px;font-size:.75rem}.ca-score-big{font-size:2.4rem}
          .gate-modal{padding:28px 20px;margin:0 12px}
          .gate-actions{flex-direction:column;width:100%}
          .gate-start-btn,.gate-cancel-btn{width:100%;text-align:center}
        }
        @media(max-width:480px){
          .course-main-title{font-size:1.35rem}
          .qm-header-actions{gap:5px}.qm-more-btn,.qm-reset-btn{padding:6px 10px;font-size:8px}
          .fct-meta{display:none}.fct-title{font-size:1.25rem}
        }
      `}</style>

      {/* Apply dark-mode class to body */}
      {typeof document !== "undefined" && (() => {
        if (darkMode) document.body.classList.add("dark-mode");
        else document.body.classList.remove("dark-mode");
        return null;
      })()}

      {authLoading && <StartupLoadingOverlay />}

      {loading && <CourseLoadingOverlay topic={topic} level={level} />}

      {/* Auth Modal */}
      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onAuthSuccess={(user) => { setCurrentUser(user); setShowAuth(false); }}
        />
      )}

      {profileOpen && (
        <ProfilePanel
          onClose={() => { setProfileOpen(false); }}
          onNavigateToCourse={handleNavigateToCourse}
          currentUser={currentUser}
          courses={profileCourses}
          onCoursesRefresh={refreshProfileCourses}
          onSignOut={async () => { await clearSession(); setCurrentUser(null); setProfileCourses([]); setProfileOpen(false); setRecommendations(null); setClassroomData(null); setUseClassroomData(false); setClassroomInfoOpen(false); }}
        />
      )}

      {quizModal && (
        quizGenerating && !currentQuizText
          ? (<div className="qm-overlay" onClick={() => setQuizModal(null)}><div className="qm-panel" style={{ alignItems: "center", justifyContent: "center" }}><CinematicLoader label="Generating quiz questions…" sublabel="Tailoring to your lesson" /></div></div>)
          : currentQuizText
            ? (<QuizModal key={quizTick} rawQuiz={currentQuizText} moduleName={quizModal.moduleTitle} courseTopic={activeTopic} level={activeLevel} allTopics={getAllTopics(course)} onClose={() => setQuizModal(null)} onGenerateMore={() => generateQuizFor(quizModal.moduleTitle)} generating={quizGenerating} onRevisitLesson={() => { const t = quizModal?.moduleTitle; setQuizModal(null); if (t) openTopicByName(t); }} currentUser={currentUser} useClassroomData={useClassroomData} onRecommendationsUpdate={(nextRecommendations, revisionLesson) => { if (nextRecommendations) { setRecommendations(nextRecommendations); if (nextRecommendations.short_task) setShortTaskToast(nextRecommendations.short_task); } if (revisionLesson) setRevisionAlert(revisionLesson); }} />)
            : null
      )}

      {showExamMode && course && (
        <ExamModePanel
          courseTopic={activeTopic}
          level={activeLevel}
          allTopics={getAllTopics(course)}
          goal={goal}
          useClassroomData={useClassroomData}
          onClose={() => setShowExamMode(false)}
        />
      )}

      {(showHome || (loading && !course)) && (
        <>
          <HeroInput
            topic={topic} setTopic={setTopic} level={level} setLevel={setLevel} goal={goal} setGoal={setGoal}
            useClassroomData={useClassroomData} setUseClassroomData={setUseClassroomData}
            classroomConnected={!!classroomData?.connected} onConnectClassroom={handleConnectClassroom} classroomLoading={classroomLoading}
            onGenerate={generateCourse} loading={loading}
            onProfileOpen={() => currentUser ? setProfileOpen(true) : setShowAuth(true)}
            profileCount={profileCourses.length}
            generateError={generateError}
            showClassroomStatus={showClassroomStatus}
            darkMode={darkMode}
            onToggleTheme={() => setDarkMode(prev => !prev)}
            onGoHome={handleGoHome}
            onShowNotifications={() => setClassroomToastTick((prev) => prev + 1)}
            disclaimerOpen={classroomInfoOpen}
            onToggleDisclaimer={() => setClassroomInfoOpen((prev) => !prev)}
          />
          <ClassroomLiveToasts alerts={classroomData?.alerts || []} visible={!!currentUser && !!classroomData?.connected} resetKey={classroomToastTick} />
        </>
      )}

      {showCourse && (
        <>
          <CompactBar
            topic={topic} setTopic={setTopic} level={level} setLevel={setLevel} goal={goal} setGoal={setGoal}
            useClassroomData={useClassroomData} setUseClassroomData={setUseClassroomData}
            classroomConnected={!!classroomData?.connected} onConnectClassroom={handleConnectClassroom} classroomLoading={classroomLoading}
            onGenerate={generateCourse} loading={loading}
            onProfileOpen={() => currentUser ? setProfileOpen(true) : setShowAuth(true)}
            profileCount={profileCourses.length}
            showClassroomStatus={showClassroomStatus}
            darkMode={darkMode}
            onToggleTheme={() => setDarkMode(prev => !prev)}
            onGoHome={handleGoHome}
            onShowNotifications={() => setClassroomToastTick((prev) => prev + 1)}
            disclaimerOpen={classroomInfoOpen}
            onToggleDisclaimer={() => setClassroomInfoOpen((prev) => !prev)}
          />
          <div className="course-page">
            <div className="course-header">
              <div className="course-kicker">Generated Course</div>
              <h2 className="course-main-title">{course.course_title}</h2>
              <div className="course-stats">
                <span className="course-stat-item">{course.chapters.length} chapters</span>
                <span className="course-stat-item">{totalTopics} topics</span>
                <span className="course-stat-item">{activeLevel}</span>
                <span className="course-stat-item">{goal}</span>
              </div>
              <div className="course-header-actions">
                <button className={`add-profile-btn ${isInProfile ? "in-profile" : ""}`} onClick={addToProfile} disabled={isInProfile}>
                  {isInProfile ? "✓ Added to Profile" : "+ Add Course to Profile"}
                </button>
                <button className="course-dl-btn" onClick={handleDownloadFullCourse} title="Download the complete course as PDF" disabled={pdfDownloading}>
                  {pdfDownloading ? <><span className="spin spin-sm" style={{ borderTopColor: "var(--orange)" }} /> Preparing PDF…</> : "📥 Download Full PDF"}
                </button>
              </div>
            </div>
            <RecommendationPanel
              recommendations={recommendations}
              classroomData={classroomData}
              onConnectClassroom={handleConnectClassroom}
              classroomLoading={classroomLoading}
              onOpenTopic={openTopicByName}
              onOpenRevisionTopic={(topicItem) => {
                const revision = (recommendations?.revision_lessons || []).find((item) => item.topic === topicItem);
                if (revision) setRevisionAlert(revision);
                openTopicByName(topicItem);
              }}
              onOpenExamMode={() => setShowExamMode(true)}
              hideClassroom
            />
            {revisionAlert && (
              <div className="revision-alert-card">
                <div className="revision-alert-header">
                  <div>
                    <div className="rec-eyebrow">Autonomous Trigger</div>
                    <h3 className="rec-title">Revision lesson generated for {revisionAlert.topic}</h3>
                  </div>
                  <button className="qm-close-btn" onClick={() => setRevisionAlert(null)}>✕</button>
                </div>
                <div className="revision-alert-body"><LessonText text={revisionAlert.revision} /></div>
              </div>
            )}
            <ProgressStrip completed={completedLessons.length} total={totalTopics} topic={activeTopic} level={activeLevel} />
            <div className="chapters-wrap">
              {course.chapters.map((chapter, i) => (
                <ChapterSection
                  key={`${activeTopic}-${activeLevel}-ch${chapter.chapter}`}
                  chapter={chapter} chapterIndex={i}
                  completedLessons={completedLessons} onToggleComplete={toggleLessonComplete}
                  lessonCache={lessonCache} typedTopics={typedTopics}
                  topic={topic} level={level} onOpenQuiz={openQuiz}
                  expandedTopics={expandedTopics} onTopicExpand={handleTopicExpand} ensureLessonLoaded={ensureLessonLoaded}
                  masteryMap={masteryMap} nextRecommended={nextRecommended}
                />
              ))}
            </div>
            <CourseBottomActions courseTopic={activeTopic} level={activeLevel} allTopics={getAllTopics(course)} goal={goal} useClassroomData={useClassroomData} />
          </div>

          {!tutorOpen && <AiTutorFab onClick={() => setTutorOpen(true)} />}
          {tutorOpen && (
            <AiTutorPanel
              courseTopic={course.course_title} level={activeLevel}
              currentTopic={null} allTopics={getAllTopics(course)}
              onClose={() => setTutorOpen(false)}
              persistedMessages={tutorMessages}
              onMessagesChange={setTutorMessages}
            />
          )}
        </>
      )}

      {shortTaskToast && (
        <ShortTaskToast message={shortTaskToast} onDismiss={() => setShortTaskToast(null)} />
      )}
    </>
  );
}
