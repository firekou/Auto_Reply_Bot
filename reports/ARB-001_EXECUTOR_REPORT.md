# ARB-001 執行者報告

| 欄位 | 值 |
| --- | --- |
| work_id | ARB-001 |
| role | Claude executor planner |
| base_sha | ac94f768d246fe7222fdc94a6d08961e6bfe2fc2 |
| content_head | PENDING_EVIDENCE_COMMIT |
| reviewed_head | null |
| reviewer_only_head | null |
| scope | Detailed design and bounded PoC plan |
| decision | null（執行者不自行批准） |
| status | READY_FOR_GPT_REVIEW |
| next_checkpoint | GPT 獨立覆核本 PR 的設計、查證來源與範圍邊界 |
| invalidates_when | 任務範圍改變、content_head 改變、或任一官方來源的結論被推翻 |

`content_head` 在本報告寫入時尚未產生，依 prompts/CLAUDE_PLANNING_PROMPT.md 的規定不在同一 commit 內自引用。內容 commit 推送後，由後續證據 commit 填入該 SHA。

## 1. 變更路徑

| 路徑 | 動作 |
| --- | --- |
| docs/IMPLEMENTATION_DESIGN.md | 新增 |
| docs/IMPLEMENTATION_BACKLOG.md | 新增 |
| docs/POC_RUNBOOK.md | 新增 |
| reports/ARB-001_EXECUTOR_REPORT.md | 新增 |
| project/WORK_LEDGER.json | 更新 |
| README.md | 更新文件入口與目前狀態 |

## 2. 分支說明

prompts/CLAUDE_PLANNING_PROMPT.md 指定分支名 `claude/arb-001-detailed-plan`。本次執行環境的工作階段指派分支為 `claude/hopeful-archimedes-bf57bo`，且該分支已存在於 origin。為了不在未授權的情況下推往其他分支，本輪在指派分支上交付，分支名與 prompt 不同。若覆核者要求以 prompt 指定的名稱交付，可由後續批次改名重推；內容不受影響。

同名工作分支的既有回報：無。`git diff origin/main...HEAD` 在開始時為空，沒有前一輪未完成的工作需要延續。

## 3. 執行的命令與退出碼

本輪沒有程式可建置或測試，因此沒有建置與測試命令。實際執行過的是 git 與檔案檢查命令。

| 命令 | 退出碼 |
| --- | --- |
| `git fetch origin main` | 0 |
| `git rev-parse origin/main` | 0 |
| `git status --porcelain` | 0 |
| `ls docs reports` | 0 |

docs/POC_RUNBOOK.md 內的所有執行命令一律標「預定」，本輪一條都沒有執行。沒有錄影、沒有通過率、沒有延遲數字可報告。

## 4. 證據分級

### 4.1 已證明（OBSERVED：官方文件內容，2026-09-22 讀取）

| 結論 | 來源 |
| --- | --- |
| Playwright 支援元素截圖與回傳 buffer，選項含 clip、animations、scale、mask、timeout | https://playwright.dev/docs/screenshots 、https://playwright.dev/docs/api/class-page#page-screenshot |
| Claude 圖片輸入支援 JPEG/PNG/GIF/WebP，單張上限 8000x8000 px，直接呼叫 API 時單張 base64 上限 10 MB，超過 20 個 image block 會套用更嚴格尺寸限制 | https://platform.claude.com/docs/en/build-with-claude/vision |
| 視覺 token 為 `⌈寬/28⌉ × ⌈高/28⌉`；Claude 4.7 以後為高解析度層（長邊 2576 px、4784 token），其餘為 1568 px、1568 token | 同上 |
| 結構化輸出以 `output_config.format` 指定，`output_format` 已被取代；JSON Schema 僅支援子集，不支援 minLength、maxLength、minimum、maximum、遞迴 schema，物件 additionalProperties 必須為 false；首次請求有 grammar 編譯延遲，快取 24 小時；會注入額外系統提示使 input token 增加 | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| 速率限制分 RPM/ITPM/OTPM，超限回 429 並附 retry-after；月費上限用盡同樣回 429 但無 retry-after 且 `error_code` 為 `enforced_spend_limit_reached`；自設上限用盡回 400 | https://platform.claude.com/docs/en/api/rate-limits |
| 模型單價：Haiku 4.5 為 $1/$5、Sonnet 5 為 $2/$10、Opus 5 為 $5/$25（每百萬 token，input/output） | https://claude.com/pricing |
| OBS Application Audio Capture 需 Windows 10 version 2004 以上或 Windows 11、OBS 28 起；OBS 30.1 起 Window/Game Capture 可帶音訊；與全域 Desktop Audio 併用會回音；不相容時以虛擬音訊裝置替代 | https://obsproject.com/kb/application-audio-capture-guide |
| Azure AI Speech 的 zh-TW 有三個 neural 語音：HsiaoChen（女）、YunJhe（男）、HsiaoYu（女）；語言支援頁未列 zh-TW 的 HD/DragonHD 變體 | https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support |
| Azure TTS neural 語音每月 50 萬字元免費額度 | https://azure.microsoft.com/en-us/pricing/details/speech/ |
| ElevenLabs Flash v2.5 標示約 75 ms 延遲、支援 32 種語言含 Chinese、單次上限 40,000 字元 | https://elevenlabs.io/docs/overview/models |
| Piper 官方語音清單的中文為 zh_CN，沒有 zh_TW | https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md |
| Grok Bot 官方文件描述其在持續運作的雲端電腦上工作，該電腦有瀏覽器、檔案系統與終端機；未提及控制使用者本機音效裝置，未提供自架選項 | https://docs.x.ai/grok-bot/overview |

