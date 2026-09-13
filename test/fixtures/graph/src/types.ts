export interface PaymentInput {
  invoiceId: string;
  amount: number;
  validate(): boolean;
}
