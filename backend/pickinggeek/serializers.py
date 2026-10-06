from rest_framework import serializers

from .models import Stock, TechnicalIndicatorCache, UserStock


class IndicatorSerializer(serializers.ModelSerializer):
    class Meta:
        model = TechnicalIndicatorCache
        exclude = ["id", "stock"]


class StockSerializer(serializers.ModelSerializer):
    indicator = IndicatorSerializer(read_only=True)

    class Meta:
        model = Stock
        fields = ["id", "symbol", "market", "name", "currency", "indicator"]


class UserStockSerializer(serializers.ModelSerializer):
    stock = StockSerializer(read_only=True)
    stock_id = serializers.PrimaryKeyRelatedField(
        queryset=Stock.objects.filter(is_active=True), source="stock", write_only=True
    )

    class Meta:
        model = UserStock
        fields = ["id", "stock", "stock_id", "created_at"]
        read_only_fields = ["created_at"]

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.can_track_unlimited_stocks and UserStock.objects.filter(user=user).exists():
            raise serializers.ValidationError({"tier": "Free 方案最多只能追蹤 1 支股票。"})
        return attrs

    def create(self, validated_data):
        return UserStock.objects.create(user=self.context["request"].user, **validated_data)
