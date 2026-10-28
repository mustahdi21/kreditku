#!/usr/bin/env python3
"""
sql_parse.py — Pemeriksa sintaks SQL untuk berkas migrasi KreditKu.

Menggunakan sqlglot (dialek PostgreSQL) untuk mendeteksi kesalahan sintaks
secara dini tanpa memerlukan server database.

Pemakaian:
    python3 scripts/sql_parse.py supabase/migrations/*.sql supabase/seed.sql

Keluaran: daftar berkas beserta jumlah pernyataan yang berhasil diurai.
Kode keluar 1 bila ada berkas yang gagal diurai.

Catatan: blok PL/pgSQL ($$...$$) diperlakukan sebagai string dan tidak
dianalisis secara semantik oleh sqlglot. Pemeriksaan menyeluruh atas logika
plpgsql dilakukan oleh `npm run db:check` terhadap database sungguhan.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import sqlglot
    from sqlglot.errors import ParseError
except ImportError:  # pragma: no cover
    print('SKIP: sqlglot tidak terpasang. Jalankan: pip install sqlglot')
    sys.exit(2)


# Blok dollar-quoted ($$ ... $$ atau $tag$ ... $tag$) diganti dengan string
# literal agar parser tidak mencoba menganalisis isi plpgsql.
DOLLAR_BLOCK = re.compile(r"\$([A-Za-z_]*)\$.*?\$\1\$", re.DOTALL)

# Klausa `SET search_path = ...` sebelum AS body adalah ekstensi PostgreSQL yang
# valid, namun belum didukung urutan ini oleh sqlglot. Klausa dihapus hanya
# untuk keperluan pemeriksaan sintaks — berkas asli tidak diubah.
SET_SEARCH_PATH = re.compile(r"\bSET\s+search_path\s*=\s*[^\n;]*?(?=\sAS\s)", re.IGNORECASE)

# `SECURITY DEFINER|INVOKER` adalah atribut fungsi yang valid; sqlglot belum
# mendukungnya pada urutan ini sehingga diabaikan saat pemeriksaan sintaks.
SECURITY_CLAUSE = re.compile(r"\bSECURITY\s+(?:DEFINER|INVOKER)\b", re.IGNORECASE)


def mask_dollar_blocks(sql: str) -> str:
    return DOLLAR_BLOCK.sub("'__PLPGSQL_BLOCK__'", sql)


def normalize_for_parser(sql: str) -> str:
    return SECURITY_CLAUSE.sub("", SET_SEARCH_PATH.sub("", sql))


def mask_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return sql


def validate(path: Path) -> tuple[bool, int, str]:
    raw = path.read_text(encoding="utf-8")
    prepared = normalize_for_parser(mask_dollar_blocks(mask_comments(raw)))
    try:
        statements = [s for s in sqlglot.parse(prepared, read="postgres") if s is not None]
    except ParseError as error:  # pragma: no cover
        return False, 0, str(error)
    except Exception as error:  # pragma: no cover
        return False, 0, f"{type(error).__name__}: {error}"
    return True, len(statements), ""


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Pemakaian: python3 scripts/sql_parse.py <berkas.sql> [...]")
        return 1

    failures = 0
    for argument in argv[1:]:
        path = Path(argument)
        if not path.exists():
            print(f"MISS  {path} (berkas tidak ditemukan)")
            failures += 1
            continue
        ok, count, error = validate(path)
        if ok:
            print(f"OK    {path} ({count} pernyataan)")
        else:
            print(f"FAIL  {path}\n      {error}")
            failures += 1

    if failures:
        print(f"\n{failures} berkas gagal diurai.")
        return 1
    print("\nSeluruh berkas SQL berhasil diurai.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
