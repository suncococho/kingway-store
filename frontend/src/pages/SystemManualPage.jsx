import PageHeader from "../components/PageHeader";

const sections = [
  {
    title: "系統總覽",
    body: "KINGWAY POS 將門市營運、LINE 預約、通知中心、訊息中心、每日任務、供應商、出貨入庫與 KPI 參考統計整合在同一個後台。"
  },
  {
    title: "門市類型與權限",
    body: "直營店與加盟店使用門市請貨、門市入庫與日常營運功能；本部使用本部請貨管理、本部出貨、本部月結與本部出貨明細；獨立店可使用自己的供應商發注、入庫、退貨與月結。"
  },
  {
    title: "通知中心",
    body: "通知中心用於顯示系統自動產生的待處理事項，例如 LINE 訂單預約、LINE 維修預約、購買確認書提交、門市請貨、本部出貨、每日任務逾期等。員工處理完成後，請按下完成，系統會記錄處理人員並計入 KPI 參考統計。"
  },
  {
    title: "訊息中心",
    body: "訊息中心用於本部與門市之間傳遞內部訊息。本部可發送給全部門市或指定門市；門市可回報問題或向本部詢問。"
  },
  {
    title: "今日任務",
    body: "今日任務是每位員工每日應完成的工作清單，例如開店清潔、電池充電確認、展示車整理、未處理通知確認、關店安全檢查等。完成後會記錄處理人員與時間。"
  },
  {
    title: "每日任務設定",
    body: "管理者可建立、啟用、停用與調整每日任務。不要重複建立同一組預設任務，避免員工看到重複工作。"
  },
  {
    title: "LINE 通知設定",
    body: "LINE 通知設定用於設定員工 LINE 群組與供應商 LINE 群組。目前測試通知以 dry-run 為主，避免誤發訊息。客戶 LINE push 會盡量減少，優先使用 POS 通知中心處理。"
  },
  {
    title: "供應商管理",
    body: "供應商管理用於供應商發注、入庫、退貨與供應商月結。直營店與加盟店原則上使用門市請貨，不直接使用供應商管理。"
  },
  {
    title: "門市請貨",
    body: "門市請貨是門市向本部申請補貨。送出後本部會在本部請貨管理中處理；送出請貨本身不會改變庫存。"
  },
  {
    title: "本部請貨管理",
    body: "本部請貨管理用於查看門市補貨申請並建立本部出貨單。建立本部出貨單不扣庫存；建立並確認出貨會立即扣本部庫存。"
  },
  {
    title: "本部出貨",
    body: "本部出貨是實際扣除本部庫存的動作。按下確認出貨後，本部庫存會立即扣除，門市需再到門市入庫確認收到商品。"
  },
  {
    title: "門市入庫",
    body: "門市入庫是門市確認收到本部出貨商品的動作。確認後門市庫存會增加。"
  },
  {
    title: "本部月結 / 本部出貨明細",
    body: "本部月結用於整理本部供貨應收與門市應付。本部出貨明細可查詢批發價、出貨數量與 Excel 匯出。"
  },
  {
    title: "訂單管理",
    body: "訂單管理用於查看 LINE 訂單預約、POS 訂單與付款狀態。購買確認書、尾款、交車流程需依訂單狀態逐步處理。"
  },
  {
    title: "維修管理",
    body: "維修管理用於處理 LINE 維修預約、維修報價、維修完成與取車通知。維修完成通知與報價確認連結屬於必要客戶通知。"
  },
  {
    title: "購買確認書 / 維修完成確認書",
    body: "客戶提交購買確認書或維修完成確認書後，系統會建立 POS 通知；員工完成處理後應在通知中心按完成。"
  },
  {
    title: "KPI / 評價",
    body: "KPI / 評價為員工作業紀錄的參考統計，包含每日任務、通知處理、訊息讀取、出貨入庫、供應商處理等紀錄。此功能是管理參考，不是自動人事評分。"
  },
  {
    title: "LINE 客戶通知注意事項",
    body: "客戶 LINE push 需控制用量。訂單預約完成與尾款完成等重複通知已改由畫面成功訊息與 POS 通知中心處理；購買確認書連結、報價確認、取車通知等必要客戶通知仍保留。"
  },
  {
    title: "常見錯誤與注意事項",
    body: "不要把本部請貨管理與本部出貨混用；不要在未收到商品前確認門市入庫；通知處理完成後要按完成；LINE groupId 不要填成客戶個人 LINE ID。"
  }
];

function SystemManualPage() {
  return (
    <div className="page-stack">
      <PageHeader title="KINGWAY 系統使用手冊" description="供員工快速確認門市、本部、通知、訊息、每日任務、LINE 與 KPI 的操作原則。" />
      <section className="manual-section-grid">
        {sections.map((section, index) => (
          <article key={section.title} className="content-card section-panel manual-section-card">
            <div className="manual-section-index">{String(index + 1).padStart(2, "0")}</div>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

export default SystemManualPage;
