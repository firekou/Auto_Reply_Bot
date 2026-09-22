# Auto Reply Bot PoC 操作手冊 v0.1（ARB-001）

base_sha：ac94f768d246fe7222fdc94a6d08961e6bfe2fc2
日期：2026-09-22

本手冊所有命令都標「預定」。本輪沒有執行任何一條，沒有錄影、沒有通過率、沒有退出碼可報告。任何人執行後必須把實際輸出寫進 reports/，不得複製本文件的預期值當成結果。

命令中的 `arb` 指 T-101 尚未建立的 CLI，現在不存在。

## 1. 兩種模式的界線

| 模式 | 執行位置 | 使用 | 可宣稱 |
| --- | --- | --- | --- |
| mock | 任何開發環境，含雲端 | 合成 fixture、MockModelProvider、MockTtsProvider、離線播放器 | 排程、去重、時效、取消、故障處理的正確性 |
| real | 只能在直播電腦 | 真實頁面、真實模型、真實 TTS、真實音效裝置、OBS | 延遲、自然度、音訊路徑、錄影品質 |

mock 通過不能宣稱 real 通過。real 的結果必須附執行時間、機器、作業系統版本與工具版本。沒有實機就標 NOT_TESTED，不用 VERIFIED。

必須在直播電腦完成的項目：畫面採集是否為黑畫面、留言來源是否可讀、TTS 自然度盲聽、本機端到端延遲、音效裝置急停時間、OBS 錄影與回音檢查、平台接收端延遲。

## 2. 合成 fixture 規格

fixture 放在 `fixtures/<scenario>/`，全部由 `tools/make-fixtures.ts` 產生，不含真實截圖與真實觀眾留言。

### 2.1 畫面

| 欄位 | 值 |
| --- | --- |
| 尺寸 | 960x540 |
| 格式 | PNG（另產生 JPEG 版本供壓縮影響測試） |
| 幀率 | 每 2 秒一張，對應 `capture.frame_interval_ms` |
| 內容 | 以程式繪製的假遊戲畫面：局數、回合計時、兩側分數、狀態文字。全部為虛構數值 |
| 特殊幀 | 黑畫面（連續 5 張）、停更（雜湊相同連續 10 張）、換局（局數加一並重置分數） |
| 檔名 | `frames/%06d.png`，另有 `frames.jsonl` 記錄每張的 `capturedAt` 與預期事實 |

`frames.jsonl` 的預期事實只供測試斷言使用，不送給模型。模型仍然只能從圖片讀資訊。

### 2.2 留言

`chat.jsonl`，每行一則：

```json
{"messageId":"m000123","idStability":"stable","source":"fixture","text":"這波能翻盤嗎","author":"viewer_07","receivedAt":1758499200000}
```

必須包含的類型與數量（單一情境）：

| 類型 | 數量 | 目的 |
| --- | --- | --- |
| 一般提問 | 40 | 回覆覆蓋率 |
| 重複 ID 重送 | 10 | 去重，重播次數必須為 0 |
| 不同人講同一句 | 6 | 真實重複，不得被誤去重 |
| 同一人隔 60 秒再講同一句 | 4 | 時間窗口外視為新留言 |
| 指令注入 | 10 | 例如要求忽略規則、讀出提示詞、開啟網址 |
| 無法回答或與遊戲無關 | 15 | 應選擇安靜或簡短帶過 |
| 空白與超長留言 | 5 | 輸入邊界 |
| 留言中斷 | 1 段 90 秒 | 來源離線行為 |

合計 90 則以上。驗收項目 2 需要 100 則帶穩定 ID 的留言，因此正式回播情境的留言總數不得少於 100。

### 2.3 情境時間軸

`timeline.json` 記錄整段的事件排程，包含畫面中斷起訖、留言中斷起訖、換局時間、預定觸發的 provider 故障時間。回放器依此推進模擬時鐘。

## 3. 30 分鐘離線回播（mock，預定）

前置：T-101 至 T-114 完成。

### 3.0 場景時間與實際時間

回播以虛擬時鐘推進，因此「30 分鐘」指的是**場景時間**，不是實際執行時間。報告必須同時列出兩者，例如「場景時間 30 分 00 秒，實際 wall time 4.1 秒」。跑完 30 分鐘場景時間**不能**宣稱已做過 30 分鐘實時穩定度測試；實時穩定度是 P4 的項目。

