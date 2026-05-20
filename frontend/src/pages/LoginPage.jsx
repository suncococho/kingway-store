import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { storeAuth } from "../lib/auth";
import { isMobileViewport, markMobileQuickActionPending } from "../lib/mobileQuickAction";
import { getDefaultRouteForUser } from "../lib/permissions";

function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    password: ""
  });
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
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/login", {
        method: "POST",
        body: JSON.stringify(form)
      });

      storeAuth(data.token, data.user);
      if (isMobileViewport()) {
        markMobileQuickActionPending();
      }
      navigate(getDefaultRouteForUser(data.user), { replace: true });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>後台登入</h1>
        <p>請使用員工帳號登入門市管理系統。</p>
        <label className="form-field">
          <span>帳號</span>
          <input
            name="username"
            type="text"
            value={form.username}
            onChange={handleChange}
            placeholder="請輸入帳號"
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
            placeholder="請輸入密碼"
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? "登入中..." : "登入"}
        </button>
      </form>
    </div>
  );
}

export default LoginPage;
