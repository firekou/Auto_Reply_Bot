# Auto Reply Bot

具備固定個性、說話風格與參考資料的 AI 互動節目主持系統。

讀取指定瀏覽器中的遊戲畫面與最新觀眾留言，適時產生 1 至 3 句口語回應，轉為本機語音，再由 OBS 或 TikTok Live Studio 輸出畫面與聲音。

## 文件入口

1. [完整專案規劃](docs/PROJECT_PLAN.md)
2. [實作設計](docs/IMPLEMENTATION_DESIGN.md)
3. [實作任務清單](docs/IMPLEMENTATION_BACKLOG.md)
4. [PoC 操作手冊](docs/POC_RUNBOOK.md)
5. [ARB-001 執行者報告](reports/ARB-001_EXECUTOR_REPORT.md)
6. [ARB-002 執行者報告](reports/ARB-002_EXECUTOR_REPORT.md)
7. [給 Claude 的下一輪 prompt](prompts/CLAUDE_PLANNING_PROMPT.md)
8. [主持角色與回覆 prompt](prompts/HOST_RUNTIME_PROMPT.md)
9. [候選設定範本](config/runtime.example.json)
10. [交接狀態](project/WORK_LEDGER.json)
11. [協作與覆核規則](AGENTS.md)

## 目前狀態

2026-09-22 建立規劃，同日完成 ARB-001 詳細設計（覆核結果 APPROVED_WITH_CONDITIONS）與 ARB-002 最小 mock 循環。

現在有可執行的程式，但**全部是 mock**：合成畫面、合成留言、腳本化模型、靜音 TTS、離線播放器。沒有開過瀏覽器、沒有發出任何聲音、沒有呼叫付費供應商、沒有錄影、沒有直播。實機驗證七項全部維持 NOT_TESTED。

ARB-002 已交回 GPT 覆核，執行者未自行批准。先做單機、單畫面、單角色；不擴張成多 agent 平台。

## 跑起來看看（全程 mock）

```
npm ci
npm run build
npm test
node dist/src/cli/index.js replay --minutes 30 --transcript 40
```

`replay` 會在虛擬時鐘上重播 30 分鐘的合成場景，印出讀到哪些留言、選了哪一則、回了什麼、何時模擬播放，以及覆蓋率與丟棄分類。30 分鐘是**場景時間**，實際只花幾秒，因此不是實時穩定度測試。

執行中可由 stdin 送 `pause`、`resume`、`stop`、`estop`。

Claude 的雲端開發環境不等於直播電腦。能產生程式碼不代表能直接讀取使用者本機瀏覽器或播放聲音，必須另有本機執行程序。

## 範圍

已授權：規劃文件上傳 GitHub、ARB-001 詳細規劃、ARB-002 mock 最小循環，皆交回覆核。
下一輪：由覆核者決定是補完 P1 其餘故障案例，或進入 P2（需先取得作業系統、遊戲頁面、留言來源、TTS 授權與預算上限）。
後續里程碑：離線回播、本機真實串接、OBS 錄影、受控直播試播。

所有數值均為設計起始值或待測驗收目標，並非已達成的效能承諾。
