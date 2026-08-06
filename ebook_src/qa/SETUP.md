# Student Q&A — one-time Google setup

The ebook's "Ask a question" feature stores questions in a Google Sheet you own and
shows your answers publicly (anonymously) on each chapter page. Total setup time:
about 15 minutes. You only do this once.

## 1. Create the Sheet

1. Go to [sheets.new](https://sheets.new) and name the spreadsheet something like
   `CE342 Q&A` (the name doesn't matter).
2. Rename the first tab (bottom left) to exactly **`Questions`** and put these
   headers in row 1:

   | A | B | C | D | E | F | G |
   |---|---|---|---|---|---|---|
   | Timestamp | Chapter | StudentID | Name | Question | Answer | Hide |

3. Select column **G**, then **Insert → Checkbox** (so hiding a question is one click).
4. Add a second tab (＋ at bottom left) named exactly **`Roster`** with headers:

   | A | B |
   |---|---|
   | StudentID | Name |

5. Select column **A** of Roster → **Format → Number → Plain text** (prevents Sheets
   from mangling IDs), then paste your class roster below the headers.
   You can add/remove students any time — changes take effect immediately.

**Keep this Sheet private** (don't share it). The web app never reveals names or IDs;
they exist only in this Sheet.

## 2. Add the script

1. In the Sheet: **Extensions → Apps Script**.
2. Delete the stub code in the editor and paste the entire contents of
   [`Code.gs`](Code.gs) (in this folder).
3. Click the 💾 save icon (or Ctrl+S).

## 3. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Click the ⚙ gear next to "Select type" → choose **Web app**.
3. Set:
   - **Execute as: Me** (your account — students never log in)
   - **Who has access: Anyone**
4. Click **Deploy**. Google will ask you to authorize: choose your account →
   if you see "Google hasn't verified this app", click **Advanced →
   Go to … (unsafe)** → **Allow**. (It's your own script; this warning is normal.)
5. Copy the **Web app URL** — it ends in `/exec`.

## 4. Test it before wiring the ebook

1. Open `<your-url>?ping=1` in a browser tab. You should see:
   `{"ok":true,"pong":true,"version":1}`
   If you instead land on a Google sign-in page, redo step 3 with
   "Who has access: **Anyone**".
2. Optional deeper test from a terminal (the `-L` flag is required — the response
   sits behind a redirect):
   ```
   curl -L -H "Content-Type: text/plain" -d "{\"id\":\"<an ID from your Roster>\",\"chapter\":\"test\",\"question\":\"hello\"}" "<your-url>"
   ```
   Expect `{"ok":true}` and a new row in Questions. Type something in its Answer
   cell, then open `<your-url>?chapter=test` — the Q&A should appear as JSON.
   Delete the test row afterwards.

## 5. Wire the ebook

1. Open `ebook_src/config.json` and paste the URL:
   ```json
   "qa_endpoint": "https://script.google.com/macros/s/…/exec",
   ```
2. Rebuild and publish:
   ```
   python ebook_build.py
   git add ebook ebook_src && git commit -m "Enable Q&A" && git push
   ```

## Daily use

- **Answer a question**: type your answer in column **F** of the Questions tab.
  It appears on the chapter page (anonymously) the next time a student loads it.
- **Hide a question**: check the box in column **G** (works even if answered).
- **See who asked**: columns C–D — visible only to you, never published.
- Unanswered questions are never shown to students.

## If you edit Code.gs later (important gotcha)

Saving the script is **not enough** — the deployed app keeps running the old code.
After any edit: **Deploy → Manage deployments → ✏ pencil → Version: New version →
Deploy**. The URL stays the same, so nothing else needs updating.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Students see "Q&A feed is unavailable" | `?ping=1` in a browser: sign-in page → redeploy with access "Anyone"; error page → check tab names are exactly `Questions` / `Roster`. |
| "That ID isn't on the class roster" for a registered student | Check Roster column A is Plain text and the ID has no stray characters; the check ignores spaces and leading zeros. |
| Your script edits don't take effect | You saved but didn't create a **New version** (see above). |
| Want to pause the feature | Set `"qa_endpoint": ""` in config.json and rebuild — all Q&A UI disappears. |

## Local testing without Google (for development)

`python ebook_src/qa/mock_qa_server.py` runs a fake endpoint on
`http://localhost:8765` (accepted ID: `200123456`; `--broken` simulates a
misconfigured deployment). Point `qa_endpoint` at it, rebuild, and serve the repo
with `python -m http.server 8000`.

## Data about the deployment
Deployment ID: AKfycbx-8IYhcQ8Zn1TlCLByMVP9WrHUj9qCc9QmKJFlk2N4BmHhICJb8Pef0n7ruu7LTcd9

Web app: https://script.google.com/macros/s/AKfycbx-8IYhcQ8Zn1TlCLByMVP9WrHUj9qCc9QmKJFlk2N4BmHhICJb8Pef0n7ruu7LTcd9/exec
