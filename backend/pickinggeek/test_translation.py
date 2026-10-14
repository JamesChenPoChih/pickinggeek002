import json
import re
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from .models import User
from .services.llm_router import LLMRouter, QUICK_REPORT_KEYS, REPORT_KEYS, ReportFormatError


class TranslationApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(username='translation-user')
        self.client.force_authenticate(self.user)
        self.report = {key: 'Original paragraph 228.52' for key in QUICK_REPORT_KEYS}

    @patch('pickinggeek.api.translate_report')
    def test_translates_supplied_report_without_analysis_or_market_lookup(self, translate):
        translate.return_value = {key: 'Translated paragraph 228.52' for key in QUICK_REPORT_KEYS}
        with patch('pickinggeek.api.build_analysis_context') as market, patch('pickinggeek.api.LLMRouter') as router:
            response = self.client.post('/api/ai/translate/', {'language': 'en', 'report': self.report}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['language'], 'en')
        self.assertEqual(set(response.data['sections']), set(QUICK_REPORT_KEYS))
        translate.assert_called_once_with(self.report, 'en', self.user.pk)
        router.assert_not_called()
        market.assert_not_called()

    def test_invalid_payloads_do_not_call_model(self):
        payloads = [[], {'language': {}}, {'language': 'fr', 'report': self.report},
                    {'language': 'en', 'report': {}}, {'language': 'en', 'report': {key: 1 for key in QUICK_REPORT_KEYS}},
                    {'language': 'en', 'report': {key: 'x' * 10000 for key in QUICK_REPORT_KEYS}}]
        with patch('pickinggeek.api.LLMRouter') as model:
            for payload in payloads:
                self.assertEqual(self.client.post('/api/ai/translate/', payload, format='json').status_code, 400)
        model.assert_not_called()

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post('/api/ai/translate/', {'language': 'en', 'report': self.report}, format='json').status_code, 401)

    @patch('pickinggeek.api.translate_report', side_effect=RuntimeError)
    def test_failure_keeps_source_unchanged(self, _):
        response = self.client.post('/api/ai/translate/', {'language': 'en', 'report': self.report}, format='json')
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.report['summary'], 'Original paragraph 228.52')


