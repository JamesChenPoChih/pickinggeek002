from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import DemoAccount, KnowledgeChunk, KnowledgeDocument, NotificationQueue, PopularStock, Stock, StockAlert, StockKnowledgeState, TechnicalIndicatorCache, User, UserStock

admin.site.register(User, UserAdmin)
admin.site.register([Stock, UserStock, TechnicalIndicatorCache, NotificationQueue])


@admin.register(DemoAccount)
class DemoAccountAdmin(admin.ModelAdmin):
    list_display = ['user', 'usage_date', 'pro_used', 'ultra_used']
    readonly_fields = ['user', 'usage_date', 'pro_used', 'ultra_used']

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(StockAlert)
class StockAlertAdmin(admin.ModelAdmin):
    list_display = ['user', 'stock', 'enabled', 'frequency', 'last_notified_date']
    list_filter = ['enabled', 'frequency', 'stock__market']
    readonly_fields = ['rules', 'last_bar_at', 'last_notified_date', 'created_at', 'updated_at']


@admin.register(PopularStock)
class PopularStockAdmin(admin.ModelAdmin):
    list_display = ["rank", "stock", "popularity_count", "ranking_source", "as_of_date", "window_days"]
    list_filter = ["ranking_source", "stock__market"]
    search_fields = ["stock__symbol", "stock__name"]
    readonly_fields = ["updated_at"]


@admin.register(StockKnowledgeState)
class StockKnowledgeStateAdmin(admin.ModelAdmin):
    list_display = ["stock", "status", "updated_at", "expires_at", "last_requested_at"]
    list_filter = ["status", "stock__market"]
    search_fields = ["stock__symbol", "stock__name"]
    readonly_fields = ["updated_at"]


@admin.register(KnowledgeDocument)
class KnowledgeDocumentAdmin(admin.ModelAdmin):
    list_display = ["title", "stock", "source_type", "language", "published_at", "expires_at"]
    list_filter = ["source_type", "language", "stock__market"]
    search_fields = ["title", "stock__symbol", "stock__name"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(KnowledgeChunk)
class KnowledgeChunkAdmin(admin.ModelAdmin):
    list_display = ["document", "chunk_index", "embedding_model", "created_at"]
    search_fields = ["document__title", "document__stock__symbol"]
    readonly_fields = ["embedding", "created_at"]
