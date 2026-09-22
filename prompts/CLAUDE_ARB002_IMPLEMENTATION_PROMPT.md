# ARB-002：先交可重播的最小互動循環

你是 Auto_Reply_Bot 的 Claude 執行者。
先讀 reviews/ARB-001_GPT_REVIEW_R1.md。ARB-001 結論為 APPROVED_WITH_CONDITIONS，實機全部 NOT_TESTED。
基準：ARB-001 reviewed_head=7a791e28ace60610acaf61e15b3a8e46588e19ec；讀取目前 PR #1 最新 head，確認之後僅為 reviewer 文件。若出現其他實作，先接續已有工作，不覆蓋。

## 本輪目標
將固定角色設定、合成遊戲畫面及留言送進完整 mock 流程，輸出 1 至 3 句回覆資料、模擬 TTS 和播放事件。能一個命令重播、看到現在讀到什麼、選了哪則留言、回了什麼及何時模擬播放。
這是最小執行管線，不能宣稱已看懂真實遊戲或已發出真實主持聲。

## 工作順序
1. 在 PR #1 現有分支以獨立 commit 修正 review F1 至 F5；保留 reports/ARB-001_EXECUTOR_REPORT.md 原始報告，另寫本輪回應。
2. 建立 TypeScript/Node 專案、lockfile、設定載入、mock capture/chat/model/TTS/player、串行 director 及最小 CLI。
3. 以 source+messageId 去重，候選槽最多一筆；持續採集、播放完才生成。角色及參考資料必須實際進入 DecisionInput，不能只寫未使用的 config。
4. 先判 speak=false 再判發言字數，允許有效短句。加入 contextVersion 及全程 generation/jobId 防護，處理換局、pause、stop、resume 與晚到 callback。
5. 真正定義 CLI 如何控制正在運行的服務。可以使用同程序 stdin 控制或最小本機 IPC，選一種；不可只有不存在的 CLI 名字。
6. 本輪只用假費率測預算保留與結算，不呼叫供應商。修正 $2/hr 等為情境估算，不宣稱硬上限。
7. 建立至少 100 個唯一穩定 ID 的可控留言，加重送、跨來源同 ID、短句、安靜、TTL 內換局、突發、provider 失敗及急停事件。合成圖及資料必須可重生。
8. 報告覆蓋率以唯一合格事件為單位，遊戲評論另外計數。同時報告丟棄分類和回覆數，不能只報漂亮延遲。
9. 完成 npm ci、build、測試與 deterministic replay。提供 30 分鐘「場景時間」回播，可用虛擬時鐘加速，但同時列場景時間與實際 wall time，不能宣稱跑過 30 分鐘實時穩定度。
10. 交 reports/ARB-002_EXECUTOR_REPORT.md，更新 ledger 與 README；附 exact content head、真實命令及退出碼、可重跑命令、測試結果及可展示的文字 transcript。real 仍全部 NOT_TESTED。

## 第一個 checkpoint
先交完整最小循環与關鍵測試，範圍不以 T-101 至 T-116 每個項目都做滿為前提。
必測：合法安靜不觸發 TTS；短句可播；跨來源 ID 不衝突；同來源重送不重播；最多一個模型及一個播放；候選槽有界；換局後舊評論不播；pause/stop 後晚到 resolve/reject/finally 不復活；resume 不受舊工作污染；10 次 mock 急停無晚到播放；預算預留不超上限；覆蓋率不超過 100%。
fixture 真實注入文字不導致工具執行，但不要將 mock 的預定回應誤稱為真實模型抗注入能力。
原 runbook 其他故障案例仍列後續 checklist，若未完成就如實標未完成，不把 checkpoint 當 P1 全部驗收。

## 接下來的產品路線
本輪後只安排一種真實擷取與留言、一個模型、一個 TTS、一個本機播放器，目標取得 10 分鐘 OBS 本地錄影。P2 前須解決 F6、OS、來源及已授權的服務與預算。
OCR、prompt caching、Live Studio、虛擬音訊後備及第二套 provider 均延後，除非選定主路徑證明不能運作。
以實際完成的 checkpoint 重估工作量，不沿用 42 至 50 天作交期承諾。

## Non-goal
不啟用付費、不讀金鑰或個人登入工作階段、不開直播、不代玩、不上 Railway、不建完整控制台、不做多角色或治理平台。
不為了等設備答案停止 mock 工作。不合併、不自行 APPROVED、不宣稱 agent 已自動喚醒。

## 交回
保持 draft PR。文件修正與實作分開 commit，更新 PR 說明讓 reviewer 辨識新增程式範圍。
如果環境禁止既有分支寫入，保留來源與 diff，在允許分支建立 draft PR 並連回 #1，不要重做整套設計。
