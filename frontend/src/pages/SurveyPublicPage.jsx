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
        const response = await apiRequest(`/api/surveys/public/${token}`);
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
      await apiRequest(`/api/surveys/public/${token}`, {
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
    return <div className="public-page">Loading...</div>;
  }

  if (submitted) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"\u554F\u5377\u5DF2\u9001\u51FA"}</h1>
          <p>{"\u8B1D\u8B1D\u60A8\u7684\u56DE\u994B\uFF0C\u795D\u60A8\u9A0E\u4E58\u6109\u5FEB\u3002"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-page">
      <form className="public-card" onSubmit={handleSubmit}>
        <h1>{"\u9867\u5BA2\u6EFF\u610F\u5EA6\u554F\u5377"}</h1>
        <p>{`${data.customerName} \u60A8\u597D\uFF0C\u6B61\u8FCE\u586B\u5BEB\u672C\u6B21\u670D\u52D9\u6EFF\u610F\u5EA6\u3002`}</p>
        <label className="form-field">
          <span>{"\u8A55\u5206"}</span>
          <select value={rating} onChange={(event) => setRating(event.target.value)}>
            <option value="5">5</option>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1</option>
          </select>
        </label>
        <label className="form-field">
          <span>{"\u610F\u898B\u56DE\u994B"}</span>
          <textarea rows="5" value={feedback} onChange={(event) => setFeedback(event.target.value)} />
        </label>
        <button type="submit" className="primary-button">
          {"\u9001\u51FA\u554F\u5377"}
        </button>
      </form>
    </div>
  );
}

export default SurveyPublicPage;
