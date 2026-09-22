# Auto Reply Bot 實作設計 v0.1（ARB-001）

work_id：ARB-001
base_sha：ac94f768d246fe7222fdc94a6d08961e6bfe2fc2
日期：2026-09-22
狀態：設計提案。本文件內所有程式介面、時序與成本數字皆為設計值，未在直播電腦執行過，不得當作已驗證結果。

本文件回答 prompts/CLAUDE_PLANNING_PROMPT.md 第 1 項。任務清單在 docs/IMPLEMENTATION_BACKLOG.md，操作步驟在 docs/POC_RUNBOOK.md。

## 1. 技術棧選擇

### 1.1 結論

| 項目 | 選擇 | 理由 |
| --- | --- | --- |
| 本機執行程序語言 | TypeScript + Node.js 22 LTS | Playwright 的第一手語言，採集、排程、播放與控制介面可放同一程序，避免跨語言 IPC 增加取消與計時誤差 |
| 瀏覽器自動化 | Playwright（Chromium channel） | 官方文件明列元素截圖與回傳 buffer，不必落地暫存檔 |
| 模型介面 | Claude Messages API（先驗 Claude Haiku 4.5，情境理解不足再升 Sonnet 5） | 官方文件對圖片輸入、結構化輸出與速率限制有明確規格，可量測 |
| 結構化輸出 | `output_config.format` 的 json_schema | 官方支援，但仍需本機二次驗證（見 3.3） |
| TTS 首選 | Azure AI Speech，zh-TW neural voice | zh-TW 有三個官方語音與 SSML 語速控制 |
| TTS 備選 | ElevenLabs Flash v2.5 | 官方標示約 75 ms 延遲，但 zh-TW 口音需盲聽才能判斷 |
| 播放 | 單一播放器程序，指定輸出裝置 | 急停與音量控制不得依賴模型或瀏覽器 |
| 直播 | OBS Studio 30.1+ | 應用程式音訊擷取有官方文件與已知限制 |

拒絕 Python 主流程的理由：本案主要工作是瀏覽器採集與事件排程，Playwright 與音訊裝置控制在 Node 端可用同一事件迴圈處理取消，不需要為了 ML 生態切語言。整套只選一種主流程語言；fixture 產生器等離線工具若用 Python 亦可，但不進入執行路徑。

### 1.1.1 控制通道與播放實作的選定狀態（R1 F6）

設計文件先前同時提到「單一 Node 程序」與「播放器程序」，沒有說明 CLI 如何對執行中的服務下達 pause 或 stop。這裡把首版選定，其餘明確標為未選。

| 項目 | P1 選定 | P2 才決定 |
| --- | --- | --- |
| 控制通道 | 同程序 stdin 控制通道。`replay` 執行時從 stdin 讀取 `pause`、`resume`、`stop`、`estop` 指令，與排程跑在同一事件迴圈 | 常駐服務模式的本機 IPC（unix socket 或 localhost HTTP），只綁 127.0.0.1 |
| 播放 | 離線播放器，以虛擬時鐘模擬播放時長，不碰音效裝置 | 依實際 OS 選一種裝置枚舉、播放與強制停止方案 |
| 播放器形態 | 與 director 同程序 | 若需子程序，另行決定其終止方式 |

首版不宣稱音訊急停已成立。Node 與 Playwright 可用，不等於本機聲音能在 1 秒內停住；那是 P2 的實機量測項目。

瀏覽器的取得方式也一併寫定：程式**自行啟動**一個獨立 profile 的瀏覽器，或連到明確為此用途開啟的受限本機連線。不假定能接管使用者已經開著的任意瀏覽器視窗。

`audio.device_id` 為 null 的語義：代表**未設定**，在 real 模式下啟動失敗並要求操作者指定裝置，不解讀為「使用系統預設」。這與第 6 節「不使用系統預設以免切換裝置時失控」一致。mock 模式忽略此欄位。

### 1.2 誰擁有瀏覽器與音效裝置

| 角色 | 實體 | 擁有 | 不擁有 |
| --- | --- | --- | --- |
| 直播電腦 | 使用者的 Windows/macOS 實機 | 指定瀏覽器、音效輸出裝置、OBS、本機執行程序、金鑰檔案 | 無 |
| 雲端開發環境 | Claude Code on the web 容器 | 這個 repository 的程式碼與文件 | 沒有使用者的瀏覽器、音效裝置、直播帳號、實機檔案 |
| 雲端模型 | Claude Messages API | 本輪送出的裁切圖片與留言文字 | 沒有 shell、檔案、瀏覽器、金鑰讀取能力 |

這條界線是整個專案的硬性前提。雲端開發環境能產生可執行程式，但不能代替使用者在直播電腦上跑它。任何「Claude 已經跑起來了」的說法，若沒有直播電腦上的執行紀錄，一律不成立。

### 1.3 Grok Bot 查證結果

官方文件（https://docs.x.ai/grok-bot/overview ，2026-09-22 讀取）描述 Grok Bot 在持續運作的雲端電腦上工作，該電腦有瀏覽器、檔案系統與終端機，關閉本機應用不會停止工作；文件未提及控制使用者本機的音效裝置，亦未提供自架選項。

