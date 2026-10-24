export type Role = "SUPER_ADMIN" | "RECEPCION" | "BARBER" | "CLIENT";
export interface EventMeta { eventId: string; occurredAt: string; source: string; correlationId?: string; }
export interface Guest { id: string; name: string; initials: string; phone?: string; }
export interface OrderLine { productId: string; name: string; quantity: number; unitPrice: number; }
export interface ServiceOrder {
  orderId: string; guest: Guest; barberId: string; barberName: string; stationId: string;
  serviceId: string; serviceName: string; startedAt: string; endedAt?: string;
  servicePrice: number; lines: OrderLine[]; status: "in-service" | "ready-for-checkout" | "paid";
}
export type PaymentMethod = "card" | "cash" | "mobile-transfer" | "loyalty" | "split";
export type LoyaltyRewardType = "free_service" | "fixed_service_discount" | "percent_service_discount";
export interface CompletedPayment {
  orderId: string; order: ServiceOrder; customer: Guest; subtotal: number; tax: number;
  tip: number; total: number; method: PaymentMethod; completedAt: string;
}
export interface InventoryUsage { itemId: string; name: string; amount: number; unit: "ml" | "g" | "unit"; }
export interface InventoryRequest { requestId?: string; itemId: string; itemName: string; quantity: number; unit: "unit" | "pack"; urgency: "normal" | "urgent"; stationId: string; barberId: string; }
export interface LoyaltyUpdate { clientId: string; pointsDelta: number; reason: "purchase" | "redemption"; orderId: string; }
export interface QueueStatus { clientId: string; position: number; estimatedWaitMinutes: number; status: "waiting" | "called" | "in-chair" | "complete"; }
export interface CheckIn {
  clientId: string; appointmentId?: string; channel: "qr" | "walk-in" | "booking";
  name?: string; initials?: string; phone?: string; serviceId?: string; serviceName?: string; barberId?: string; barberName?: string;
}
export interface BookingCreated { bookingId: string; clientId: string; clientName: string; phone?: string; serviceId: string; serviceName: string; barberId: string; barberName: string; date: string; time: string; }
export interface ReceptionClient {
  id: string; name: string; initials: string; phone: string; serviceId: string; serviceName: string;
  barberId: string; barberName: string; stationId?: string; channel: "walk-in" | "booking" | "qr";
  status: "waiting" | "in-chair" | "complete"; checkedInAt: string; startedAt?: string; completedAt?: string;
}
export interface EventPayloads {
  "queue:check-in": CheckIn;
  "queue:status-updated": QueueStatus;
  "booking:created": BookingCreated;
  CLIENT_CHECKED_IN: { client: ReceptionClient; status: "waiting" | "in-chair"; changedAt: string };
  RECEPTION_CLIENT_UPDATED: { client: ReceptionClient };
  "chair:service-started": { order: ServiceOrder };
  "chair:line-added": { orderId: string; line: OrderLine; order: ServiceOrder };
  "chair:service-completed": { order: ServiceOrder; usage: InventoryUsage[] };
  "checkout:order-ready": { order: ServiceOrder };
  /** Canonical cross-MFE contract used by Chair Station and Checkout Express. */
  ORDER_SENT_TO_CHECKOUT: { order: ServiceOrder };
  PAYMENT_COMPLETED: CompletedPayment;
  "checkout:payment-completed": { orderId: string; total: number; tip: number; method: PaymentMethod | "split"; clientId?: string };
  "inventory:restock-requested": InventoryRequest;
  "inventory:usage-recorded": { orderId: string; stationId: string; usage: InventoryUsage[] };
  SERVICE_COMPLETED: { order: ServiceOrder; usage: InventoryUsage[] };
  INSUMO_REQUESTED: InventoryRequest;
  "loyalty:points-updated": LoyaltyUpdate;
  "auth:session-changed": { userId: string; role: Role; token?: string; authenticated: boolean };
}
export type EventName = keyof EventPayloads;
export type AppEvent<K extends EventName = EventName> = K extends EventName ? EventMeta & { type: K; payload: EventPayloads[K] } : never;
