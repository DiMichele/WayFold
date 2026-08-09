from __future__ import annotations

from datetime import date, datetime, timedelta


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def today() -> date:
    return date.today()


def is_overdue(due: str | None, *, as_of: date | None = None) -> bool:
    d = parse_date(due)
    if d is None:
        return False
    return d < (as_of or today())


def is_upcoming(due: str | None, *, days: int = 30, as_of: date | None = None) -> bool:
    d = parse_date(due)
    if d is None:
        return False
    base = as_of or today()
    return base <= d <= base + timedelta(days=days)


def format_iso(d: date | datetime | None) -> str | None:
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date().isoformat()
    return d.isoformat()


_IT_MONTHS = (
    "gen",
    "feb",
    "mar",
    "apr",
    "mag",
    "giu",
    "lug",
    "ago",
    "set",
    "ott",
    "nov",
    "dic",
)


def format_display_date(value: str | date | datetime | None, *, lang: str = "it") -> str:
    """Italian-friendly display date (e.g. 12 ago 2026) or ISO fallback."""
    if value is None or value == "":
        return "—"
    if isinstance(value, datetime):
        d = value.date()
    elif isinstance(value, date):
        d = value
    else:
        d = parse_date(str(value))
        if d is None:
            return str(value)
    if lang == "en":
        return d.strftime("%d %b %Y")
    return f"{d.day} {_IT_MONTHS[d.month - 1]} {d.year}"
