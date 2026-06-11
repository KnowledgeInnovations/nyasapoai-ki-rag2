"""
Phase 2 table-aware extraction.

Downloads each document's PDF from the Supabase `documents` storage bucket,
finds tables with pdfplumber, classifies them as either a national-aggregate
table or a ministry/MDA allocation table, and writes one JSON file per
document to python/output/<document_id>.json containing the extracted facts.

These JSON files are later loaded by ingest_table_facts_tmp.mts, which
converts them to FinancialFact rows via tableRecordToFact() and inserts them
into the financial_facts table (extraction_method='table').

Usage:
    pip install -r requirements.txt
    python extract_tables.py
"""

import io
import json
import re
from pathlib import Path

import pdfplumber
from dotenv import dotenv_values
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path(__file__).resolve().parent / "output"

# ── Setup ────────────────────────────────────────────────────────────

env = dotenv_values(ROOT / ".env.local")
SUPABASE_URL = env.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = env.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Classification rules ─────────────────────────────────────────────

# Row-label patterns -> national metric. Checked against the first cell of
# each row (case-insensitive).
NATIONAL_ROW_METRICS = [
    (re.compile(r"total\s+expenditure|total\s+government\s+expenditure", re.I), "total_budget"),
    (re.compile(r"total\s+revenue(\s+and\s+grants)?", re.I), "revenue"),
    (re.compile(r"domestic\s+revenue", re.I), "revenue"),
    (re.compile(r"total\s+public\s+debt|public\s+debt\s+stock", re.I), "debt"),
    (re.compile(r"capital\s+expenditure", re.I), "capital_expenditure"),
    (re.compile(r"recurrent\s+expenditure", re.I), "recurrent_expenditure"),
]

# Column-header patterns that mark a table as a ministry/MDA allocation table.
MINISTRY_COL_RX = re.compile(r"ministry|mda|vote|agency", re.I)

# Column-header patterns for funding-source columns -> all map to 'allocation'.
ALLOCATION_COL_RX = re.compile(r"gog|igf|abfa|donor|total", re.I)

YEAR_RX = re.compile(r"\b(19|20)\d{2}\b")

UNIT_RX = [
    (re.compile(r"gh.?\s*c?\s*'?\s*000|thousand", re.I), "thousand"),
    (re.compile(r"gh.?\s*c?\s*million|million", re.I), "million"),
    (re.compile(r"%|percent", re.I), "%"),
    (re.compile(r"gh.?\s*c?\s*billion|billion", re.I), "billion"),
]


def detect_unit(*texts: str) -> str:
    for text in texts:
        if not text:
            continue
        for rx, unit in UNIT_RX:
            if rx.search(text):
                return unit
    return "million"


def detect_year(*texts: str) -> str | None:
    for text in texts:
        if not text:
            continue
        m = YEAR_RX.search(text)
        if m:
            return m.group(0)
    return None


def parse_number(cell: str) -> float | None:
    if not cell:
        return None
    cleaned = cell.strip().replace(",", "").replace("(", "-").replace(")", "")
    if not re.match(r"^-?\d+(\.\d+)?$", cleaned):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def classify_national_row(row: list[str | None]) -> str | None:
    label = (row[0] or "").strip()
    for rx, metric in NATIONAL_ROW_METRICS:
        if rx.search(label):
            return metric
    return None


def extract_national_table(table: list[list[str | None]], page_text: str, page_number: int, caption: str | None) -> list[dict]:
    if not table or len(table) < 2:
        return []

    header = [c or "" for c in table[0]]
    records = []
    for row in table[1:]:
        if not row:
            continue
        metric = classify_national_row(row)
        if not metric:
            continue

        for col_idx in range(1, len(row)):
            value = parse_number(row[col_idx] if col_idx < len(row) else None)
            if value is None:
                continue

            col_header = header[col_idx] if col_idx < len(header) else ""
            unit = detect_unit(col_header, caption or "")
            if unit == "%":
                continue

            year = detect_year(col_header) or detect_year(caption or "") or detect_year(page_text)

            records.append({
                "page_number": page_number,
                "entity": "National",
                "entity_type": "national",
                "metric": metric,
                "fiscal_year": year,
                "value": value,
                "unit": unit,
                "table_caption": caption,
            })

    return records