結論：官方文件描述的是雲端代理。本輪未找到它與本機音效裝置或本機瀏覽器橋接的證據，因此**暫不納入**採集層與播放層。這是「未找到證據」，不是「已證明永遠不可能串接」；若日後官方提供本機橋接，再重新評估（R1 補正）。

該頁面同時出現一句關於雲端供應商歸屬的敘述與產品名稱不一致，因此「由哪一家的雲端承載、如何計費」標記為 UNVERIFIED，不在本文件外推。Claude Code、Codex、Grok Bot 不視為能力等價工具。

## 2. 兩條路徑的取捨

### 2.1 比較

| 面向 | agent 直接工具操作 | 常駐本機程序 |
| --- | --- | --- |
| 每輪延遲 | 受 agent 迴圈與工具往返影響，不可預測 | 可量測，路徑固定 |
| 取消語義 | 依賴 agent 自願停止 | 程序內 AbortController 與 epoch 檢查，可強制 |
| 成本控制 | 難以硬性設上限 | 呼叫計數器與冷卻可強制 |
| 失敗行為 | 容易重試堆積 | 明確規則：本事件不重試 |
| 適合工作 | 探索、單次驗證、診斷、產生修正 | 長時間循環、播放、急停 |

### 2.2 決策

長時間節目循環由常駐本機程序承擔。agent 能力用三個有界入口保留，不做無界迴圈：

1. `arb probe`：執行一次採集加一次生成，只輸出 JSON，不合成也不播放。用來驗證頁面與模型是否可用。
2. `arb doctor`：檢查瀏覽器是否連得上、選擇器是否命中、音效裝置是否存在、金鑰是否設定，輸出結構化結果與退出碼。
3. `runtime/logs/*.jsonl`：結構化事件日誌，agent 讀日誌做診斷，不需要接管執行程序。

agent 可以讀這三者並提出修正，但不是執行期的決策者。執行期決策在 director（見第 4 節）。

## 3. 官方文件查證

全部於 2026-09-22 讀取。以下是文件確實記載的內容，與本案的推論分開列。

### 3.1 Playwright 截圖

來源：https://playwright.dev/docs/screenshots 與 https://playwright.dev/docs/api/class-page#page-screenshot

文件記載：`page.screenshot()` 可回傳 Buffer 而不落地；`locator.screenshot()` 可對單一元素截圖；選項包含 `clip`、`fullPage`、`type`、`quality`、`timeout`、`animations`、`scale`、`mask`、`omitBackground`、`path`；`animations: 'disabled'` 會在截圖期間停止動畫。

本案推論與限制：文件沒有保證 Canvas、WebGL、被遮擋視窗或最小化視窗一定能取得非黑畫面。目標遊戲是否可擷取必須在直播電腦以實機檢查，未檢查前記為 NOT_TESTED。

### 3.2 Claude 圖片輸入

來源：https://platform.claude.com/docs/en/build-with-claude/vision

文件記載：支援 JPEG、PNG、GIF、WebP；單張最大 8000x8000 px；直接呼叫 API 時單張 base64 上限 10 MB；單次請求超過 20 個 image block 時，每張會套用更嚴格的尺寸限制，建議控制在 20 張以內或每邊不超過 2000 px；視覺 token 計算為 `⌈寬/28⌉ × ⌈高/28⌉`；Claude 4.7 以後為高解析度層，長邊上限 2576 px、視覺 token 上限 4784，其餘模型為 1568 px 與 1568 token；超限會被自動縮放。

本案推論：每次請求最多 2 張圖、長邊 1280 的既有候選值在限制之內，且遠低於 20 張門檻。實際送圖尺寸直接決定成本，因此 capture 層必須在送出前縮放，不可把原始 1920x1080 丟進去。

| 送出尺寸 | 視覺 token | 說明 |
| --- | --- | --- |
| 1280x720 | 46 × 26 = 1196 | 候選上限 |
| 960x540 | 35 × 20 = 700 | 建議起始值 |
| 640x360 | 23 × 13 = 299 | 低成本模式，文字可讀性需實測 |

文件同時記載模型不會辨識圖中真人身分，也無法判斷圖片是否為 AI 生成。本案不依賴這兩件事。

### 3.3 結構化輸出

來源：https://platform.claude.com/docs/en/build-with-claude/structured-outputs

文件記載：以 `output_config.format`（型別 `json_schema`）指定結構，舊的 `output_format` 參數已被取代；beta header `structured-outputs-2025-11-13` 已標記為過渡期仍接受；支援的模型清單包含 Claude Sonnet 5、Claude Opus 5 與 Claude Haiku 4.5；JSON Schema 只支援子集，`minLength`、`maxLength`、`minimum`、`maximum`、`multipleOf` 不支援，物件的 `additionalProperties` 必須為 false，不支援遞迴 schema 與外部 `$ref`；首次請求會有 grammar 編譯延遲，編譯結果自最後使用起快取 24 小時；模型會收到額外的系統提示，input token 會增加。

