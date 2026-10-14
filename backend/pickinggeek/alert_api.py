from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import NotificationQueue, Stock, StockAlert
from .services.alerts import validate_rules


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def stock_alert(request, stock_id):
    stock = get_object_or_404(Stock, pk=stock_id, followers__user=request.user)
    alert = StockAlert.objects.filter(user=request.user, stock=stock).first()
    if request.method == 'PUT':
        if not isinstance(request.data, dict):
            return Response({'detail': 'Settings must be an object.'}, status=400)
        try:
            rules = validate_rules(request.data.get('rules'))
            frequency = request.data.get('frequency')
            enabled = request.data.get('enabled', True)
            if frequency not in {'ONCE', 'DAILY'} or type(enabled) is not bool:
                raise ValueError('Invalid frequency or enabled flag.')
        except ValueError as error:
            return Response({'detail': str(error)}, status=400)
        alert, _ = StockAlert.objects.update_or_create(user=request.user, stock=stock, defaults={
            'rules': rules, 'frequency': frequency, 'enabled': enabled,
            'last_bar_at': None,
        })
    return Response({'enabled': alert.enabled if alert else False, 'rules': alert.rules if alert else [],
                     'frequency': alert.frequency if alert else 'ONCE', 'id': alert.id if alert else None})


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def notifications(request):
    query = NotificationQueue.objects.filter(user=request.user)
    if request.method == 'POST':
        query.filter(read_at__isnull=True).update(read_at=timezone.now())
    return Response({'unread': query.filter(read_at__isnull=True).count(), 'items': list(
        query.order_by('-created_at', '-id').values('id', 'title', 'body', 'payload', 'created_at', 'read_at')[:50])})
