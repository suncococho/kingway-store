import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  clearPlatformAuth,
  getStoredPlatformToken,
  getStoredPlatformUser,
  platformLogin
} from "../lib/platformAuth";
import SaasAdminPage from "./SaasAdminPage";

function PlatformLoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await platformLogin(form);
      navigate("/platform-admin", { replace: true });
    } catch (submitError) {
      setError(submitError.message || "登入失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>平台管理員登入</h1>
        <p>請使用 SaaS 本社平台管理員帳號登入。</p>
        <label className="form-field">
          <span>電子郵件</span>
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="請輸入平台管理員電子郵件"
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
          {loading ? "登入中..." : "登入平台管理中心"}
        </button>
      </form>
    </div>
  );
}

export function PlatformAdminPage() {
  const navigate = useNavigate();
  const token = getStoredPlatformToken();
  const user = getStoredPlatformUser();
  function handleLogout() {
    clearPlatformAuth();
    navigate("/platform-admin/login", { replace: true });
  }

  if (!token) {
    return <Navigate to="/platform-admin/login" replace />;
  }

  return (
    <main className="page-content">
      <div className="compact-actions" style={{ marginBottom: 16 }}>
        <span className="secondary-button">{user?.displayName || user?.email || "平台管理員"}</span>
        <button type="button" className="secondary-button" onClick={handleLogout}>登出</button>
      </div>
      <SaasAdminPage />
    </main>
  );
}

export default PlatformLoginPage;
