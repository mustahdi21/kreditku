/**
 * types.ts — Bentuk data yang dibaca/ditulis aplikasi.
 *
 * Tipe di sini mencerminkan kolom tabel dan view pada supabase/migrations.
 * Nama kolom sengaja memakai snake_case agar sama dengan database dan tidak
 * memerlukan pemetaan tambahan.
 */

import type {
  AdminFeePosition,
  AllocationOrder,
  ApplicationStatus,
  ContractStatus,
  CustomerStatus,
  DueDateAdjustment,
  InstallmentStatus,
  InterestMethod,
  MemberRole,
  NotificationType,
  PaymentFrequency,
  PaymentMethod,
  PaymentStatus,
  PenaltyStatus,
  PenaltyType,
  RateBasis,
  ReminderChannel,
  ReminderOffset,
  ReminderStatus,
} from '@/core/types';
import type { PenaltyPercentBase } from '@/core/penalties';

export interface CustomerRow {
  id: string;
  organization_id: string;
  customer_number: string;
  full_name: string;
  identity_number: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  birth_date: string | null;
  occupation: string | null;
  monthly_income: number | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  status: CustomerStatus;
  remind_enabled: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerSummaryRow extends CustomerRow {
  total_contracts: number;
  active_contracts: number;
  total_payable: number;
  total_paid: number;
  outstanding: number;
  overdue_amount: number;
  next_due_date: string | null;
  max_days_late: number;
}

export interface CreditProductRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  description: string | null;
  default_tenor: number;
  default_method: InterestMethod;
  default_rate_bp: number;
  default_rate_basis: RateBasis;
  default_frequency: PaymentFrequency;
  default_admin_fee: number;
  min_down_payment_pct: number;
  is_active: boolean;
}

export interface CreditApplicationRow {
  id: string;
  organization_id: string;
  application_number: string;
  customer_id: string;
  product_id: string | null;
  credit_type: string;
  price: number;
  down_payment: number;
  principal: number;
  tenor: number;
  method: InterestMethod;
  rate_bp: number;
  rate_basis: RateBasis;
  frequency: PaymentFrequency;
  admin_fee: number;
  admin_fee_position: AdminFeePosition;
  other_fee_per_period: number;
  disbursement_date: string | null;
  first_due_date: string;
  due_date_adjustment: DueDateAdjustment;
  status: ApplicationStatus;
  notes: string | null;
  decision_reason: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  contract_id: string | null;
  created_at: string;
  created_by: string | null;
}

export interface ApplicationWithRelations extends CreditApplicationRow {
  customers: { id: string; customer_number: string; full_name: string; phone: string } | null;
  credit_products: { id: string; name: string } | null;
}

export interface ApplicationHistoryRow {
  id: string;
  application_id: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  note: string | null;
  changed_by: string | null;
  created_at: string;
  profiles: { full_name: string; email: string } | null;
}

export interface CreditContractRow {
  id: string;
  organization_id: string;
  contract_number: string;
  application_id: string | null;
  customer_id: string;
  contract_date: string;
  disbursement_date: string | null;
  price: number;
  down_payment: number;
  principal: number;
  tenor: number;
  method: InterestMethod;
  rate_bp: number;
  rate_basis: RateBasis;
  frequency: PaymentFrequency;
  admin_fee: number;
  admin_fee_position: AdminFeePosition;
  other_fee_per_period: number;
  upfront_amount: number;
  total_interest: number;
  total_fees: number;
  total_payable: number;
  total_paid: number;
  outstanding: number;
  first_due_date: string;
  next_due_date: string | null;
  due_date_adjustment: DueDateAdjustment;
  status: ContractStatus;
  last_payment_date: string | null;
  restructured_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  snapshot: Record<string, unknown>;
  created_at: string;
}

export interface ContractSummaryRow extends CreditContractRow {
  customer_number: string;
  customer_name: string;
  customer_phone: string;
  paid_installments: number;
  partial_installments: number;
  overdue_installments: number;
  overdue_amount: number;
  penalty_outstanding: number;
  max_days_late: number;
  progress_percent: number;
}

export interface InstallmentDetailRow {
  id: string;
  organization_id: string;
  contract_id: string;
  contract_number: string;
  installment_number: number;
  base_due_date: string;
  due_date: string;
  principal: number;
  interest: number;
  fees: number;
  total_due: number;
  paid_amount: number;
  penalty_paid_amount: number;
  outstanding: number;
  last_payment_date: string | null;
  stored_status: InstallmentStatus;
  status: InstallmentStatus;
  late_days: number;
  aging_bucket: string;
  penalty_outstanding: number;
  penalty_amount: number;
  penalty_id: string | null;
  penalty_status: PenaltyStatus | null;
  customer_id: string;
  customer_number: string;
  customer_name: string;
  customer_phone: string;
  remind_enabled: boolean;
}

