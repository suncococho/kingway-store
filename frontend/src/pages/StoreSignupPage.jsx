import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";

const initialForm = {
  storeName: "",
  ownerName: "",
  phone: "",
  username: "",
  password: "",
  confirmPassword: ""
};

function StoreSignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password.length < 8) {
      setError("密碼至少需要 8 個字元");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("兩次輸入的密碼不一致");
      return;
    }

    setLoading(true);
    try {
      const data = await apiRequest("/store-signup", {
        method: "POST",
        body: JSON.stringify({
          storeName: form.storeName,
          ownerName: form.ownerName,
          phone: form.phone,
          username: form.username,
          password: form.password
        })
      });

      navigate("/login", {
        replace: true,
        state: {
          signupMessage: data.message || "店家帳號已建立，請使用新帳號登入",
          signupUsername: data.username || form.username
        }
      });
    } catch (submitError) {
      setError(submitError.message || "建立店家帳號失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      {loading ? (
        <div className="processing-overlay">
          <div className="loading-state">建立店家帳號中...</div>
        </div>
      ) : null}
      <form className="login-card signup-card" onSubmit={handleSubmit}>
        <h1>建立店家帳號</h1>
        <p>請填寫店家與負責人資料，系統會建立新門市與管理員帳號。</p>
        <label className="form-field">
          <span>店家名稱</span>
          <input
            name="storeName"
            type="text"
            value={form.storeName}
            onChange={handleChange}
            placeholder="請輸入店家名稱"
            autoComplete="organization"
            required
          />
        </label>
        <label className="form-field">
          <span>負責人姓名</span>
          <input
            name="ownerName"
            type="text"
            value={form.ownerName}
            onChange={handleChange}
            placeholder="請輸入負責人姓名"
            autoComplete="name"
            required
          />
        </label>
        <label className="form-field">
          <span>電話</span>
          <input
            name="phone"
            type="tel"
            value={form.phone}
            onChange={handleChange}
            placeholder="請輸入聯絡電話"
            autoComplete="tel"
            required
          />
        </label>
        <label className="form-field">
          <span>登入帳號或 Email</span>
          <input
            name="username"
            type="text"
            value={form.username}
            onChange={handleChange}
            placeholder="請輸入登入帳號或 Email"
            autoComplete="username"
            required
          />
        </label>
        <label className="form-field">
          <span>密碼</span>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            placeholder="至少 8 個字元"
            autoComplete="new-password"
            required
          />
        </label>
        <label className="form-field">
          <span>確認密碼</span>
          <input
            name="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={handleChange}
            placeholder="請再次輸入密碼"
            autoComplete="new-password"
            required
          />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? "建立中..." : "建立店家帳號"}
        </button>
        <Link className="login-secondary-link" to="/login">
          已有帳號，返回登入
        </Link>
      </form>
    </div>
  );
}

export default StoreSignupPage;