本案推論，這一點直接決定設計：句數（1 至 3）與字數（20 至 80）不能靠 schema 約束，必須由本機驗證器強制執行。schema 只保證欄位與型別，內容規則一律本機檢查。這與 AGENTS.md「模型輸出不能直接送去播放」一致。

### 3.4 速率限制與費用中斷

來源：https://platform.claude.com/docs/en/api/rate-limits

文件記載：限制分為 RPM、ITPM、OTPM，依 usage tier 與模型分別計算，採 token bucket 連續補充；超限回傳 429 並附 `retry-after` header；回應含 `anthropic-ratelimit-*` 系列 header；月費上限用盡時同樣回 429，但沒有 `retry-after`，且 `error.details.error_code` 為 `enforced_spend_limit_reached`，重試無效；自設 spend limit 用盡時回 400 `invalid_request_error`。Start tier 對 Claude Haiku 4.5 與 Sonnet 5 標示 1,000 RPM。

本案推論：專案自訂的每分鐘 12 次上限遠低於供應商上限，成本控制靠自訂上限而不是靠撞到 429。程式必須把三種情況分開處理：

| 回應 | 判斷依據 | 行為 |
| --- | --- | --- |
| 一般 429 | 有 `retry-after` | 本事件丟棄，冷卻至 `retry-after` 後才接受新事件，不重試舊事件 |
| 額度用盡 429 | `error_code = enforced_spend_limit_reached` | 停止所有付費呼叫，切到靜音模式，保留人工控制與直播畫面 |
| 自設上限 400 | `invalid_request_error` 且訊息為已達指定用量上限 | 同上，並在控制台標示需人工調整 |

### 3.5 OBS 應用程式音訊擷取

來源：https://obsproject.com/kb/application-audio-capture-guide

文件記載：Application Audio Capture 需 Windows 10 version 2004 以上或 Windows 11，OBS Studio 28 起提供；OBS Studio 30.1 起 Window Capture 與 Game Capture 可直接含音訊；部分應用程式的輸出方式不相容，此法擷取不到；同時開啟全域 Desktop Audio 與應用程式音訊來源會造成回音，建議在設定中關閉 Desktop Audio；不相容時以 VB-Cable 之類虛擬音訊裝置加 Audio Input Capture 作為替代。

本案推論：這是 Windows 路徑。macOS 沒有等價保證，若使用者實際是 macOS，音訊路徑必須另行驗證，不可沿用本節設定。

### 3.6 TTS 候選

| 候選 | 官方可查事實（2026-09-22） | 未確認 |
| --- | --- | --- |
| Azure AI Speech | zh-TW 有 `zh-TW-HsiaoChenNeural`（女）、`zh-TW-YunJheNeural`（男）、`zh-TW-HsiaoYuNeural`（女）三個 neural 語音；語言支援頁未列出 zh-TW 的 HD / DragonHD 變體；定價頁標示 neural 語音每月 50 萬字元免費額度 | 官方定價頁在本次讀取時金額欄位為佔位符，每百萬字元單價標記為待查；串流首位元組延遲未量測 |
| ElevenLabs Flash v2.5 | 官方文件標示約 75 ms 延遲（不含應用與網路延遲）、支援 32 種語言含 Chinese、單次請求上限 40,000 字元、API 生成每字元價格較其他模型低 50%；Eleven v3 Conversational 標示約 280 ms | 文件只寫 Chinese，未區分繁簡與台灣口音；zh-TW 自然度必須盲聽才能判斷 |
| Piper（本機離線） | 官方 VOICES 文件的中文語音為 zh_CN（huayan） | 沒有 zh_TW 語音。作為繁中主持聲音不合適 |
| Windows SAPI / 系統內建 | 本機可用、零外部費用 | 自然度待評估。本輪未盲聽，不宣稱不合格（R1 補正） |

第一輪實作只做一個真實供應商，選 Azure AI Speech，理由是 zh-TW 語音是官方明列的而不是推測，且 SSML 可控語速。ElevenLabs 保留為備選，只在 P2 盲聽不合格時才啟用，切換透過 TtsProvider 介面完成，不改 director。Piper 與 SAPI 列為無網路時的 mock 或緊急備援。它們是否適合當節目聲音，要等盲聽才有結論，本輪不先下判斷。

沒有供應商憑證時一律使用 `MockTtsProvider`，它產生固定長度的靜音音檔並回報時長。mock 通過不等於真實 TTS 通過，報告必須分開寫。

## 4. 架構

### 4.1 程序與模組

單一 Node 程序，內部分層。控制介面預設只綁 127.0.0.1。

```
arb-host (single process)
├─ capture/     BrowserCaptureAdapter, WindowCaptureAdapter(後備)
├─ chat/        DomChatAdapter, ApiChatAdapter, OcrChatAdapter(後備)
├─ context/     ObservationStore, Deduper, ReferenceStore
├─ director/    StateMachine, Scheduler, Validator, EpochGuard
├─ providers/   ClaudeModelProvider, AzureTtsProvider, Mock*
├─ audio/       ExclusivePlayer, DeviceResolver
├─ control/     CLI 與 localhost 控制端點
└─ log/         JSONL 事件日誌
```

### 4.2 五個 adapter 介面

