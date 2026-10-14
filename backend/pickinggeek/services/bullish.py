from math import isfinite

from .analysis_context import technical_snapshot


def bullish_assessment(snapshot):
    indicators = snapshot.get('indicators', {})
    previous = snapshot.get('previous_indicators', {})
    values = [snapshot.get('close'), indicators.get('ma20'), indicators.get('ma60'), indicators.get('ma200'),
              indicators.get('macd'), indicators.get('macd_signal'), indicators.get('histogram'),
              indicators.get('bb_middle'), indicators.get('squeeze_momentum'), previous.get('squeeze_momentum')]
    if snapshot.get('status') != 'available' or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) for value in values
    ) or indicators.get('squeeze_state') not in {'ON', 'OFF', 'NEUTRAL'}:
        return {'status': 'unavailable', 'score': None, 'signals': {}}
    close, ma20, ma60, ma200, dif, dea, histogram, middle, momentum, before = values
    signals = {'MA': close > ma20 > ma60 > ma200,
               'MACD': dif > 0 and dif > dea and histogram > 0,
               'Bollinger Bands': close > middle,
               'Squeeze': indicators['squeeze_state'] == 'OFF' and momentum > 0 and momentum > before}
    score = sum(signals.values())
    return {'status': 'bullish' if score >= 3 else 'neutral', 'score': score, 'signals': signals}


def stock_assessment(stock):
    snapshot = technical_snapshot(stock.symbol, stock.market)
    return {'id': stock.id, 'symbol': stock.symbol, 'name': stock.name, 'market': stock.market,
            'as_of': snapshot.get('as_of'), **bullish_assessment(snapshot)}
