from datetime import datetime
from math import isfinite
from zoneinfo import ZoneInfo

from django.db import transaction

from pickinggeek.models import NotificationQueue, StockAlert, UserStock


PERIODS = {5, 10, 20, 60, 100, 200, 250}
RULES = {
    'ma_price_cross': {'period': 200, 'direction': 'UP'},
    'ma_cross': {'short': 20, 'long': 60, 'direction': 'UP'},
    'ma_alignment': {'direction': 'UP'},
    'ma_bias': {'period': 20, 'threshold': 15},
    'macd_cross': {'direction': 'UP'},
    'macd_zero': {'direction': 'UP'},
    'macd_trend': {'direction': 'UP', 'days': 3},
    'bb_boundary': {'direction': 'UP'},
    'bb_middle': {},
    'bb_width': {'threshold': 5},
    'bb_expansion': {'growth': 20, 'volume_ratio': 1.5},
    'squeeze_on': {},
    'squeeze_release': {},
    'squeeze_momentum': {'direction': 'UP'},
}


def validate_rules(rules):
    if not isinstance(rules, list) or not 1 <= len(rules) <= len(RULES):
        raise ValueError('Select at least one alert condition.')
    result, seen = [], set()
    for rule in rules:
        if not isinstance(rule, dict) or not isinstance(rule.get('kind'), str) or rule['kind'] not in RULES:
            raise ValueError('Unknown alert condition.')
        kind = rule['kind']
        if kind in seen or set(rule) - {'kind', *RULES[kind]}:
            raise ValueError('Duplicate condition or unknown parameter.')
        seen.add(kind)
        normalized = {'kind': kind, **RULES[kind], **rule}
        for key, value in normalized.items():
            if key in {'period', 'short', 'long'} and (type(value) is not int or value not in PERIODS):
                raise ValueError('Unsupported moving average period.')
            if key == 'direction' and value not in {'UP', 'DOWN'}:
                raise ValueError('Direction must be UP or DOWN.')
            if key == 'days' and (type(value) is not int or not 2 <= value <= 10):
                raise ValueError('Consecutive days must be between 2 and 10.')
            if key in {'threshold', 'growth', 'volume_ratio'}:
                try:
                    finite = type(value) in {int, float} and isfinite(value)
                except OverflowError:
                    finite = False
                if not finite:
                    raise ValueError('Thresholds must be finite numbers.')
                if key == 'threshold' and kind == 'ma_bias':
                    valid = -99 <= value <= 100 and value != 0
                elif key == 'volume_ratio':
                    valid = 1 <= value <= 10
                else:
                    valid = 0 < value <= 100
                if not valid:
                    raise ValueError('Threshold is outside its allowed range.')
        if kind == 'ma_cross' and normalized['short'] >= normalized['long']:
            raise ValueError('Short MA must be shorter than long MA.')
        if kind == 'ma_bias' and normalized['period'] not in {20, 60}:
            raise ValueError('Bias uses MA20 or MA60.')
        result.append(normalized)
    return result


def cross(previous, current, up):
    if previous is None or current is None:
        return False
    return previous <= 0 < current if up else previous >= 0 > current


def difference(point, left, right):
    a, b = point.get(left), point.get(right)
    return a - b if a is not None and b is not None else None


