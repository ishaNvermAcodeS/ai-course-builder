from googleapiclient.discovery import build
import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

API_KEY = os.getenv("YOUTUBE_API_KEY")
GROQ_KEY = os.getenv("GROQ_API_KEY")

youtube = build("youtube", "v3", developerKey=API_KEY) if API_KEY else None
client = Groq(api_key=GROQ_KEY) if GROQ_KEY else None


def is_probably_english(text):
    sample = (text or "").strip()
    if not sample:
        return False
    letters = [ch for ch in sample if ch.isalpha()]
    if not letters:
        return True
    ascii_letters = [ch for ch in letters if ch.isascii()]
    return (len(ascii_letters) / max(len(letters), 1)) >= 0.85


def search_youtube_videos(topic, level, max_results=12):
    if not youtube:
        return []

    level_keywords = {
        "Beginner": "beginner tutorial basics introduction",
        "Intermediate": "intermediate tutorial concepts",
        "Advanced": "advanced lecture deep dive"
    }

    query = f"{topic} {level_keywords[level]} english"

    request = youtube.search().list(
        part="snippet",
        q=query,
        type="video",
        maxResults=max_results,
        relevanceLanguage="en",
        videoEmbeddable="true",
        safeSearch="moderate"
    )

    try:
        response = request.execute()
    except Exception:
        return []

    videos = []

    for item in response["items"]:
        title = item["snippet"]["title"]
        channel = item["snippet"]["channelTitle"]
        description = item["snippet"].get("description", "")
        if not is_probably_english(f"{title} {channel} {description}"):
            continue
        videos.append({
            "title": title,
            "channel": channel,
            "url": f"https://www.youtube.com/watch?v={item['id']['videoId']}"
        })

    return rank_videos_with_ai(topic, level, videos)


def rank_videos_with_ai(topic, level, videos):
    if not videos:
        return []
    if not client:
        return videos[:3]

    titles = "\n".join([v["title"] for v in videos])

    prompt = f"""
You are selecting the best learning videos.

Topic: {topic}
Difficulty Level: {level}

Here are video titles:

{titles}

Select the 3 BEST English-language videos for learning this topic at the given level.

Rules:
- Only choose English-language videos
- Prefer clear tutorials, beginner-friendly explanations, or strong educational lectures
- Avoid duplicates, unrelated videos, and clickbait

Return ONLY the titles exactly as written.
"""

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}]
        )
        selected_titles = completion.choices[0].message.content
    except Exception:
        return videos[:3]

    selected_videos = [
        v for v in videos if v["title"] in selected_titles
    ]

    fallback_videos = [v for v in videos if is_probably_english(f"{v['title']} {v['channel']}")]
    return (selected_videos or fallback_videos or videos)[:3]
