# ARB-002 執行者報告

| 欄位 | 值 |
| --- | --- |
| work_id | ARB-002 |
| role | Claude executor implementer |
| base_sha | 7a791e28ace60610acaf61e15b3a8e46588e19ec（ARB-001 reviewed_head） |
| review_head | 6079e14b35a162ae70d09ea7a84b4930d84eb68f（R1 覆核與 ARB-002 prompt） |
| design_fix_commit | 81296793ecf7aeb98347e75c0e7730eb3d1f1110 |
| implementation_commit | 7647009701a3107db9ea63fb0afaf39ec359f4f2 |
| content_head | 5051b9acf687f782fdc8c83de726028f36713849 |
| reviewed_head | null |
| reviewer_only_head | null |
| scope | R1 F1 至 F5 設計修正（F6 的 P1 部分），加上可重播的最小 mock 循環與關鍵測試 |
| decision | null（執行者不自行批准） |
| status | READY_FOR_GPT_REVIEW |
| next_checkpoint | GPT 覆核 R1 條件是否閉合，以及 C1 是否可接受 |
| invalidates_when | 範圍擴及真實供應商、實機或直播；或 content_head 改變 |

`content_head` 指內容 commit `5051b9acf687f782fdc8c83de726028f36713849`，由本證據 commit 填入；內容 commit 不自引用自己的 SHA。ARB-001 的原始報告 `reports/ARB-001_EXECUTOR_REPORT.md` 未修改，本報告是本輪的獨立回應。

## 1. 變更路徑

