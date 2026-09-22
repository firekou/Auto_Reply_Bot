# ARB-001 獨立覆核 R1
日期：2026-09-22
角色：GPT reviewer
決定：APPROVED_WITH_CONDITIONS
範圍：詳細規劃方向通過；只可依下列修正條件推進 mock 最小實作。不是實機、付費或直播放行，不代表 PR 可直接合併。

## 固定審查範圍
- repository：firekou/Auto_Reply_Bot
- PR：[#1](https://github.com/firekou/Auto_Reply_Bot/pull/1)，讀取時 open、draft、未合併、mergeable=true。
- base_sha：ac94f768d246fe7222fdc94a6d08961e6bfe2fc2
- content_head：be87c7724a956f2e2033242bd06f35ee349ebef5
- reviewed_head：7a791e28ace60610acaf61e15b3a8e46588e19ec
- reviewer_only_head：null，由寫入本報告的 commit 識別，不自引用。
- source range：base_sha...reviewed_head，共 README、三份設計文件、執行報告與 ledger 六個變更檔案。
- content_head 至 reviewed_head 的 diff 只有報告及 ledger 證據欄位、格式及 PR 位置，未改設計。
- 檢查執行記錄：check-runs=0、workflow_runs=0，無 review 或留言。這是文件 PR，沒有程式可跑，不能將無 CI 當測試通過。
- commands_and_exit_codes：[]。本輪使用 GitHub API 讀檔、diff 與狀態，以及官方文件覆核，未執行 repository 建置或實機測試。
- executor 原始證據未修改。其 git 命令退出碼維持 REPORTED，未冒稱本 reviewer 重跑。
- 分支名不同不影響交付，接受現有 claude/hopeful-archimedes-bf57bo，不要求改名。

## 結論與距離目標
方向沒有偏離：本機讀畫面及留言、依角色回話、語音播放、OBS 輸出的分工已具體化。五個 adapter 與 mock/real 區分可作實作起點。
但目前仍是 P0 詳細設計，沒有可執行程式、真實回覆、聲音或錄影；不能給虛構完成百分比。
下一步要做小型可重播循環，之後只接一個真實來源與一個聲音，盡早取得能看、能聽的 OBS 本地錄影。先不要把所有後備方案做完才展示。

## 必須修正的發現

### F1 高：正常安靜與短句會被驗證規則誤擋
位置：IMPLEMENTATION_DESIGN 4.4，原 config speech.target_min_characters。
表格寫所有回覆都需 1 至 3 句、20 至 80 字，任一失敗即丟棄；但下一段允許 speak=false、utterance=""。若照表實作，正常安靜會變成驗證錯誤。原規劃的 20 字是常態目標，不是硬下限，「漂亮！」等有效短反應也應能播放。
修正：先驗 schema/ID，再分支。speak=false 僅接受空文字與空引用，直接回 IDLE，不呼叫 TTS、不計 provider failure。speak=true 需非空、1 至 3 句、最多 80 字；20 字保留目標值。明定 Unicode 計數及空白規則。
驗收：合法安靜、短句、81 字、空發言與無效 silence payload 各有案例。

### F2 高：局面改變不等於 TTL 到期，取消後 callback 亦可能改回狀態
位置：IMPLEMENTATION_DESIGN 4.3、4.5、4.6、4.7。
sessionGeneration 遞增原因沒有換局，Observation 也沒有場景版本。反例：第 0 秒擷取舊局，第 2 秒換局，第 4 秒回覆返回；仍在 12 秒 TTL 內，epoch 相同，舊局評論可能照播。僅有 frameHash 不提供何時判定換局的規則。
另一缺口是 PAUSED/STOPPED 後，舊生成工作進入 finally/catch，若套用「取消→IDLE」就可能覆蓋人工停止。三道播放前檢查不足以規範所有狀態回寫。
修正：定義 contextVersion/roundId 或等價失效機制，來源確定換局時取消相關舊觀測；fixture 可提供換局事件，真實畫面識別仍待驗證，不假定每張 hash 改變都是換局。所有非同步完成、錯誤及 finally 修改狀態前都檢查工作 ID 和 generation。stopNow 不得成為阻塞取消其餘工作的無限 await。
验收：TTL 內換局、pause 後 resolve/reject、stop 後 finally、resume 後舊工作返回，均不播舊內容、不改掉新狀態。

### F3 中：串行流程卻描述待播回覆替換，且尚未界定可回答事件
位置：IMPLEMENTATION_DESIGN 4.5、4.7；POC_RUNBOOK 3。
PLAYING 時禁止 GENERATING，整條流程串行，實際需要的是「至多一筆候選觀測」，不是持續產生待播回覆。排程以「可回答」作前置條件，但目前沒有定義由誰判斷；圖 hash 變化也不能證明是有意義遊戲事件。
修正：首版選串行，採集可繼續；候選槽至多一筆，按最新有效事件更新，播放完才生成。穩定去重 key 使用 source+messageId，分開 seen/selected/spoken；spoke 在實際播放開始記錄，避免驗證失敗就永久吃掉所有候選。定義本機粗篩与模型 speak 決策的邊界。
覆蓋率應為「至少被一段已播放回覆涵蓋的唯一合格事件數 / 唯一合格事件數」，遊戲評論另算。不可用全部 utterance 數除留言數，造成超過 100% 或重複計分。
驗收：兩來源同 ID、播放中突發留言、同回覆涵蓋多留言、只有遊戲評論，分母與候選上限都正確。

### F4 中：成本算式正確，但一般情境被錯稱硬上界
位置：IMPLEMENTATION_DESIGN 7.1；IMPLEMENTATION_BACKLOG 5；執行報告 4.2。
720 × (2200 × 1 + 120 × 5) / 1,000,000 = $2.016，符合表格的指定情境。
但設定允許兩張圖、更大圖片、最多 180 output token、更多參考與歷史，表格只用一張圖及 120 output，故不能稱最壞情況或保證實際更低。
即使文字仍假設 1500 token，只改為兩張 1280x720 及 output 180，在相同單價下就是 $3.45024/小時，已高於所稱 $2 上界；這個反例仍不是完整上界。
修正：改稱「情境估算」，將含所有輸入、結構化額外提示、output 預留、TTS、cache 寫入與未知用量的預算保留算法獨立寫清楚。先預留，完成後結算；逾時不假定零費用。未知費率不啟動付費模式。
驗收：P1 用假費率證明預留不可超上限；P2 固定 model ID、SDK 版本及費率來源後才計真實成本。SDK 自動重試也要明確關閉，不能只有 director 寫「不重試」。

### F5 中：第一個展示被非必要後備工作拖長
位置：IMPLEMENTATION_BACKLOG P1/P2/P3。
文件給 P1 14 至 16 天、P2 18 至 22 天、P3 10 至 12 天，合計 42 至 50 個工作天的規劃範圍。這不是有實作根據的工期承諾，且 OCR、cache 評估、第二直播工具及音訊後備不應成為第一版展示的必要依賴。
修正：ARB-002 先交一個完整 mock 循環及 F1 至 F4 對應測試，再補 30 分鐘回播。P2 先做一種擷取、一種留言、一個模型、一個 TTS、一個播放器；OCR/cache/Live Studio/虛擬裝置按主路徑失敗或必要性再排入。
首個真正節目驗收是可聽見角色回應的本機錄影，mock 靜音檔只證明管線，不能算節目成品。

### F6 中，P2 前：播放器與瀏覽器連線仍缺具體實作選項
位置：IMPLEMENTATION_DESIGN 1.1、4.1、4.2、6.1；POC_RUNBOOK 4。
文件同時使用「單一 Node 程序」及「播放器程序」，尚未選套件/子程序，也未解釋 CLI 如何向運行中服務發出 pause/stop。adapter 介面有用，但不是已選定可行音訊實作。
修正：P1 定義最小控制通道及停止流程；P2 根據實際 OS 選一種裝置枚舉、播放與強制停止方案。明定 browser 為程式啟動的獨立 profile，或本機受限連線；不要假定能接管任意已開瀏覽器。device_id=null 的預設語義與「不使用系統預設」需一致。
OBS 擷取該播放器是否可行要實錄。不能憑 Node 與 Playwright 可用，推論音訊急停已成立。

## 不阻擋 mock 的補正
- Grok Bot 官方文件確實描述雲端電腦；只能結論為「本輪未找到本機音效橋接證據，因此暫不納入」，不能從未記載直接推論永遠不能串接。
- 系統內建聲音自然度不合格的說法未盲聽，應標待評估；也不必為此另做大型選型。
- 跨來源 iframe 不應一律與 DRM 等同；應按實際可擷取性判定。相同 hash 可能只是靜態場景，不能單憑不變就判斷來源已斷線。
- mock 預設固定 JSON 回覆，不能證明模型真的理解畫面或抵抗提示注入。可驗的是工具不存在、輸入隔離及不執行指令；真實語意測試留 P2。
- 既有五個設備/聲音問題不阻擋 mock，無須現在停工等人回答。

## 官方資料獨立覆核
本輪只查證影響決策的下列內容，不宣稱執行者整張來源表全部已獨立驗證。
- [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision)：已見圖片格式、尺寸與 visual token 公式；成本反例依該公式及文件候選尺寸計算。
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)：已確認部分長度約束不支援，需本機驗證；不代表目前本機驗證表已無矛盾。
- [Claude pricing](https://claude.com/pricing)：讀取時 Haiku 4.5、Sonnet 5、Opus 5 標準 input/output 單價與表格一致。費率正確不會讓情境估算變硬上限。
- [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)：已確認月費限制與一般速率限制的區分；仍需處理 SDK retry。
- [Azure voice support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)：已見三個 zh-TW Standard 語音，支持候選，未驗證聲音品質。
- [Grok Bot overview](https://docs.x.ai/grok-bot/overview)：已見 persistent cloud computer 描述，未取得本機音效能力證據。

## 下一步及放行範圍
- ARB-001：APPROVED_WITH_CONDITIONS。F1 至 F5 應在下一批設計修正及程式中閉合，不必再花一整輪只做文件。
- ARB-002：可按附帶 prompt 進行 mock 最小實作及上述修正；不以原 16 任務全部完成才交第一個 checkpoint。
- P2/付費/本機/直播：尚未放行，F4/F6 與實機資訊需先具體化。
- PR #1 保留 draft，不合併。下一輪在同分支先修正文檔，實作保持可區分 commit，交 exact head 供 review。
- prompt：prompts/CLAUDE_ARB002_IMPLEMENTATION_PROMPT.md
- invalidates_when：被審查內容改變、聲稱的能力被推翻，或擴展到真實供應商/直播。
