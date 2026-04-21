const express = require("express");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { TAIPEI_TZ } = require("../services/reportService");
const { createError } = require("../utils/errors");
const { logKpi } = require("../services/kpiService");

dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER", "CASHIER"]));

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          o.id,
          o.order_no AS orderNo,
          o.business_date AS businessDate,
          o.total_amount AS totalAmount,
          o.customer_name AS customerNameSnapshot,
          o.customer_phone AS customerPhoneSnapshot,
          o.payment_method AS paymentMethod,
          o.status,
          o.notes,
          o.created_at AS createdAt,
          c.id AS customerId,
          c.name AS customerName,
          s.id AS staffId,
          s.display_name AS staffName
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        INNER JOIN staff_users s ON s.id = o.created_by
        ORDER BY o.id DESC
        LIMIT 100
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      customerId,
      customer_name: customerNameInput,
      customer_phone: customerPhoneInput,
      customerName,
      customerPhone,
      paymentMethod,
      notes,
      items
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items are required" });
    }

    const order = await withTransaction(async (connection) => {
      let resolvedCustomerId = customerId ? Number(customerId) : null;
      const resolvedCustomerName = customerNameInput || customerName || null;
      const resolvedCustomerPhone = customerPhoneInput || customerPhone || null;

      if (!resolvedCustomerId && (resolvedCustomerName || resolvedCustomerPhone)) {
        const [matches] = await connection.query(
          `
            SELECT id
            FROM customers
            WHERE (? IS NOT NULL AND phone = ?) OR (? IS NOT NULL AND name = ?)
            ORDER BY id DESC
            LIMIT 1
          `,
          [resolvedCustomerPhone, resolvedCustomerPhone, resolvedCustomerName, resolvedCustomerName]
        );

        if (matches[0]) {
          resolvedCustomerId = matches[0].id;
        } else {
          const [customerResult] = await connection.query(
            `
              INSERT INTO customers (name, phone)
              VALUES (?, ?)
            `,
            [resolvedCustomerName || "POS Customer", resolvedCustomerPhone || null]
          );
          resolvedCustomerId = customerResult.insertId;
        }
      }

      const mergedItems = new Map();
      for (const item of items) {
        const productId = Number(item.productId || item.product_id);
        const quantity = Number(item.quantity || item.qty);

        if (!Number.isInteger(productId) || !Number.isInteger(quantity)) {
          throw createError("Each item must include integer productId and quantity", 400);
        }

        const existing = mergedItems.get(productId);
        if (existing) {
          existing.quantity += quantity;
          if (item.unitPrice !== undefined) {
            existing.unitPrice = Number(item.unitPrice);
          }
        } else {
          mergedItems.set(productId, {
            productId,
            quantity,
            unitPrice: item.unitPrice !== undefined ? Number(item.unitPrice) : undefined
          });
        }
      }

      const itemList = Array.from(mergedItems.values());
      const productIds = itemList.map((item) => item.productId);
      const [products] = await connection.query(
        `
          SELECT id, sku, name, category, price, stock, is_active
          FROM products
          WHERE id IN (?)
          FOR UPDATE
        `,
        [productIds]
      );

      if (products.length !== productIds.length) {
        throw createError("One or more products were not found", 400);
      }

      const productMap = new Map(products.map((product) => [product.id, product]));
      let totalAmount = 0;
      const normalizedItems = [];

      for (const item of itemList) {
        const product = productMap.get(item.productId);
        const quantity = Number(item.quantity);

        if (!product || !product.is_active) {
          throw createError(`Product ${item.productId} is unavailable`, 400);
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw createError(`Invalid quantity for product ${item.productId}`, 400);
        }

        if (product.stock < quantity) {
          throw createError(`Insufficient stock for ${product.sku}`, 409);
        }

        const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : Number(product.price);
        const lineTotal = unitPrice * quantity;
        totalAmount += lineTotal;

        normalizedItems.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          category: product.category,
          quantity,
          unitPrice,
          lineTotal
        });
      }

      const businessDate = dayjs().tz(TAIPEI_TZ).format("YYYY-MM-DD");
      const orderNo = `POS-${dayjs().tz(TAIPEI_TZ).format("YYYYMMDD-HHmmss-SSS")}`;
      const [orderResult] = await connection.query(
        `
          INSERT INTO orders (
            order_no,
            customer_id,
            customer_name,
            customer_phone,
            total_amount,
            payment_method,
            status,
            notes,
            created_by,
            business_date
          )
          VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)
        `,
        [
          orderNo,
          resolvedCustomerId || null,
          resolvedCustomerName,
          resolvedCustomerPhone,
          totalAmount,
          paymentMethod || "CASH",
          notes || null,
          req.user.id,
          businessDate
        ]
      );

      for (const item of normalizedItems) {
        await connection.query(
          `
            INSERT INTO order_items (
              order_id,
              product_id,
              sku_snapshot,
              product_name_snapshot,
              product_category_snapshot,
              quantity,
              unit_price,
              line_total
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            orderResult.insertId,
            item.productId,
            item.sku,
            item.name,
            item.category,
            item.quantity,
            item.unitPrice,
            item.lineTotal
          ]
        );

        await connection.query(
          `
            UPDATE products
            SET stock = stock - ?
            WHERE id = ?
          `,
          [item.quantity, item.productId]
        );

        await connection.query(
          `
            INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
            VALUES (?, 'SALE', ?, 'ORDER', ?, ?, ?)
          `,
          [item.productId, -item.quantity, orderResult.insertId, req.user.id, `Auto deduction for ${orderNo}`]
        );
      }

      return {
        id: orderResult.insertId,
        orderNo,
        businessDate,
        totalAmount,
        customerId: resolvedCustomerId,
        customerName: resolvedCustomerName,
        customerPhone: resolvedCustomerPhone,
        items: normalizedItems
      };
    });

    await logKpi(req.user.id, "ORDER_CREATED", "ORDER", order.id, 2);
    return res.status(201).json(order);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
