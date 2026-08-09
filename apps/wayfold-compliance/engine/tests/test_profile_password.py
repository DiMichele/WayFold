"""Profile + password change (isolated)."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.users import authenticate, change_password, create_user, get_user
from engine.session_revoke import bump_user_sessions


class ProfilePasswordTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = {
            "WAYFOLD_DATA_DIR": self.tmp.name,
            "WAYFOLD_SESSION_SECRET": "test-profile-secret",
            "WAYFOLD_AUTH_USER": "",
            "WAYFOLD_AUTH_PASSWORD": "",
        }
        self._patch = mock.patch.dict(os.environ, self.env, clear=False)
        self._patch.start()
        create_user("reviewer", "old-pass-12345", role="SUPER_ADMIN")

    def tearDown(self):
        self._patch.stop()
        self.tmp.cleanup()

    def test_change_password_invalidates_old(self):
        change_password("reviewer", "old-pass-12345", "new-pass-98765")
        self.assertFalse(authenticate("reviewer", "old-pass-12345").ok)
        self.assertTrue(authenticate("reviewer", "new-pass-98765").ok)
        self.assertIsNotNone(get_user("reviewer"))


if __name__ == "__main__":
    unittest.main()
