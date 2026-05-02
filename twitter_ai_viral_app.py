#!/usr/bin/env python3
"""
Find viral AI tweets from the last N days and generate 3 new tweet drafts
using hashtags observed in those viral tweets.

Usage:
  python twitter_ai_viral_app.py --days 3 --min-likes 1000 --limit 200
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, List

import pandas as pd
import snscrape.modules.twitter as sntwitter

HASHTAG_RE = re.compile(r"#\w+")


@dataclass
class ViralTweet:
    date: dt.datetime
    username: str
    content: str
    likes: int
    retweets: int
    replies: int
    url: str

    @property
    def engagement(self) -> int:
        return self.likes + self.retweets + self.replies


def collect_ai_tweets(days: int, limit: int) -> List[ViralTweet]:
    today = dt.datetime.utcnow().date()
    since = today - dt.timedelta(days=days)
    query = f"(artificial intelligence OR AI OR machine learning OR LLM) lang:en since:{since.isoformat()}"

    tweets: List[ViralTweet] = []
    for i, tweet in enumerate(sntwitter.TwitterSearchScraper(query).get_items()):
        if i >= limit:
            break
        tweets.append(
            ViralTweet(
                date=tweet.date,
                username=tweet.user.username,
                content=tweet.rawContent,
                likes=tweet.likeCount,
                retweets=tweet.retweetCount,
                replies=tweet.replyCount,
                url=tweet.url,
            )
        )
    return tweets


def pick_viral(tweets: Iterable[ViralTweet], min_likes: int) -> List[ViralTweet]:
    viral = [t for t in tweets if t.likes >= min_likes]
    return sorted(viral, key=lambda t: t.engagement, reverse=True)


def top_hashtags(tweets: Iterable[ViralTweet], top_n: int = 10) -> List[str]:
    c = Counter()
    for t in tweets:
        c.update(tag.lower() for tag in HASHTAG_RE.findall(t.content))
    return [tag for tag, _ in c.most_common(top_n)]


def generate_tweets(hashtags: List[str]) -> List[str]:
    fallback = ["#AI", "#ArtificialIntelligence", "#MachineLearning", "#LLM"]
    tags = hashtags[:4] if hashtags else fallback
    while len(tags) < 4:
        tags.append(fallback[len(tags)])

    drafts = [
        f"AI is moving from demos to daily workflows. The winners will be teams that combine great data + fast iteration. {tags[0]} {tags[1]}",
        f"The real moat in AI isn't just the model—it's distribution, feedback loops, and product speed. {tags[1]} {tags[2]}",
        f"If you're building in AI, focus on one painful user problem and solve it 10x better than legacy tools. {tags[2]} {tags[3]}",
    ]
    return drafts


def as_dataframe(tweets: List[ViralTweet]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "date": t.date,
                "username": t.username,
                "likes": t.likes,
                "retweets": t.retweets,
                "replies": t.replies,
                "engagement": t.engagement,
                "url": t.url,
                "content": t.content,
            }
            for t in tweets
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=3, help="Look back window in days")
    parser.add_argument("--min-likes", type=int, default=1000, help="Minimum likes to count as viral")
    parser.add_argument("--limit", type=int, default=200, help="Maximum tweets to inspect")
    parser.add_argument("--csv", default="viral_ai_tweets.csv", help="CSV output for viral tweets")
    args = parser.parse_args()

    tweets = collect_ai_tweets(days=args.days, limit=args.limit)
    viral = pick_viral(tweets, min_likes=args.min_likes)

    print(f"Fetched {len(tweets)} tweets, found {len(viral)} viral tweets (likes >= {args.min_likes}).")

    if not viral:
        print("No viral tweets found. Lower --min-likes or increase --limit.")
        return

    df = as_dataframe(viral)
    df.to_csv(args.csv, index=False)
    print(f"Saved viral tweets to {args.csv}")

    print("\nTop viral tweets:")
    for t in viral[:10]:
        short = t.content.replace("\n", " ")[:160]
        print(f"- @{t.username} | ❤️ {t.likes} 🔁 {t.retweets} 💬 {t.replies} | {t.url}")
        print(f"  {short}...")

    tags = top_hashtags(viral, top_n=10)
    print("\nTrending hashtags from viral AI tweets:")
    print(" ".join(tags) if tags else "(none detected)")

    print("\n3 new tweet drafts:")
    for i, tw in enumerate(generate_tweets(tags), 1):
        print(f"{i}. {tw}")


if __name__ == "__main__":
    main()
