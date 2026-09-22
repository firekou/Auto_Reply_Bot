# 給 Claude 的詳細規劃 prompt

你是 firekou/Auto_Reply_Bot 的執行規劃者。本輪 work_id：ARB-001。
請直接以本 repository 作為工作來源與交付位置。

## 先讀與固定範圍

讀取 README.md、AGENTS.md、docs/PROJECT_PLAN.md、prompts/HOST_RUNTIME_PROMPT.md、config/runtime.example.json 及 project/WORK_LEDGER.json。
記錄開始時 main 的完整 commit SHA 為 base_sha；以此建立 claude/arb-001-detailed-plan 分支。若已有同工作分支及回報，先讀 diff，再延續未完成部分，不另開重複工作。

目標：讀取本機指定瀏覽器遊戲畫面及最新觀眾留言，依角色與參考資料產生 1 至 3 句自然口語，經本機 TTS 播放，再由 OBS 或 TikTok Live Studio 直播。畫面本身由直播工具直接擷取。

你這一輪只要把下一步變成可執行的具體設計與最小 PoC 計畫，完成後開 draft PR 交回 GPT；不需要現在完成整套系統。

## 必須完成

1. 提供 docs/IMPLEMENTATION_DESIGN.md：
   - 一套首選技術棧與選擇理由。區分本機、雲端開發及雲端模型，明確指出誰擁有瀏覽器及音效裝置。
   - 檢查 agent 直接工具操作與常駐本機程序兩條路徑。保留使用者希望的 agent 能力，但不要靠無界 agent 迴圈運作。
   - 以官方文件確認候選套件、介面、圖片輸入、結構化輸出、取消、速率及授權條件。Grok Bot 名稱若仍無法確認就標 UNKNOWN，不臆測產品。
   - 五個 adapter 的介面、觀測與回覆 schema、狀態機、佇列及 session_generation 取消規則。
   - browser 截圖、DOM 留言、OCR fallback 的選擇條件及實際限制。
   - 本機播放器至 OBS 的音訊路徑；Live Studio 替代路徑另列未知項目。
   - TTS 首選與備選的比較，但第一輪實作只選一個。
2. 提供 docs/IMPLEMENTATION_BACKLOG.md：
   - 依 P1、P2、P3 排序的最小任務清單，列依賴、預估工作量、檔案、驗收方法與設備條件。
   - 第一個程式實作批次只涵蓋離線回播與核心排程，不先做全功能控制台。
   - 列出本機／雲端推論的成本估算方法及呼叫上限，缺價格就標待查。
3. 提供 docs/POC_RUNBOOK.md：
   - 一個遊戲畫面加一個留言來源的操作步驟與合成 fixture 規格。
   - 30 分鐘測試步驟、延遲分段、錄影驗證、回音排除、急停及失效測試。
   - mock 與 real 分開，說明什麼必須在直播電腦完成。
   - 實際沒有執行的命令一律標「預定」，禁止編造 exit code、錄影或通過率。
4. 提供 reports/ARB-001_EXECUTOR_REPORT.md：
   - base_sha、內容 commit、變更路徑、官方來源及查證日期。
   - 已證明、僅設計、待實機確認三類分開。
   - 最多五個真正阻擋下一階段的問題，同時提供能先進行的替代方案。
   - 下一批明確範圍與驗收，狀態 READY_FOR_GPT_REVIEW。
5. 在同分支更新 project/WORK_LEDGER.json，保持本工作 ID，下一角色為 GPT reviewer，附 PR 與報告位置。

## Non-goal

本輪不開直播、不連使用者個人登入工作階段、不購買或啟用付費服務、不讀取或上傳金鑰、不代玩或自動下注、不向觀眾送文字訊息、不新增 Railway 部署、資料庫叢集、多角色、多 agent 團隊或無關治理平台。
不要在欠缺設備時把整輪標為停工；先完成全部不依賴設備的設計。
不要要求使用者重述已寫在本 repo 的目標。
不要將「自然」設計成假冒特定真人，遇到身分問題如實回答。

## 交付

以 draft PR 提交到 main，不自行合併或宣稱 APPROVED。
PR 說明只需交代問題、具體設計、驗證與限制，附下一步。
內容 commit 完成後，報告可使用後續證據 commit 引用前一個內容 SHA；不要在同一 commit 中填入它自己的 SHA。
GitHub 上傳完成不代表 GPT 或 Claude 已自動被喚醒。沒有實測觸發鏈就保持 automation=NOT_ENABLED。
