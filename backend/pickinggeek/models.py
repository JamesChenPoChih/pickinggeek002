from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models, transaction


class User(AbstractUser):
    class Tier(models.TextChoices):
        FREE = "FREE", "Free"
        PRO = "PRO", "Pro"

    tier = models.CharField(max_length=8, choices=Tier.choices, default=Tier.FREE)
    google_subject = models.CharField(max_length=255, unique=True, null=True, blank=True)
    avatar_url = models.URLField(max_length=500, blank=True)

    @property
    def can_track_unlimited_stocks(self):
        return self.tier == self.Tier.PRO


class Stock(models.Model):
    class Market(models.TextChoices):
        US = "US", "US"
        TW = "TW", "Taiwan"

    symbol = models.CharField(max_length=20)
    market = models.CharField(max_length=2, choices=Market.choices)
    name = models.CharField(max_length=160)
    currency = models.CharField(max_length=3, default="USD")
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["symbol", "market"], name="unique_stock")]
        ordering = ["market", "symbol"]

    def __str__(self):
        return f"{self.symbol} ({self.market})"


class UserStock(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tracked_stocks")
    stock = models.ForeignKey(Stock, on_delete=models.CASCADE, related_name="followers")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "stock"], name="unique_user_stock")]
        ordering = ["-created_at"]

    def clean(self):
        if not self.user_id or self.user.can_track_unlimited_stocks:
            return
        query = UserStock.objects.filter(user_id=self.user_id)
        if self.pk:
            query = query.exclude(pk=self.pk)
        if query.exists():
            raise ValidationError("Free 方案最多只能追蹤 1 支股票。")

    def save(self, *args, **kwargs):
        with transaction.atomic():
            User.objects.select_for_update().get(pk=self.user_id)
            self.full_clean()
            return super().save(*args, **kwargs)


class TechnicalIndicatorCache(models.Model):
    class Signal(models.TextChoices):
        BULLISH = "BULLISH", "Bullish"
        BEARISH = "BEARISH", "Bearish"
        NEUTRAL = "NEUTRAL", "Neutral"

    stock = models.OneToOneField(Stock, on_delete=models.CASCADE, related_name="indicator")
    as_of_date = models.DateField()
    close_price = models.DecimalField(max_digits=14, decimal_places=4)
    macd = models.DecimalField(max_digits=14, decimal_places=6, null=True)
    macd_signal = models.DecimalField(max_digits=14, decimal_places=6, null=True)
    macd_histogram = models.DecimalField(max_digits=14, decimal_places=6, null=True)
    macd_status = models.CharField(max_length=10, choices=Signal.choices, default=Signal.NEUTRAL)
    ma60 = models.DecimalField(max_digits=14, decimal_places=4, null=True)
    ma100 = models.DecimalField(max_digits=14, decimal_places=4, null=True)
    ma200 = models.DecimalField(max_digits=14, decimal_places=4, null=True)
    above_ma60 = models.BooleanField(null=True)
    above_ma100 = models.BooleanField(null=True)
    above_ma200 = models.BooleanField(null=True)
    summary = models.TextField(blank=True)
    chart_points = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class NotificationQueue(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    stock = models.ForeignKey(Stock, on_delete=models.CASCADE)
    title = models.CharField(max_length=160)
    body = models.TextField()
    payload = models.JSONField(default=dict)
    is_sent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
