# AI Invest

Quick answers use the existing Yahoo daily candle engine to compute MA5/20/60/100/200/250,
MACD12/26/9, Bollinger SMA20 +/- 2 population standard deviations, and LazyBear
Squeeze (BB20/2 vs KC20/1.5 true range). The most recent unfinished daily session is
excluded. Latest quotes are separate from confirmed closing signals.
The quick template contains only AI analysis (title with divider), Summary, and Technical
analysis with MA, MACD, Bollinger Bands and Squeeze. Five required JSON string fields
bind directly to the template, without a numeric prelude or a second AI interpretation.
Quick mode does not fetch or invent news, compare other stocks, or render strategy/news
sections. Stored records retain this five-field template on replay.

Detailed answers add two editable comparison symbols and Yahoo search news headlines.
NBIS defaults to NVDA as an industry reference and CRWV as a peer reference.
These are research selections, not verified claims of a partnership or competition.
Both reference fields are optional. Blank fields are omitted from requests; a detailed
answer can have zero, one or two references. Omitted reference roles are not discussed
in the report and do not generate missing-reference reminders. Comparisons may use US
or Taiwan markets.
Raw prices across currencies are not comparable; the context includes 20-session returns
when available, and each asset has its own as-of date.

News is retrieved from the existing Yahoo Finance search provider (an unofficial interface
that may be rate-limited or changed), restricted to matching related tickers when supplied,
HTTPS links, and a maximum of four titles per asset. Prefer the past 7 days; when empty,
look back 30 days. Article bodies are NOT retrieved. Titles are not proof of all details
in an article. Source URL, publisher and publication timestamp accompany each title.
Missing quotes, insufficient indicator history and news outages remain explicit.

No database migration, per-user news copies, vector embedding or new paid news subscription
is required. Yahoo charts retain the existing cache; news uses Django cache for 15 minutes
(failed requests 60 seconds). Default local-memory cache is per process, not a shared
cross-server cache. This is not a persistent research archive.

NEBIUS_API_KEY and existing NANO_MODEL / ULTRA_MODEL configure inference. Each submitted
question calls Nebius once; browsing the screen does not call the model. Model calls use
no automatic retries, a timeout, and token limits. Embedding credits and tables are not
used by this feature. Deployment still needs a restart to load the new backend code.

UI renders evidence independently of model output. The model must not invent unavailable
data, obey instructions in retrieved headlines, or promise returns. Detailed research is
not a substitute for reading linked primary sources. Analysis runs against watched stocks
only, and input lengths / comparison counts are bounded. Each user may submit at most
six requests per minute per cache backend. Language follows the app setting.

Detailed answers now request a JSON object with seven required nonempty string fields:
summary, ma, macd, bollinger, squeeze, strategy, news. The backend validates the entire
report before emitting a report SSE event. The frontend binds those fields to fixed
sections rather than inferring their location from model-written headings. Stored
in-memory analysis records include the structured report, so replay uses the same layout.
Older text-only records still use the legacy heading parser.
The provider receives response_format=json_schema with strict=true, requiring all seven
string fields and disallowing additional properties. The schema is also included in the
prompt. Complete JSON with literal newlines inside strings or
a surrounding JSON code fence is normalized before validation; incomplete/truncated
reports are rejected, never rendered as successful empty sections. A complete report is
accepted even if the provider reports finish_reason=length; harmless additional response
metadata is ignored after validating the seven fields. Errors render a
separate alert and manual retry action, and are not added to analysis history. Diagnostic
logs include only error class/status and fixed validation reason codes, not prompts,
model response bodies, credentials or provider exception messages.

The exact visible order is AI analysis (title only), Summary, Technical analysis with
MA/MACD/Bollinger Bands/Squeeze, Suggested strategy, News analysis, research disclaimer,
news sources grouped by stock, and Model. The detailed response is buffered until the
JSON object is complete; the loading indicator remains visible during generation.
Quick responses also buffer until the five-field report validates. Detailed max_tokens
is 12288 to leave room for reasoning and seven full paragraphs; quick max_tokens is
4096 for the summary and four complete indicator paragraphs. Temperature is 0.2.
No automatic repair
request or paid retry is made when a report is invalid or incomplete.
