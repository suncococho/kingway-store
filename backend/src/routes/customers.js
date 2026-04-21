const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

router.get("/", authorize(["ADMIN", "MANAGER", "CASHIER"]), async (req, res, next) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;
    let sql = `
      SELECT
        id,
        name,
        phone,
        line_user_id AS lineUserId,
        notes,
        created_at AS createdAt
      FROM customers
    `;
    const params = [];

    if (search) {
      sql += " WHERE name LIKE ? OR phone LIKE ? OR line_user_id LIKE ? ";
      params.push(search, search, search);
    }

    sql += " ORDER BY id DESC";

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/", authorize(["ADMIN", "MANAGER", "CASHIER"]), async (req, res, next) => {
  try {
    const { name, phone, lineUserId, notes } = req.body;

    if (!name) {
      return res.status(400).json({ message: "name is required" });
    }

    const [result] = await pool.query(
      `
        INSERT INTO customers (name, phone, line_user_id, notes)
        VALUES (?, ?, ?, ?)
      `,
      [name, phone || null, lineUserId || null, notes || null]
    );

    return res.status(201).json({
      id: result.insertId,
      name,
      phone: phone || null,
      lineUserId: lineUserId || null,
      notes: notes || null
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "lineUserId already bound";
    }
    return next(error);
  }
});

router.patch("/:id", authorize(["ADMIN", "MANAGER", "CASHIER"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, phone, lineUserId, notes } = req.body;

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name);
    }

    if (phone !== undefined) {
      updates.push("phone = ?");
      values.push(phone);
    }

    if (lineUserId !== undefined) {
      updates.push("line_user_id = ?");
      values.push(lineUserId);
    }

    if (notes !== undefined) {
      updates.push("notes = ?");
      values.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    values.push(id);
    await pool.query(`UPDATE customers SET ${updates.join(", ")} WHERE id = ?`, values);

    const [rows] = await pool.query(
      `
        SELECT
          id,
          name,
          phone,
          line_user_id AS lineUserId,
          notes,
          created_at AS createdAt
        FROM customers
        WHERE id = ?
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.json(rows[0]);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "lineUserId already bound";
    }
    return next(error);
  }
});

module.exports = router;
