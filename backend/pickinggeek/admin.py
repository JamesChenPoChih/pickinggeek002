from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import NotificationQueue, Stock, TechnicalIndicatorCache, User, UserStock

admin.site.register(User, UserAdmin)
admin.site.register([Stock, UserStock, TechnicalIndicatorCache, NotificationQueue])
