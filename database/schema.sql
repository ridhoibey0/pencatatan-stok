-- =====================================================================
-- NERVA - Inventory Management System
-- Database schema (MySQL 8.0 / MariaDB 10.5+)
--
-- Naming conventions:
--   * tables        : snake_case, plural            (products, order_items)
--   * primary key   : id, BIGINT UNSIGNED           (never id_product)
--   * foreign key   : <singular_table>_id           (product_id, user_id)
--   * booleans      : is_* prefix                   (is_active)
--   * timestamps    : *_at for datetime, *_date for date
--   * money         : DECIMAL, never FLOAT
--   * enums         : lowercase snake_case values
--
-- Tables are ordered by dependency; run top to bottom.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS nerva
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nerva;

-- =====================================================================
-- A. USERS & MASTER DATA
-- =====================================================================

CREATE TABLE users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  username      VARCHAR(50)  NOT NULL,
  password      VARCHAR(255) NOT NULL,          -- bcrypt / argon2 hash
  role          ENUM('owner','warehouse','host','admin') NOT NULL DEFAULT 'warehouse',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME     NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_unique (username)
) ENGINE=InnoDB;

CREATE TABLE categories (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(50) NOT NULL,
  is_active  TINYINT(1)  NOT NULL DEFAULT 1,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY categories_name_unique (name)
) ENGINE=InnoDB;