```ts
export interface CaptureAdapter {
  readonly id: string;
  start(signal: AbortSignal): Promise<void>;
  /** 回傳裁切後、已縮放到送模型尺寸的影像。取不到時 throw CaptureError。 */
  grab(signal: AbortSignal): Promise<Frame>;
  health(): SourceHealth;
  stop(): Promise<void>;
}

export interface Frame {
  frameRef: string;          // 記憶體內參照，不預設寫檔
  bytes: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  frameHash: string;         // 用於判斷畫面是否有變化
  capturedAt: number;        // epoch ms，本機時鐘
}

export interface ChatAdapter {
  readonly id: string;
  readonly kind: 'api' | 'dom' | 'ocr';
  start(signal: AbortSignal): Promise<void>;
  /** 只回傳上次呼叫之後新出現的留言，最舊在前。 */
  poll(signal: AbortSignal): Promise<ChatMessage[]>;
  health(): SourceHealth;
  stop(): Promise<void>;
}

export interface ChatMessage {
  messageId: string;         // 無穩定 ID 時由 adapter 產生 synthetic:<hash>
  idStability: 'stable' | 'synthetic';
  source: string;
  text: string;
  author?: string;
  receivedAt: number;        // 本機收到時間，排程只信這個
  sourceTime?: number;       // 來源宣稱時間，可能有誤差
  confidence?: number;       // OCR 專用，0 至 1
}

export interface ModelProvider {
  readonly id: string;
  decide(input: DecisionInput, signal: AbortSignal): Promise<RawDecision>;
  usage(): ProviderUsage;    // 呼叫次數、token、已知或 UNKNOWN 的費用
}

export interface TtsProvider {
  readonly id: string;
  synthesize(req: TtsRequest, signal: AbortSignal): Promise<TtsResult>;
  usage(): ProviderUsage;
}

export interface TtsRequest {
  text: string;
  voiceId: string;
  rate?: number;             // 1.0 為原速
}

export interface TtsResult {
  audio: Buffer;
  mediaType: 'audio/wav' | 'audio/mpeg';
  durationMs: number;        // 供播放排程與重疊檢查使用
}

export interface AudioPlayer {
  /** 解析並鎖定輸出裝置；裝置消失時 throw DeviceError。 */
  open(deviceId: string | null): Promise<void>;
  /** 同時只允許一個播放工作。回傳實際開始與結束時間。 */
  play(audio: Buffer, mediaType: string, signal: AbortSignal): Promise<PlaybackRecord>;
  /** 立即停止目前聲音，目標 1 秒內完成，並丟棄尚未開始的工作。 */
  stopNow(): Promise<void>;
  isPlaying(): boolean;
}
```

`SourceHealth` 至少包含 `state: 'ok' | 'degraded' | 'offline'`、`lastOkAt`、`consecutiveFailures`、`reason`。

### 4.3 觀測 schema

```ts
export interface Observation {
  observationId: string;     // obs_<sequence>_<random>
  sequence: number;          // 單調遞增
  capturedAt: number;
  receivedAt: number;
  frameRef: string | null;
  frameHash: string | null;
  chatIds: string[];
  sourceHealth: { capture: SourceHealth; chat: SourceHealth };
  sessionGeneration: number; // 建立當下的 epoch，人工控制與來源重連時遞增
  contextVersion: number;    // 建立當下的場景版本，換局等情境切換時遞增
}
```

`sessionGeneration` 與 `contextVersion` 是兩個獨立的失效維度（R1 F2）。前者對應人工控制與連線狀態，後者對應節目內容的情境切換。只有 TTL 不足以防止舊局評論在新局播出：TTL 是時間窗口，換局是語意事件，兩者不會同時發生。

圖片與留言以 `receivedAt` 對齊。`sourceTime` 只記錄不作排序依據。畫面不可用時 `frameRef` 為 null，director 仍可處理留言，但不得產生依賴畫面的評論。

### 4.4 模型輸出 schema

送 API 的 `output_config.format.schema`：

```json
{
  "type": "object",
  "properties": {
    "speak": { "type": "boolean" },
    "utterance": { "type": "string" },
    "reply_to_ids": { "type": "array", "items": { "type": "string" } },
    "observation_id": { "type": "string" },
    "reason_code": {
      "type": "string",
      "enum": ["chat_reply", "game_event", "idle_comment", "no_new_information", "uncertain", "unsafe_input"]
    }
  },
  "required": ["speak", "utterance", "reply_to_ids", "observation_id", "reason_code"],
  "additionalProperties": false
}
```

因為 3.3 所述的 schema 子集限制，以下規則一律由本機 `Validator` 強制。驗證分三段，順序不可對調（R1 F1）：先驗共同欄位，再依 `speak` 分支，最後才驗發言內容。把發言內容規則套到安靜回覆上，會讓「正常選擇安靜」被誤判為驗證錯誤。

第一段，共同欄位，對 `speak` 兩種值都適用：

| 檢查 | 規則 | 失敗時 reason |
| --- | --- | --- |
| schema | 欄位齊全且型別正確 | `schema` |
| observation 對應 | `observation_id` 必須等於本輪送出的 ID | `stale_observation` |
| epoch 與工作 | `sessionGeneration`、`contextVersion` 與 `jobId` 必須等於本輪發出時的值 | `cancelled` |

