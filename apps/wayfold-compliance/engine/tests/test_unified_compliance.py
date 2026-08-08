from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.authz import assert_tenant_access
from engine.checklist import build_unified_checklist
from engine.impact import rank_control_impact
from engine.program_loader import load_program_snapshot
from engine.readiness import framework_readiness
from engine.domain import CoverageRelation, ImplementationStatus, RequirementCoverage


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "michele_phase2_program.json"


class UnifiedComplianceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.program = load_program_snapshot(FIXTURE)
        cls.checklist = build_unified_checklist(cls.program)

    def test_dedup_three_frameworks_to_one_control(self):
        iam = [c for c in self.checklist.controls if c.canonical_control_ref == "CTRL-IAM-001"]
        self.assertEqual(len(iam), 1)
        fws = {c.framework_id for c in iam[0].framework_coverage}
        self.assertEqual(fws, {"fw-a", "fw-b", "fw-c"})

    def test_partial_remains_partial(self):
        iam = next(c for c in self.checklist.controls if c.canonical_control_ref == "CTRL-IAM-001")
        partials = [c for c in iam.framework_coverage if c.relation == CoverageRelation.PARTIAL]
        self.assertGreaterEqual(len(partials), 1)
        self.assertTrue(any(c.uncovered_delta for c in partials))
        # Implemented + PARTIAL must not be treated as FULL in readiness
        ready = framework_readiness(self.program, self.checklist)
        fw_a = next(r for r in ready if r.framework_id == "fw-a")
        self.assertEqual(
            fw_a.requirement_breakdown["req-a-02"],
            RequirementCoverage.PARTIALLY_COVERED,
        )

    def test_unmapped_remain_visible(self):
        codes = {u.code for u in self.checklist.unmapped}
        self.assertIn("A.9.9", codes)
        self.assertIn("NIS2-X9", codes)
        self.assertGreaterEqual(len(self.checklist.unmapped), 2)

    def test_version_pinning_preserved(self):
        for cov in self.checklist.controls[0].framework_coverage:
            self.assertTrue(cov.framework_version)
        for u in self.checklist.unmapped:
            self.assertTrue(u.framework_version)

    def test_supporting_relation(self):
        iam = next(c for c in self.checklist.controls if c.canonical_control_ref == "CTRL-IAM-001")
        supporting = [c for c in iam.framework_coverage if c.relation == CoverageRelation.SUPPORTING]
        self.assertEqual(len(supporting), 1)
        self.assertIn("recovery", supporting[0].uncovered_delta.lower())

    def test_mixed_implementation_statuses(self):
        statuses = {c.status for c in self.checklist.controls}
        self.assertIn(ImplementationStatus.IMPLEMENTED, statuses)
        self.assertIn(ImplementationStatus.IN_PROGRESS, statuses)
        self.assertIn(ImplementationStatus.NOT_IMPLEMENTED, statuses)

    def test_control_impact_readable(self):
        impact = rank_control_impact(self.program, self.checklist)
        self.assertTrue(impact)
        top = impact[0]
        self.assertIn("requirements", top.readable_summary)
        self.assertIn("frameworks", top.readable_summary)
        # Open IR control should rank high
        refs = [r.canonical_control_ref for r in impact]
        self.assertIn("CTRL-IR-001", refs)

    def test_tenant_isolation_gate(self):
        denied = assert_tenant_access(
            actor_tenant_ids={"tenant-other"},
            is_superuser=False,
            target_tenant_id="tenant-michele",
        )
        self.assertFalse(denied.allowed)
        allowed = assert_tenant_access(
            actor_tenant_ids={"tenant-michele"},
            is_superuser=False,
            target_tenant_id="tenant-michele",
        )
        self.assertTrue(allowed.allowed)

    def test_counts(self):
        self.assertEqual(self.checklist.raw_requirement_count, 8)
        self.assertEqual(self.checklist.unified_control_count, 3)


if __name__ == "__main__":
    unittest.main()
