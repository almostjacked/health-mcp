#!/usr/bin/env python3
"""Generate the "Sync Health Data" iOS Shortcut as an unsigned .shortcut plist.

Reads eight metrics out of Apple Health for the last 3 days (today's data is
usually incomplete, so this window lets yesterday/day-before catch up) and
POSTs one JSON body per day to your health-ingest endpoint.

Configure via environment variables (no personal values are baked in):

  INGEST_URL   your health-ingest function URL, e.g.
               https://<project-ref>.supabase.co/functions/v1/health-ingest
  INGEST_KEY   the INGEST_KEY secret you set for that project (sent as the
               "X-Api-Key" header)

Usage:
    INGEST_URL=https://<ref>.supabase.co/functions/v1/health-ingest \\
    INGEST_KEY=<your-ingest-key> \\
    python3 scripts/generate_shortcut.py

Writes build/Sync Health Data.shortcut. Import it via AirDrop/Files, or sign
it first if your device's security settings require a signed shortcut:
    shortcuts sign -m anyone -i "build/Sync Health Data.shortcut" -o "Sync Health Data.shortcut"

Design notes (kept from the original device-verified build): one Repeat-3
loop (iteration 1 = yesterday), body = Adjust Date -> Format Date -> 8 x
(Find "Start Date is Adjusted Date" -> Statistics) -> one Text assembling the
day's JSON -> POST -> Show Result. No named variables, no If blocks; metrics
with no data interpolate as "" and the ingest function rejects those entries
individually while accepting the rest. Serializations below (adjustdate,
filter.health.quantity's type row + "Start Date is <date output>" template,
and statistics using param name `Input`, not `WFInput`) were sampled from a
real device export; the only chip not sampled is Repeat Index as the
subtract amount — if it imports blank, fix that single field by hand.
"""
import os
import plistlib
import sys
import uuid


def u() -> str:
    return str(uuid.uuid4()).upper()


PLACEHOLDER = "￼"


def token_string(parts):
    """WFTextTokenString from a list of str / attachment-value-dict parts."""
    s = ""
    attachments = {}
    for p in parts:
        if isinstance(p, str):
            s += p
        else:
            # Inside attachmentsByRange the reference is BARE ({Type: CurrentDate},
            # {Type: ActionOutput, …}) — the WFTextTokenAttachment envelope is only
            # for standalone parameters. Double-wrapping renders as "unknown variable".
            bare = p["Value"] if isinstance(p, dict) and p.get("WFSerializationType") == "WFTextTokenAttachment" else p
            attachments[f"{{{len(s)}, 1}}"] = bare
            s += PLACEHOLDER
    value = {"string": s}
    if attachments:
        value["attachmentsByRange"] = attachments
    return {"Value": value, "WFSerializationType": "WFTextTokenString"}


def action_output(output_uuid, name):
    return {"OutputUUID": output_uuid, "OutputName": name, "Type": "ActionOutput"}


def attachment(value):
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def act(identifier, params):
    return {"WFWorkflowActionIdentifier": identifier, "WFWorkflowActionParameters": params}


# (iOS Health picker label, server metric name, unit health-mcp expects, statistic)
METRICS = [
    ("Dietary Calories", "calories", "kcal", "Sum"),
    ("Protein", "protein", "g", "Sum"),
    ("Carbohydrates", "carbs", "g", "Sum"),
    ("Total Fat", "fat", "g", "Sum"),
    ("Water", "water", "floz", "Sum"),
    ("Sodium", "sodium", "mg", "Sum"),
    ("Weight", "weight", "lb", "Average"),
    ("Body Fat Percentage", "body_fat_pct", "%", "Average"),
]


def health_filter(sample_type, date_uuid):
    """Device-verified filter: locked Type row + 'Start Date is <Adjusted Date output>'."""
    return {
        "Value": {
            "WFActionParameterFilterPrefix": 1,
            "WFActionParameterFilterTemplates": [
                {
                    "Bounded": True,
                    "Operator": 4,
                    "Property": "Type",
                    "Removable": False,
                    "Values": {
                        "Enumeration": {
                            "Value": sample_type,
                            "WFSerializationType": "WFStringSubstitutableState",
                        }
                    },
                },
                {
                    "Bounded": True,
                    "Operator": 4,
                    "Property": "Start Date",
                    "Removable": False,
                    "Values": {
                        "Date": attachment(action_output(date_uuid, "Adjusted Date")),
                        # Vestigial fields present in a device's own export:
                        "Number": "7",
                        "Unit": 16,
                    },
                },
            ],
            "WFContentPredicateBoundedDate": False,
        },
        "WFSerializationType": "WFContentPredicateTableTemplate",
    }