第二段，依 `speak` 分支：

| `speak` | 規則 | 結果 |
| --- | --- | --- |
| false | `utterance` 必須為空字串，`reply_to_ids` 必須為空陣列 | 合法安靜。直接回 IDLE，不呼叫 TTS，不計入 provider 失敗，不計入連續失敗計數 |
| false 但欄位不空 | 不合法的 silence payload | 丟棄，reason `invalid_silence` |
| true | 進入第三段 | |

第三段，只對 `speak` 為 true 的回覆：

| 檢查 | 規則 | 失敗時 reason |
| --- | --- | --- |
| 非空 | 去除前後空白後長度大於 0 | `empty_utterance` |
| 留言引用 | `reply_to_ids` 每個 ID 必須在本輪送入的清單內 | `unknown_chat_id` |
| 句數 | 以句號、問號、驚嘆號、換行切分後為 1 至 3 句 | `sentence_count` |
| 長度 | 上限 80，超長不硬切 | `length` |
| 禁用格式 | 不得含 Markdown 記號、條列符號、破折號、程式碼圍欄 | `format` |
| 重複 | 與最近 10 句已播放內容的正規化結果不得相同 | `duplicate` |
| 時效 | 通過生成前、TTS 前、播放前三道檢查 | `expired` |

字數的計算與下限（R1 F1）：

1. 長度以 Unicode code point 計算，不以 UTF-16 code unit 計算，避免表情符號被算成兩個字。
2. 計算前先把前後空白去除，並把連續空白正規化為一個空白。
3. 上限 80 是硬性規則。下限 20 是常態目標值，不是硬性規則：`speech.target_min_characters` 只用於記錄與調校，不作為丟棄條件。像「漂亮！」這種有效短反應必須能播出。
4. 只有空字串或僅含空白才視為不合法。

超長回覆的處理：預設直接丟棄。可設定啟用一次受限改寫，指令為「用 1 至 3 句、80 字以內重說同一件事」，只允許一次，仍不合格就丟棄。這條算一次付費呼叫，計入每分鐘上限。

### 4.5 狀態機

狀態：`STOPPED`、`IDLE`、`GENERATING`、`SYNTHESIZING`、`PLAYING`、`PAUSED`、`ERROR`。

| 從 | 到 | 觸發 |
| --- | --- | --- |
| STOPPED | IDLE | `start()` 且 adapter 啟動成功 |
| IDLE | GENERATING | 排程選出事件且通過節流 |
| GENERATING | SYNTHESIZING | 回覆通過驗證且 `speak` 為 true |
| GENERATING | IDLE | `speak` 為 false、驗證失敗、逾時或取消 |
| SYNTHESIZING | PLAYING | 合成成功且時效仍有效 |
| SYNTHESIZING | IDLE | 合成失敗、過期或取消 |
| PLAYING | IDLE | 播放結束或被 `stopNow()` 中止 |
| IDLE / GENERATING / SYNTHESIZING / PLAYING | PAUSED | 人工暫停 |
| PAUSED | IDLE | 人工恢復，佇列已清空 |
| 任一 | ERROR | 不可復原錯誤，例如音效裝置消失 |
| ERROR | IDLE | 人工確認後復位 |
| 任一 | STOPPED | 人工停止或急停後關閉 |

不允許的轉換一律視為程式錯誤並記錄，不靜默忽略。

首版流程是串行的（R1 F3）：同時最多一個生成、一個合成、一個播放，播放結束回到 IDLE 才可能開始下一次生成。因此「等待中的回覆」這個概念不存在，取而代之的是**候選槽**：

| 概念 | 首版做法 |
| --- | --- |
| 候選槽 | 至多一筆候選觀測，不是至多一筆待播回覆。新的更相關事件直接覆蓋槽內的舊候選 |
| 採集 | 不因為 PLAYING 而停止。採集持續進行，只是結果先進候選槽 |
| 生成 | 只在 IDLE 且通過節流時才啟動，取用候選槽當下的內容 |
| 播放期間的新留言 | 更新候選槽，不中斷播放，也不排隊成第二筆回覆 |

### 4.6 取消語義

`sessionGeneration` 是單調遞增整數，儲存在 director。以下情況遞增：急停、人工暫停、來源重新連線、設定重新載入、狀態機進入 ERROR。

`contextVersion` 是另一個單調遞增整數，在情境切換時遞增。首版的遞增來源只有兩個，都必須是來源能明確指出的事件，不是猜測：

1. fixture 或來源提供的顯式換局事件（`scene_change`）。
2. 操作者手動宣告情境切換。

畫面雜湊改變本身不足以判定換局（R1 F2）。同樣的雜湊可能只代表靜態場景，改變也可能只是動畫或計時器跳動。真實畫面的換局辨識在 P2 之前記為未驗證，首版不從 `frameHash` 推論換局。`contextVersion` 遞增時，所有攜帶舊版本的觀測、待處理候選與進行中的生成一律作廢。

