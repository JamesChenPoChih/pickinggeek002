from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Case, F, Q, Value, When
from django.utils import timezone

from ..models import DemoAccount


LIMITS = {'quick': ('pro_used', 20, 'Pro Model'), 'deep': ('ultra_used', 3, 'Ultra Model')}


class DemoQuotaExceeded(Exception):
    def __init__(self, mode):
        self.mode = mode


def _today():
    return timezone.localdate(timezone.now(), ZoneInfo(settings.TIME_ZONE))


def reserve_analysis(user, mode):
    """Reserve in one conditional SQL UPDATE, including the midnight reset."""
    field, limit, _ = LIMITS[mode]
    today = _today()
    same_day = Q(usage_date=today)
    values = {'usage_date': today}
    for counter in ('pro_used', 'ultra_used'):
        increment = 1 if counter == field else 0
        values[counter] = Case(When(same_day, then=F(counter) + increment), default=Value(increment))
    changed = DemoAccount.objects.filter(user=user).filter(
        ~same_day | Q(usage_date=today, **{f'{field}__lt': limit})
    ).update(**values)
    if not changed and DemoAccount.objects.filter(user=user).exists():
        raise DemoQuotaExceeded(mode)


def usage_for(user):
    account = DemoAccount.objects.filter(user=user).first()
    if account is None:
        return {'limited': False, 'can_use_ai': user.can_use_ai_models, 'tier': user.tier}
    today = _today()
    reset = datetime.combine(today + timedelta(days=1), time.min, ZoneInfo(settings.TIME_ZONE))
    result = {'limited': True, 'can_use_ai': user.can_use_ai_models, 'tier': user.tier,
              'timezone': settings.TIME_ZONE, 'resets_at': reset.isoformat()}
    for mode, (field, limit, _) in LIMITS.items():
        used = getattr(account, field) if account.usage_date == today else 0
        result[mode] = {'used': used, 'limit': limit, 'remaining': max(0, limit - used)}
    return result
