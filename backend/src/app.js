const path = require("path");
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const config = require("./config");
const { pool } = require("./db");
const authRoutes = require("./routes/auth");
const staffRoutes = require("./routes/staff");
const customerRoutes = require("./routes/customers");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");
const lineRoutes = require("./routes/line");
const dashboardRoutes = require("./routes/dashboard");
const inventoryRoutes = require("./routes/inventory");
const purchaseConfirmationRoutes = require("./routes/purchaseConfirmations");
const repairRoutes = require("./routes/repairs");
const couponRoutes = require("./routes/coupons");
const surveyRoutes = require("./routes/surveys");
const attendanceRoutes = require("./routes/attendance");
const kpiRoutes = require("./routes/kpi");
const payrollRoutes = require("./routes/payroll");
const { errorHandler } = require("./middleware/errorHandler");
const { sendDailyReport, TAIPEI_TZ } = require("./services/reportService");

const app = express();

app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    }
  })
);

app.get("/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.use("/api", authRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/purchase-confirmations", purchaseConfirmationRoutes);
app.use("/api/repairs", repairRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/surveys", surveyRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/kpi", kpiRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/line", lineRoutes);
app.use("/files", express.static(path.join(__dirname, "..", "storage")));

cron.schedule(
  "0 21 * * *",
  async () => {
    try {
      const result = await sendDailyReport(config);
      console.log(`Daily report finished. Delivered: ${result.delivered}`);
    } catch (error) {
      console.error("Daily report failed:", error.message);
    }
  },
  { timezone: TAIPEI_TZ }
);

app.use(errorHandler);

module.exports = app;
