# Xoul.ai Chat Bubble Exporter

A Tampermonkey script that exports your Xoul.ai chats to a plain text file or a SillyTavern-compatible file. It only grabs the visible message text from chat bubbles — no hidden metadata, no API scraping, no data beyond what's on your screen.

## Setup

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser (works on Chrome, Firefox, Edge, Opera, Safari).
2. Open [`chat-exporter.user.js`](chat-exporter.user.js) in this repo and click the **Raw** button. Tampermonkey should pop up an install prompt automatically — click **Install**.

## How to use

1. Open a chat on Xoul.ai.
2. **Scroll all the way to the top of the chat first.** The site only loads messages near your current scroll position, so the script needs to walk through the whole thing to grab everything. Starting from the top gives the most reliable results — if the export comes out short, scroll up manually and try again.
3. A small clickable button will appear in the bottom-right corner that opens a menu with four options. Pick your export type:
   - **Export .txt** — plain text export
   - **Export .jsonl (SillyTavern)** — formatted for importing into SillyTavern
   - **Export .HTML** — a HTML export
   - **Message Stats** — Character count, word count, total messages, which character sent how many messages, etc.
4. The script will auto-scroll through the chat to collect every message (you'll see a live count), then download the file automatically, however for best results scroll up first.

## Known issues

- Very long chats may need a couple of tries if the auto-scroll doesn't reach the top/bottom cleanly — scrolling there yourself first helps.
- If Xoul.ai updates their site's layout, the script may stop finding messages until it's updated to match.

## Privacy

This script only reads text that's already rendered on your screen. It doesn't make network requests, read cookies, or access anything beyond the visible chat bubbles.
