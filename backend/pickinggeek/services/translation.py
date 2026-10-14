import hashlib
import html
import json
import os

import httpx
from django.core.cache import cache
from opencc import OpenCC


class TranslationNotConfigured(RuntimeError):
    pass


def translate_report(report, language, user_id):
    payload = json.dumps({'report': report, 'language': language}, sort_keys=True, ensure_ascii=False)
    key = f'google-translation:v1:{user_id}:{hashlib.sha256(payload.encode()).hexdigest()}'
    cached = cache.get(key)
    if cached is not None:
        return cached
    api_key = os.getenv('GOOGLE_TRANSLATE_API_KEY', '').strip()
    if not api_key:
        raise TranslationNotConfigured()
    keys = list(report)
    # Translate all sections in one request; do not regenerate investment analysis.
    with httpx.Client(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
        response = client.post('https://translation.googleapis.com/language/translate/v2',
                               params={'key': api_key},
                               json={'q': [report[field] for field in keys],
                                     'target': 'zh-TW' if language == 'zh' else 'en', 'format': 'text'})
        response.raise_for_status()
        translations = response.json().get('data', {}).get('translations', [])
    if not isinstance(translations, list) or len(translations) != len(keys):
        raise ValueError('incomplete_google_translation')
    converted = {}
    traditional = OpenCC('s2tw') if language == 'zh' else None
    for field, translation in zip(keys, translations):
        text = translation.get('translatedText') if isinstance(translation, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise ValueError('empty_google_translation')
        text = html.unescape(text).strip()
        converted[field] = traditional.convert(text) if traditional else text
    cache.set(key, converted, timeout=3600)
    return converted