CREATE TABLE products (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id BIGINT UNSIGNED NOT NULL,
  code        VARCHAR(30)   NOT NULL,
  name        VARCHAR(200)  NOT NULL,
  base_price  DECIMAL(12,2) NOT NULL DEFAULT 0,  -- default price, overridable per variant
  image_path  VARCHAR(255)  NULL,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY products_code_unique (code),
  KEY products_category_id_index (category_id),
  CONSTRAINT products_category_id_foreign FOREIGN KEY (category_id)
    REFERENCES categories (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- The variant (SKU) is the stock-keeping unit.
-- stock_on_hand is a CACHED value; the source of truth is stock_movements.
CREATE TABLE product_variants (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id      BIGINT UNSIGNED NOT NULL,
  sku             VARCHAR(40)   NOT NULL,
  size            VARCHAR(10)   NULL,
  color           VARCHAR(30)   NULL,
  barcode         VARCHAR(40)   NULL,
  price           DECIMAL(12,2) NULL,              -- NULL = inherit products.base_price
  stock_on_hand   INT           NOT NULL DEFAULT 0,
  reorder_point   INT           NOT NULL DEFAULT 0, -- low-stock threshold
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY product_variants_sku_unique (sku),
  UNIQUE KEY product_variants_combination_unique (product_id, size, color),
  KEY product_variants_barcode_index (barcode),
  KEY product_variants_stock_on_hand_index (stock_on_hand),
  CONSTRAINT product_variants_product_id_foreign FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE RESTRICT
  -- Deliberately NO "stock_on_hand >= 0" check. Sales are recorded as a recap
  -- after the fact, so a shortfall means the records were wrong, not that the
  -- sale is invalid. Blocking the entry would push staff to invent numbers.
  -- Negative stock is allowed, flagged via stock_alerts, and cleared by a count.
) ENGINE=InnoDB;

-- A table rather than an ENUM, so adding a marketplace needs no ALTER TABLE.
CREATE TABLE sales_channels (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(50) NOT NULL,
  is_active  TINYINT(1)  NOT NULL DEFAULT 1,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY sales_channels_name_unique (name)
) ENGINE=InnoDB;

-- Maps a marketplace's own SKU identifier to our variant.
--
-- Needed because the seller SKU in the export ("T014") identifies the PRODUCT,
-- not the variant -- T014 appears as S, M, L and XL. The platform's numeric
-- "SKU ID" is what is unique per variant, so that is the join key.
-- Rows are created once, by hand, on a mapping screen.
CREATE TABLE channel_sku_mappings (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_channel_id   BIGINT UNSIGNED NOT NULL,
  product_variant_id BIGINT UNSIGNED NOT NULL,
  channel_sku_id     VARCHAR(50)  NOT NULL,   -- e.g. TikTok "SKU ID"
  channel_seller_sku VARCHAR(50)  NULL,       -- e.g. "T014", for reference only
  channel_variation  VARCHAR(100) NULL,       -- e.g. "Hitam, M", for reference only
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY channel_sku_mappings_unique (sales_channel_id, channel_sku_id),
  KEY channel_sku_mappings_product_variant_id_index (product_variant_id),
  CONSTRAINT channel_sku_mappings_sales_channel_id_foreign FOREIGN KEY (sales_channel_id)
    REFERENCES sales_channels (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT channel_sku_mappings_product_variant_id_foreign FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- One row per uploaded export file, so an import can be traced and repeated
-- safely. Re-importing the same file must never deduct stock twice.
CREATE TABLE import_batches (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_channel_id BIGINT UNSIGNED NOT NULL,
  file_name        VARCHAR(255) NOT NULL,
  file_hash        CHAR(64)     NULL,        -- sha256, to detect a repeat upload
  row_count        INT          NOT NULL DEFAULT 0,
  created_count    INT          NOT NULL DEFAULT 0,
  updated_count    INT          NOT NULL DEFAULT 0,
  skipped_count    INT          NOT NULL DEFAULT 0,
  status           ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  error_log        JSON         NULL,
  imported_by      BIGINT UNSIGNED NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY import_batches_channel_index (sales_channel_id, created_at),
  CONSTRAINT import_batches_sales_channel_id_foreign FOREIGN KEY (sales_channel_id)
    REFERENCES sales_channels (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT import_batches_imported_by_foreign FOREIGN KEY (imported_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- Garment workshops that produce finished goods (konveksi).
CREATE TABLE manufacturers (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,
  phone      VARCHAR(20)  NULL,
  address    VARCHAR(255) NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY manufacturers_name_unique (name)
) ENGINE=InnoDB;

CREATE TABLE suppliers (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,
  phone      VARCHAR(20)  NULL,
  address    VARCHAR(255) NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY suppliers_name_unique (name)
) ENGINE=InnoDB;

CREATE TABLE materials (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(30)   NOT NULL,
  name           VARCHAR(100)  NOT NULL,
  type           ENUM('fabric','accessory','packaging','other') NOT NULL DEFAULT 'fabric',
  unit           VARCHAR(20)   NOT NULL,            -- meter, pcs, roll
  stock_on_hand  DECIMAL(12,2) NOT NULL DEFAULT 0,  -- CACHED, source: material_movements
  reorder_point  DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY materials_code_unique (code)
  -- No non-negative check, same reasoning as product_variants.
) ENGINE=InnoDB;

-- =====================================================================
-- B. SALES  (source of outbound stock)
-- =====================================================================

CREATE TABLE orders (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_number     VARCHAR(50)     NOT NULL,   -- marketplace order id; KEEP AS TEXT (18 digits)
  sales_channel_id BIGINT UNSIGNED NOT NULL,
  status           ENUM('pending','processing','shipped','completed','cancelled')
                     NOT NULL DEFAULT 'pending',
  platform_status  VARCHAR(50)     NULL,       -- raw status from the export, e.g. "Selesai"
  order_source     ENUM('live','video','product_card','other') NOT NULL DEFAULT 'other',
  creator_handle   VARCHAR(100)    NULL,       -- host/affiliate who drove the sale
  ordered_at       DATETIME        NOT NULL,
  paid_at          DATETIME        NULL,
  shipped_at       DATETIME        NULL,
  completed_at     DATETIME        NULL,
  cancelled_at     DATETIME        NULL,
  courier          VARCHAR(50)     NULL,
  tracking_number  VARCHAR(40)     NULL,
  province         VARCHAR(60)     NULL,
  city             VARCHAR(80)     NULL,
  -- Buyer details arrive masked in the export ("i***di09", "(+62)857******96"),
  -- so they identify nobody and are kept denormalised here instead of in a
  -- customers table, where a masked value could merge two different people.
  buyer_username   VARCHAR(100)    NULL,
  recipient_name   VARCHAR(100)    NULL,
  phone            VARCHAR(30)     NULL,
  shipping_cost    DECIMAL(12,2)   NOT NULL DEFAULT 0,
  discount_total   DECIMAL(12,2)   NOT NULL DEFAULT 0,
  grand_total      DECIMAL(12,2)   NOT NULL DEFAULT 0,
  -- Cancellation lives here rather than in its own table: an order has at most
  -- one, so a separate 1:1 table would only add a join.
  cancelled_by     ENUM('customer','seller','system') NULL,
  cancel_reason    VARCHAR(150)    NULL,
  refund_amount    DECIMAL(12,2)   NOT NULL DEFAULT 0,
  notes            VARCHAR(255)    NULL,
  import_batch_id  BIGINT UNSIGNED NULL,
  recorded_by      BIGINT UNSIGNED NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY orders_channel_number_unique (sales_channel_id, order_number),
  KEY orders_status_ordered_at_index (status, ordered_at),
  KEY orders_ordered_at_index (ordered_at),
  KEY orders_tracking_number_index (tracking_number),
  KEY orders_source_index (order_source, ordered_at),
  CONSTRAINT orders_sales_channel_id_foreign FOREIGN KEY (sales_channel_id)
    REFERENCES sales_channels (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT orders_import_batch_id_foreign FOREIGN KEY (import_batch_id)
    REFERENCES import_batches (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT orders_recorded_by_foreign FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id           BIGINT UNSIGNED NOT NULL,
  product_variant_id BIGINT UNSIGNED NOT NULL,
  channel_sku_id     VARCHAR(50)     NULL,               -- raw platform SKU ID as imported
  quantity           INT             NOT NULL,
  returned_quantity  INT             NOT NULL DEFAULT 0, -- "Sku Quantity of return"
  unit_price         DECIMAL(12,2)   NOT NULL,           -- price snapshot at sale time
  discount           DECIMAL(12,2)   NOT NULL DEFAULT 0, -- line-level discount
  subtotal           DECIMAL(12,2) AS ((unit_price * quantity) - discount) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY order_items_order_variant_unique (order_id, product_variant_id),
  KEY order_items_product_variant_id_index (product_variant_id),
  CONSTRAINT order_items_order_id_foreign FOREIGN KEY (order_id)
    REFERENCES orders (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT order_items_product_variant_id_foreign FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT order_items_quantity_check CHECK (quantity > 0)
) ENGINE=InnoDB;
-- =====================================================================
-- C. PRODUCTION  (source of inbound stock)
-- =====================================================================

CREATE TABLE production_orders (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference_no    VARCHAR(25)     NOT NULL,
  manufacturer_id BIGINT UNSIGNED NOT NULL,
  ordered_date    DATE            NOT NULL,
  due_date        DATE            NULL,
  completed_date  DATE            NULL,
  status          ENUM('draft','in_progress','completed','cancelled')
                    NOT NULL DEFAULT 'in_progress',
  labor_cost      DECIMAL(12,2)   NULL,            -- biaya maklon
  notes           VARCHAR(255)    NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY production_orders_reference_no_unique (reference_no),
  KEY production_orders_status_index (status, ordered_date),
  CONSTRAINT production_orders_manufacturer_id_foreign FOREIGN KEY (manufacturer_id)
    REFERENCES manufacturers (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT production_orders_created_by_foreign FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- One production order covers many variants.
-- order_item_id is set only for make-to-order production.
CREATE TABLE production_order_items (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  production_order_id BIGINT UNSIGNED NOT NULL,
  product_variant_id  BIGINT UNSIGNED NOT NULL,
  order_item_id       BIGINT UNSIGNED NULL,
  quantity_ordered    INT             NOT NULL,
  quantity_produced   INT             NOT NULL DEFAULT 0,
  quantity_rejected   INT             NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY production_order_items_unique (production_order_id, product_variant_id),
  KEY production_order_items_product_variant_id_index (product_variant_id),
  CONSTRAINT production_order_items_production_order_id_foreign FOREIGN KEY (production_order_id)
    REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT production_order_items_product_variant_id_foreign FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT production_order_items_order_item_id_foreign FOREIGN KEY (order_item_id)
    REFERENCES order_items (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT production_order_items_quantity_check
    CHECK (quantity_ordered > 0 AND quantity_produced >= 0 AND quantity_rejected >= 0)
) ENGINE=InnoDB;

-- Inbound goods are recorded as their own event, not as a side effect of a
-- status change. A production order can be delivered in several batches.
CREATE TABLE goods_receipts (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference_no        VARCHAR(25)     NOT NULL,
  production_order_id BIGINT UNSIGNED NOT NULL,
  invoice_number      VARCHAR(40)     NULL,       -- nota from the workshop
  received_date       DATE            NOT NULL,
  notes               VARCHAR(255)    NULL,
  received_by         BIGINT UNSIGNED NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY goods_receipts_reference_no_unique (reference_no),
  KEY goods_receipts_production_order_id_index (production_order_id),
  CONSTRAINT goods_receipts_production_order_id_foreign FOREIGN KEY (production_order_id)
    REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT goods_receipts_received_by_foreign FOREIGN KEY (received_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE goods_receipt_items (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  goods_receipt_id   BIGINT UNSIGNED NOT NULL,
  product_variant_id BIGINT UNSIGNED NOT NULL,
  quantity           INT             NOT NULL,
  quantity_rejected  INT             NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY goods_receipt_items_unique (goods_receipt_id, product_variant_id),
  KEY goods_receipt_items_product_variant_id_index (product_variant_id),
  CONSTRAINT goods_receipt_items_goods_receipt_id_foreign FOREIGN KEY (goods_receipt_id)
    REFERENCES goods_receipts (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT goods_receipt_items_product_variant_id_foreign FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_items_quantity_check
    CHECK (quantity > 0 AND quantity_rejected >= 0)
) ENGINE=InnoDB;

-- =====================================================================
-- D. MATERIALS
-- =====================================================================

CREATE TABLE material_purchases (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_number VARCHAR(40)     NULL,
  supplier_id    BIGINT UNSIGNED NOT NULL,
  purchase_date  DATE            NOT NULL,
  total_amount   DECIMAL(14,2)   NOT NULL DEFAULT 0,
  notes          VARCHAR(255)    NULL,
  recorded_by    BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY material_purchases_supplier_date_index (supplier_id, purchase_date),
  CONSTRAINT material_purchases_supplier_id_foreign FOREIGN KEY (supplier_id)
    REFERENCES suppliers (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT material_purchases_recorded_by_foreign FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE material_purchase_items (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_purchase_id BIGINT UNSIGNED NOT NULL,
  material_id          BIGINT UNSIGNED NOT NULL,
  quantity             DECIMAL(10,2)   NOT NULL,
  unit_price           DECIMAL(12,2)   NOT NULL,
  subtotal             DECIMAL(14,2) AS (quantity * unit_price) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY material_purchase_items_unique (material_purchase_id, material_id),
  KEY material_purchase_items_material_id_index (material_id),
  CONSTRAINT material_purchase_items_purchase_id_foreign FOREIGN KEY (material_purchase_id)
    REFERENCES material_purchases (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT material_purchase_items_material_id_foreign FOREIGN KEY (material_id)
    REFERENCES materials (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT material_purchase_items_quantity_check CHECK (quantity > 0)
) ENGINE=InnoDB;
-- =====================================================================
-- E. CORE: STOCK LEDGER
-- Every stock change MUST go through here. product_variants.stock_on_hand
-- is only a cached roll-up of this table.
-- =====================================================================

CREATE TABLE stock_movements (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_variant_id BIGINT UNSIGNED NOT NULL,
  movement_type      ENUM('in','out','return','damage','count_adjustment','correction') NOT NULL,
  quantity           INT             NOT NULL,   -- signed: positive adds, negative removes
  balance_after      INT             NOT NULL,
  reference_type     ENUM('goods_receipt','order','stock_count','manual') NOT NULL,
  reference_id       BIGINT UNSIGNED NULL,
  notes              VARCHAR(255)    NULL,
  movement_date      DATE            NOT NULL,
  recorded_by        BIGINT UNSIGNED NULL,
  reverses_id        BIGINT UNSIGNED NULL,       -- set when this row corrects another
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY stock_movements_variant_id_index (product_variant_id, id),
  KEY stock_movements_movement_date_index (movement_date),
  KEY stock_movements_reference_index (reference_type, reference_id),
  CONSTRAINT stock_movements_product_variant_id_foreign FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT stock_movements_recorded_by_foreign FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT stock_movements_reverses_id_foreign FOREIGN KEY (reverses_id)
    REFERENCES stock_movements (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT stock_movements_quantity_check CHECK (quantity <> 0)
) ENGINE=InnoDB;

CREATE TABLE material_movements (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id    BIGINT UNSIGNED NOT NULL,
  movement_type  ENUM('in','usage','damage','count_adjustment','correction') NOT NULL,
  quantity       DECIMAL(12,2)   NOT NULL,
  balance_after  DECIMAL(12,2)   NOT NULL,
  reference_type ENUM('material_purchase','production','stock_count','manual') NOT NULL,
  reference_id   BIGINT UNSIGNED NULL,
  notes          VARCHAR(255)    NULL,
  movement_date  DATE            NOT NULL,
  recorded_by    BIGINT UNSIGNED NULL,
  reverses_id    BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY material_movements_material_id_index (material_id, id),
  KEY material_movements_movement_date_index (movement_date),
  KEY material_movements_reference_index (reference_type, reference_id),
  CONSTRAINT material_movements_material_id_foreign FOREIGN KEY (material_id)
    REFERENCES materials (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT material_movements_recorded_by_foreign FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT material_movements_reverses_id_foreign FOREIGN KEY (reverses_id)
    REFERENCES material_movements (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT material_movements_quantity_check CHECK (quantity <> 0)
) ENGINE=InnoDB;

-- =====================================================================
-- F. STOCK COUNT  (stok opname)
-- =====================================================================

CREATE TABLE stock_counts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference_no VARCHAR(25)     NOT NULL,
  count_type   ENUM('product','material') NOT NULL DEFAULT 'product',
  count_date   DATE            NOT NULL,
  status       ENUM('draft','submitted','approved') NOT NULL DEFAULT 'draft',
  notes        VARCHAR(255)    NULL,
  created_by   BIGINT UNSIGNED NULL,
  approved_by  BIGINT UNSIGNED NULL,
  approved_at  DATETIME        NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY stock_counts_reference_no_unique (reference_no),
  CONSTRAINT stock_counts_created_by_foreign FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT stock_counts_approved_by_foreign FOREIGN KEY (approved_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE stock_count_items (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stock_count_id     BIGINT UNSIGNED NOT NULL,
  product_variant_id BIGINT UNSIGNED NULL,
  material_id        BIGINT UNSIGNED NULL,
  system_quantity    DECIMAL(12,2)   NOT NULL,
  counted_quantity   DECIMAL(12,2)   NOT NULL,
  variance           DECIMAL(12,2) AS (counted_quantity - system_quantity) STORED,
  notes              VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  KEY stock_count_items_product_variant_id_index (product_variant_id),
  KEY stock_count_items_material_id_index (material_id),
  CONSTRAINT stock_count_items_stock_count_id_foreign FOREIGN KEY (stock_count_id)
    REFERENCES stock_counts (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT stock_count_items_product_variant_id_foreign FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT stock_count_items_material_id_foreign FOREIGN KEY (material_id)
    REFERENCES materials (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT stock_count_items_target_check CHECK (
    (product_variant_id IS NOT NULL AND material_id IS NULL) OR
    (product_variant_id IS NULL AND material_id IS NOT NULL)
  )
) ENGINE=InnoDB;

-- =====================================================================
-- G. ALERTS & AUDIT
-- =====================================================================

CREATE TABLE stock_alerts (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_variant_id BIGINT UNSIGNED NULL,
  material_id        BIGINT UNSIGNED NULL,
  alert_type         ENUM('low_stock','out_of_stock','variance') NOT NULL,
  message            VARCHAR(255)    NOT NULL,
  stock_level        DECIMAL(12,2)   NOT NULL,
  status             ENUM('new','seen','resolved') NOT NULL DEFAULT 'new',
  resolved_by        BIGINT UNSIGNED NULL,
  resolved_at        DATETIME        NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY stock_alerts_status_index (status, created_at),
  KEY stock_alerts_product_variant_id_index (product_variant_id),
  KEY stock_alerts_material_id_index (material_id),
  CONSTRAINT stock_alerts_product_variant_id_foreign FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT stock_alerts_material_id_foreign FOREIGN KEY (material_id)
    REFERENCES materials (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT stock_alerts_resolved_by_foreign FOREIGN KEY (resolved_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE activity_logs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NULL,
  action         VARCHAR(50)     NOT NULL,   -- created / updated / deleted / login
  auditable_type VARCHAR(50)     NOT NULL,   -- table or model name
  auditable_id   VARCHAR(50)     NULL,
  old_values     JSON            NULL,
  new_values     JSON            NULL,
  ip_address     VARCHAR(45)     NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY activity_logs_user_id_index (user_id, created_at),
  KEY activity_logs_auditable_index (auditable_type, auditable_id),
  CONSTRAINT activity_logs_user_id_foreign FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- H. VIEWS
-- =====================================================================

-- Backs the stock screen shown to live hosts.
-- NOTE: this reflects stock as of the last recorded entry. Sales made during an
-- ongoing live session are not reflected until that session's recap is entered.
CREATE OR REPLACE VIEW v_available_stock AS
SELECT
  pv.id            AS product_variant_id,
  pv.sku,
  p.name           AS product_name,
  c.name           AS category_name,
  pv.size,
  pv.color,
  pv.stock_on_hand,
  pv.reorder_point,
  CASE
    WHEN pv.stock_on_hand <= 0                 THEN 'out_of_stock'
    WHEN pv.stock_on_hand <= pv.reorder_point  THEN 'low_stock'
    ELSE 'in_stock'
  END AS stock_status
FROM product_variants pv
JOIN products   p ON p.id = pv.product_id
JOIN categories c ON c.id = p.category_id
WHERE pv.is_active = 1
  AND pv.deleted_at IS NULL
  AND p.is_active = 1
  AND p.deleted_at IS NULL;

-- Integrity check: cached balance vs. ledger sum. Should always return 0 rows.
CREATE OR REPLACE VIEW v_stock_balance_check AS
SELECT
  pv.id AS product_variant_id,
  pv.sku,
  pv.stock_on_hand                AS cached_balance,
  COALESCE(SUM(sm.quantity), 0)   AS ledger_balance,
  pv.stock_on_hand - COALESCE(SUM(sm.quantity), 0) AS difference
FROM product_variants pv
LEFT JOIN stock_movements sm ON sm.product_variant_id = pv.id
GROUP BY pv.id, pv.sku, pv.stock_on_hand
HAVING difference <> 0;

-- =====================================================================
-- I. SEED DATA
--
-- Data awal (akun pengguna, kategori, channel) diisi lewat `node scripts/seed.mjs`,
-- bukan di sini, supaya password selalu di-hash oleh aplikasi dan tidak ada
-- dua sumber data awal yang bisa berbeda isinya.
-- =====================================================================
