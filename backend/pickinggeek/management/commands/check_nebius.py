import os

from django.core.management.base import BaseCommand, CommandError
from openai import OpenAI

from pickinggeek.services.llm_router import LLMRouter


class Command(BaseCommand):
    help = "Validate the Nebius token and list available Nemotron model IDs"

    def add_arguments(self, parser):
        parser.add_argument(
            "--chat",
            action="store_true",
            help="Also run a minimal chat completion with the configured Nano model",
        )
        parser.add_argument(
            "--stream",
            action="store_true",
            help="Also verify the application's SSE-oriented LLM stream generator",
        )

    def handle(self, *args, **options):
        api_key = os.getenv("NEBIUS_API_KEY")
        if not api_key:
            raise CommandError("Nebius API key is not configured")
        client = OpenAI(
            api_key=api_key,
            base_url=os.getenv(
                "NEBIUS_BASE_URL",
                "https://api.tokenfactory.nebius.com/v1",
            ),
        )
        try:
            models = client.models.list().data
        except Exception as exc:
            status_code = getattr(exc, "status_code", "connection-error")
            raise CommandError(
                f"Nebius verification failed ({type(exc).__name__}, status={status_code})"
            ) from None

        model_ids = sorted(model.id for model in models if "nemotron" in model.id.lower())
        self.stdout.write(self.style.SUCCESS("Nebius token verified"))
        if model_ids:
            self.stdout.write("\n".join(model_ids))
        else:
            self.stdout.write("No Nemotron models are currently visible to this token")

        if options["chat"]:
            model = os.getenv("NANO_MODEL", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B")
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "Reply with exactly: Picking Geek ready"}],
                    temperature=0,
                    max_tokens=40,
                    extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                )
            except Exception as exc:
                status_code = getattr(exc, "status_code", "connection-error")
                raise CommandError(
                    f"Nebius chat failed ({type(exc).__name__}, status={status_code})"
                ) from None
            self.stdout.write(f"Chat model: {model}")
            content = response.choices[0].message.content or "(empty content)"
            self.stdout.write(f"Chat response: {content.strip()}")

        if options["stream"]:
            try:
                events = LLMRouter().stream(
                    "Summarize the bullish MACD status in one sentence.",
                    {"symbol": "AAPL", "macd_status": "BULLISH"},
                    "quick",
                )
                metadata = next(events)
                character_count = sum(len(event.get("content", "")) for event in events)
            except Exception as exc:
                status_code = getattr(exc, "status_code", "connection-error")
                raise CommandError(
                    f"Nebius stream failed ({type(exc).__name__}, status={status_code})"
                ) from None
            if character_count == 0:
                raise CommandError("Nebius stream returned no final-answer content")
            self.stdout.write(
                self.style.SUCCESS(
                    f"Stream verified: model={metadata['model']} "
                    f"mode={metadata['mode']} characters={character_count}"
                )
            )