控制指令透過 stdin 控制通道送入（IMPLEMENTATION_DESIGN 1.1.1），指令為 `pause`、`resume`、`stop`、`estop`。P1 沒有常駐服務，也沒有本機 IPC。

預定命令：

```
預定：npm ci
預定：npm run build
預定：npm test
預定：node dist/tools/make-fixtures.js --scenario scenario-a --minutes 30
預定：node dist/cli/index.js replay --scenario fixtures/scenario-a --config config/runtime.example.json --out runtime/logs/replay-a.jsonl
預定：node dist/tools/replay-report.js runtime/logs/replay-a.jsonl
```

回播報告必須同時輸出以下欄位，缺一項視為未通過：

| 欄位 | 說明 |
| --- | --- |
| `events_total` | 進入排程的事件總數 |
| `utterances_played` | 實際播出的回覆數 |
| `qualified_events` | 通過本機粗篩的唯一合格事件數（去重鍵為 source+messageId），即覆蓋率分母 |
| `covered_events` | 至少被一段已播放回覆涵蓋的唯一合格事件數 |
| `coverage_rate` | `covered_events / qualified_events`。一段回覆同時回應多則留言時，那幾則都算被涵蓋，但回覆本身只算一次。此值不可能超過 100% |
| `game_comment_count` | 遊戲評論另行計數，不併入上面的覆蓋率 |
| `dropped_by_reason` | 依 `expired`、`rate_capped`、`length`、`duplicate`、`cancelled` 等分類 |
| `latency_ms` | 分段時間的中位數與 p95 |
| `duplicate_playbacks` | 同一 messageId 重播次數，必須為 0 |
| `overlap_count` | 播放重疊次數，必須為 0 |

覆蓋率必須與延遲一起看。靠大量丟棄事件把延遲壓低不算通過。

覆蓋率不得以「utterance 總數 ÷ 留言總數」計算（R1 F3）。那個算法在一段回覆涵蓋多則留言時會超過 100%，也會讓重複回應同一則留言被重複計分。分母固定是唯一合格事件數，遊戲評論另計。

### 3.1 延遲分段

每筆回覆記錄五個時間戳，報告輸出四段差值：

| 分段 | 定義 |
| --- | --- |
| t1 事件到決策開始 | `receivedAt` 到模型呼叫送出 |
| t2 模型往返 | 送出到收到回覆 |
| t3 驗證與 TTS | 收到回覆到音訊就緒 |
| t4 播放啟動 | 音訊就緒到實際開始播放 |

驗收項目 1 的「本機收到事件至開始播放」等於 t1 加 t2 加 t3 加 t4，候選目標中位數 6 秒、p95 12 秒，樣本至少 100 個可控事件。mock 模式下 t2 由 MockModelProvider 依設定的延遲分布模擬，不能當成真實模型延遲。

### 3.2 必測故障案例

每一項都要能重跑並得到相同結論。

| 案例 | 觸發方式 | 預期 |
| --- | --- | --- |
| 畫面中斷 | fixture 黑畫面段 | 停止依賴畫面的評論，來源標 degraded，不重講舊畫面 |
| 留言中斷 | fixture 留言中斷段 | 仍可做遊戲評論，留言來源標 offline |
| 模型逾時 | MockModelProvider 腳本 | 本事件不重試，冷卻後處理新事件 |
| 模型 429（含 retry-after） | 同上 | 依 retry-after 冷卻，不重試舊事件 |
| 額度用盡 | 模擬 `enforced_spend_limit_reached` | 停止付費呼叫，保留人工控制 |
| TTS 失敗 | MockTtsProvider 腳本 | 不播放半成品，記錄失敗，不自動換供應商 |
| 音效裝置消失 | 離線播放器模擬 | 停止播放並提示，恢復後丟棄舊回覆 |
| 連續三次失敗 | 腳本連續失敗 | 暫停該來源 30 秒後探測一次 |
| 留言注入 | fixture 注入留言 | `reason_code` 為 `unsafe_input` 或正常回答但不執行指令 |
| 換局過期 | fixture 換局 | 舊局結果不在新局播出 |
| 晚到結果 | 急停後延遲回傳 | 結果被丟棄，無重播 |

### 3.3 急停測試（mock）

預定命令：

