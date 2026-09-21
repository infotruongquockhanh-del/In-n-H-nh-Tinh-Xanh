export const COMPANY = {
  name: "CÔNG TY TNHH TRUYỀN THÔNG QUẢNG CÁO HÀNH TINH XANH",
  taxCode: "1801778788",
  address: "Số 120, Đường số 3, Khu giảng viên ĐHCT, Phường Tân An, Thành phố Cần Thơ",
  email: "inhanhtinhxanh@gmail.com",
  phone: "0912824106 (Trương Quốc Khánh)"
};

export const SYNC_KEYS = [
  "htx_users_v6",
  "htx_auto_quotes_v5",
  "htx_customer_profiles_v10",
  "htx_inventory_v7",
  "htx_custom_products_v7",
  "htx_payroll_v17",
  "htx_work_month_v7",
  "htx_price_adjustments_v6",
  "htx_catalog_overrides_v7"
];

export const ROLE_PERMISSIONS = {
  director: ["*"],
  accounting: [
    "htx_auto_quotes_v5",
    "htx_customer_profiles_v10",
    "htx_inventory_v7",
    "htx_custom_products_v7",
    "htx_payroll_v17",
    "htx_work_month_v7",
    "htx_price_adjustments_v6",
    "htx_catalog_overrides_v7"
  ],
  sales: [
    "htx_auto_quotes_v5",
    "htx_customer_profiles_v10",
    "htx_inventory_v7",
    "htx_custom_products_v7",
    "htx_work_month_v7",
    "htx_price_adjustments_v6",
    "htx_catalog_overrides_v7"
  ],
  designer: ["htx_auto_quotes_v5"],
  printing: ["htx_auto_quotes_v5", "htx_work_month_v7"]
};

export const COLLECTION_KEYS = {
  "htx_users_v6": "users",
  "htx_auto_quotes_v5": "orders",
  "htx_customer_profiles_v10": "customers",
  "htx_inventory_v7": "inventory",
  "htx_custom_products_v7": "customProducts"
};

export const SETTINGS_KEYS = [
  "htx_payroll_v17",
  "htx_work_month_v7",
  "htx_price_adjustments_v6",
  "htx_catalog_overrides_v7"
];

export const SESSION_COOKIE = "htx_cloud_session";
