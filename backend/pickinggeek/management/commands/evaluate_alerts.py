import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.db.models import F

from pickinggeek.models import StockAlert
from pickinggeek.services.alerts import evaluate_alert
from pickinggeek.services.yahoo_finance import get_price_chart


class Command(BaseCommand):
    help = 'Evaluate completed daily-bar alerts and enqueue in-app notifications.'

    def add_arguments(self, parser):
        parser.add_argument('--loop', action='store_true')
        parser.add_argument('--interval', type=int, default=60)

    def handle(self, *args, **options):
        while True:
            close_old_connections()
            try:
                stocks = list(StockAlert.objects.filter(enabled=True, user__is_active=True,
                    stock__is_active=True, stock__followers__user_id=F('user_id')).values_list(
                    'stock_id', 'stock__symbol', 'stock__market').distinct())
                for stock_id, symbol, market in stocks:
                    try:
                        chart = get_price_chart(symbol, market, '1Y', technical=True)
                        for alert_id in StockAlert.objects.filter(stock_id=stock_id, enabled=True).values_list('id', flat=True):
                            evaluate_alert(alert_id, chart)
                    except Exception as error:
                        self.stderr.write(f'Alert evaluation failed: stock={stock_id}, error={type(error).__name__}')
            except Exception as error:
                self.stderr.write(f'Alert worker failed: {type(error).__name__}')
            if not options['loop']:
                break
            time.sleep(max(15, options['interval']))
