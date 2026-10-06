import os
from dataclasses import dataclass

from openai import OpenAI

NANO_MODEL = os.getenv("NANO_MODEL", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B")
ULTRA_MODEL = os.getenv("ULTRA_MODEL", "nvidia/Nemotron-3-Ultra-550b-a55b")
DEEP_KEYWORDS = {
    "risk", "valuation", "strategy", "portfolio", "earnings", "macro",
    "風險", "估值", "策略", "財報", "大盤", "深度", "報告", "投資組合",
}


@dataclass(frozen=True)
class RouteDecision:
    model: str
    mode: str
    reason: str


class LLMRouter:
    def __init__(self):
        self.client = OpenAI(
            api_key=os.environ["NEBIUS_API_KEY"],
            base_url=os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1"),
        )

    def choose_model(self, question: str, requested_mode: str = "auto") -> RouteDecision:
        mode = requested_mode.lower()
        if mode == "quick":
            return RouteDecision(NANO_MODEL, "quick", "使用者指定快速回答")
        if mode == "deep":
            return RouteDecision(ULTRA_MODEL, "deep", "使用者指定深度報告")
        normalized = question.lower()
        if len(question) > 180 or any(word in normalized for word in DEEP_KEYWORDS):
            return RouteDecision(ULTRA_MODEL, "deep", "偵測到策略或風險推理需求")
        return RouteDecision(NANO_MODEL, "quick", "簡短指標解讀")

    def stream(self, question: str, context: dict, requested_mode: str = "auto"):
        decision = self.choose_model(question, requested_mode)
        is_deep = decision.mode == "deep"
        extra_body = {"chat_template_kwargs": {"enable_thinking": is_deep}}
        if is_deep:
            extra_body["max_thinking_tokens"] = 2048
        system_prompt = (
            "你是 Picking Geek 的投資研究 Copilot。使用繁體中文，清楚區分事實、推論與未知資訊；"
            "使用易讀的純文字與短段落，不要使用 Markdown 標記；不可承諾報酬，"
            "結尾附上『此內容僅供研究參考，不構成投資建議。』"
        )
        response = self.client.chat.completions.create(
            model=decision.model,
            stream=True,
            temperature=0.6 if is_deep else 0.2,
            max_tokens=4096 if is_deep else 600,
            extra_body=extra_body,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"市場資料：{context}\n\n問題：{question}"},
            ],
        )
        yield {"type": "meta", "model": decision.model, "mode": decision.mode}
        for chunk in response:
            text = chunk.choices[0].delta.content or ""
            if text:
                yield {"type": "token", "content": text}