每個外部呼叫都帶一個 `AbortController` 與一個唯一 `jobId`，且在三個關卡再檢查一次失效條件：送模型前、送 TTS 前、送播放器前。檢查的是三元組 `(jobId, sessionGeneration, contextVersion)`，任一項與當前值不同就丟棄，即使呼叫本身成功。

非同步完成路徑的狀態回寫規則（R1 F2）：`then`、`catch` 與 `finally` 三條路徑在寫入任何狀態之前，都必須先比對自己的三元組。不符就只記錄並返回，不得改動狀態機。這條規則防止的具體情況是：人工 pause 或 stop 之後，舊生成工作的 `finally` 把狀態從 PAUSED 覆寫回 IDLE。取消不是「一律回 IDLE」，而是「只有仍屬於當前工作的路徑才有權改狀態」。

`stopNow()` 不得成為阻塞其餘取消動作的無限 await。它有自己的逾時上限，逾時後記錄 `stop_timeout` 並繼續執行後續取消步驟，不讓一個卡住的播放器擋住整個急停流程。

急停流程，順序固定：

1. 遞增 `sessionGeneration`。這一步先做，之後所有晚到結果都會被三元組檢查擋下。
2. `AudioPlayer.stopNow()`，目標 1 秒內本機無聲，本身有逾時上限，不阻塞後續步驟。
3. abort 所有進行中的模型與 TTS 呼叫。
4. 清空候選槽與待處理事件。
5. 寫入一筆 `emergency_stop` 日誌，含觸發時間與實際靜音時間。

重新啟動時不續播先前半段聲音。一般新留言不截斷正在播放的話，只有急停與人工暫停會中斷播放。

### 4.7 排程

起始候選值沿用 config/runtime.example.json：畫面每 2 秒、留言每 1 秒、模型最快每 5 秒一次、畫面事件 12 秒失效、留言 30 秒失效。這些是待測值，P1 結束後以量測結果調整。

每個排程 tick 的判斷順序：

1. 若狀態不是 IDLE，跳過（採集仍繼續，候選槽照常更新）。
2. 若距上次模型呼叫不足 `min_model_interval_ms`，跳過。
3. 若本分鐘呼叫數已達 `max_calls_per_minute`，跳過並記 `rate_capped`。
4. 讀取候選槽。槽內容的優先序為：合格新留言 > 顯式情境事件 > 有新資訊的空檔。
5. 候選若已超過對應 TTL，或 `contextVersion` 已改變，丟棄並記 `expired` 或 `context_changed`。
6. 沒有候選就保持安靜，不填罐頭台詞。

### 4.7.1 誰判斷「可回答」

這是兩層判斷，邊界必須寫死，不能混為一談（R1 F3）：

| 層 | 判斷什麼 | 怎麼判斷 |
| --- | --- | --- |
| 本機粗篩 | 這則留言是否**有資格**成為候選 | 純機械規則：非空、長度在上下限內、未在 `spoken`、未超過 TTL、非純符號洗版。不做語意判斷 |
| 模型 | 現在**值不值得**說話、說什麼 | 由模型回傳 `speak` 與 `reason_code` 決定 |

本機粗篩不判斷「這則留言有沒有意義」。模型不負責判斷資料是否過期，過期一律由本機硬性擋下。

合格事件（qualified event）的定義就是通過本機粗篩的唯一留言，加上顯式情境事件。這個定義同時是覆蓋率的分母。

連續 30 秒沒有新資訊時保持安靜是正常行為，不是故障。

## 5. 採集路徑的選擇條件

### 5.1 畫面

| 條件 | 做法 |
| --- | --- |
| 目標為一般 DOM 或可截取的 canvas，且頁面在前景 | Playwright `locator.screenshot()` 取遊戲區域元素，回傳 buffer |
| 遊戲區域無法以選擇器定位 | `page.screenshot({ clip })` 以座標裁切，座標寫在設定檔 |
| 截圖為黑畫面、長時間不更新或頁面被最小化 | 改用本機視窗擷取後備路徑，共用 `CaptureAdapter` 介面 |
| 實測證明無法擷取的內容（例如 DRM 保護，或該 iframe 實測取不到畫面） | 記 `capture_unavailable`，停止依賴畫面的評論，不猜測內容 |

跨來源 iframe 不預設等同 DRM（R1 補正）。是否可擷取依實測結果判定，不依來源類型一概而論。

黑畫面偵測：連續 N 次 `frameHash` 相同**且**平均亮度低於門檻時標記 `degraded`，並在控制台顯示。單純雜湊不變不足以判定來源已斷線，靜態場景本來就會產生相同雜湊（R1 補正）。兩個條件必須同時成立，且 `degraded` 只代表「不再產生新的畫面事件」，不等於 `offline`。

本機視窗擷取在 Windows 與 macOS 的可用 API 與權限不同，且 macOS 需要螢幕錄製權限，這部分在實機驗證前記為 NOT_TESTED。

### 5.2 留言

優先序固定為：平台官方介面 > 可讀 DOM > OCR。

