from django.contrib import admin
from django.urls import include, path, re_path
from django.views.generic import TemplateView
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from config.views import health_check, service_status
from pickinggeek.api import (
    StockViewSet,
    UserStockViewSet,
    add_yahoo_to_watchlist,
    ai_analyze,
    google_auth_config,
    google_login,
    indicator_detail,
    indicator_webhook,
    remove_stock_from_watchlist,
    stock_price_chart,
    yahoo_stock_search,
)

router = DefaultRouter()
router.register("stocks", StockViewSet, basename="stock")
router.register("watchlist", UserStockViewSet, basename="watchlist")

admin.site.site_header = "Picking Geek Administration"
admin.site.site_title = "Picking Geek Admin"
admin.site.index_title = "Picking Geek Management"

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("api/status/", service_status, name="service-status"),
    path("admin/", admin.site.urls),
    path("api/auth/google/config/", google_auth_config),
    path("api/auth/token/", TokenObtainPairView.as_view()),
    path("api/auth/token/refresh/", TokenRefreshView.as_view()),
    path("api/auth/google/", google_login),
    path("api/stocks/search/", yahoo_stock_search),
    path("api/watchlist/yahoo/", add_yahoo_to_watchlist),
    path("api/watchlist/stocks/<int:stock_id>/", remove_stock_from_watchlist),
    path("api/stocks/<int:stock_id>/chart/", stock_price_chart),
    path("api/", include(router.urls)),
    path("api/stocks/<int:stock_id>/indicator/", indicator_detail),
    path("api/ai/analyze/", ai_analyze),
    path("api/internal/indicators/", indicator_webhook),
    re_path(
        r"^(?!api/|admin/|health/|static/).*$",
        TemplateView.as_view(template_name="frontend/index.html"),
        name="frontend",
    ),
]
