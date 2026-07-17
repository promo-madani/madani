# AI Viral Tweet Scraper (Last 3 Days)

This small app finds potentially viral tweets in the AI niche from the last 3 days, then generates 3 new tweet drafts using hashtags seen in those viral tweets.

## Features
- Scrapes recent tweets with AI-related keywords.
- Filters viral tweets by minimum likes.
- Exports viral tweets to CSV.
- Extracts trending hashtags.
- Generates 3 tweet drafts using viral hashtags.

## Setup
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run
```bash
python twitter_ai_viral_app.py --days 3 --min-likes 1000 --limit 200
```

Optional flags:
- `--csv viral_ai_tweets.csv` output filename
- `--min-likes` adjust viral threshold
- `--limit` number of tweets scanned

## Notes
- `snscrape` reads public data and may break if X/Twitter changes pages.
- This script creates drafts only; review before posting.
