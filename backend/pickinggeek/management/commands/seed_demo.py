from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand

from pickinggeek.models import Stock, TechnicalIndicatorCache, User, UserStock


STOCKS = [
    ("AAPL", "US", "Apple Inc.", "USD", Decimal("224.31")),
    ("NVDA", "US", "NVIDIA Corporation", "USD", Decimal("176.67")),
    ("2330", "TW", "台灣積體電路製造", "TWD", Decimal("1265.00")),
]


class Command(BaseCommand):
    help = "建立 Hackathon 展示帳號、股票與技術指標"

    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(
            username="demo",
            defaults={"email": "demo@pickinggeek.local", "tier": User.Tier.PRO},
        )
        if created:
            user.set_password("demo1234")
            user.save(update_fields=["password"])

        for index, (symbol, market, name, currency, close) in enumerate(STOCKS):
            stock, _ = Stock.objects.update_or_create(
                symbol=symbol,
                market=market,
                defaults={"name": name, "currency": currency, "is_active": True},
            )
            UserStock.objects.get_or_create(user=user, stock=stock)
            points = []
            for offset in range(12):
                point_date = date.today() - timedelta(days=(11 - offset) * 7)
                points.append({
                    "date": point_date.strftime("%m/%d"),
                    "price": float(close - Decimal(11 - offset) * Decimal("1.55") + index),
                    "ma60": float(close - Decimal("19.65")),
                    "ma200": float(close - Decimal("38.89")),
                })
            TechnicalIndicatorCache.objects.update_or_create(
                stock=stock,
                defaults={
                    "as_of_date": date.today(),
                    "close_price": close,
                    "macd": Decimal("4.821") - index,
                    "macd_signal": Decimal("4.102") - index,
                    "macd_histogram": Decimal("0.719"),
                    "macd_status": TechnicalIndicatorCache.Signal.BULLISH,
                    "ma60": close - Decimal("19.65"),
                    "ma100": close - Decimal("28.49"),
                    "ma200": close - Decimal("38.89"),
                    "above_ma60": True,
                    "above_ma100": True,
                    "above_ma200": True,
                    "summary": "股價站上主要均線，MACD 動能維持正值，趨勢偏多。",
                    "chart_points": points,
                },
            )
        self.stdout.write(self.style.SUCCESS("Demo data ready: demo / demo1234"))
