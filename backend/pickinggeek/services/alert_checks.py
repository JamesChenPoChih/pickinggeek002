from concurrent.futures import ThreadPoolExecutor, as_completed
import logging

from django.core.cache import cache

from pickinggeek.models import StockAlert
from .alerts import evaluate_alert
from .yahoo_finance import get_price_chart

logger = logging.getLogger(__name__)


def check_user_alerts(user):
    cooldown = f'alert-check:{user.pk}'
    cursor_key = f'alert-cursor:{user.pk}'
    if not cache.add(cooldown, True, timeout=60):
        return {'checked': 0, 'created': 0, 'failed': 0, 'cached': True}
    alerts = StockAlert.objects.filter(user=user, enabled=True, stock__is_active=True,
                                      stock__followers__user=user).select_related('stock').order_by('stock_id')
    cursor = cache.get(cursor_key, 0)
    batch = list(alerts.filter(stock_id__gt=cursor)[:8])
    if not batch and cursor:
        batch = list(alerts[:8])
    cache.set(cursor_key, batch[-1].stock_id if batch else 0, timeout=3600)
    result = {'checked': 0, 'created': 0, 'failed': 0, 'cached': False}
    if not batch:
        return result
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = {pool.submit(get_price_chart, alert.stock.symbol, alert.stock.market, '1Y', technical=True): alert.id
                 for alert in batch}
        for task in as_completed(tasks):
            try:
                chart = task.result()
                result['created'] += int(evaluate_alert(tasks[task], chart))
                result['checked'] += 1
            except Exception as error:
                result['failed'] += 1
                logger.warning('Alert check failed: alert=%s error=%s', tasks[task], type(error).__name__)
    return result
