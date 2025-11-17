# WebSummit Simple Scraper

A minimal Node.js scraper that extracts contacts from the WebSummit mobile app using ADB + Gemini AI.

## Features

- 📸 Screenshot capture via ADB
- 🤖 AI-powered contact extraction using Gemini 2.0
- 📜 Automatic scrolling through search results
- 💾 SQLite database storage with duplicate detection
- 📊 CSV export

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure `.env`:
```env
GEMINI_API_KEY=your_gemini_api_key
ADB_DEVICE_ID=R3CT90ET1TL
SEARCH_ROLE=Investor
MAX_SCROLLS=200
OUTPUT_CSV=contacts.csv
```

3. Connect your Android device via ADB:
```bash
adb devices
```

4. Open the WebSummit app and navigate to search results

5. Run the scraper:
```bash
npm start
```

## How It Works

1. Takes a screenshot of the current screen
2. Sends screenshot to Gemini AI for contact extraction
3. Saves unique contacts to SQLite database
4. Scrolls down to see more results
5. Repeats until no new contacts found for 5 consecutive screens
6. Exports all contacts to CSV

## Output

- `contacts.db` - SQLite database with all extracted contacts
- `contacts.csv` - CSV export of all contacts

## Requirements

- Node.js 18+
- ADB (Android Debug Bridge)
- Gemini API key
- Android device with WebSummit app