def extract_ministry_table(table: list[list[str | None]], page_text: str, page_number: int, caption: str | None) -> list[dict]:
    if not table or len(table) < 2:
        return []

    header = [c or "" for c in table[0]]
    if not any(MINISTRY_COL_RX.search(h) for h in header):
        return []

    entity_col = next((i for i, h in enumerate(header) if MINISTRY_COL_RX.search(h)), 0)
    alloc_cols = [i for i, h in enumerate(header) if i != entity_col and ALLOCATION_COL_RX.search(h)]
    if not alloc_cols:
        return []

    records = []
    for row in table[1:]:
        if not row or entity_col >= len(row):
            continue
        entity = (row[entity_col] or "").strip()
        if not entity:
            continue

        for col_idx in alloc_cols:
            value = parse_number(row[col_idx] if col_idx < len(row) else None)
            if value is None:
                continue

            col_header = header[col_idx] if col_idx < len(header) else ""
            unit = detect_unit(col_header, caption or "")
            if unit == "%":
                continue

            year = detect_year(col_header) or detect_year(caption or "") or detect_year(page_text)

            records.append({
                "page_number": page_number,
                "entity": entity,
                "entity_type": "ministry",
                "metric": "allocation",
                "fiscal_year": year,
                "value": value,
                "unit": unit,
                "table_caption": caption,
            })

    return records


def find_tables(page) -> list[list[list[str | None]]]:
    seen_bboxes = []
    tables = []

    for settings in (
        {"vertical_strategy": "lines", "horizontal_strategy": "lines"},
        {"vertical_strategy": "text", "horizontal_strategy": "text"},
    ):
        for t in page.find_tables(table_settings=settings):
            bbox = tuple(round(x) for x in t.bbox)
            if any(abs(bbox[i] - b[i]) < 5 for b in seen_bboxes for i in range(4)):
                continue
            seen_bboxes.append(bbox)
            extracted = t.extract()
            if extracted:
                tables.append(extracted)

    return tables


def nearby_caption(page_text: str) -> str | None:
    for line in page_text.splitlines():
        if re.search(r"table\s+\d", line, re.I):
            return line.strip()
    return None


def process_document(doc: dict) -> list[dict]:
    file_path = doc["file_path"]
    document_id = doc["id"]

    print(f"\n=== {doc.get('title', document_id)} ({document_id}) ===")

    res = supabase.storage.from_("documents").download(file_path)
    if not res:
        print("  could not download, skipping")
        return []

    records: list[dict] = []
    tables_found = 0
    page_count = 0

    with pdfplumber.open(io.BytesIO(res)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            caption = nearby_caption(page_text)

            for table in find_tables(page):
                tables_found += 1
                national = extract_national_table(table, page_text, page.page_number, caption)
                ministry = extract_ministry_table(table, page_text, page.page_number, caption)
                records.extend(national)
                records.extend(ministry)

    for r in records:
        r["document_id"] = document_id

    national_count = sum(1 for r in records if r["entity_type"] == "national")
    ministry_count = sum(1 for r in records if r["entity_type"] == "ministry")
    print(f"  pages: {page_count}, tables found: {tables_found}, "
          f"national facts: {national_count}, ministry facts: {ministry_count}")

    return records


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    docs = supabase.table("documents").select("id, title, file_path, status").execute().data or []
    docs = [d for d in docs if d.get("file_path")]

    print(f"Found {len(docs)} documents with files")

    for doc in docs:
        try:
            records = process_document(doc)
        except Exception as exc:
            print(f"  ERROR: {exc}")
            continue

        out_path = OUTPUT_DIR / f"{doc['id']}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(records, f, indent=2)

        print(f"  wrote {len(records)} records -> {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
