# Auto Reply Bot 實作任務清單 v0.1（ARB-001）

base_sha：ac94f768d246fe7222fdc94a6d08961e6bfe2fc2
日期：2026-09-22
狀態：規劃。以下沒有任何一項已開始實作，工作量為估計值。

工作量單位為一個執行者的專注工作天，S 約 0.5 天、M 約 1 天、L 約 2 天。設備條件欄位標示該任務能否在沒有直播電腦的環境完成。

## 0. 批次邊界

第一個程式批次（ARB-002）只涵蓋 P1：離線回播與核心排程。不做完整控制台、不接真實供應商、不做直播。控制介面在 P1 只有 CLI 子指令，圖形控制頁最早在 P4 之後再評估。

每個任務的驗收都必須是可重跑的命令或可檢查的檔案。沒有 fixture 或證據時必須明確失敗，不得 silent pass。

## 1. P1 離線循環（ARB-002 範圍）

目標：用合成截圖與合成留言，在沒有直播設備的環境跑滿 30 分鐘回播，並重現去重、過期、取消與故障案例。

| ID | 任務 | 依賴 | 工作量 | 主要檔案 | 驗收方法 | 設備條件 |
| --- | --- | --- | --- | --- | --- | --- |
| T-101 | 專案骨架：TypeScript 設定、lint、測試執行器、`arb` CLI 進入點 | 無 | S | `package.json`、`tsconfig.json`、`src/cli/index.ts` | `npm run build` 與 `npm test` 退出碼 0 | 雲端可完成 |
| T-102 | 型別與 schema：Observation、ChatMessage、Decision、設定檔 schema 與載入驗證 | T-101 | M | `src/types/*.ts`、`src/config/load.ts` | 針對缺欄位、型別錯誤、budget 為 null 但 mode 非 mock 的設定各有一個失敗測試 | 雲端可完成 |
| T-103 | fixture 產生器與 fixture 集：合成畫面序列與留言 JSONL | T-102 | M | `tools/make-fixtures.ts`、`fixtures/scenario-a/` | 產生器可重跑並得到相同雜湊；fixture 內無真實截圖與真實留言 | 雲端可完成 |
| T-104 | MockCaptureAdapter 與 MockChatAdapter：依時間軸回放 fixture | T-103 | M | `src/capture/mock.ts`、`src/chat/mock.ts` | 回放時間誤差測試；畫面中斷與留言中斷可由 fixture 觸發 | 雲端可完成 |
| T-105 | 去重器：穩定 ID 與 synthetic ID 兩條路徑 | T-102 | M | `src/context/deduper.ts` | 100 則含重複 ID 的合成留言重播次數為 0；時間窗口外的相同文字視為新留言 | 雲端可完成 |
| T-106 | 觀測儲存與短期上下文：保留上一張有效畫面與最近 10 句 | T-104 | S | `src/context/store.ts` | 畫面失效後上下文不再提供過期畫面事實 | 雲端可完成 |
| T-107 | 狀態機與 epoch 守衛：允許轉換表、sessionGeneration | T-102 | M | `src/director/state.ts`、`src/director/epoch.ts` | 非法轉換丟出錯誤；晚到結果被丟棄的測試 | 雲端可完成 |
| T-108 | 排程器：優先序、節流、TTL、單一待播 | T-107、T-105 | L | `src/director/scheduler.ts` | 以 fixture 重現「舊比賽結果不在新局播出」；rate cap 生效測試 | 雲端可完成 |
| T-109 | 驗證器：句數、長度、格式、ID 對應、重複、時效 | T-102 | M | `src/director/validator.ts` | 設計文件 4.4 表格每一列各有一個失敗案例測試 | 雲端可完成 |
| T-110 | MockModelProvider：可腳本化回覆，含逾時、429、格式錯誤、超長回覆 | T-109 | M | `src/providers/mock-model.ts` | 每種故障各有一個測試，且都不造成佇列堆積 | 雲端可完成 |
| T-111 | MockTtsProvider 與離線播放器：產生靜音音檔並回報時長，播放以時間軸模擬 | T-107 | M | `src/providers/mock-tts.ts`、`src/audio/offline-player.ts` | 無重疊播放測試；stopNow 在模擬時鐘 1 秒內完成 | 雲端可完成 |
| T-112 | 急停與暫停：CLI 指令與 epoch 連動 | T-111、T-107 | S | `src/control/commands.ts` | 連續 10 次急停皆無晚到重播 | 雲端可完成 |
| T-113 | JSONL 事件日誌與延遲分段欄位 | T-108 | S | `src/log/events.ts` | 每筆回覆可還原五個時間戳；日誌不含金鑰 | 雲端可完成 |
| T-114 | 回播報告工具：讀日誌輸出延遲中位數、p95、丟棄率、覆蓋率 | T-113 | M | `tools/replay-report.ts` | 對同一份日誌重跑結果一致；樣本數與丟棄率必須同時輸出 | 雲端可完成 |
| T-115 | 30 分鐘離線回播情境與故障案例集 | T-104 至 T-114 | L | `fixtures/scenario-*/`、`tests/replay/*` | 見 POC_RUNBOOK 第 3 節；全部案例可重現 | 雲端可完成 |
| T-116 | `arb doctor` 骨架：在無設備環境回報哪些檢查被略過 | T-101 | S | `src/cli/doctor.ts` | 無設備時明確標示 SKIPPED，不回報通過 | 雲端可完成 |