def matches(rule, points):
    if len(points) < 2:
        return False
    previous, current = points[-2:]
    kind, up = rule['kind'], rule.get('direction', 'UP') == 'UP'
    if kind == 'ma_price_cross':
        key = f"ma{rule['period']}"
        return cross(difference(previous, 'price', key), difference(current, 'price', key), up)
    if kind == 'ma_cross':
        left, right = f"ma{rule['short']}", f"ma{rule['long']}"
        return cross(difference(previous, left, right), difference(current, left, right), up)
    if kind == 'ma_alignment':
        def aligned(point):
            values = [point.get(f'ma{period}') for period in [5, 20, 60, 200]]
            return all(value is not None for value in values) and all(
                a > b if up else a < b for a, b in zip(values, values[1:]))
        return aligned(current) and not aligned(previous)
    if kind == 'ma_bias':
        def bias(point):
            average = point.get(f"ma{rule['period']}")
            return (point['price'] / average - 1) * 100 if average else None
        before, after = bias(previous), bias(current)
        return before is not None and after is not None and cross(
            before - rule['threshold'], after - rule['threshold'], rule['threshold'] > 0)
    if kind == 'macd_cross':
        return cross(previous.get('histogram'), current.get('histogram'), up)
    if kind == 'macd_zero':
        return cross(previous.get('macd'), current.get('macd'), up)
    if kind == 'macd_trend':
        count = rule['days']
        values = [point.get('histogram') for point in points[-(count + 1):]]
        if len(values) != count + 1 or any(value is None for value in values):
            return False
        trending = all(a < b if up else a > b for a, b in zip(values, values[1:]))
        earlier = [point.get('histogram') for point in points[-(count + 2):-1]]
        already_trending = len(earlier) == count + 1 and all(value is not None for value in earlier) and all(
            a < b if up else a > b for a, b in zip(earlier, earlier[1:]))
        return trending and not already_trending
    if kind == 'bb_boundary':
        key = 'bb_upper' if up else 'bb_lower'
        return cross(difference(previous, 'price', key), difference(current, 'price', key), up)
    if kind == 'bb_middle':
        middle = current.get('bb_middle')
        before = difference(previous, 'price', 'bb_middle')
        return middle is not None and before is not None and before > 0 and current.get('low') is not None and current['low'] <= middle <= current['price']
    if kind == 'bb_width':
        before, after = previous.get('bb_bandwidth'), current.get('bb_bandwidth')
        return before is not None and after is not None and before * 100 >= rule['threshold'] > after * 100
    if kind == 'bb_expansion':
        before, after, volume = previous.get('bb_bandwidth'), current.get('bb_bandwidth'), current.get('volume')
        volumes = [point.get('volume') for point in points[-21:-1]]
        return (before is not None and before > 0 and after is not None and volume is not None and
                len(volumes) == 20 and all(v is not None for v in volumes) and sum(volumes) > 0 and
                after >= before * (1 + rule['growth'] / 100) and volume >= sum(volumes) / 20 * rule['volume_ratio'] and
                (matches({'kind': 'bb_boundary', 'direction': 'UP'}, points) or matches({'kind': 'bb_boundary', 'direction': 'DOWN'}, points)))
    if kind == 'squeeze_on':
        return previous.get('squeeze_state') in {'OFF', 'NEUTRAL'} and current.get('squeeze_state') == 'ON'
    if kind == 'squeeze_release':
        return previous.get('squeeze_state') == 'ON' and current.get('squeeze_state') == 'OFF'
    if kind == 'squeeze_momentum':
        before, after = previous.get('squeeze_momentum'), current.get('squeeze_momentum')
        if before is None or after is None:
            return False
        older = points[-3].get('squeeze_momentum') if len(points) > 2 else None
        reversal = older is not None and (before <= older if up else before >= older)
        return (after > 0 and after > before if up else after < 0 and after < before) and (cross(before, after, up) or reversal)
    return False


def evaluate_alert(alert_id, chart):
    points = chart['points']
    market_zone = ZoneInfo(chart.get('timezone') or 'America/New_York')
    # Exclude a still-forming daily bar; alerts use confirmed completed sessions.
    today = datetime.now(market_zone).date()
    if chart.get('market_state') in {'PRE', 'REGULAR', 'OPEN_24H'}:
        points = [point for point in points if datetime.fromtimestamp(point['timestamp'], market_zone).date() < today]
    if len(points) < 2:
        return False
    bar_at = points[-1]['timestamp']
    date = datetime.fromtimestamp(bar_at, market_zone).date()
    with transaction.atomic():
        alert = StockAlert.objects.select_for_update().select_related('stock').get(pk=alert_id)
        if not alert.enabled or not alert.user.is_active or not alert.stock.is_active or (alert.last_bar_at is not None and alert.last_bar_at >= bar_at):
            return False
        if not UserStock.objects.filter(user_id=alert.user_id, stock_id=alert.stock_id).exists():
            return False
        if alert.last_bar_at is None:
            alert.last_bar_at = bar_at
            alert.save(update_fields=['last_bar_at', 'updated_at'])
            return False
        hits = [rule for rule in validate_rules(alert.rules) if matches(rule, points)]
        notify = bool(hits) and alert.last_notified_date != date
        if notify:
            NotificationQueue.objects.create(user_id=alert.user_id, stock_id=alert.stock_id,
                title=f"{alert.stock.symbol} technical alert", body=', '.join(rule['kind'] for rule in hits),
                payload={'type': 'stock_alert', 'alert_id': alert.id, 'symbol': alert.stock.symbol,
                         'name': alert.stock.name, 'currency': chart.get('currency', ''),
                         'timezone': chart.get('timezone', ''),
                         'market_date': date.isoformat(), 'rules': hits, 'price': points[-1]['price'],
                         'snapshot': {key: points[-1].get(key) for key in [
                             *[f'ma{period}' for period in sorted(PERIODS)], 'macd', 'macd_signal',
                             'histogram', 'bb_upper', 'bb_middle', 'bb_lower', 'bb_bandwidth', 'squeeze_momentum']}})
            alert.last_notified_date = date
            if alert.frequency == 'ONCE':
                alert.enabled = False
        alert.last_bar_at = bar_at
        alert.save(update_fields=['last_bar_at', 'last_notified_date', 'enabled', 'updated_at'])
    return notify