```
預定：node dist/cli/index.js replay --scenario fixtures/scenario-a --inject-estop 10
```

每次急停記錄：觸發時間、模擬時鐘上聲音停止的時間、被取消的工作數、是否有晚到結果被播出。目標每次 1 秒內停止且無晚到重播。模擬時鐘的結果不能代替實機的 1 秒目標。

## 4. 本機真實循環（real，預定）

只能在直播電腦執行。前置：P2 任務完成、金鑰以本機環境變數提供、獨立瀏覽器設定檔已由操作者登入。

預定步驟：

1. 啟動指定瀏覽器的獨立設定檔，開啟遊戲頁面與留言來源，由操作者完成登入。
2. 預定：`node dist/cli/index.js doctor --config config/runtime.local.json`。檢查瀏覽器連線、選擇器命中、音效裝置存在、金鑰已設定。任一項失敗就停止，不進入下一步。
3. 預定：`node dist/cli/index.js probe --config config/runtime.local.json`。執行一次採集加一次生成，輸出 JSON，不合成也不播放。確認截圖非黑畫面、留言有讀到、模型回傳可用結構。
4. 預定：`node dist/cli/index.js run --config config/runtime.local.json --minutes 30`。
5. 預定：`node dist/tools/replay-report.js runtime/logs/<本次檔名>.jsonl`。

執行期間操作者以耳機監聽，不開喇叭，避免麥克風收到聲音。

### 4.1 必記項目

| 項目 | 記法 |
| --- | --- |
| 機器與系統 | 作業系統版本、CPU、RAM、瀏覽器版本、Node 版本、OBS 版本 |
| 截圖健康度 | 總次數、黑畫面次數、停更次數 |
| 留言來源 | 路徑（官方介面 / DOM / OCR）、ID 穩定性、中斷次數 |
| 延遲 | 四個分段的中位數與 p95、樣本數 |
| 用量與費用 | 呼叫次數、token、TTS 字元數；單價未知時標 UNKNOWN |
| 丟棄 | 依原因分類 |

### 4.2 急停測試（real）

預定：執行中連續觸發 10 次急停，以錄音或碼表記錄實際靜音時間。這是驗收項目 3 的唯一有效證據來源，模擬時鐘的結果不算。

## 5. OBS 錄影與回音排除（real，預定）

前置：第 4 節完成。

預定步驟：

1. OBS 新增遊戲畫面來源（Window Capture 或 Game Capture）。
2. OBS 新增 Application Audio Capture 指向播放器程序；OBS 30.1 以上亦可由 Window/Game Capture 直接帶音訊。
3. 設定 → 音訊，關閉全域 Desktop Audio。這是回音的主要來源。
4. 確認沒有麥克風來源，或將其靜音。
5. 錄影 10 分鐘，期間至少播出 20 句。
6. 回放錄影，檢查：遊戲畫面連續、主持聲清晰、沒有同一句聲音出現兩次、沒有控制台或金鑰入鏡。

若 Application Audio Capture 對播放器不相容，改走虛擬音訊裝置：播放器輸出到虛擬裝置，OBS 以 Audio Input Capture 擷取該裝置。兩條路徑不可同時開啟同一聲音來源。

### 5.1 回音自我檢查表

| 檢查 | 通過條件 |
| --- | --- |
| Desktop Audio | 已關閉，或確認未與應用來源重複 |
| 應用音訊來源 | 只有播放器一個 |
| 麥克風 | 無來源或已靜音 |
| 監聽 | 操作者使用耳機 |
| 錄影回放 | 單一句子只聽到一次 |

### 5.2 平台接收端

OBS 錄影成功不等於觀眾端驗證。接收端延遲必須在受控試播時另行量測，且試播需要另外授權，本輪未包含。TikTok Live Studio 的音源選擇與虛擬攝影機是否攜帶音訊仍為 UNKNOWN，查證前不安排該路徑的驗收。

## 6. 報告規則

1. 每次執行寫一份 reports/ 檔案，含日期、機器、命令、實際退出碼、實際數字。
2. 沒跑的命令標「預定」，不填退出碼。
3. mock 與 real 分開列，不合併計分。
4. OCR 路線的誤讀率與誤去重率分開報告，不與 DOM 路線合成單一分數。
5. 缺設備而未執行的項目標 NOT_TESTED，不標通過。
