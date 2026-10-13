from hashlib import sha256

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from .models import KnowledgeChunk, KnowledgeDocument, Stock


class KnowledgeDocumentTests(TestCase):
    def setUp(self):
        self.stock = Stock.objects.create(symbol="NVDA", market="US", name="NVIDIA")
        self.document = KnowledgeDocument.objects.create(
            stock=self.stock, title="Sample report", content="Sample content",
            content_hash=sha256(b"Sample content").hexdigest(), source_type="REPORT",
        )

    def test_document_deduplication_is_per_stock(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            KnowledgeDocument.objects.create(stock=self.stock, title="Duplicate", content="Sample content", content_hash=self.document.content_hash)
        other = Stock.objects.create(symbol="2330", market="TW", name="TSMC")
        KnowledgeDocument.objects.create(stock=other, title="Same text", content="Sample content", content_hash=self.document.content_hash)
        self.assertEqual(KnowledgeDocument.objects.count(), 2)

    def test_chunks_have_unique_order_per_document(self):
        KnowledgeChunk.objects.create(document=self.document, chunk_index=1, content="Second")
        KnowledgeChunk.objects.create(document=self.document, chunk_index=0, content="First")
        self.assertEqual(list(self.document.chunks.values_list("chunk_index", flat=True)), [0, 1])
        with self.assertRaises(IntegrityError), transaction.atomic():
            KnowledgeChunk.objects.create(document=self.document, chunk_index=0, content="Duplicate")

    def test_nullable_embedding_and_vector_round_trip(self):
        chunk = KnowledgeChunk.objects.create(document=self.document, chunk_index=0, content="First")
        chunk.refresh_from_db()
        self.assertIsNone(chunk.embedding)
        chunk.embedding = [1.0] + [0.0] * 1023
        chunk.save()
        chunk.refresh_from_db()
        self.assertEqual(len(chunk.embedding), 1024)
        self.assertEqual(float(chunk.embedding[0]), 1.0)
        self.assertEqual(chunk.embedding_model, "Qwen/Qwen3-Embedding-8B")

    def test_invalid_vector_dimensions_are_rejected(self):
        chunk = KnowledgeChunk(document=self.document, chunk_index=0, content="Wrong", embedding=[1.0, 2.0])
        with self.assertRaises(ValidationError):
            chunk.full_clean()

    def test_document_deletion_removes_its_chunks(self):
        KnowledgeChunk.objects.create(document=self.document, chunk_index=0, content="First")
        self.document.delete()
        self.assertFalse(KnowledgeChunk.objects.exists())

    def test_database_rejects_invalid_metadata(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            KnowledgeChunk.objects.create(document=self.document, chunk_index=0, content="First", embedding_model="")
        with self.assertRaises(IntegrityError), transaction.atomic():
            KnowledgeChunk.objects.create(document=self.document, chunk_index=-1, content="First")
        with self.assertRaises(IntegrityError), transaction.atomic():
            KnowledgeDocument.objects.create(stock=self.stock, title="Invalid", content="Other", content_hash="a" * 64, source_type="UNKNOWN")
