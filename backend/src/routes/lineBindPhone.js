const express = require("express");
const {
  bindPhoneAndIssueNewFriendCoupon
} = require("../services/lineWorkflowService");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const lineUserId = String(req.body.lineUserId || "").trim();
    const phone = String(req.body.phone || "").replace(/\D/g, "");

    if (!lineUserId) {
      return res.status(400).json({ message: "缺少 LINE 使用者資料" });
    }

    if (!/^09\d{8}$/.test(phone)) {
      return res.status(400).json({ message: "請輸入正確手機號碼，例如 0912345678" });
    }

    const result = await bindPhoneAndIssueNewFriendCoupon(lineUserId, phone);

    return res.json({
      ok: true,
      phone,
      couponCode: result?.couponCode || null
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
