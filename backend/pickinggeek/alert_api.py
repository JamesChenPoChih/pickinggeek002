from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.core.cache import cache
from django.conf import settings

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.throttling import UserRateThrottle
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import NotificationQueue, Stock, StockAlert
from .services.alerts import validate_rules
from .services.alert_checks import check_user_alerts


class AlertCheckThrottle(UserRateThrottle):
    scope = 'alert_checks'
    rate = '12/min'


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([AlertCheckThrottle])
def check_alerts(request):
    return Response(check_user_alerts(request.user))


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def stock_alert(request, stock_id):
    stock = get_object_or_404(Stock, pk=stock_id, followers__user=request.user)
    alert = StockAlert.objects.filter(user=request.user, stock=stock).first()
    if request.method == 'PUT':
        if not isinstance(request.data, dict):
            return Response({'detail': 'Settings must be an object.'}, status=400)
        try:
            frequency = request.data.get('frequency')
            enabled = request.data.get('enabled', True)
            if frequency not in {'ONCE', 'DAILY'} or type(enabled) is not bool:
                raise ValueError('Invalid frequency or enabled flag.')
            rules = [] if not enabled and request.data.get('rules') == [] else validate_rules(request.data.get('rules'))
        except ValueError as error:
            return Response({'detail': str(error)}, status=400)
        alert, _ = StockAlert.objects.update_or_create(user=request.user, stock=stock, defaults={
            'rules': rules, 'frequency': frequency, 'enabled': enabled,
            'last_bar_at': None,
        })
        cache.delete(f'alert-check:{request.user.pk}')
        cache.delete(f'alert-cursor:{request.user.pk}')
    return Response({'enabled': alert.enabled if alert else False, 'rules': alert.rules if alert else [],
                     'frequency': alert.frequency if alert else 'ONCE', 'id': alert.id if alert else None})


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def notifications(request):
    query = NotificationQueue.objects.filter(user=request.user)
    if request.method == 'POST':
        query.filter(read_at__isnull=True).update(read_at=timezone.now())
    try:
        zone = ZoneInfo(request.query_params.get('timezone') or settings.TIME_ZONE)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo('UTC')
    today = timezone.now().astimezone(zone).date()
    start = datetime.combine(today, time.min, tzinfo=zone)
    end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=zone)
    today_unread = query.filter(read_at__isnull=True, payload__type='stock_alert', created_at__gte=start, created_at__lt=end).count()
    active_alert_stock_ids = list(StockAlert.objects.filter(user=request.user, enabled=True,
        stock__is_active=True, stock__followers__user=request.user).values_list('stock_id', flat=True))
    return Response({'unread': query.filter(read_at__isnull=True).count(), 'today_unread': today_unread,
        'active_alert_stock_ids': active_alert_stock_ids, 'items': list(
        query.order_by('-created_at', '-id').values('id', 'title', 'body', 'payload', 'created_at', 'read_at')[:50])})
