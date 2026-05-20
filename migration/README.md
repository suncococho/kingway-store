# Migration Commands

Run these commands on the EC2 host from the existing repo checkout:

```bash
cd ~/kingway-store/backend
npm run migrate:products -- /absolute/path/to/wordpress-products.csv
npm run migrate:verify
```

To import from a WordPress/WooCommerce SQL dump instead of CSV:

```bash
cd ~/kingway-store/backend
npm run migrate:products -- /absolute/path/to/wordpress-dump.sql
npm run migrate:verify
```

To import supplier settlement CSV rows into `orders` and `order_items`:

```bash
cd ~/kingway-store/backend
npm run migrate:orders-csv -- /absolute/path/to/supplier-settlement.csv
```

# Notes

- `migrate:products` upserts by `sku` and maps categories into `EBIKE`, `REPAIR`, `ACCESSORY`, or `OTHER`.
- `migrate:verify` prints product totals, category totals, duplicate SKU checks, and the newest 20 products.
- `migrate:orders-csv` matches products by SKU first, then by name, and creates placeholder products when a SKU or product name is missing from the current catalog.
- The order CSV importer needs at least one active row in `staff_users` because `orders.created_by` is mandatory.

# Docker MySQL Fallback

If you need to load a raw SQL dump into MySQL directly before running the verification script, use the existing container:

```bash
docker exec -i kingway-mysql mysql -ukingway -pkingway kingway_store < /absolute/path/to/file.sql
```

Then verify:

```bash
cd ~/kingway-store/backend
npm run migrate:verify
```
