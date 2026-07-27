# The "Sync Health Data" Shortcut

An iOS Shortcut that reads eight metrics out of Apple Health for the last 3
days (today, yesterday, the day before — today's data is usually still
incomplete when the automation runs, so this window lets earlier days catch
up) and POSTs one JSON body per day to your `health-ingest` endpoint.

Metrics synced: calories, protein, carbs, fat, water, sodium, weight, body
fat percentage.

## 1. Generate the .shortcut file

You need Python 3 and your ingest URL + key from whichever
[install path](../README.md#install) you used (the wizard prints both at
the end; the manual path derives them in
[setup-manual.md](setup-manual.md#5-your-connector-url)).

```bash
INGEST_URL=https://<ref>.supabase.co/functions/v1/health-ingest \
INGEST_KEY=<your-ingest-key> \
python3 scripts/generate_shortcut.py
```

This writes `build/Sync Health Data.shortcut`.

If your device is set to only allow signed shortcuts, sign it first (needs
the `shortcuts` CLI on a Mac):

```bash
shortcuts sign -m anyone -i "build/Sync Health Data.shortcut" -o "Sync Health Data.shortcut"
```

## 2. Install it on your iPhone

1. Get the `.shortcut` file onto your phone — AirDrop from a Mac, or upload
   it somewhere and open the link in Safari on the phone.
2. Opening it launches the Shortcuts app's import screen. Tap **Add
   Shortcut**.
3. The first time it runs, iOS will ask for permission to read each Health
   metric (Dietary Calories, Protein, Carbohydrates, Total Fat, Water,
   Sodium, Weight, Body Fat Percentage). Allow all of them.
4. Run it once manually (tap the shortcut in the Shortcuts app) to confirm
   it works — each day's POST response is shown on screen. You should see a
   response indicating rows were inserted/updated, not an error.
5. If a Health metric picker chip (e.g. "Dietary Calories") imported blank
   or wrong, tap that action and reselect the correct type from the picker.
   Likewise, if the **Repeat Index** chip inside the date-subtraction step
   imported blank, tap it and choose **Repeat Index** from the magic-variable
   list — this is the one chip iOS sometimes drops on import.

## 3. Turn on the daily automation

1. In the Shortcuts app, go to the **Automation** tab → **+** → **Create
   Personal Automation**.
2. Choose **Time of Day**, set it to **9:00 AM** (or any time after your
   data for "yesterday" is likely to be finalized), repeat **Daily**.
3. Add action **Run Shortcut**, choose **Sync Health Data**.
4. Turn **off** "Ask Before Running" so it runs silently in the background.
5. Before relying on the automation, open the shortcut and delete the
   **Show Result** action at the end — it's useful for confirming manual
   runs but will otherwise pop up a dialog during the silent automation.

That's it — health-mcp's `get_sync_status` tool will show `days_since: 1-2`
for each metric once the automation has run a couple of times; treat
`3+` as a sign the automation stopped firing.

## Not using Shortcuts?

The `health-ingest` endpoint just accepts `{"entries": [...]}` — a JSON
array of `{date, metric, value, unit, source}` objects — over HTTP with the
same `X-Api-Key` header. Any script, cron job, or export pipeline that can
produce that shape can write to health-mcp; the Shortcut is simply the
easiest way to do it from an iPhone without writing code. A browser-based
`export.zip` importer for one-time backfills of older history is planned
for release 3c.
