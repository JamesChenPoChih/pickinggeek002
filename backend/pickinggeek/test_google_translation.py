from unittest.mock import patch

import httpx
from django.core.cache import cache
from django.test import SimpleTestCase

from .services.translation import TranslationNotConfigured, translate_report


class GoogleTranslationTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.report = {'summary': 'Price 228.52.', 'ma': 'MA20 and MACD are positive.'}

    @patch.dict('os.environ', {'GOOGLE_TRANSLATE_API_KEY': 'test-key'})
    @patch('pickinggeek.services.translation.httpx.Client')
    def test_batch_traditional_and_cache_without_model(self, client):
        response = client.return_value.__enter__.return_value.post.return_value
        response.json.return_value = {'data': {'translations': [
            {'translatedText': '价格 228.52。'}, {'translatedText': 'MA20 与 MACD 动能转强。'}]}}
        with patch('pickinggeek.services.llm_router.OpenAI') as model:
            first = translate_report(self.report, 'zh', 1)
            self.assertEqual(translate_report(self.report, 'zh', 1), first)
        self.assertEqual(first, {'summary': '價格 228.52。', 'ma': 'MA20 與 MACD 動能轉強。'})
        post = client.return_value.__enter__.return_value.post
        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs['json'], {'q': list(self.report.values()), 'target': 'zh-TW', 'format': 'text'})
        model.assert_not_called()

    @patch.dict('os.environ', {'GOOGLE_TRANSLATE_API_KEY': ''})
    @patch('pickinggeek.services.translation.httpx.Client')
    def test_missing_key_does_not_call_provider(self, client):
        with self.assertRaises(TranslationNotConfigured):
            translate_report(self.report, 'zh', 1)
        client.assert_not_called()

    @patch.dict('os.environ', {'GOOGLE_TRANSLATE_API_KEY': 'test-key'})
    @patch('pickinggeek.services.translation.httpx.Client')
    def test_cache_isolated_by_user_language_and_report(self, client):
        response = client.return_value.__enter__.return_value.post.return_value
        response.json.return_value = {'data': {'translations': [{'translatedText': 'One'}, {'translatedText': 'Two'}]}}
        translate_report(self.report, 'en', 1)
        translate_report(self.report, 'en', 2)
        translate_report(self.report, 'zh', 1)
        translate_report({**self.report, 'ma': 'Changed'}, 'en', 1)
        self.assertEqual(client.return_value.__enter__.return_value.post.call_count, 4)

    @patch.dict('os.environ', {'GOOGLE_TRANSLATE_API_KEY': 'test-key'})
    @patch('pickinggeek.services.translation.httpx.Client')
    def test_bad_response_not_cached(self, client):
        response = client.return_value.__enter__.return_value.post.return_value
        response.json.return_value = {'data': {'translations': [{'translatedText': ''}]}}
        for _ in range(2):
            with self.assertRaises(ValueError):
                translate_report(self.report, 'en', 1)
        self.assertEqual(client.return_value.__enter__.return_value.post.call_count, 2)

    @patch.dict('os.environ', {'GOOGLE_TRANSLATE_API_KEY': 'test-key'})
    @patch('pickinggeek.services.translation.httpx.Client')
    def test_timeout_not_retried(self, client):
        post = client.return_value.__enter__.return_value.post
        post.side_effect = httpx.ReadTimeout('timeout')
        with self.assertRaises(httpx.ReadTimeout):
            translate_report(self.report, 'zh', 1)
        post.assert_called_once()
