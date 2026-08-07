# The "Sync Health Data" Shortcut

This is step 3 of the
[four-step setup](../README.md#get-set-up-four-steps-20-minutes) — the daily
sync. It assumes you've already got your connector + ingest URL/key from
[step 1](../README.md#1-create-your-database--connector); if you haven't
loaded your older history yet, do
[step 2](../README.md#2-load-your-history) first (it's faster to backfill
before the daily sync starts layering new rows on top).

> Get this Shortcut from the
> [Shortcut panel](https://almostjacked.github.io/health-mcp/#shortcut) on
> the setup page — one click, no Terminal, no signing step. This doc covers
> the same flow written out, plus the "Not using the setup page?" fallback
> below.

An iOS Shortcut that reads eight metrics out of Apple Health for the last 3
days (today, yesterday, the day before — today's data is usually still
incomplete when the automation runs, so this window lets earlier days catch
up) and POSTs one JSON body per day to your `health-ingest` endpoint.

Metrics synced: calories, protein, carbs, fat, water, sodium, weight, body
fat percentage.

## Why there's no signing step for you

iOS refuses to import an unsigned `.shortcut` file. Every earlier version of
this doc had you run `shortcuts sign` yourself on a Mac — that's gone now.
The setup page ships **one shortcut file, signed once** (by the maintainer,
at release time — see [RESIGNING.md](RESIGNING.md) if you're curious how),
with your ingest URL and key left as placeholders. iOS's *Import Questions*
feature prompts you to fill those two placeholders in during import,
without touching the file's signature. Same signed bytes for everyone;
your values just get typed in at the door.

## 1. Download and install

1. On the [setup page](https://almostjacked.github.io/health-mcp/#shortcut),
   click **Download the shortcut**. Note the ingest URL and key shown next
   to it (copy buttons provided) — you'll need them in a moment.
2. Get the downloaded `sync-health-data-signed.shortcut` file onto your
   iPhone — AirDrop it from a Mac, or upload it somewhere and open the link
   in Safari on the phone.
3. Opening it launches the Shortcuts app's import screen. Tap **Add
   Shortcut**.
4. iOS prompts you for two values during import — **Paste your ingest URL**
   and **Paste your ingest key (from the setup page)**. Paste in the values
   from step 1.
5. The first time it runs, iOS will ask for permission to read each Health
   metric (Dietary Calories, Protein, Carbohydrates, Total Fat, Water,
   Sodium, Weight, Body Fat Percentage). Allow all of them.
6. Run it once manually (tap the shortcut in the Shortcuts app) to confirm
   it works — each day's POST response is shown on screen. You should see a
   response indicating rows were inserted/updated, not an error.
7. If a Health metric picker chip (e.g. "Dietary Calories") imported blank
   or wrong, tap that action and reselect the correct type from the picker.
   Likewise, if the **Repeat Index** chip inside the date-subtraction step
   imported blank, tap it and choose **Repeat Index** from the magic-variable
   list — this is the one chip iOS sometimes drops on import.

## 2. Turn on the daily automation

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

**Finally: connect Claude.** Open claude.ai → Settings → Connectors → Add
custom connector, and paste in the connector URL from
[step 1](../README.md#1-create-your-database--connector). If it fails with
*"Couldn't register with [name]'s sign-in service"*, that's a transient
claude.ai hiccup, not a problem with your connector — just try adding it
again. See [step 4](../README.md#4-connect-claude) in the README.

## Advanced: bake your URL/key into a custom build instead

Prefer a shortcut with your values baked in (no import prompts) over the
signed canonical file above? The setup page's Shortcut panel has a
collapsed **"Advanced: bake values into a custom build"** section that
generates one in your browser — same action graph, byte-identical in
structure to `scripts/generate_shortcut.py` below — but **you have to sign
it yourself**, same as before:

```bash
shortcuts sign -m anyone -i sync-health-data.shortcut -o sync-health-data-signed.shortcut
```

(No Mac? Signing needs one — borrow a friend's for this single command; the
signed file works forever.)

Or run the generator from the command line instead of the browser (needs
Python 3):

```bash
INGEST_URL=https://<ref>.supabase.co/functions/v1/health-ingest \
INGEST_KEY=<your-ingest-key> \
python3 scripts/generate_shortcut.py
```

This writes `build/Sync Health Data.shortcut` — sign it the same way as
above before AirDropping it over.

## Not using Shortcuts?

The `health-ingest` endpoint just accepts `{"entries": [...]}` — a JSON
array of `{date, metric, value, unit, source}` objects — over HTTP with the
same `X-Api-Key` header. Any script, cron job, or export pipeline that can
produce that shape can write to health-mcp; the Shortcut is simply the
easiest way to do it from an iPhone without writing code. For one-time
backfills of older history, use the browser-based `export.zip` importer on
the setup page's [Import panel](https://almostjacked.github.io/health-mcp/#import)
instead — see [step 2](../README.md#2-load-your-history).