P1 合計估計約 14 至 16 個工作天，全部不需要直播設備。

P1 通過條件：30 分鐘回播完成，且 POC_RUNBOOK 第 3 節列出的故障案例全部可重現。任何一項以「環境不支援」略過都必須在報告中明列，不得計入通過。

## 2. P2 本機循環

目標：在直播電腦上接真實頁面、真實模型、真實 TTS 與真實音效裝置，連續執行 30 分鐘。

| ID | 任務 | 依賴 | 工作量 | 主要檔案 | 驗收方法 | 設備條件 |
| --- | --- | --- | --- | --- | --- | --- |
| T-201 | BrowserCaptureAdapter：Playwright 連線、元素或 clip 裁切、縮放到送模型尺寸 | P1 完成 | L | `src/capture/browser.ts` | 對目標頁面連續 100 次截圖，黑畫面與停更比例需記錄 | 需直播電腦 |
| T-202 | 黑畫面與停更偵測 | T-201 | S | `src/capture/health.ts` | 人為最小化視窗可觸發 degraded | 需直播電腦 |
| T-203 | DomChatAdapter：選擇器設定、穩定 ID 抽取 | P1 完成 | L | `src/chat/dom.ts` | 對真實留言區連續讀取 10 分鐘，ID 穩定性需記錄 | 需直播電腦與登入的獨立設定檔 |
| T-204 | OCR 後備路徑 | T-203 | L | `src/chat/ocr.ts` | 誤讀率與誤去重率分開報告，不與 DOM 路徑合併計分 | 需直播電腦 |
| T-205 | ClaudeModelProvider：圖片輸入、output_config.format、逾時、429 與額度用盡分流 | P1 完成 | L | `src/providers/claude.ts` | 三種錯誤分流各有一次實際或模擬觸發紀錄；首次請求的 grammar 編譯延遲需量測 | 需 API 金鑰 |
| T-206 | AzureTtsProvider：zh-TW 語音、SSML 語速、串流或整檔 | P1 完成 | M | `src/providers/azure-tts.ts` | 首位元組延遲與總時長量測；無憑證時明確失敗 | 需 Azure 憑證 |
| T-207 | 實機播放器：指定輸出裝置、獨佔播放、stopNow | P1 完成 | L | `src/audio/player.ts` | 拔除裝置可觸發 ERROR；急停 10 次量測實際靜音時間 | 需直播電腦 |
| T-208 | 成本計量：token 與字元用量、每小時推估、硬上限中斷 | T-205、T-206 | M | `src/providers/usage.ts` | 以實際用量輸出每小時成本；單價未知時輸出 UNKNOWN 而非 0 | 需 API 金鑰 |
| T-209 | prompt caching 評估 | T-205 | M | `src/providers/claude.ts` | 開啟前後的 input token 與延遲對照表 | 需 API 金鑰 |
| T-210 | 盲聽評分流程與紀錄表 | T-206 | M | `docs/blind-listening-template.md` | 至少 30 段情境，三個面向各 1 至 5 分，逐項報告 | 需直播電腦與操作者 |
| T-211 | 30 分鐘實機執行與延遲分段報告 | T-201 至 T-208 | L | `reports/` | 中位數與 p95 延遲、樣本數、丟棄率、覆蓋率同時報告 | 需直播電腦 |

