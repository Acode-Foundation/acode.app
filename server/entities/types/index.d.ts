interface User {
  id: number;
  name: string;
  email: string;
  github: string;
  website: string;
  verified: boolean;
  password: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date;
}

interface Comment {
  id: number;
  plugin_id: number;
  user_id: number;
  flagged_by_author: boolean;
  comment: string;
  author_reply: string;
  vote: boolean;
  created_at: Date;
  updated_at: Date;
}

interface Download {
  id: number;
  plugin_id: number;
  device_id: number;
  client_ip: string;
  package_name: string;
  created_at: Date;
}

interface Login {
  id: number;
  ip: string;
  token: string;
  user_id: number;
  expired_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface Otp {
  id: number;
  email: string;
  otp: string;
  created_at: Date;
}

interface Payment {
  id: number;
  user_id: number;
  amount: number;
  receipt: string;
  payment_method_id: number;
  status: number;
  date_from: Date;
  date_to: Date;
  created_at: Date;
  updated_at: Date;
}

interface PaymentMethod {
  id: number;
  user_id: number;
  paypal_email: string;
  bank_name: string;
  bank_ifsc_code: string;
  bank_swift_code: string;
  bank_account_number: string;
  bank_account_holder: string;
  bank_account_type: string;
  created_at: Date;
  updated_at: Date;
}

interface Plugin {
  id: number;
  sku: string;
  name: string;
  version: string;
  user_id: number;
  repository: string;
  description: string;
  status: number;
  created_at: Date;
  updated_at: Date;
  status_change_message: string;
  status_change_date: Date;
  votes_up: number;
  votes_down: number;
  min_version_code: number;
  price: number;
  download_count: number;
}

interface PurchaseOrder {
  id: number;
  package: string;
  amount: number;
  plugin_id: number;
  order_id: string;
  token: string;
  state: text;
  created_at: Date;
  updated_at: Date;
}

interface EntityMap {
  user: User;
  comment: Comment;
  download: Download;
  login: Login;
  otp: Otp;
  payment: Payment;
  payment_method: PaymentMethod;
  plugin: Plugin;
  purchase_order: PurchaseOrder;
}
