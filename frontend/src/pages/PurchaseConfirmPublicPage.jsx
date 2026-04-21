import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import SignaturePad from "../components/SignaturePad";
import { apiRequest } from "../lib/api";

function PurchaseConfirmPublicPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [signatureData, setSignatureData] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const response = await apiRequest(`/api/purchase-confirmations/public/${token}`);
        setData(response);
      } catch (error) {
        alert(error.message);
      }
    }

    load();
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!signatureData) {
      alert("\u8ACB\u5148\u7C3D\u540D");
      return;
    }

    try {
      await apiRequest(`/api/purchase-confirmations/public/${token}`, {
        method: "POST",
        body: JSON.stringify({ signatureData })
      });
      setSubmitted(true);
    } catch (error) {
      alert(error.message);
    }
  }

  if (!data) {
    return <div className="public-page">Loading...</div>;
  }

  if (submitted) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"\u8CFC\u8ECA\u78BA\u8A8D\u5DF2\u5B8C\u6210"}</h1>
          <p>{"\u611F\u8B1D\u60A8\u5B8C\u6210\u8CFC\u8ECA\u78BA\u8A8D\uFF0CKINGWAY \u5C07\u4FDD\u5B58\u60A8\u7684\u78BA\u8A8D\u7D00\u9304\u3002"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-page">
      <form className="public-card" onSubmit={handleSubmit}>
        <h1>{"\u8CFC\u8ECA\u78BA\u8A8D"}</h1>
        <p>{"\u8ACB\u78BA\u8A8D\u4EE5\u4E0B\u8CC7\u6599\u4E26\u5B8C\u6210\u7C3D\u540D\u9001\u51FA\u3002"}</p>
        <div className="detail-grid">
          <div>{"\u59D3\u540D"}</div>
          <div>{data.customerName}</div>
          <div>{"\u96FB\u8A71"}</div>
          <div>{data.customerPhone || "-"}</div>
          <div>{"\u8A02\u55AE\u7DE8\u865F"}</div>
          <div>{data.orderNo}</div>
        </div>
        <div className="page-section">
          <h2>{"\u8A02\u55AE\u5167\u5BB9"}</h2>
          {data.items.map((item, index) => (
            <div key={index} className="cart-row">
              <div>{item.productName}</div>
              <div>
                {item.quantity} x NT${item.unitPrice}
              </div>
            </div>
          ))}
        </div>
        <div className="page-section">
          <h2>{"\u7C3D\u540D"}</h2>
          <SignaturePad value={signatureData} onChange={setSignatureData} />
        </div>
        <button type="submit" className="primary-button">
          {"\u9001\u51FA\u78BA\u8A8D"}
        </button>
      </form>
    </div>
  );
}

export default PurchaseConfirmPublicPage;
