# Auto Reply Bot

具備固定個性、說話風格與參考資料的 AI 互動節目主持系統。

讀取指定瀏覽器中的遊戲畫面與最新觀眾留言，適時產生 1 至 3 句口語回應，轉為本機語音，再由 OBS 或 TikTok Live Studio 輸出畫面與聲音。

## 文件入口

1. [完整專案規劃](docs/PROJECT_PLAN.md)
2. [給 Claude 的下一輪 prompt](prompts/CLAUDE_PLANNING_PROMPT.md)
3. [主持角色與回覆 prompt](prompts/HOST_RUNTIME_PROMPT.md)
4. [候選設定範本](config/runtime.example.json)
5. [交接狀態](project/WORK_LEDGER.json)
6. [協作與覆核規則](AGENTS.md)

## 目前狀態

2026-09-22 建立規劃。原 repository 為空，目前只有規劃文件與設定範本，尚未實作或驗證本機串接、語音播放、直播及自動喚醒 Claude。

下一個工作：ARB-001，由 Claude 讀取上述文件並提出具體實作設計與最小驗證方案。先做單機、單畫面、單角色；不擴張成多 agent 平台。

Claude 的雲端開發環境不等於直播電腦。能產生程式碼不代表能直接讀取使用者本機瀏覽器或播放聲音，必須另有本機執行程序。

## 範圍

本輪已授權：規劃文件上傳 GitHub。
下一輪：Claude 詳細規劃，交回 GitHub 供覆核。
後續里程碑：離線回播、本機真實串接、OBS 錄影、受控直播試播。

所有數值均為設計起始值或待測驗收目標，並非已達成的效能承諾。
