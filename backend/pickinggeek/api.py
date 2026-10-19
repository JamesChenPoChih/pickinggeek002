import json
import os
import secrets
import logging
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.conf import settings
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.throttling import UserRateThrottle
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import NotificationQueue, Stock, StockAlert, TechnicalIndicatorCache, User, UserStock
from .serializers import IndicatorSerializer, StockSerializer, UserStockSerializer
from .services.llm_router import LLMRouter, ReportFormatError, REPORT_KEYS, QUICK_REPORT_KEYS, choose_route
from .services.demo_quota import DemoQuotaExceeded, LIMITS, reserve_analysis, usage_for
from .services.analysis_context import build_analysis_context, validate_peers
from .services.bullish import stock_assessment
from .services.native_names import native_stock_name
from .services.translation import translate_report, TranslationNotConfigured
from .services.yahoo_finance import YahooFinanceError, enrich_market_assets, get_market_asset, get_price_chart, search_market_assets

logger = logging.getLogger(__name__)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def google_auth_config(request):
    return Response({
        "enabled": bool(settings.GOOGLE_OAUTH_CLIENT_ID),
        "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
    })


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def google_login(request):
    client_id = settings.GOOGLE_OAUTH_CLIENT_ID
    credential = str(request.data.get("credential", "")).strip()
    if not client_id:
        return Response(
            {"detail": "Google 登入尚未完成伺服器設定。"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if not credential:
        return Response({"detail": "缺少 Google 登入憑證。"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        identity = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
        )
    except ValueError:
        return Response({"detail": "Google 登入憑證無效或已過期。"}, status=status.HTTP_400_BAD_REQUEST)

    subject = str(identity.get("sub", "")).strip()
    email = str(identity.get("email", "")).strip().lower()
    if not subject or not email or identity.get("email_verified") is not True:
        return Response({"detail": "Google 帳號資料未通過驗證。"}, status=status.HTTP_400_BAD_REQUEST)

    defaults = {
        "username": f"google_{subject}"[:150],
        "email": email,
        "first_name": str(identity.get("given_name", ""))[:150],
        "last_name": str(identity.get("family_name", ""))[:150],
        "avatar_url": str(identity.get("picture", "")),
    }
    with transaction.atomic():
        user, created = User.objects.get_or_create(google_subject=subject, defaults=defaults)
        if created:
            user.set_unusable_password()
        else:
            user.email = defaults["email"]
            user.first_name = defaults["first_name"]
            user.last_name = defaults["last_name"]
            user.avatar_url = defaults["avatar_url"]
        user.last_login = timezone.now()
        user.save()

    refresh = RefreshToken.for_user(user)
    return Response({
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": {
            "name": user.get_full_name() or user.email,
            "email": user.email,
            "avatar": user.avatar_url,
            "tier": user.tier,
        },
    })


class StockViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = StockSerializer

    def get_queryset(self):
        if not UserStock.objects.filter(user=self.request.user).exists():
            with transaction.atomic():
                user = User.objects.select_for_update().get(pk=self.request.user.pk)
                if not UserStock.objects.filter(user=user).exists():
                    stock, _ = Stock.objects.update_or_create(
                        symbol="NVDA",
                        market=Stock.Market.US,
                        defaults={
                            "name": "NVIDIA Corporation",
                            "currency": "USD",
                            "is_active": True,
                        },
                    )
                    UserStock.objects.get_or_create(user=user, stock=stock)
        query = Stock.objects.filter(
            is_active=True,
            followers__user=self.request.user,
        ).select_related("indicator").annotate(alert_enabled=Exists(
            StockAlert.objects.filter(user=self.request.user, stock_id=OuterRef('pk'), enabled=True)
        )).distinct()
        symbol = self.request.query_params.get("symbol")
        market = self.request.query_params.get("market")
        if symbol:
            query = query.filter(symbol__icontains=symbol)
        if market:
            query = query.filter(market=market.upper())
        return query


class UserStockViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = UserStockSerializer
    http_method_names = ["get", "post", "delete"]

    def get_queryset(self):
        return UserStock.objects.filter(user=self.request.user).select_related("stock", "stock__indicator")


@api_view(["GET"])
def yahoo_stock_search(request):
    market = str(request.query_params.get('market', 'US')).upper()
    if market not in Stock.Market.values:
        return Response({'detail': 'Invalid market'}, status=status.HTTP_400_BAD_REQUEST)
    query = str(request.query_params.get("q", "")).strip()
    if not query:
        return Response({"results": []})
    if len(query) > 50:
        return Response({"detail": "Search query is too long"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        assets = search_market_assets(query, market=market)
        if market == 'TW':
            results = [{**asset, 'price': None, 'change_percent': None,
                        'market_state': 'UNAVAILABLE', 'updated_at': None} for asset in assets]
        else:
            results = enrich_market_assets(assets)
    except YahooFinanceError:
        return Response(
            {"detail": "Yahoo Finance search is temporarily unavailable"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response({"results": results})


@api_view(["POST"])
def add_yahoo_to_watchlist(request):
    market = str(request.data.get('market', 'US')).upper()
    if market not in Stock.Market.values:
        return Response({'detail': 'Invalid market'}, status=status.HTTP_400_BAD_REQUEST)
    symbol = str(request.data.get("symbol", "")).strip().upper()
    if not symbol or len(symbol) > 20:
        return Response({"detail": "Invalid stock symbol"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        asset = get_market_asset(symbol, market=market)
    except YahooFinanceError:
        return Response(
            {"detail": "Yahoo Finance search is temporarily unavailable"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    if asset is None:
        return Response({"detail": "Investment symbol was not found"}, status=status.HTTP_404_NOT_FOUND)

    stock, _ = Stock.objects.update_or_create(
        symbol=asset['symbol'].removesuffix('.TW') if market == 'TW' else asset['symbol'],
        market=market,
        defaults={"name": native_stock_name(asset['symbol'], market, asset['name']), "currency": 'TWD' if market == 'TW' else 'USD', "is_active": True},
    )
    try:
        _, created = UserStock.objects.get_or_create(user=request.user, stock=stock)
    except ValidationError as exc:
        return Response({"detail": exc.messages[0]}, status=status.HTTP_400_BAD_REQUEST)

    return Response(
        StockSerializer(stock).data,
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(["DELETE"])
def remove_stock_from_watchlist(request, stock_id):
    tracked_stock = get_object_or_404(UserStock, user=request.user, stock_id=stock_id)
    tracked_stock.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def stock_price_chart(request, stock_id):
    stock = get_object_or_404(Stock, pk=stock_id, is_active=True)
    range_key = str(request.query_params.get("range", "1D")).upper()
    try:
        if request.query_params.get('technical') == 'true':
            payload = get_price_chart(stock.symbol, stock.market, range_key, technical=True)
        else:
            payload = get_price_chart(stock.symbol, stock.market, range_key)
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except YahooFinanceError:
        return Response(
            {"detail": "Yahoo Finance chart is temporarily unavailable"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response(payload)


@api_view(["GET"])
def indicator_detail(request, stock_id):
    indicator = get_object_or_404(TechnicalIndicatorCache, stock_id=stock_id)
    return Response(IndicatorSerializer(indicator).data)


class AnalysisThrottle(UserRateThrottle):
    scope = 'ai_analysis'
    rate = '6/min'


@api_view(['POST'])
@throttle_classes([AnalysisThrottle])
def translate_analysis(request):
    if not isinstance(request.data, dict) or not isinstance(request.data.get('language'), str) or request.data['language'] not in {'zh', 'en'}:
        return Response({'detail': 'Invalid translation language'}, status=400)
    report = request.data.get('report')
    if not isinstance(report, dict) or set(report) not in (set(REPORT_KEYS), set(QUICK_REPORT_KEYS)):
        return Response({'detail': 'Invalid analysis report'}, status=400)
    if any(not isinstance(value, str) or not value.strip() for value in report.values()) or sum(len(value) for value in report.values()) > 30000:
        return Response({'detail': 'Invalid or oversized analysis report'}, status=400)
    try:
        translated = translate_report(report, request.data['language'], request.user.pk)
        return Response({'language': request.data['language'], 'sections': translated, 'provider': 'google'})
    except TranslationNotConfigured:
        return Response({'detail': '請先設定 GOOGLE_TRANSLATE_API_KEY，Google 翻譯尚未啟用。' if request.data['language'] == 'zh'
                         else 'Set GOOGLE_TRANSLATE_API_KEY to enable Google translation.'}, status=503)
    except Exception as exc:
        logger.warning('AI translation failed: %s status=%s reason=%s', type(exc).__name__,
                       getattr(exc, 'status_code', None), str(exc) if isinstance(exc, ReportFormatError) else 'provider_error')
        return Response({'detail': '翻譯暫時無法完成，原文已保留。' if request.data['language'] == 'zh' else 'Translation unavailable; the original analysis is preserved.'}, status=502)


@api_view(['GET'])
def bullish_summary(request):
    stocks = list(Stock.objects.filter(followers__user=request.user, is_active=True).distinct())
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(stock_assessment, stocks))
    return Response({'count': sum(item['status'] == 'bullish' for item in results),
                     'stocks': results, 'updated_at': timezone.now().isoformat()})


@api_view(["POST"])
@throttle_classes([AnalysisThrottle])
def ai_analyze(request):
    if not request.user.can_use_ai_models:
        return Response({'detail': 'AI analysis requires an active Pro or Premium membership.',
                         'code': 'paid_membership_required'}, status=status.HTTP_403_FORBIDDEN)
    if not isinstance(request.data, dict):
        return Response({'detail': 'Invalid request'}, status=400)
    question = str(request.data.get("question", "")).strip()
    mode = str(request.data.get("mode", "auto"))
    stock_id = request.data.get("stock_id")
    if not question or len(question) > 2000 or mode not in {'auto', 'quick', 'deep'}:
        return Response({"detail": "question 不可為空"}, status=status.HTTP_400_BAD_REQUEST)
    if isinstance(stock_id, bool) or not isinstance(stock_id, int) or stock_id <= 0:
        return Response({'detail': 'Invalid stock_id'}, status=400)
    stock = get_object_or_404(Stock.objects.select_related("indicator"), pk=stock_id)
    if not UserStock.objects.filter(user=request.user, stock=stock).exists():
        return Response({'detail': 'Please add this stock to your watchlist first.'}, status=403)
    try:
        peers = validate_peers(request.data.get('comparisons', []), stock.symbol, stock.market)
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=400)
    language = 'en' if request.data.get('language') == 'en' else 'zh'
    selected_mode = choose_route(question, mode).mode
    try:
        reserve_analysis(request.user, selected_mode)
    except DemoQuotaExceeded:
        _, limit, label = LIMITS[selected_mode]
        message = (f'{label} daily demo limit reached ({limit}/{limit}). Resets at midnight in {settings.TIME_ZONE}.'
                   if language == 'en' else
                   f'{label} \u4eca\u65e5 Demo \u984d\u5ea6\u5df2\u7528\u5b8c\uff08{limit}/{limit}\uff09\uff0c\u65bc {settings.TIME_ZONE} \u6bcf\u65e5\u96f6\u6642\u91cd\u7f6e\u3002')
        return Response({'detail': message, 'code': 'daily_demo_limit', 'usage': usage_for(request.user)}, status=429)

    def event_stream():
        try:
            router = LLMRouter()
            context = build_analysis_context(stock, selected_mode, peers)
            context['language'] = language
            yield f"data: {json.dumps({'type': 'context', 'data': context}, ensure_ascii=False)}\n\n"
            for event in router.stream(question, context, selected_mode):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            logger.warning('AI analysis failed: %s status=%s', type(exc).__name__, getattr(exc, 'status_code', None))
            code = 'service_error'
            message = 'AI 服務目前無法完成請求，請稍後再試。' if language == 'zh' else 'AI analysis is unavailable. Please try again.'
            if isinstance(exc, ReportFormatError):
                code = str(exc)
                message = '模型回傳的分析格式不完整，請重新分析。' if language == 'zh' else 'The model returned an incomplete report. Please retry.'
                if code == 'truncated_report':
                    message = '報告生成被長度限制截斷，請縮短問題後重新分析。' if language == 'zh' else 'The report reached its output limit. Shorten the question and retry.'
                logger.warning('AI report validation failed: %s', code)
            elif type(exc).__name__ == 'APITimeoutError':
                code = 'timeout'
                message = '分析服務回應逾時，請重新分析。' if language == 'zh' else 'Analysis timed out. Please retry.'
            error = {"type": "error", "message": message, 'code': code}
            yield f"data: {json.dumps(error, ensure_ascii=False)}\n\n"
        yield "data: {\"type\": \"done\"}\n\n"

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    response['X-Analysis-Format'] = 'json-schema-v2'
    return response


@api_view(['GET'])
def analysis_usage(request):
    return Response(usage_for(request.user))


def _optional_decimal(value):
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"無效數值：{value}") from exc


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def indicator_webhook(request):
    expected_secret = os.getenv("JOB_WEBHOOK_SECRET", "")
    supplied_secret = request.headers.get("X-Job-Secret", "")
    if not expected_secret or not secrets.compare_digest(expected_secret, supplied_secret):
        return Response({"detail": "無效的 Job 憑證"}, status=status.HTTP_403_FORBIDDEN)

    payload = request.data
    try:
        stock = Stock.objects.get(symbol=payload["symbol"], market=payload["market"])
        indicator, _ = TechnicalIndicatorCache.objects.update_or_create(
            stock=stock,
            defaults={
                "as_of_date": payload["as_of_date"],
                "close_price": _optional_decimal(payload["close"]),
                "macd": _optional_decimal(payload.get("macd")),
                "macd_signal": _optional_decimal(payload.get("signal")),
                "macd_histogram": _optional_decimal(payload.get("histogram")),
                "macd_status": payload.get("macd_status", "NEUTRAL"),
                "ma60": _optional_decimal(payload.get("ma60")),
                "ma100": _optional_decimal(payload.get("ma100")),
                "ma200": _optional_decimal(payload.get("ma200")),
                "above_ma60": payload.get("above_ma60"),
                "above_ma100": payload.get("above_ma100"),
                "above_ma200": payload.get("above_ma200"),
                "summary": payload.get("summary", ""),
                "chart_points": payload.get("chart_points", []),
            },
        )
    except Stock.DoesNotExist:
        return Response({"detail": "找不到股票"}, status=status.HTTP_404_NOT_FOUND)
    except (KeyError, ValueError) as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    for follower in stock.followers.select_related("user"):
        NotificationQueue.objects.create(
            user=follower.user,
            stock=stock,
            title=f"{stock.symbol} 技術訊號更新",
            body=indicator.summary or f"MACD 狀態：{indicator.get_macd_status_display()}",
            payload={"stock_id": stock.id, "as_of_date": str(indicator.as_of_date)},
        )
    return Response(IndicatorSerializer(indicator).data)
