import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from .models import Stock, User, UserStock
from .services.analysis_context import build_analysis_context, indicator_facts, recent_news, technical_readout, technical_snapshot, validate_peers
from .services.llm_router import LLMRouter, REPORT_KEYS, QUICK_REPORT_KEYS, validate_report


class AnalysisContextTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_peer_validation(self):
        good = [{'symbol': 'nvda', 'market': 'US', 'role': 'industry'}, {'symbol': 'CRWV', 'role': 'peer'}]
        self.assertEqual(validate_peers(good, 'NBIS', 'US')[0]['symbol'], 'NVDA')
        for bad in [None, [1], [{'symbol': 'https://localhost'}], [{'symbol': 'NBIS'}], good + good, [good[0], good[0]], [{'symbol': 'NVDA', 'role': 'fake'}]]:
            with self.assertRaises(ValueError):
                validate_peers(bad, 'NBIS', 'US')

    def test_computed_relationships(self):
        facts = indicator_facts({'price': 206, 'ma5': 205, 'ma20': 229, 'ma60': 190, 'ma200': 150,
            'bb_lower': 200, 'bb_middle': 229, 'bb_upper': 250, 'bb_bandwidth': .2,
            'histogram': -3, 'squeeze_state': 'OFF', 'squeeze_released': False, 'squeeze_momentum': -2})
        self.assertEqual(facts['MA']['close_vs_averages']['ma5'], 'above')
        self.assertEqual(facts['MA']['alignment_5_20_60_200'], 'mixed')
        self.assertEqual(facts['Bollinger Bands']['close_position'], 'between lower and middle bands')
        self.assertEqual(facts['Bollinger Bands']['bandwidth_pct'], 20)
        self.assertEqual(facts['MACD']['new_cross'], 'none')
        self.assertFalse(facts['Squeeze']['new_release'])
        readout = technical_readout({'language': 'en', 'target': {'status': 'available', 'close': 206, 'computed_facts': facts, 'indicators': {'ma20': 229, 'ma60': 190, 'ma200': 150}}})
        self.assertIn('between lower and middle bands', readout)
        for heading in ('MA:', 'MACD:', 'Bollinger Bands:', 'Squeeze:'):
            self.assertIn(heading, readout)

    @patch('pickinggeek.services.analysis_context.get_price_chart')
    def test_snapshot_excludes_forming_bar(self, chart):
        now = datetime.now(timezone.utc)
        chart.return_value = {'timezone': 'UTC', 'market_state': 'REGULAR', 'currency': 'USD',
            'current_price': 30, 'updated_at': int(now.timestamp()), 'points': [
                {'timestamp': int((now - timedelta(days=1)).timestamp()), 'price': 20, 'ma60': 19, 'bb_bandwidth': .1},
                {'timestamp': int(now.timestamp()), 'price': 30, 'ma60': 29}]}
        result = technical_snapshot('NBIS', 'US')
        self.assertEqual(result['close'], 20)
        self.assertEqual(result['latest_quote'], 30)
        self.assertEqual(result['indicators']['bb_bandwidth'], .1)
        self.assertIn('ma200', result['missing'])
        chart.assert_called_once_with('NBIS', 'US', '1Y', technical=True)

    @patch('pickinggeek.services.analysis_context.get_price_chart', side_effect=RuntimeError)
    def test_quote_failure_is_not_fabricated(self, _):
        self.assertEqual(technical_snapshot('NBIS', 'US')['status'], 'unavailable')

    @patch('pickinggeek.services.analysis_context.httpx.get')
    def test_news_filter_window_cache(self, get):
        now = datetime.now(timezone.utc)
        def item(days, **extra):
            return {'title': 'Headline', 'link': f'https://example.com/{days}', 'providerPublishTime': (now - timedelta(days=days)).timestamp(), 'relatedTickers': ['NBIS'], **extra}
        response = Mock()
        response.json.return_value = {'news': [item(1), item(10), item(31), item(2, link='javascript:alert(1)'), item(3, relatedTickers=['AAPL']), item(-1), item(1)]}
        get.return_value = response
        result = recent_news('NBIS', 'US')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['window_days'], 7)
        self.assertEqual(recent_news('NBIS', 'US'), result)
        get.assert_called_once()
        cache.clear()
        response.json.return_value = {'news': [item(10)]}
        self.assertEqual(recent_news('NBIS', 'US')['window_days'], 30)

    @patch('pickinggeek.services.analysis_context.httpx.get', side_effect=httpx.ConnectError('offline'))
    def test_news_failure(self, _):
        self.assertEqual(recent_news('NBIS', 'US')['status'], 'unavailable')

    @patch('pickinggeek.services.analysis_context.recent_news')
    @patch('pickinggeek.services.analysis_context.technical_snapshot')
    def test_quick_no_news_deep_two_comparisons(self, technical, news):
        technical.side_effect = lambda symbol, market: {'symbol': symbol, 'market': market, 'status': 'available'}
        news.return_value = {'status': 'empty', 'items': [], 'window_days': 7}
        stock = SimpleNamespace(symbol='NBIS', market='US', name='Nebius')
        peers = validate_peers([{'symbol': 'NVDA', 'role': 'industry'}, {'symbol': 'CRWV'}], 'NBIS', 'US')
        quick = build_analysis_context(stock, 'quick', peers)
        self.assertEqual(quick['comparisons'], [])
        news.assert_not_called()
        deep = build_analysis_context(stock, 'deep', peers)
        self.assertEqual([item['symbol'] for item in deep['comparisons']], ['NVDA', 'CRWV'])
        self.assertEqual(news.call_count, 3)
        for selected in ([], peers[:1]):
            news.reset_mock()
            technical.reset_mock()
            report = build_analysis_context(stock, 'deep', selected)
            self.assertEqual(len(report['comparisons']), len(selected))
            self.assertEqual(news.call_count, 1 + len(selected))
            self.assertEqual(technical.call_count, 1 + len(selected))


class AnalysisApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(username='analysis-user')
        self.stock = Stock.objects.create(symbol='NBIS', market='US', name='Nebius')
        UserStock.objects.create(user=self.user, stock=self.stock)
        self.client.force_authenticate(self.user)

    def test_invalid_input_and_watchlist(self):
        for payload in [[], {'question': 'Q', 'stock_id': 'bad'}, {'question': 'Q', 'stock_id': self.stock.id, 'mode': 'bad'}, {'question': 'Q', 'stock_id': self.stock.id, 'comparisons': [{'symbol': 'NBIS'}]}]:
            self.assertEqual(self.client.post('/api/ai/analyze/', payload, format='json').status_code, 400)
        UserStock.objects.all().delete()
        self.assertEqual(self.client.post('/api/ai/analyze/', {'question': 'Q', 'stock_id': self.stock.id}, format='json').status_code, 403)

    @patch('pickinggeek.api.build_analysis_context')
    @patch('pickinggeek.api.LLMRouter')
    def test_context_precedes_answer(self, router, context):
        router.return_value.choose_model.return_value.mode = 'quick'
        router.return_value.stream.return_value = [{'type': 'token', 'content': 'Answer'}]
        context.return_value = {'target': {'symbol': 'NBIS'}, 'comparisons': [], 'mode': 'quick'}
        response = self.client.post('/api/ai/analyze/', {'question': 'Q', 'stock_id': self.stock.id, 'mode': 'quick', 'language': 'en'}, format='json')
        content = b''.join(response.streaming_content).decode()
        events = [json.loads(part[6:]) for part in content.strip().split('\n\n')]
        self.assertEqual([item['type'] for item in events], ['context', 'token', 'done'])
        self.assertEqual(context.return_value['language'], 'en')

    @patch('pickinggeek.api.LLMRouter', side_effect=RuntimeError)
    def test_failure_sse(self, _):
        response = self.client.post('/api/ai/analyze/', {'question': 'Q', 'stock_id': self.stock.id}, format='json')
        self.assertIn('"type": "error"', b''.join(response.streaming_content).decode())

    def test_rate_limit(self):
        for _ in range(6):
            self.client.post('/api/ai/analyze/', {}, format='json')
        self.assertEqual(self.client.post('/api/ai/analyze/', {}, format='json').status_code, 429)