def build(url, key):
    loop_group = u()
    adj_uuid, fmt_uuid = u(), u()

    actions = [
        act("is.workflow.actions.repeat.count", {
            "GroupingIdentifier": loop_group,
            "WFControlFlowMode": 0,
            "WFRepeatCount": 3,
        }),
        # Adjusted Date = Current Date - Repeat Index days (iteration 1 = yesterday).
        # If the Repeat Index chip imports blank, tap it once and pick Repeat Index.
        act("is.workflow.actions.adjustdate", {
            "UUID": adj_uuid,
            "WFDate": token_string([attachment({"Type": "CurrentDate"})]),
            "WFAdjustOperation": "Subtract",
            "WFDuration": {
                "Value": {"Magnitude": {"Type": "Variable", "VariableName": "Repeat Index"}, "Unit": "days"},
                "WFSerializationType": "WFQuantityFieldValue",
            },
        }),
        act("is.workflow.actions.format.date", {
            "UUID": fmt_uuid,
            "WFDate": token_string([attachment(action_output(adj_uuid, "Adjusted Date"))]),
            "WFDateFormatStyle": "Custom",
            "WFDateFormat": "yyyy-MM-dd",
        }),
    ]

    parts = ['{"entries": [']
    stat_uuids = []
    for label, _metric, _unit, stat in METRICS:
        find_uuid, stat_uuid = u(), u()
        actions.append(act("is.workflow.actions.filter.health.quantity", {
            "UUID": find_uuid,
            "WFContentItemFilter": health_filter(label, adj_uuid),
        }))
        actions.append(act("is.workflow.actions.statistics", {
            "UUID": stat_uuid,
            "Input": attachment(action_output(find_uuid, "Health Samples")),
            "WFStatisticsOperation": stat,
        }))
        stat_uuids.append(stat_uuid)

    first = True
    for (label, metric, unit, stat), stat_uuid in zip(METRICS, stat_uuids):
        if not first:
            parts.append(", ")
        first = False
        parts.extend([
            '{"date": "', attachment(action_output(fmt_uuid, "Formatted Date")),
            '", "metric": "', metric,
            '", "value": "', attachment(action_output(stat_uuid, stat)),
            '", "unit": "', unit,
            '", "source": "shortcut"}',
        ])
    parts.append("]}")

    body_uuid, post_uuid = u(), u()
    actions.append(act("is.workflow.actions.gettext", {
        "UUID": body_uuid,
        "WFTextActionText": token_string(parts),
    }))
    actions.append(act("is.workflow.actions.downloadurl", {
        "UUID": post_uuid,
        "Advanced": True,
        "ShowHeaders": True,
        "WFURL": url,
        "WFHTTPMethod": "POST",
        "WFHTTPBodyType": "File",
        "WFRequestVariable": attachment(action_output(body_uuid, "Text")),
        "WFHTTPHeaders": {
            "Value": {
                "WFDictionaryFieldValueItems": [
                    {"WFItemType": 0, "WFKey": token_string(["X-Api-Key"]), "WFValue": token_string([key])},
                    {"WFItemType": 0, "WFKey": token_string(["Content-Type"]), "WFValue": token_string(["application/json"])},
                ]
            },
            "WFSerializationType": "WFDictionaryFieldValue",
        },
    }))
    # Shows each day's server response on manual runs — delete this one action
    # before enabling the daily automation.
    actions.append(act("is.workflow.actions.showresult", {
        "UUID": u(),
        "Text": token_string([attachment(action_output(post_uuid, "Contents of URL"))]),
    }))
    actions.append(act("is.workflow.actions.repeat.count", {
        "UUID": u(),
        "GroupingIdentifier": loop_group,
        "WFControlFlowMode": 2,
    }))

    return {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "4610.1",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": 61440, "WFWorkflowIconStartColor": -43634177},
        "WFWorkflowName": "Sync Health Data",
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": [],
        "WFQuickActionSurfaces": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
    }


def main():
    url = os.environ.get("INGEST_URL")
    key = os.environ.get("INGEST_KEY")
    if not url or not key:
        sys.exit(
            "need INGEST_URL and INGEST_KEY environment variables, e.g.\n"
            "  INGEST_URL=https://<ref>.supabase.co/functions/v1/health-ingest \\\n"
            "  INGEST_KEY=<your-ingest-key> \\\n"
            "  python3 scripts/generate_shortcut.py"
        )

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    out_dir = os.path.join(root, "build")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "Sync Health Data.shortcut")
    workflow = build(url, key)
    with open(out, "wb") as f:
        plistlib.dump(workflow, f, fmt=plistlib.FMT_XML)
    print(f"wrote {out} ({len(workflow['WFWorkflowActions'])} actions)")


if __name__ == "__main__":
    main()