| 路徑 | 使用條件 | 實際限制 |
| --- | --- | --- |
| 官方介面 | 平台提供且使用條款允許讀取 | 需要申請與授權，本輪未申請 |
| DOM | 留言在可讀 DOM 節點且有穩定屬性可當 ID | 選擇器會隨平台改版失效，需要 `arb doctor` 檢查 |
| OCR | 前兩者都不可用 | 誤讀、重複與延遲都較高，必須單獨報告錯誤率 |

去重規則（R1 F3）：去重鍵是 `source + messageId` 的組合，不是單獨的 `messageId`。不同來源可能各自發出相同的 ID，單用 messageId 會讓兩個來源的不同留言互相吃掉。

去重狀態分三個集合，不可合併成一個：

| 集合 | 何時寫入 | 用途 |
| --- | --- | --- |
| `seen` | adapter 讀到留言時 | 防止同一來源重送同一則被當成新留言 |
| `selected` | 該留言被選入某次生成時 | 避免同一則在短時間內反覆送模型 |
| `spoken` | **實際開始播放時** | 防止同一則被播兩次 |

`spoken` 在播放開始才寫入，不在選取時寫入。若在選取時就寫入，一次驗證失敗或 TTS 失敗就會讓該留言永遠失去被回應的機會，連帶讓候選被永久吃掉。

沒有穩定 ID 時，以「正規化文字 + 作者 + 時間窗口」產生 synthetic ID，時間窗口候選 8 秒，仍與 source 組合成去重鍵。真實重複留言（不同人講同一句，或同一人隔一段時間再講）不應被吃掉，因此時間窗口外的相同文字視為新留言。OCR 路線額外比對前後兩次視窗的重疊區，低信心結果不送模型。

重新連線時預設從當下開始收，不朗讀歷史留言。

開發使用獨立瀏覽器設定檔，由操作者自行登入。不匯出個人瀏覽器 cookie，不規避登入、驗證碼或存取限制。

## 6. 音訊路徑

### 6.1 本機播放器到 OBS（Windows 候選基線）

主路徑：

1. 本機執行程序把 TTS 音訊送到指定輸出裝置，裝置 ID 寫在設定檔，不使用系統預設以免切換裝置時失控。
2. OBS 新增遊戲畫面來源（Window Capture 或 Game Capture）。
3. OBS 新增 Application Audio Capture，指向播放器程序。OBS 30.1 起亦可由 Window/Game Capture 直接帶音訊。
4. 在 OBS 設定中關閉全域 Desktop Audio，避免與應用程式音訊來源重複造成回音。

後備路徑：播放器輸出改送 VB-Cable 之類虛擬音訊裝置，OBS 以 Audio Input Capture 擷取該裝置。當 Application Audio Capture 對播放器不相容時使用。

操作者監聽用耳機，避免麥克風收到喇叭聲再進直播。本案不需要麥克風來源，若 OBS 內有麥克風來源應靜音。

### 6.2 TikTok Live Studio 替代路徑的未知項目

以下項目本輪沒有查證，一律記為 UNKNOWN，不得當作可行：

1. Live Studio 是否能選擇單一應用程式的音訊來源。
2. Live Studio 與 OBS 虛擬攝影機的相容性，以及虛擬攝影機是否攜帶音訊（預設假定不攜帶）。
3. 帳號是否具備直播資格與 AI 內容標示的平台要求。
4. macOS 下的可用性。

在這些確認之前，P3 的驗證對象是 OBS 本地錄影。

## 7. 成本模型

### 7.1 計算方式

每小時模型費用 = 實際呼叫數 × 每次（文字 input token + 視覺 token）成本 + 每次 output token 成本。TTS 費用另計，以字元數或音訊長度計。

### 7.1.1 情境估算

以下是**情境估算**，不是硬上界（R1 F4）。它只涵蓋所列的那一組參數，換一組參數就不成立。

單次呼叫假設：1 張 960x540 圖（700 視覺 token）、文字 input 約 1,500 token（系統指令、角色設定、參考摘要、20 則留言）、output 約 120 token。單次 input 約 2,200 token。

| 模型 | 單價（input / output，每百萬 token） | 單次成本 | 每分鐘 12 次、每小時 720 次的情境估算 |
| --- | --- | --- | --- |
| Claude Haiku 4.5 | $1 / $5 | 約 $0.0028 | 約 $2.02 |
| Claude Sonnet 5 | $2 / $10 | 約 $0.0056 | 約 $4.03 |
| Claude Opus 5 | $5 / $25 | 約 $0.0140 | 約 $10.08 |

同一份設定允許的其他組合會高於這個數字。反例：把圖改成設定允許的兩張 1280x720（各 1,196 視覺 token）並把 output 用滿 180 token，文字 input 仍假設 1,500，以 Haiku 4.5 單價計算，每小時就是 $3.45，已高於上表的 $2.02。因此上表不得被引用為「最壞情況」或「保證實際更低」。

### 7.1.2 預算保留算法

成本控制靠**先預留、後結算**，不靠事後估算（R1 F4）。每次付費呼叫的流程：

