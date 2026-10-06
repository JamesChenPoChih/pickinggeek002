# Picking Geek

## Version 1.02.1

- Successful Google sign-in now updates `User.last_login` for both new and existing users.
- Regression tests cover first sign-in, repeat sign-in, and rejected credentials.
- No database migration is required. Deploy this version and sign in again to record a new login timestamp.

## Version 1.02

- Django app, imports, tests, and migration references now use `pickinggeek`.
- The configured Neon database has been renamed in place to `pickinggeek_*`, preserving user data, permissions, and migration history.
- Set `DATABASE_URL` in the Render backend environment to the intended Neon connection string before deploying. Local `.env` settings are not transferred to Render.
- Existing databases with the old app label require a coordinated table and migration-history rename before running this version. Do not run the new initial migrations over an unmigrated legacy database. The configured Neon database already completed this transition.
- Fresh databases can be initialized with `python backend/manage.py migrate`.

Picking Geek 是個人 AI 投資研究 Copilot，聚焦美股與台股，將 MACD、60/100/200 日均線、每日訊號通知與 Nemotron AI 分析整合在同一個工作介面。Free 用戶最多追蹤 1 支股票，Pro 用戶可追蹤不限支數。

> 本專案提供研究工具，不構成投資建議，也不承諾任何報酬。

## 系統架構

```mermaid
flowchart LR
    U[投資人] --> FE[React Dashboard]
    FE -->|JWT REST / SSE| API[Django REST API]
    API --> AUTH[JWT + Tier Guard]
    API --> DB[(PostgreSQL)]
    API --> ROUTER{LLM Router}
    ROUTER -->|快速摘要| NANO[Nemotron Nano / Super]
    ROUTER -->|風險與策略| ULTRA[Nemotron 3 Ultra]
    NANO --> TF[Nebius Token Factory]
    ULTRA --> TF

    CRON[Nebius Cron] --> JOB[Serverless Indicator Job]
    JOB --> DATA[美股 / 台股 Data API]
    DATA --> JOB
    JOB -->|MACD + MA60/100/200| WEBHOOK[Internal Webhook]
    WEBHOOK --> DB
    JOB --> NANO
    JOB --> QUEUE[(Redis Notification Queue)]
    QUEUE --> PUSH[Push Worker / FCM / APNs]
    PUSH --> U
```

### 主要資料流

1. React 透過 JWT 呼叫 Django REST API，取得自選股與最新指標。
2. `UserStock.save()` 在 PostgreSQL transaction 中鎖定使用者，Free Tier 只能新增一筆。
3. 台股與美股收盤後由兩個 Nebius Cron 觸發 Job，抓取至少 260 個交易日資料。
4. Job 計算 MACD、MA60/100/200，呼叫 Nano 產生短摘要，再用共享密鑰寫入 Django webhook。
5. Django 更新 `TechnicalIndicatorCache`，為追蹤者建立 `NotificationQueue` 紀錄。
6. AI Chat 使用 SSE 串流；Router 依問題長度與風險、策略關鍵字選擇 Nano 或 Ultra。

## 目錄

```text
backend/                 Django REST API、JWT、Models、LLM Router
frontend/                React + Vite 儀表板
jobs/                    Nebius Serverless 每日指標 Job
docker-compose.yml       PostgreSQL 16 + Redis 7
.env.example             環境變數範本
```

## 資料模型

- `User`: Django 使用者加上 `tier = FREE | PRO`。
- `Stock`: `symbol + market` 唯一，美股與台股共用一套模型。
- `UserStock`: 自選股關聯，模型與 API 兩層執行 Free Tier 上限。
- `TechnicalIndicatorCache`: 最新收盤價、MACD、MA60/100/200、突破狀態、AI 摘要與圖表點。
- `NotificationQueue`: 待推播訊息，後續可接 FCM、APNs 或 Email worker。

## 本機啟動

### 1. 後端

Windows PowerShell：

```powershell
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python backend\manage.py migrate
.\.venv\Scripts\python backend\manage.py seed_demo
.\.venv\Scripts\python backend\manage.py runserver
```

Demo 帳號為 `demo`，密碼為 `demo1234`。取得 JWT：

```http
POST /api/auth/token/
Content-Type: application/json

{"username":"demo","password":"demo1234"}
```

### 2. 前端

```powershell
Set-Location frontend
npm install
npm run dev
```

開啟 `http://localhost:5173`。前端可先展示預設 Hackathon 資料；串流 AI 需先把 JWT access token 放入瀏覽器的 `localStorage.access_token`。

### 3. PostgreSQL 與 Redis

```powershell
docker compose up -d
```

若不啟動 PostgreSQL，Django 開發環境會自動使用 SQLite。正式部署請使用 `.env.example` 的 PostgreSQL `DATABASE_URL`。

## Nebius 設定

必要環境變數：

```dotenv
NEBIUS_API_KEY=...
NEBIUS_API_KEY_FILE=Nebius_Picking_Geek_AI_API.txt
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NANO_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
SUPER_MODEL=nvidia/nemotron-3-super-120b-a12b
ULTRA_MODEL=nvidia/Nemotron-3-Ultra-550b-a55b
MARKET_DATA_URL=https://your-market-adapter.example/prices
INTERNAL_INDICATOR_WEBHOOK=https://api.example.com/api/internal/indicators/
JOB_WEBHOOK_SECRET=use-a-long-random-value
REDIS_URL=redis://redis:6379/0
```