以上為文件記載內容，不是本專案的實機驗證結果。

### 4.2 僅設計（REPORTED：本輪產出，未執行）

1. TypeScript + Node.js 單程序架構與模組切分。
2. 五個 adapter 介面、觀測 schema、回覆 schema。
3. 七狀態的狀態機與允許轉換表。
4. `sessionGeneration` 取消語義與急停五步流程。
5. 排程優先序、TTL 與單一待播規則。
6. 本機驗證器的八項檢查（句數、長度與格式必須本機強制，因為官方 schema 子集不支援長度約束）。
7. 畫面與留言採集的選擇條件與去重規則。
8. 成本估算：Haiku 4.5 每小時上界約 $2.0、Sonnet 5 約 $4.0、Opus 5 約 $10.1（以每分鐘 12 次、單次 input 約 2,200 token、output 約 120 token 估算）。這是估算，不是量測。
9. P1 至 P3 的任務清單與工作量估計。

### 4.3 待實機確認（NOT_TESTED）

| 項目 | 原因 |
| --- | --- |
| 目標遊戲頁面是否可截圖 | 沒有 URL，也沒有直播電腦 |
| 留言來源的實際結構與 ID 穩定性 | 同上 |
| Azure zh-TW 語音的自然度與延遲 | 無憑證，未呼叫 |
| 本機端到端延遲是否達候選目標 | 無實機 |
| 急停 1 秒內靜音 | 無音效裝置 |
| OBS 錄影與回音排除 | 無 OBS |
| 平台接收端延遲 | 未授權試播 |
| Azure TTS 每百萬字元單價 | 官方定價頁本次讀取時金額欄位為佔位符 |
| ElevenLabs 對 zh-TW 的實際口音表現 | 官方文件只寫 Chinese，未區分繁簡 |
| Grok Bot 的雲端供應商歸屬與計費 | 官方頁面該段敘述與產品名稱不一致，標 UNVERIFIED |

runtime_validation 的七個欄位維持 NOT_TESTED，本輪沒有任何一項改變。automation 維持 NOT_ENABLED，本輪沒有實測任何自動喚醒往返。

## 5. 阻擋下一階段的問題（最多五個）

每題都附可先進行的替代方案，因此沒有任何一項會讓本專案停工。

| # | 問題 | 影響 | 在得到答案前可先做的事 |
| --- | --- | --- | --- |
| 1 | 直播電腦的作業系統是 Windows 11 還是 macOS，版本為何 | 決定音訊路徑與視窗擷取 API。IMPLEMENTATION_DESIGN 第 6 節整節是 Windows 路徑，macOS 需重做 | P1 全部任務照做，音訊層只實作離線播放器與介面 |
| 2 | 遊戲頁面的 URL 與顯示方式（一般 DOM、Canvas、WebGL、跨來源 iframe） | 決定 Playwright 元素截圖是否可用，以及是否需要視窗擷取後備 | 以合成 fixture 完成 P1；BrowserCaptureAdapter 介面先定義好 |
| 3 | 留言來源平台，以及是否有可用的官方介面 | 決定走官方介面、DOM 或 OCR。OCR 的誤讀率會直接影響驗收項目 2 | 先實作 MockChatAdapter 與去重器，三條路徑共用同一介面 |
| 4 | 是否授權開通 Azure AI Speech，以及每小時與每場的美元預算上限 | 沒有授權上限就不能啟用付費模式，程式設計為啟動失敗 | P1 全程 mock；成本計量模組可先寫，單價欄位標 UNKNOWN |
| 5 | 角色人設與聲音偏好是否由使用者指定，或沿用候選預設 | 影響盲聽驗收的基準。目前的「親切、機靈、輕鬆」是候選預設，不是使用者選定 | 以候選預設實作，persona 設定外部化，換人設不需改程式 |

## 6. 下一批範圍與驗收

建議 work_id：ARB-002，角色為 Claude executor implementer。

範圍：只做 IMPLEMENTATION_BACKLOG 第 1 節的 T-101 至 T-116（P1 離線循環）。不接真實供應商、不做直播、不做圖形控制台。

驗收：

1. `npm run build` 與 `npm test` 退出碼 0，測試輸出附在報告中。
2. 30 分鐘離線回播可重跑，報告同時含樣本數、延遲中位數與 p95、丟棄率分類、覆蓋率。
3. 100 則帶穩定 ID 的合成留言中，重複播放為 0；播放重疊為 0。
4. POC_RUNBOOK 第 3.2 節的 11 個故障案例全部可重現，每個案例對應至少一個測試。
5. 急停 10 次在模擬時鐘下 1 秒內停止且無晚到重播，並明確標示這是 mock 結果，不能代替實機。
6. 報告明確區分 mock 與 real，real 欄位全部維持 NOT_TESTED。

超出上述範圍的內容不應出現在 ARB-002，包含真實 provider 憑證、直播設定與多角色。

## 7. 自我限制聲明

本報告由執行者撰寫，沒有獨立覆核。decision 欄位為 null，不宣稱 APPROVED。本輪沒有在直播電腦執行任何程式，沒有播放任何聲音，沒有連線使用者的個人登入工作階段，沒有啟用任何付費服務，沒有讀取或上傳金鑰。

GitHub 上傳完成不代表 GPT 或 Claude 已被自動喚醒。automation 維持 NOT_ENABLED。