| 路徑 | 動作 | commit |
| --- | --- | --- |
| docs/IMPLEMENTATION_DESIGN.md | 修正 F1、F2、F3、F4、F6(P1) 與補正項 | `8129679` |
| docs/IMPLEMENTATION_BACKLOG.md | 修正 F5 與 F4 成本敘述 | `8129679` |
| docs/POC_RUNBOOK.md | 覆蓋率定義、場景時間與實際時間、控制通道 | `8129679` |
| package.json、package-lock.json、tsconfig.json | 新增專案 | `7647009` |
| src/**（23 檔） | 新增實作 | `7647009` |
| tests/**（4 檔） | 新增測試 | `7647009` |
| tools/make-fixtures.ts | 新增 | `7647009` |
| fixtures/scenario-a/** | 新增合成 fixture | `7647009` |
| project/WORK_LEDGER.json、README.md、reports/ARB-002_EXECUTOR_REPORT.md | 交接更新 | 本 commit（SHA 由後續證據 commit 記錄） |

## 2. 實際執行的命令與退出碼

在實作 commit 的工作樹上執行，Node v22.22.2、npm 10.9.7、TypeScript 5.9.3。`npm ci` 前先刪除 `node_modules` 與 `dist`。

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm ci` | 0 | 3 個套件（typescript、@types/node、undici-types） |
| `npm run build` | 0 | tsc 無錯誤 |
| `npm test` | 0 | 48 tests、48 pass、0 fail、0 skipped |
| `node dist/src/cli/index.js replay --minutes 30 --out runtime/logs/scenario-a.jsonl` | 0 | 見第 4 節 |
| `node dist/src/cli/index.js replay --minutes 30 --inject-estop 10 --out runtime/logs/scenario-a-estop.jsonl` | 0 | 10 次急停，0 次晚到播放 |
| `node dist/src/cli/index.js make-fixtures --minutes 30` | 0 | 138 則留言、11 個時間軸事件 |
| `node dist/src/cli/index.js doctor` | 0 | 5 項標 SKIPPED，2 項 RUN |
| `node dist/src/cli/index.js transcript --log runtime/logs/scenario-a.jsonl` | 0 | 見第 5 節 |

可重跑的最短序列：

```
npm ci && npm run build && npm test
node dist/src/cli/index.js replay --minutes 30 --transcript 40
```

`runtime/` 在 .gitignore 內，日誌不進 repository。

## 3. R1 必修項目的處理

### F1 安靜與短句（已閉合）

驗證改為三段：共同欄位 → 依 `speak` 分支 → 只對發言套用內容規則。`speak=false` 且 utterance 為空、reply_to_ids 為空是**合法安靜**，直接回 IDLE，不呼叫 TTS，不計入連續失敗。20 字改為目標值，只有上限 80 是硬性規則；字數以 Unicode code point 計算。

程式：`src/director/validator.ts`。測試：`tests/validator.test.ts` 12 項，含合法安靜、`漂亮！`（3 字）可播、80 字通過而 81 字被擋、`speak=true` 但空字串被擋、不合法 silence payload 被擋、emoji 計為 1 字。整合面：`tests/replay.test.ts` 的「a legal silence never calls TTS」直接斷言 `ttsUsage.calls === 0`。

### F2 換局與取消後 callback（已閉合）

新增 `contextVersion`，與 `sessionGeneration` 並列。換局只從顯式事件取得，不從 `frameHash` 推論。所有非同步完成路徑（resolve、reject、finally）在寫狀態前比對 `(jobId, sessionGeneration, contextVersion)`，不符就只記錄不改狀態。`stopNow()` 有自己的逾時，不阻塞其餘取消步驟。

程式：`src/director/state.ts` 的 `transitionIfCurrent`、`src/director/runtime.ts` 的 `finishJob`。測試：TTL 內換局（留言 TTL 30 秒，換局在 4 秒，模型 6 秒才返回）舊評論不播；故意忽略 abort signal 的 provider 在 pause 之後才 resolve，狀態仍為 PAUSED 且不播出；stop 後的晚到完成不復活；resume 後舊 token 無法改狀態。

### F3 候選槽、來源 ID、覆蓋率（已閉合）

改為串行流程加**候選槽**（至多一筆觀測），採集不因播放而停止。去重鍵為 `source + messageId`，`seen`／`selected`／`spoken` 三個集合分開，`spoken` 在實際播放開始才寫入。本機粗篩只做機械判斷，`speak` 由模型決定，過期一律本機硬擋。

覆蓋率 = 被已播放回覆涵蓋的唯一合格事件數 ÷ 唯一合格事件數，遊戲評論另計，不可能超過 100%。

測試：跨來源同 ID 不互相吃掉；同來源重送只播一次；TTS 失敗後該留言沒有被永久吃掉；播放中突發留言只更新候選槽；同時最多一個模型呼叫與一個播放；一句回覆涵蓋兩則留言時，utterance 記 1、covered 記 2 且覆蓋率不超過 100%。

### F4 成本（已閉合）

每小時數字改稱情境估算，並寫入反例：兩張 1280x720 加 output 用滿 180 token，以同一單價計算是每小時 $3.45，高於原本宣稱的 $2.02。新增先預留後結算：預留含每張圖的實際 token、全部文字、結構化輸出額外提示、`max_output_tokens` 全額；逾時不假定零費用，保留額維持扣除；未知費率不啟動付費模式。SDK 自動重試必須顯式關閉，已寫入設計並由設定驗證強制 `retriesPerEvent === 0`。

測試：`tests/budget.test.ts` 10 項，含視覺 token 公式、預留含 output 全額、超上限被拒、結算沖銷、逾時保留不釋放、未知費率丟錯、付費模式缺上限或缺費率版本啟動失敗、real 模式不得跑 mock provider。

本輪只用假費率（input $1、output $5、TTS $16 每百萬）測試預留邏輯，沒有呼叫任何供應商，沒有讀取任何金鑰。

### F5 展示範圍（已閉合）

P1 切成 C1／C2／C3：C1 是最小循環與關鍵測試，C2 是回播規模與報告，C3 才補其餘故障案例。P2 收斂為一種擷取、一種留言、一個模型、一個 TTS、一個播放器；OCR、prompt caching、Live Studio、虛擬音訊改列條件任務。移除「42 至 50 個工作天」這種會被讀成交期承諾的寫法。

### F6 播放器與瀏覽器連線（P1 部分已做，P2 部分仍開放）

P1 選定同程序 stdin 控制通道，指令 `pause`、`resume`、`stop`、`estop`、`status`，已實作於 `src/control/channel.ts` 並由 replay 的腳本化控制驅動。明確寫出：瀏覽器由程式自行啟動獨立 profile，不接管使用者已開的視窗；`audio.deviceId` 為 null 代表未設定，real 模式啟動失敗，不解讀為系統預設。

仍然開放：實際裝置枚舉、真實播放與強制停止方案，以及 OBS 能否擷取該播放器。這些要等 OS 確定並實機驗證，維持 NOT_TESTED。

## 4. 30 分鐘回播結果

命令：`node dist/src/cli/index.js replay --minutes 30 --out runtime/logs/scenario-a.jsonl`，退出碼 0。

| 指標 | 值 |
| --- | --- |
| 場景時間 | 1801.3 秒（虛擬時鐘） |
| 實際 wall time | 8.5 秒 |
| 模型呼叫 | 104 |
| 播出回覆 | 59 |
| 唯一合格事件 | 122 |
| 被涵蓋事件 | 60 |
| 覆蓋率 | 49.2% |
| 遊戲評論 | 0（另計） |
| 重複播放 | 0 |
| 重疊播放 | 0 |
| 急停後晚到播放 | 0 |

丟棄分類：duplicate 28、timeout 1、rate_limit 1、schema 1、length 1、spend_limit 1。

延遲分段（場景時間，mock provider 的模擬延遲，不是真實延遲）：t1 事件到送模型中位數 562 ms、p95 5553 ms；t2 模型往返固定 900 ms；t3 驗證加 TTS 固定 350 ms；事件到開始播放中位數 1812 ms、p95 6803 ms，樣本 59。

這些數字只說明排程與管線行為。真實模型與真實 TTS 的延遲未量測，驗收項目 1 的 6 秒／12 秒目標在 P2 之前不能宣稱達成。

覆蓋率 49.2% 的原因是節流：每分鐘最多 12 次、最快每 5 秒一次，而 fixture 在 30 分鐘內有 122 個合格事件。報告同時列出分母、丟棄分類與回覆數，不靠丟棄事件美化延遲。

## 5. 可展示的 transcript（節錄）

```
[00:17.5] SAY   「剛剛有人問剛剛是不是可以直接收，第1局先穩住再看下一步。」 -> fixture_primary::m000001 [chat_reply, 28 chars]
[01:29.6] SAY   「漂亮！」 -> fixture_primary::m000006 [chat_reply, 3 chars]
[01:59.0] SAY   「剛剛有人問對面是不是要衝了，第1局先穩住再看下一步。」 -> fixture_primary::m000008 [chat_reply, 26 chars]
[02:05.2] SAY   「剛剛有人問另一個來源說：對面是，第1局先穩住再看下一步。」 -> fixture_secondary::m000008 [chat_reply, 28 chars]
[02:48.4] error model timeout
[03:22.3] SAY   「兩位問的是同一件事，現在還沒到收尾，穩著打還有機會。」 -> fixture_primary::m000123, fixture_primary::m000124 [chat_reply, 26 chars]
[03:28.1] quiet unsafe_input
```

第 4 行與第 3 行是兩個不同來源的同一個 message id，各自被獨立回應，證明去重鍵包含 source。倒數第二行是一句回覆涵蓋兩則留言。最後一行是注入留言，結果是安靜且 `reason_code=unsafe_input`。

完整 transcript 由 `node dist/src/cli/index.js transcript --log <log> --lines <n>` 產生。

## 6. 證據分級

### 6.1 已測試（TESTED，mock 環境，本機執行並附退出碼）

1. 合法安靜不觸發 TTS。
2. 短句（3 字）可播，81 字被擋，80 字通過。
3. 跨來源同 ID 不衝突；同來源重送不重播。
4. 同時最多一個模型呼叫與一個播放；候選槽上界為 1。
5. TTL 內換局後舊評論不播。
6. pause／stop 後的晚到 resolve、reject、finally 不復活也不覆寫狀態；resume 不受舊工作污染。
7. 播放中的 10 次急停皆中斷播放、場景時間內 1 秒完成、無晚到播放。
8. 預算預留不超上限；逾時不釋放保留額；未知費率不啟動付費模式。
9. 覆蓋率不超過 100%，一句涵蓋多則留言時分母與分子都正確。
10. 相同 seed 的回播逐字相同。

共 48 個測試，`npm test` 退出碼 0。

### 6.2 僅設計（REPORTED）

1. 真實 provider adapter 的介面實作（ClaudeModelProvider、AzureTtsProvider）尚未撰寫。
2. 真實播放器、裝置枚舉與強制停止方案尚未選定。
3. 瀏覽器採集與 DOM 留言 adapter 尚未撰寫。
4. 常駐服務模式與本機 IPC 尚未實作。

### 6.3 未測試（NOT_TESTED）

runtime_validation 七個欄位全部維持 NOT_TESTED：capture、chat、model、tts、local_audio、obs_recording、live_reception。本輪沒有開瀏覽器、沒有發出任何聲音、沒有呼叫任何付費供應商、沒有錄影、沒有直播。

特別說明三件 mock 不能證明的事：

1. mock 的靜音 WAV 不是節目聲音。管線接通不等於有可聽的主持聲。
2. MockModelProvider 回傳預先寫好的 JSON，因此注入測試只能證明推論層沒有工具、不可信輸入在資料結構上是隔離的、注入文字不會導致任何指令被執行。它**不能**證明真實模型會抵抗提示注入。
3. 虛擬時鐘跑完 30 分鐘場景只花 8.5 秒實際時間，這不是 30 分鐘實時穩定度測試。

## 7. 下一批範圍與驗收

建議 work_id：ARB-003，維持 C2／C3 或進入 P2，由覆核者決定。

C3 剩餘項目（若先補完 P1）：POC_RUNBOOK 3.2 尚未覆蓋的故障案例（音效裝置消失、連續三次失敗後暫停 30 秒再探測、留言中斷後的遊戲評論續行）、`arb doctor` 對真實檢查的實作。

P2 起手（若放行）：一種擷取、一種留言來源、一個模型、一個 TTS、一個播放器，目標是 10 分鐘可聽見角色回應的本機錄影。開始前需要：作業系統與版本、遊戲頁面 URL 與顯示方式、留言來源、已授權的 TTS 服務與每小時／每場預算上限。

## 8. 自我限制聲明

本報告由執行者撰寫，沒有獨立覆核，decision 為 null，不宣稱 APPROVED，也不合併 PR。本輪沒有啟用付費服務、沒有讀取金鑰或個人登入工作階段、沒有開直播、沒有代玩、沒有新增部署或治理平台。automation 維持 NOT_ENABLED；GitHub 上傳完成不代表任何 agent 已被自動喚醒。
