from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import NotificationQueue, PopularStock, Stock, TechnicalIndicatorCache, User, UserStock

admin.site.register(User, UserAdmin)
admin.site.register([Stock, UserStock, TechnicalIndicatorCache, NotificationQueue])


@admin.register(PopularStock)
class PopularStockAdmin(admin.ModelAdmin):
    list_display = ["rank", "stock", "popularity_count", "ranking_source", "as_of_date", "window_days"]
    list_filter = ["ranking_source", "stock__market"]
    search_fields = ["stock__symbol", "stock__name"]
    readonly_fields = ["updated_at"]