建議排程使用 `Asia/Taipei`：

- 台股：週一至週五 `14:10`，即收盤後約 40 分鐘。
- 美股：因夏令時間不同，使用 UTC 排程或拆成 DST / non-DST 兩組排程，收盤後約 30 分鐘執行。
- Job entry point：`jobs.daily_indicator_job:handler`。

實際 Nebius Model ID 可能隨帳戶可用模型調整，因此 `NANO_MODEL` 與 `ULTRA_MODEL` 都設計成環境變數。
本機優先讀取專案根目錄的 `Nebius_Picking_Geek_AI_API.txt`；檔案已加入 `.gitignore`。正式環境仍建議使用 Nebius Secrets 注入 `NEBIUS_API_KEY`。

## API

| Method | Endpoint | 用途 |
| --- | --- | --- |
| `POST` | `/api/auth/token/` | 取得 JWT |
| `POST` | `/api/auth/google/` | 驗證 Google ID token 並取得 JWT |
| `GET` | `/api/stocks/` | 搜尋股票與最新指標 |
| `GET/POST/DELETE` | `/api/watchlist/` | 管理自選股與方案限制 |
| `GET` | `/api/stocks/{id}/indicator/` | 讀取技術指標 |
| `POST` | `/api/ai/analyze/` | SSE 串流 AI 分析 |
| `POST` | `/api/internal/indicators/` | Serverless Job 寫入指標 |

## LLM Router 規則

- `mode=quick`：固定 Nano，適合一句話指標解讀。
- `mode=deep`：固定 Ultra，適合深度風險與策略報告。
- `mode=auto`：長問題或包含「風險、策略、估值、財報、大盤、投資組合」等詞彙時使用 Ultra，其餘使用 Nano。

## 驗證

```powershell
.\.venv\Scripts\python backend\manage.py check
.\.venv\Scripts\python backend\manage.py check_nebius --chat --stream
.\.venv\Scripts\python backend\manage.py test pickinggeek
Set-Location frontend
npm run build
```

## Render 部署

Django Web Service（建議名稱 `pickinggeek001-api`，Repository Root 保持空白）：

```text
Build Command: pip install -r requirements.txt && python backend/manage.py collectstatic --no-input
Start Command: python backend/manage.py migrate && (python backend/manage.py createsuperuser --noinput || true) && python -m gunicorn --chdir backend config.wsgi:application --bind 0.0.0.0:$PORT --timeout 180 --access-logfile - --error-logfile -
Health Check Path: /health/
```

必要環境變數：`DJANGO_SECRET_KEY`、`DJANGO_DEBUG=false`、
`CORS_ALLOWED_ORIGINS=https://pickinggeekai001.onrender.com`、
`CSRF_TRUSTED_ORIGINS=https://pickinggeekai001.onrender.com`、`NEBIUS_API_KEY`。
Render 會自動提供 `RENDER_EXTERNAL_HOSTNAME`，Django 會將它加入 `ALLOWED_HOSTS`。

`DATABASE_URL` 目前可以不設定，Django 會使用 SQLite，適合先驗證部署流程；Render 的本機檔案不是永久儲存，正式保存帳號與自選股前應建立 Render PostgreSQL，並將 Internal Database URL 設為 `DATABASE_URL`。

首次建立線上管理員時，在 Django Web Service 設定 `DJANGO_SUPERUSER_USERNAME`、`DJANGO_SUPERUSER_PASSWORD` 與 `DJANGO_SUPERUSER_EMAIL`。啟動命令使用 Django 內建的非互動式建立功能；帳號已存在時會略過建立並繼續啟動 Gunicorn。不要將這些值寫入 GitHub。

React Static Site：

```text
Root Directory: frontend
Build Command: npm ci && npm run build
Publish Directory: dist
```

前端建置環境變數：`VITE_API_BASE_URL=https://<backend-name>.onrender.com/api`。

## Google OAuth 登入

1. 在 Google Cloud Console 建立 OAuth 2.0 Client，Application type 選擇 `Web application`。
2. Authorized JavaScript origins 加入 `http://localhost:5173` 與正式前端 `https://pickinggeekai001.onrender.com`。目前使用 Google Identity Services 的 popup callback，不需要設定 redirect URI。
3. 將同一個 Web Client ID 設定到 Django Web Service 的 `GOOGLE_OAUTH_CLIENT_ID`，以及 React Static Site 的 `VITE_GOOGLE_CLIENT_ID`。
4. Google OAuth consent screen 若仍為 Testing，須把要登入的 Google 帳號加入 Test users。

後端只接受 Google 驗證過且 `email_verified=true` 的 ID token，並以不可變的 Google `sub` 作為帳號識別；React 不保存 Google token，只保存 Django 簽發的 JWT。

專案根目錄的 `render.yaml` 也可用來建立 Render Blueprint。部署完成後，後端根網址會回傳服務狀態 JSON，`/health/` 會同時檢查 Django 與資料庫連線。Render 會自動提供 `RENDER_EXTERNAL_HOSTNAME`，不需要再把預設的 `onrender.com` 主機名稱硬編碼進 Django。
