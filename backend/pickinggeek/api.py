import json
import os
import secrets
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.conf import settings
from django.db import transaction
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import NotificationQueue, Stock, TechnicalIndicatorCache, User, UserStock
from .serializers import IndicatorSerializer, StockSerializer, UserStockSerializer
from .services.llm_router import LLMRouter
from .services.yahoo_finance import YahooFinanceError, enrich_market_assets, get_market_asset, get_price_chart, search_market_assets


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
        ).select_related("indicator").distinct()
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
    query = str(request.query_params.get("q", "")).strip()
    if not query:
        return Response({"results": []})
    if len(query) > 50:
        return Response({"detail": "Search query is too long"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        results = enrich_market_assets(search_market_assets(query))
    except YahooFinanceError:
        return Response(
            {"detail": "Yahoo Finance search is temporarily unavailable"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response({"results": results})


@api_view(["POST"])
def add_yahoo_to_watchlist(request):
    symbol = str(request.data.get("symbol", "")).strip().upper()
    if not symbol or len(symbol) > 20:
        return Response({"detail": "Invalid stock symbol"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        asset = get_market_asset(symbol)
    except YahooFinanceError:
        return Response(
            {"detail": "Yahoo Finance search is temporarily unavailable"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    if asset is None:
        return Response({"detail": "Investment symbol was not found"}, status=status.HTTP_404_NOT_FOUND)

    stock, _ = Stock.objects.update_or_create(
        symbol=asset["symbol"],
        market=Stock.Market.US,
        defaults={"name": asset["name"], "currency": "USD", "is_active": True},
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


@api_view(["POST"])
def ai_analyze(request):
    question = str(request.data.get("question", "")).strip()
    mode = str(request.data.get("mode", "auto"))
    stock_id = request.data.get("stock_id")
    if not question:
        return Response({"detail": "question 不可為空"}, status=status.HTTP_400_BAD_REQUEST)
    stock = get_object_or_404(Stock.objects.select_related("indicator"), pk=stock_id)
    context = StockSerializer(stock).data

    def event_stream():
        try:
            for event in LLMRouter().stream(question, context, mode):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception:
            error = {"type": "error", "message": "AI 服務目前無法完成請求，請稍後再試。"}
            yield f"data: {json.dumps(error, ensure_ascii=False)}\n\n"
        yield "data: {\"type\": \"done\"}\n\n"

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


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
