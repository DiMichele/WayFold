"""Regression counts for Matrice_MultiCompliance.xlsx (fixture-specific)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

XLSX = ROOT / "docs" / "Matrice_MultiCompliance.xlsx"


@unittest.skipUnless(XLSX.is_file(), "legacy workbook not present")
class MulticomplianceSourceCounts(unittest.TestCase):
    def test_source_counts_approximate(self):
        from engine.importers.multicompliance.__main__ import analyze_workbook

        counts = analyze_workbook(XLSX)["counts"]
        self.assertGreaterEqual(counts["iso_annex_a"], 90)
        self.assertLessEqual(counts["iso_annex_a"], 115)
        self.assertGreaterEqual(counts["reg_cloud_rows"], 650)
        self.assertLessEqual(counts["reg_cloud_rows"], 820)
        self.assertGreaterEqual(counts["reg_cloud_codes"], 85)
        self.assertGreaterEqual(counts["nis2_rows"], 110)
        self.assertGreaterEqual(counts["nis2_codes"], 45)
        self.assertGreaterEqual(counts["psnc_rows"], 125)
        self.assertGreaterEqual(counts["psnc_codes"], 50)
        self.assertEqual(counts["csa_populated_rows"], 0)


if __name__ == "__main__":
    unittest.main()
