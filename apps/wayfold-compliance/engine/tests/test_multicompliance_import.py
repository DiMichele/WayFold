"""Regression counts for Matrice_MultiCompliance (sanitized fixture or private source)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURE = ROOT / "engine" / "fixtures" / "import" / "multicompliance_sanitized.xlsx"
PRIVATE = ROOT / "docs" / "Matrice_MultiCompliance.xlsx"
LOCAL = ROOT / ".local" / "import-source" / "Matrice_MultiCompliance.xlsx"


def _xlsx() -> Path | None:
    for p in (FIXTURE, LOCAL, PRIVATE):
        if p.is_file():
            return p
    return None


@unittest.skipUnless(_xlsx() is not None, "workbook/fixture not present")
class MulticomplianceSourceCounts(unittest.TestCase):
    def test_source_and_normalized_counts(self):
        from engine.importers.multicompliance.__main__ import analyze_workbook, convert_workbook

        path = _xlsx()
        assert path is not None
        counts = analyze_workbook(path)["counts"]
        self.assertEqual(counts["iso_annex_a"], 93)
        self.assertEqual(counts["iso_annex_a_by_category"]["Organizzativo"], 37)
        self.assertEqual(counts["iso_annex_a_by_category"]["Personale"], 8)
        self.assertEqual(counts["iso_annex_a_by_category"]["Fisico"], 14)
        self.assertEqual(counts["iso_annex_a_by_category"]["Tecnologico"], 34)
        self.assertEqual(counts["reg_cloud_rows"], 808)
        self.assertEqual(counts["reg_cloud_codes"], 91)
        self.assertEqual(counts["nis2_rows"], 117)
        self.assertEqual(counts["nis2_codes"], 50)
        self.assertEqual(counts["psnc_rows"], 133)
        self.assertEqual(counts["psnc_codes"], 58)
        self.assertEqual(counts["csa_populated_rows"], 0)

        out = Path(tempfile.mkdtemp())
        summary = convert_workbook(path, out)
        self.assertEqual(summary["normalized"]["iso_annex_a_controls"], 93)
        self.assertGreaterEqual(summary["normalized"]["iso_clauses"], 1)
        self.assertEqual(summary["normalized"]["reg_cloud_requirements"], 91)
        self.assertEqual(summary["normalized"]["reg_cloud_questions"], 808)
        self.assertEqual(summary["normalized"]["nis2_requirements"], 50)
        self.assertEqual(summary["normalized"]["psnc_requirements"], 58)
        self.assertNotIn("csa-star-legacy.json", summary["frameworkPackages"])
        self.assertTrue((out / "frameworks" / "iso-27001-legacy.json").is_file())
        self.assertFalse((out / "frameworks" / "csa-star-legacy.json").exists())
        iso = json.loads((out / "frameworks" / "iso-27001-legacy.json").read_text(encoding="utf-8"))
        controls = [r for r in iso["requirements"] if r["type"] == "CONTROL"]
        clauses = [r for r in iso["requirements"] if r["type"] == "CLAUSE"]
        self.assertEqual(len(controls), 93)
        self.assertGreaterEqual(len(clauses), 1)
        self.assertEqual(iso["sourceStatus"], "SOURCE_UNVERIFIED")
        self.assertEqual(iso["version"]["status"], "DRAFT")


if __name__ == "__main__":
    unittest.main()
