from rest_framework import serializers

from .models import Stock, TechnicalIndicatorCache, UserStock
from .services.native_names import native_stock_name


class IndicatorSerializer(serializers.ModelSerializer):
    class Meta:
        model = TechnicalIndicatorCache
        exclude = ["id", "stock"]


class StockSerializer(serializers.ModelSerializer):
    indicator = IndicatorSerializer(read_only=True)
    alert_enabled = serializers.BooleanField(read_only=True, default=False)
    name = serializers.SerializerMethodField()

    def get_name(self, stock):
        return native_stock_name(stock.symbol, stock.market, stock.name)

    class Meta:
        model = Stock
        fields = ["id", "symbol", "market", "name", "currency", "indicator", "alert_enabled"]


class UserStockSerializer(serializers.ModelSerializer):
    stock = StockSerializer(read_only=True)
    stock_id = serializers.PrimaryKeyRelatedField(
        queryset=Stock.objects.filter(is_active=True), source="stock", write_only=True
    )

    class Meta:
        model = UserStock
        fields = ["id", "stock", "stock_id", "created_at"]
        read_only_fields = ["created_at"]

    def create(self, validated_data):
        return UserStock.objects.create(user=self.context["request"].user, **validated_data)