class TranslationServiceTests(SimpleTestCase):
    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_simplified_chinese_normalized_without_changing_indicators_or_values(self, client):
        report = {key: 'MA20, MACD and Squeeze: price 228.52, momentum -3.63.' for key in QUICK_REPORT_KEYS}
        result = {key: 'MA20、MACD 与 Squeeze：价格 [[VALUE_0]]，动能 [[VALUE_1]]，趋势转强，风险仍须观察。' for key in QUICK_REPORT_KEYS}
        client.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason='stop', message=SimpleNamespace(content=json.dumps(result)))])
        translated = LLMRouter().translate_report(report, 'zh')
        self.assertEqual(translated['ma'], 'MA20、MACD 與 Squeeze：價格 228.52，動能 -3.63，趨勢轉強，風險仍須觀察。')

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_structure_numeric_preservation_and_client_close(self, client):
        for keys in (QUICK_REPORT_KEYS, REPORT_KEYS):
            report = {key: '收盤228.52、柱狀-3.63、頻寬10.5%、MA20。' for key in keys}
            translated = {key: 'Close 228.52, histogram -3.63, bandwidth 10.5%, MA20.' for key in keys}
            client.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
                finish_reason='stop', message=SimpleNamespace(content=json.dumps(translated)))])
            self.assertEqual(LLMRouter().translate_report(report, 'en'), translated)
            call = client.return_value.chat.completions.create.call_args.kwargs
            self.assertEqual(call['response_format']['json_schema']['schema']['required'], list(keys))
        self.assertEqual(client.return_value.close.call_count, 2)

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_changed_numbers_are_rejected(self, client):
        report = {key: 'Price 228.52' for key in QUICK_REPORT_KEYS}
        client.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason='stop', message=SimpleNamespace(content=json.dumps({key: 'Price 999' for key in QUICK_REPORT_KEYS})))])
        with self.assertRaisesRegex(ReportFormatError, 'translation_numbers_changed'):
            LLMRouter().translate_report(report, 'en')
        client.return_value.close.assert_called_once()

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_chinese_prose_keeps_english_indicator_names(self, client):
        report = {key: 'MA20, MACD and Squeeze momentum are bullish.' for key in QUICK_REPORT_KEYS}
        translated = {key: 'MA20、MACD 與 Squeeze 動能偏多。' for key in QUICK_REPORT_KEYS}
        client.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason='stop', message=SimpleNamespace(content=json.dumps(translated)))])
        self.assertEqual(LLMRouter().translate_report(report, 'zh'), translated)
        prompt = client.return_value.chat.completions.create.call_args.kwargs['messages'][0]['content']
        self.assertIn('all explanatory prose in Traditional Chinese', prompt)
        self.assertIn('MA, MACD, Bollinger Bands, Squeeze', prompt)
        self.assertIn('raw status words into natural Chinese', prompt)

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_equivalent_negative_and_percentage_formatting(self, client):
        report = {key: 'Momentum –12.47; bandwidth 25.33\u202f%; price 1,200.00.' for key in QUICK_REPORT_KEYS}
        translated = {key: '動能 -12.47；頻寬 25.33%；價格 1200.00。' for key in QUICK_REPORT_KEYS}
        client.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason='stop', message=SimpleNamespace(content=json.dumps(translated)))])
        self.assertEqual(LLMRouter().translate_report(report, 'zh'), translated)

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_protected_values_restored_exactly(self, client):
        report = {key: 'MA20 momentum –12.47; bandwidth 25.33\u202f%.' for key in QUICK_REPORT_KEYS}
        translated = {key: 'MA20 動能 [[VALUE_0]]；頻寬 [[VALUE_1]]。' for key in QUICK_REPORT_KEYS}
        client.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason='stop', message=SimpleNamespace(content=json.dumps(translated)))])
        result = LLMRouter().translate_report(report, 'zh')
        self.assertEqual(result['ma'], 'MA20 動能 –12.47；頻寬 25.33\u202f%。')
        source = json.loads(client.return_value.chat.completions.create.call_args.kwargs['messages'][1]['content'])
        self.assertEqual(source['ma'], 'MA20 momentum [[VALUE_0]]; bandwidth [[VALUE_1]].')

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_duplicate_protected_value_rejected(self, client):
        report = {key: 'Price 228.52; momentum -3.63.' for key in QUICK_REPORT_KEYS}
        translated = {key: 'Price [[VALUE_0]]; momentum [[VALUE_0]].' for key in QUICK_REPORT_KEYS}
        client.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason='stop', message=SimpleNamespace(content=json.dumps(translated)))])
        with self.assertRaisesRegex(ReportFormatError, 'translation_values_changed'):
            LLMRouter().translate_report(report, 'en')
        self.assertEqual(client.return_value.chat.completions.create.call_count, 3)

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_detailed_translation_repairs_only_failed_section(self, client):
        report = {key: 'Price 228.52; momentum -3.63.' for key in REPORT_KEYS}
        valid = '價格 [[VALUE_0]]；動能 [[VALUE_1]]。'
        first = {key: valid for key in REPORT_KEYS}
        first['ma'] = '價格 [[VALUE_0]]；動能 [[VALUE_0]]。'
        def response(sections):
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',
                message=SimpleNamespace(content=json.dumps(sections)))])
        client.return_value.chat.completions.create.side_effect = [response(first), response({'ma': valid})]
        result = LLMRouter().translate_report(report, 'zh')
        self.assertEqual(result, {key: '價格 228.52；動能 -3.63。' for key in REPORT_KEYS})
        calls = client.return_value.chat.completions.create.call_args_list
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1].kwargs['response_format']['json_schema']['schema']['required'], ['ma'])
        self.assertEqual(set(json.loads(calls[1].kwargs['messages'][1]['content'])), {'ma'})
        client.return_value.close.assert_called_once()

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_long_report_translated_in_units_then_reassembled(self, client):
        report = {key: 'Price 228.52. Momentum -3.63.' for key in REPORT_KEYS}
        report['ma'] = 'Price ' + ', '.join(str(number) for number in range(12)) + '. Momentum -3.63.'
        def translate(**kwargs):
            source = json.loads(kwargs['messages'][1]['content'])
            self.assertTrue(all(len(re.findall(r'\[\[VALUE_\d+\]\]', value)) <= 8 for value in source.values()))
            sections = {key: value.replace('Price', '價格').replace('Momentum', '動能') for key, value in source.items()}
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',
                message=SimpleNamespace(content=json.dumps(sections)))])
        client.return_value.chat.completions.create.side_effect = translate
        result = LLMRouter().translate_report(report, 'zh')
        self.assertEqual(list(result), list(REPORT_KEYS))
        self.assertEqual(result['summary'], '價格 228.52. 動能 -3.63.')
        self.assertEqual(result['ma'], report['ma'].replace('Price', '價格').replace('Momentum', '動能'))
        client.return_value.chat.completions.create.assert_called_once()

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_english_translation_rejects_remaining_chinese(self, client):
        report = {key: 'MA20 動能偏多。' for key in QUICK_REPORT_KEYS}
        client.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason='stop', message=SimpleNamespace(content=json.dumps(
                {key: 'MA20 momentum is bullish（偏多）.' for key in QUICK_REPORT_KEYS})))])
        with self.assertRaisesRegex(ReportFormatError, 'translation_language_mismatch'):
            LLMRouter().translate_report(report, 'en')
        client.return_value.close.assert_called_once()