1. **預留**：呼叫前以最壞情況計算保留額，並從剩餘預算扣除。保留額必須包含：
   - 所有實際送出的圖片，依 `⌈寬/28⌉ × ⌈高/28⌉` 逐張計算，不用平均值。
   - 全部文字 input，包含系統指令、角色設定、參考資料、留言與近期已播內容。
   - 結構化輸出注入的額外系統提示（3.3），長度未知時以量測到的上界計。
   - `max_output_tokens` 的**全額**，不是預期值。模型可能用滿。
   - 若啟用 prompt caching，cache 寫入另計，不與 cache read 混算。
2. **執行**：送出呼叫。
3. **結算**：以回應的 usage 欄位取代保留額。差額退回剩餘預算。
4. **逾時或錯誤**：**不假定零費用**。逾時的呼叫可能已在供應商端產生費用，保留額維持扣除，直到能以 usage 或帳單核對為止。

TTS 同樣先預留後結算，以送出的字元數計算保留額。

任一次預留會讓累計超過 `hourly_usd_limit` 或 `session_usd_limit` 時，該次呼叫不送出，記 `budget_stop`。費率未知時不啟動付費模式，不以 0 代替未知。

### 7.1.3 SDK 層的重試

director 寫「每事件不重試」只管到 director 自己。SDK 預設會自動重試，那一層的重試同樣會產生費用並打亂時效判斷。因此建立 client 時必須顯式關閉自動重試（`maxRetries: 0`），並在報告中記錄實際設定值（R1 F4）。只有 director 寫不重試而 SDK 仍在重試，等於沒有關閉重試。

### 7.1.4 其他項目

系統指令與角色設定可用 prompt caching 降低成本（cache read 單價為 input 的一部分），且官方文件說明 cache read token 多數模型不計入 ITPM。此項在 P2 量測後再啟用，不先假設節省幅度。

TTS：每句約 60 字元，若每小時 360 句則約 21,600 字元。Azure 的每百萬字元單價在本次讀取時官方頁面未顯示金額，記為待查；免費額度為每月 50 萬字元。在單價確認前，TTS 每小時費用標記為 UNKNOWN，不以估算值代替。

### 7.2 硬上限

`budget.hourly_usd_limit` 與 `session_usd_limit` 目前為 null。null 不等於無上限，代表付費模式未授權。程式行為：

1. 預設 `mode: mock`，不做任何付費呼叫。
2. 切換到付費模式時，若兩個上限任一為 null 或 `price_table_version` 為 null，啟動失敗並說明原因，不允許 silent pass。
3. 每次呼叫前先估算，若本次預估會使累計超過上限就不呼叫，記 `budget_stop`。
4. 訂閱制 CLI 沒有逐次費率時，記錄呼叫量、速率限制與可用額度，費用欄標 UNKNOWN，不填 0。

## 8. 安全與資料邊界

留言、畫面內文字、OCR 結果與外部參考文字都是資料。系統指令、角色設定與不可信輸入在程式中以不同欄位傳遞，不做字串拼接。推論層沒有 shell、檔案、瀏覽器與金鑰存取能力。

模型被要求忽略規則、讀出提示詞、開啟網址或執行指令時，回 `reason_code: unsafe_input` 且 `speak: false`，或正常回答遊戲問題但不執行指令。這個判斷同時在本機驗證器做一次關鍵字與樣式檢查，不只依賴模型自律。

mock 模式能驗證的範圍有限，必須說清楚（R1 補正）：MockModelProvider 回傳的是預先寫好的 JSON，因此 mock 測試能證明的只有三件事——推論層沒有工具可用、不可信輸入與系統指令在資料結構上是分開的、注入文字不會導致任何指令被執行。它**不能**證明真實模型理解畫面或能抵抗提示注入。真實語意與抗注入測試留到 P2。

日誌記錄 observation ID、選取的 chat IDs、回覆、各階段時間、丟棄原因、播放起訖與 provider 用量。不記錄金鑰與完整瀏覽器狀態。畫面預設只存在記憶體，除錯留存需明確開啟且限量。音檔預設 24 小時輪替，文字日誌 7 日。

本 repository 為公開。只放合成或去識別 fixture，不提交登入資料、cookie、token、串流金鑰、私密截圖與真實觀眾日誌。

角色為虛構設定，不冒充特定真人。觀眾詢問是否為 AI 時如實簡短回答。平台要求的 AI 內容標示由操作者在試播前確認。

## 9. 本設計未涵蓋與待實機確認

1. 目標遊戲頁面是否可截圖，是否為 Canvas/WebGL 或跨來源框架。
2. 留言平台的官方介面可用性與使用條款。
3. 使用者實際作業系統。若為 macOS，第 6 節整節需重做。
4. Azure TTS 的每百萬字元單價與 zh-TW 語音的實際自然度。
5. 本機端到端延遲是否能達到中位數 6 秒、p95 12 秒的候選目標。
6. 真實畫面的換局辨識方式。首版只接受顯式情境事件，不從畫面推論。
7. 真實播放器的裝置枚舉、播放與強制停止方案，以及 OBS 能否擷取該播放器。

以上都不阻擋 P1 的離線實作，P1 全部使用 mock 與合成 fixture。R1 覆核確認的五個設備與聲音問題同樣不阻擋 mock，不為了等答案停工。