class AnalysisPromptTests(SimpleTestCase):
    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_mode_specific_report_templates(self, client):
        context = {'language': 'en', 'target': {'status': 'available', 'close': 10, 'indicators': {}, 'computed_facts': {}}}
        for mode, expected_tokens in [('deep', 1), ('quick', 1)]:
            response = Mock()
            report = {key: f'{key} paragraph' for key in (REPORT_KEYS if mode == 'deep' else QUICK_REPORT_KEYS)}
            content = json.dumps(report)
            response.__iter__ = Mock(return_value=iter([SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content), finish_reason='length')])]))
            client.return_value.chat.completions.create.return_value = response
            events = list(LLMRouter().stream('Q', context, mode))
            tokens = [event['content'] for event in events if event['type'] == 'token']
            self.assertEqual(len(tokens), expected_tokens)
            if mode == 'deep':
                self.assertTrue(tokens[0].startswith('AI analysis\n\nSummary'))
                self.assertEqual(next(event for event in events if event['type'] == 'report')['sections'], report)
                response_format = client.return_value.chat.completions.create.call_args.kwargs['response_format']
                self.assertEqual(response_format['type'], 'json_schema')
                self.assertTrue(response_format['json_schema']['strict'])
                schema = response_format['json_schema']['schema']
                self.assertEqual(schema['required'], list(REPORT_KEYS))
                self.assertFalse(schema['additionalProperties'])
                prompt = client.return_value.chat.completions.create.call_args.kwargs['messages'][0]['content']
                self.assertIn('不要在開頭另列一份重複', prompt)
                self.assertIn('恢復敘述式分析', prompt)
                self.assertIn('已提供的參考標的在同一指標上的比較', prompt)
                for title in ('總結：', 'AI 分析：', '技術面：', '建議操作策略：', '新聞面：'):
                    self.assertIn(title, prompt)
                self.assertIn('不能單獨當成買進確認', prompt)
                self.assertIn('每個子標題下至少一段完整分析', prompt)
                self.assertIn('模板只固定結構', prompt)
                self.assertNotIn('精確逐項判讀已由程式顯示', prompt)
            else:
                self.assertTrue(tokens[0].startswith('AI analysis\n\nSummary'))
                self.assertNotIn('Suggested strategy', tokens[0])
                self.assertNotIn('News analysis', tokens[0])
                self.assertEqual(set(next(event for event in events if event['type'] == 'report')['sections']), set(QUICK_REPORT_KEYS))
                call = client.return_value.chat.completions.create.call_args.kwargs
                self.assertEqual(call['response_format']['json_schema']['schema']['required'], list(QUICK_REPORT_KEYS))
                self.assertIn('不要額外產生', call['messages'][0]['content'])

    def test_rejects_incomplete_report(self):
        for text in ['not json', '{}', json.dumps({key: '' for key in REPORT_KEYS}), json.dumps({key: [] for key in REPORT_KEYS})]:
            with self.assertRaises(ValueError):
                validate_report(text)

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_optional_comparison_prompt(self, client):
        for peers, expected in [([], '本次未選取任何比較標的'),
                                ([{'symbol': 'NVDA', 'role': 'industry'}], '不要加入同業比較'),
                                ([{'symbol': 'CRWV', 'role': 'peer'}], '不要加入產業關聯比較')]:
            response = Mock()
            response.__iter__ = Mock(return_value=iter([SimpleNamespace(choices=[SimpleNamespace(
                delta=SimpleNamespace(content=json.dumps({key: 'Analysis paragraph' for key in REPORT_KEYS})), finish_reason='stop')])]))
            client.return_value.chat.completions.create.return_value = response
            list(LLMRouter().stream('Q', {'comparisons': peers}, 'deep'))
            prompt = client.return_value.chat.completions.create.call_args.kwargs['messages'][0]['content']
            self.assertIn(expected, prompt)

    def test_accepts_complete_report_with_literal_newlines(self):
        report = {key: 'First paragraph\nSecond paragraph' for key in REPORT_KEYS}
        raw = json.dumps(report).replace('\\n', '\n')
        self.assertEqual(validate_report(raw), report)
        self.assertEqual(validate_report('```json\n' + json.dumps(report) + '\n```'), report)
        self.assertEqual(validate_report(json.dumps({**report, 'disclaimer': 'Research only'})), report)

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_incomplete_truncation_has_specific_error(self, client):
        response = Mock()
        response.__iter__ = Mock(return_value=iter([SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content='{"summary":"unfinished'), finish_reason='length')])]))
        client.return_value.chat.completions.create.return_value = response
        with self.assertRaisesRegex(ValueError, 'truncated_report'):
            list(LLMRouter().stream('Q', {}, 'deep'))
        response.close.assert_called_once()
        client.return_value.close.assert_called_once()

    @patch('pickinggeek.services.llm_router.OpenAI')
    @patch.dict('os.environ', {'NEBIUS_API_KEY': 'test-key'})
    def test_grounded_prompt_and_close(self, client):
        response = Mock()
        content = json.dumps({key: 'Answer' for key in QUICK_REPORT_KEYS})
        response.__iter__ = Mock(return_value=iter([SimpleNamespace(choices=[]), SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content))])]))
        client.return_value.chat.completions.create.return_value = response
        events = list(LLMRouter().stream('Q', {'language': 'en', 'target': {'close': 10}}, 'quick'))
        self.assertIn('Answer', events[-1]['content'])
        call = client.return_value.chat.completions.create.call_args.kwargs
        self.assertIn('Bollinger', call['messages'][0]['content'])
        for name in ('MA：', 'MACD：', 'Bollinger Bands：', 'Squeeze：', 'computed_facts'):
            self.assertIn(name, call['messages'][0]['content'])
        self.assertIn('10', call['messages'][1]['content'])
        response.close.assert_called_once()
        client.return_value.close.assert_called_once()
