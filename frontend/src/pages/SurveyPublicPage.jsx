import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";

function SurveyPublicPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [rating, setRating] = useState("5");
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const response = await apiRequest(`/surveys/public/${token}`);
        setData(response);
      } catch (error) {
        alert(error.message);
      }
    }

    load();
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      await apiRequest(`/surveys/public/${token}`, {
        method: "POST",
        body: JSON.stringify({
          rating: Number(rating),
          feedback
        })
      });
      setSubmitted(true);
    } catch (error) {
      alert(error.message);
    }
  }

  if (!data) {
    return <div className="public-page">載入中...</div>;
  }

  if (submitted) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"問卷已送出"}</h1>
          <p>{"謝謝您的回饋，祝您騎乘愉快。"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-page">
      <form className="public-card" onSubmit={handleSubmit}>
        <h1>{"顧客滿意度問卷"}</h1>
        <p>{`${data.customerName} 您好，歡迎填寫本次服務滿意度。`}</p>
        <label className="form-field">
          <span>{"評分"}</span>
          <select value={rating} onChange={(event) => setRating(event.target.value)}>
            <option value="5">5</option>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1</option>
          </select>
        </label>
        <label className="form-field">
          <span>{"意見回饋"}</span>
          <textarea rows="5" value={feedback} onChange={(event) => setFeedback(event.target.value)} />
        </label>
        <button type="submit" className="primary-button">
          {"送出問卷"}
        </button>
      </form>
    </div>
  );
}

export default SurveyPublicPage;