export interface PaymentRow {
  id: string;
  organization_id: string;
  contract_id: string;
  receipt_number: string;
  amount: number;
  method: PaymentMethod;
  paid_at: string;
  paid_date: string;
  reference: string | null;
  notes: string | null;
  proof_path: string | null;
  status: PaymentStatus;
  idempotency_key: string;
  penalty_first: boolean;
  allocation_order: AllocationOrder;
  unallocated: number;
  reversed_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface PaymentWithRelations extends PaymentRow {
  credit_contracts: {
    id: string;
    contract_number: string;
    customer_id: string;
    customers: { full_name: string; customer_number: string } | null;
  } | null;
  profiles: { full_name: string; email: string } | null;
}

export interface PaymentAllocationRow {
  id: string;
  payment_id: string;
  installment_id: string;
  amount: number;
  penalty_amount: number;
  installments: {
    installment_number: number;
    due_date: string;
    total_due: number;
  } | null;
}

export interface PaymentReversalRow {
  id: string;
  payment_id: string;
  reversal_number: string;
  amount: number;
  reason: string;
  created_at: string;
  created_by: string | null;
  profiles: { full_name: string; email: string } | null;
}

export interface PenaltyRow {
  id: string;
  organization_id: string;
  contract_id: string;
  installment_id: string;
  amount: number;
  paid_amount: number;
  waived_amount: number;
  late_days: number;
  chargeable_days: number;
  status: PenaltyStatus;
  calculated_at: string;
  waived_reason: string | null;
  rule_snapshot: {
    type?: PenaltyType;
    amount?: number;
    grace_days?: number;
    max_amount?: number | null;
    percent_base?: PenaltyPercentBase;
  };
  installments: {
    installment_number: number;
    due_date: string;
    total_due: number;
    paid_amount: number;
    contract_id: string;
    credit_contracts: { contract_number: string; customer_id: string } | null;
  } | null;
}

export interface ReminderRow {
  id: string;
  organization_id: string;
  contract_id: string;
  installment_id: string;
  customer_id: string;
  offset_key: ReminderOffset;
  channel: ReminderChannel;
  scheduled_for: string;
  status: ReminderStatus;
  attempts: number;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  installments: { installment_number: number; due_date: string } | null;
  credit_contracts: { contract_number: string } | null;
  customers: { full_name: string; phone: string } | null;
}

export interface ReminderTemplateRow {
  id: string;
  organization_id: string;
  offset_key: ReminderOffset;
  channel: ReminderChannel;
  subject: string | null;
  body: string;
  is_active: boolean;
}

export interface NotificationRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  organization_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  is_active: boolean;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  profiles: { id: string; full_name: string; email: string; phone: string | null; is_active: boolean } | null;
}

export interface FinanceSettings {
  default_interest_method: InterestMethod;
  default_rate_bp: number;
  default_rate_basis: RateBasis;
  default_tenor: number;
  default_admin_fee: number;
  max_tenor: number;
  min_down_payment_percent: number;
  allow_overpayment: boolean;
  allocation_order: AllocationOrder;
  penalty_first: boolean;
  require_separate_approver: boolean;
  due_date_adjustment: DueDateAdjustment;
  weekend_days: number[];
  holidays: string[];
  aging_bounds: number[];
}

export interface PenaltySettings {
  type: PenaltyType;
  amount: number;
  grace_days: number;
  max_amount: number | null;
  percent_base: PenaltyPercentBase;
}

export interface IntegrationSettings {
  whatsapp_enabled: boolean;
  whatsapp_provider: 'WAHASENDER' | 'CUSTOM';
  whatsapp_sender_name?: string | null;
  email_enabled: boolean;
  email_from_name?: string | null;
  email_from_address?: string | null;
  reminder_offsets: ReminderOffset[];
  reminder_channels: ReminderChannel[];
  reminder_simulation_mode: boolean;
}

export interface NumberingSettings {
  customer: string;
  contract: string;
  receipt: string;
  application: string;
  payment_reversal: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  code: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  timezone: string;
  locale: string;
  is_active: boolean;
  settings: Record<string, unknown>;
}

export interface AppSettingsRow {
  organization_id: string;
  numbering: NumberingSettings;
  finance: FinanceSettings;
  penalty: PenaltySettings;
  integrations: IntegrationSettings;
  ui: { theme?: string; primary_color?: string; [key: string]: unknown };
}

export interface ListResult<T> {
  readonly rows: T[];
  readonly total: number;
}

export interface DashboardMetricsResult {
  active_customers: number;
  new_customers: number;
  applications_in_range: number;
  applications_pending: number;
  approved_financing: number;
  disbursed_in_range: number;
  active_contracts: number;
  paid_off_contracts: number;
  delinquent_contracts: number;
  outstanding_total: number;
  overdue_total: number;
  overdue_count: number;
  due_today_total: number;
  due_today_count: number;
  penalty_outstanding: number;
  collections_in_range: number;
  reversals_in_range: number;
  on_time_paid: number;
  total_paid_installments: number;
  long_overdue_outstanding: number;
  method_distribution: Record<string, number>;
  status_distribution: Record<string, number>;
  aging: Record<string, { count: number; amount: number }>;
}

export interface PaymentSeriesRow {
  period: string;
  amount: number;
  count: number;
  reversal_amount: number;
}
