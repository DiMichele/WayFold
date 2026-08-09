from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    reason: str


def assert_tenant_access(
    *,
    actor_tenant_ids: set[str],
    is_superuser: bool,
    target_tenant_id: str,
) -> AccessDecision:
    """Server-side tenant gate for WayFold Compliance endpoints/services.

    Overlays a hard tenant boundary before returning unified checklist /
    readiness / impact for a program.
    """
    if is_superuser:
        return AccessDecision(True, "superuser")
    if target_tenant_id in actor_tenant_ids:
        return AccessDecision(True, "tenant_member")
    return AccessDecision(False, "tenant_isolation_denied")
