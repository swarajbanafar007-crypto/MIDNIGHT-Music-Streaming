"""Search public YouTube videos through the official Data API."""

from __future__ import annotations

import json
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.config import youtube_api_key


class YouTubeSearchError(RuntimeError):
    """A user-readable error from YouTube search or local configuration."""


def search_music(query: str, max_results: int = 12) -> list[dict[str, str]]:
    api_key = youtube_api_key()
    if not api_key:
        raise YouTubeSearchError(
            "YouTube API key is missing. Add YOUTUBE_API_KEY to the project's .env file."
        )

    params = urlencode({
        "part": "snippet",
        "type": "video",
        # Only return tracks that are allowed to play inside this desktop app.
        "videoEmbeddable": "true",
        "videoSyndicated": "true",
        "q": query,
        "maxResults": max(1, min(max_results, 25)),
        "key": api_key,
        "safeSearch": "moderate",
    })
    request = Request(
        f"https://www.googleapis.com/youtube/v3/search?{params}",
        headers={"Accept": "application/json", "User-Agent": "MIDNIGHT-Desktop/0.1"},
    )

    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8"))
            message = detail.get("error", {}).get("message", "YouTube rejected the request.")
        except (ValueError, UnicodeDecodeError):
            message = "YouTube rejected the request. Check the API key and API settings."
        raise YouTubeSearchError(message) from exc
    except URLError as exc:
        reason = str(exc.reason)
        if "CERTIFICATE_VERIFY_FAILED" in reason or isinstance(exc.reason, ssl.SSLCertVerificationError):
            raise YouTubeSearchError(
                "Python is missing its HTTPS certificates. In Finder, open Applications → Python 3.13 → "
                "Install Certificates.command, then restart MIDNIGHT."
            ) from exc
        raise YouTubeSearchError(f"Could not reach YouTube ({reason}). Check your internet connection and try again.") from exc
    except TimeoutError as exc:
        raise YouTubeSearchError("YouTube took too long to respond. Check your internet connection and try again.") from exc
    except (ValueError, UnicodeDecodeError) as exc:
        raise YouTubeSearchError("YouTube returned a response the app could not read.") from exc

    results = []
    for item in payload.get("items", []):
        video_id = item.get("id", {}).get("videoId")
        snippet = item.get("snippet", {})
        if not video_id:
            continue
        thumbs = snippet.get("thumbnails", {})
        thumbnail = thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}
        results.append({
            "video_id": video_id,
            "title": snippet.get("title", "Untitled video"),
            "artist": snippet.get("channelTitle", "Unknown channel"),
            "thumbnail_url": thumbnail.get("url", ""),
        })
    return results
