from django.db import IntegrityError, transaction
from django.test import TestCase

from .models import PopularStock, Stock


class PopularStockTests(TestCase):
    def setUp(self):
        self.us = Stock.objects.create(symbol="NVDA", market="US", name="NVIDIA")
        self.tw = Stock.objects.create(symbol="2330", market="TW", name="TSMC")

    def test_shared_ranking_orders_stocks_across_markets(self):
        PopularStock.objects.create(stock=self.us, rank=2)
        PopularStock.objects.create(stock=self.tw, rank=1)
        self.assertEqual(list(PopularStock.objects.values_list("stock_id", flat=True)), [self.tw.id, self.us.id])

    def test_database_rejects_duplicate_stock_and_rank(self):
        PopularStock.objects.create(stock=self.us, rank=1)
        for stock, rank in [(self.us, 2), (self.tw, 1)]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                PopularStock.objects.create(stock=stock, rank=rank)

    def test_database_rejects_invalid_values(self):
        for values in [{"rank": 0}, {"rank": 101}, {"rank": 1, "window_days": 0},
                       {"rank": 1, "ranking_source": "UNKNOWN"}, {"rank": 1, "popularity_count": -1}]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                PopularStock.objects.create(stock=self.us, **values)

    def test_stock_deletion_removes_only_its_ranking(self):
        PopularStock.objects.create(stock=self.us, rank=1)
        PopularStock.objects.create(stock=self.tw, rank=100)
        self.us.delete()
        self.assertEqual(PopularStock.objects.get().stock_id, self.tw.id)
