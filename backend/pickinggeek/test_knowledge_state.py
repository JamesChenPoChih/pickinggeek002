from datetime import timedelta
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from .models import Stock, StockKnowledgeState


class StockKnowledgeStateTests(TestCase):
    def setUp(self):
        self.stock = Stock.objects.create(symbol="NVDA", market="US", name="NVIDIA")

    def test_defaults_and_shared_primary_key(self):
        state = StockKnowledgeState.objects.create(stock=self.stock)
        self.assertEqual(state.pk, self.stock.pk)
        self.assertEqual(state.status, "NOT_BUILT")
        self.assertIsNone(state.expires_at)
        self.assertIsNone(state.last_requested_at)
        self.assertIsNotNone(state.updated_at)
        self.assertTrue(state.needs_refresh)
        with self.assertRaises(IntegrityError), transaction.atomic():
            StockKnowledgeState.objects.create(stock=self.stock)

    def test_database_rejects_invalid_status_and_ready_without_expiry(self):
        for status in ["UNKNOWN", "READY"]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                StockKnowledgeState.objects.create(stock=self.stock, status=status)

    def test_fresh_expired_and_in_progress_states(self):
        now = timezone.now()
        state = StockKnowledgeState(stock=self.stock, status="READY", expires_at=now + timedelta(hours=1))
        with patch("pickinggeek.models.timezone.now", return_value=now):
            self.assertFalse(state.needs_refresh)
            state.expires_at = now
            self.assertTrue(state.needs_refresh)
            state.expires_at = now - timedelta(seconds=1)
            self.assertTrue(state.needs_refresh)
            state.expires_at = now + timedelta(hours=1)
            for status in ["NOT_BUILT", "QUEUED", "BUILDING", "FAILED"]:
                state.status = status
                self.assertTrue(state.needs_refresh)

    def test_request_timestamp_round_trip_and_stock_deletion(self):
        now = timezone.now()
        state = StockKnowledgeState.objects.create(stock=self.stock, last_requested_at=now)
        state.refresh_from_db()
        self.assertEqual(state.last_requested_at, now)
        self.stock.delete()
        self.assertFalse(StockKnowledgeState.objects.exists())