P2 合計估計約 18 至 22 個工作天。開始前必須先取得第 4 節列出的資訊。

## 3. P3 錄影與受控試播

| ID | 任務 | 依賴 | 工作量 | 主要檔案 | 驗收方法 | 設備條件 |
| --- | --- | --- | --- | --- | --- | --- |
| T-301 | OBS 場景設定文件：來源、音訊路由、關閉 Desktop Audio | P2 完成 | M | `docs/obs-setup.md` | 依文件重建場景可得到相同結果 | 需直播電腦與 OBS |
| T-302 | 錄影驗證：連續遊戲畫面與清晰主持聲，無重複擷取回音 | T-301 | M | `reports/` | 錄影檔可聽、無回音；同一聲音未同時由桌面與應用來源擷取 | 需直播電腦與 OBS |
| T-303 | 虛擬音訊裝置後備路徑驗證 | T-301 | M | `docs/obs-setup.md` | 在 Application Audio Capture 不相容時可用 | 需直播電腦 |
| T-304 | Live Studio 路徑查證與驗證 | T-302 | L | `docs/live-studio.md` | 先把設計文件 6.2 的四個 UNKNOWN 逐項查證；無法確認就維持 UNKNOWN | 需直播電腦與平台帳號 |
| T-305 | 受控試播與接收端延遲量測 | T-302 | M | `reports/` | 本機延遲與觀眾端延遲分開記錄 | 需直播權限，另行授權 |

P3 合計估計約 10 至 12 個工作天。試播需要獨立授權，本輪未包含。

## 4. P4 穩定度

2 小時壓力測試、來源中斷與恢復、無界佇列檢查、成本守限、人工接管。細節在 P3 完成後再展開，本輪不預估。

## 5. 成本估算方法與呼叫上限

### 5.1 方法

模型：每小時費用 = 實際呼叫數 × 單次成本。單次成本 = （文字 input token + 視覺 token）× input 單價 + output token × output 單價。視覺 token 依官方公式 `⌈寬/28⌉ × ⌈高/28⌉` 計算，因此送圖尺寸是可控的成本槓桿。

TTS：每小時費用 = 播出字元數 × 每字元單價，或依供應商的音訊長度計價。

兩者都必須以量測到的用量計算，不能用憑空單價。訂閱制 CLI 沒有逐次費率時，記錄呼叫量、速率限制與可用額度，費用標 UNKNOWN。

### 5.2 呼叫上限

| 項目 | 值 | 來源 |
| --- | --- | --- |
| 模型呼叫上限 | 每分鐘 12 次 | 本案自訂，config/runtime.example.json |
| 每次最多圖片 | 2 張 | 本案自訂，遠低於官方每請求上限 |
| 送圖尺寸 | 起始 960x540，上限長邊 1280 | 本案自訂，依官方 token 公式選定 |
| 單次 output token | 上限 180 | 本案自訂 |
| 每事件重試 | 0 次 | 本案自訂，避免佇列堆積 |
| 連續失敗暫停 | 3 次後暫停 30 秒 | 本案自訂 |

### 5.3 單價狀態

| 項目 | 單價 | 狀態 |
| --- | --- | --- |
| Claude Haiku 4.5 | $1 / $5 每百萬 token | 已查（claude.com/pricing，2026-09-22） |
| Claude Sonnet 5 | $2 / $10 每百萬 token | 已查（同上） |
| Claude Opus 5 | $5 / $25 每百萬 token | 已查（同上） |
| Azure TTS neural 每百萬字元 | 未取得 | 待查。官方定價頁本次讀取時金額欄位為佔位符 |
| Azure TTS 免費額度 | 每月 50 萬字元 | 已查（azure.microsoft.com 定價頁，2026-09-22） |
| ElevenLabs Flash v2.5 每字元 | 未在官方頁面確認 | 待查 |
| 每小時與每場美元預算 | null | 未授權。null 不等於無上限 |

付費模式啟用前必須填入已授權上限與版本化費率，否則程式啟動失敗。
