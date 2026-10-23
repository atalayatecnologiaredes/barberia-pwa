import { create } from "zustand";
import { MOCK_APPOINTMENTS, MOCK_STOCK, MOCK_VISITS, MOCK_BARBERS } from "../data/mockData";
import type { AppEvent, BookingCreated, EventName, EventPayloads, InventoryRequest, InventoryUsage, ReceptionClient, ServiceOrder, CompletedPayment } from "../types/events.types";
export * from "../types/events.types";

export interface InventoryItem {
  id: string; name: string; category: string; quantity: number; unit: string;
  minimum: number; cost: number; price: number;
}
export interface AppointmentRecord extends BookingCreated {
  startsAt: string;
  status: "confirmed" | "waiting" | "in-chair" | "complete";
}
export interface CommissionRecord {
  id: string; orderId: string; barberId: string; barberName: string;
  serviceAmount: number; productAmount: number; total: number; createdAt: string;
}
export interface SaleRecord extends CompletedPayment { commission: number; }

interface BarberState {
  appointments: AppointmentRecord[];
  queue: ReceptionClient[];
  checkoutOrders: ServiceOrder[];
  inventory: Record<string, InventoryItem>;
  restockRequests: InventoryRequest[];
  sales: SaleRecord[];
  commissions: CommissionRecord[];
  processedServiceOrders: string[];
  processedPaymentOrders: string[];
  createAppointment: (appointment: BookingCreated, startsAt: string) => void;
  setClientQueueStatus: (client: ReceptionClient) => void;
  receiveOrder: (order: ServiceOrder) => void;
  finishService: (order: ServiceOrder, usage: InventoryUsage[]) => void;
  completePayment: (payment: CompletedPayment) => void;
  addRestockRequest: (request: InventoryRequest) => void;
}

const seededAppointments: AppointmentRecord[] = MOCK_APPOINTMENTS.map((item) => {
  const client = MOCK_VISITS.find((visit) => visit.id === item.clientId)!;
  const service = client.serviceName;
  const barber = MOCK_BARBERS.find((row) => row.id === item.barberId)!;
  return {
    bookingId: item.id,
    clientId: item.clientId,
    clientName: client.name,
    phone: client.phone,
    serviceId: item.serviceId,
    serviceName: service,
    barberId: item.barberId,
    barberName: barber.name,
    date: item.startsAt.slice(0, 10),
    time: new Date(item.startsAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" }),
    startsAt: item.startsAt,
    status: item.status,
  };
});

export const useBarberStore = create<BarberState>((set) => ({
  appointments: seededAppointments,
  queue: MOCK_VISITS,
  checkoutOrders: [],
  inventory: Object.fromEntries(MOCK_STOCK.map((item) => [item.id, item])),
  restockRequests: [],
  sales: [],
  commissions: [],
  processedServiceOrders: [],
  processedPaymentOrders: [],
  createAppointment: (appointment, startsAt) => set((state) => ({
    appointments: [{ ...appointment, startsAt, status: "confirmed" }, ...state.appointments.filter((item) => item.bookingId !== appointment.bookingId)],
  })),
  setClientQueueStatus: (client) => set((state) => {
    const queue = state.queue.some((item) => item.id === client.id)
      ? state.queue.map((item) => item.id === client.id ? client : item)
      : [...state.queue, client];
    const status = client.status === "in-chair" ? "in-chair" : client.status === "complete" ? "complete" : "waiting";
    return {
      queue,
      appointments: state.appointments.map((appointment) => appointment.clientId === client.id ? { ...appointment, status } : appointment),
    };
  }),
  receiveOrder: (order) => set((state) => ({
    checkoutOrders: state.checkoutOrders.some((item) => item.orderId === order.orderId)
      ? state.checkoutOrders.map((item) => item.orderId === order.orderId ? order : item)
      : [order, ...state.checkoutOrders],
  })),
  finishService: (order, usage) => set((state) => {
    if (state.processedServiceOrders.includes(order.orderId)) return {};
    const inventory = { ...state.inventory };
    for (const used of usage) {
      const item = inventory[used.itemId];
      if (item) inventory[used.itemId] = { ...item, quantity: Math.max(0, item.quantity - used.amount) };
    }
    const completedOrder: ServiceOrder = { ...order, status: "ready-for-checkout", endedAt: order.endedAt ?? new Date().toISOString() };
    const checkoutOrders = state.checkoutOrders.some((item) => item.orderId === order.orderId)
      ? state.checkoutOrders.map((item) => item.orderId === order.orderId ? completedOrder : item)
      : [completedOrder, ...state.checkoutOrders];
    const finishedClientIds = new Set(state.queue.filter((client) => client.id === order.guest.id || client.stationId === order.stationId).map((client) => client.id));
    const queue = state.queue.map((client) => client.id === order.guest.id || client.stationId === order.stationId
      ? { ...client, status: "complete" as const, completedAt: completedOrder.endedAt }
      : client);
    const appointments = state.appointments.map((appointment) => finishedClientIds.has(appointment.clientId) ? { ...appointment, status: "complete" as const } : appointment);
    return { inventory, checkoutOrders, queue, appointments, processedServiceOrders: [...state.processedServiceOrders, order.orderId] };
  }),
  completePayment: (payment) => set((state) => {
    if (state.processedPaymentOrders.includes(payment.orderId)) return {};
    const order = { ...payment.order, status: "paid" as const };
    const inventory = { ...state.inventory };
    for (const line of order.lines) {
      const item = inventory[line.productId];
      if (item) inventory[line.productId] = { ...item, quantity: Math.max(0, item.quantity - line.quantity) };
    }
    const barber = MOCK_BARBERS.find((item) => item.id === order.barberId);
    const productSales = order.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const serviceCommission = order.servicePrice * (barber?.commissionService ?? 0.5);
    const productCommission = productSales * (barber?.commissionProduct ?? 0.1);
    const commission: CommissionRecord = {
      id: `commission_${payment.orderId}`,
      orderId: payment.orderId,
      barberId: order.barberId,
      barberName: order.barberName,
      serviceAmount: Number(serviceCommission.toFixed(2)),
      productAmount: Number(productCommission.toFixed(2)),
      total: Number((serviceCommission + productCommission).toFixed(2)),
      createdAt: payment.completedAt,
    };
    const sale: SaleRecord = { ...payment, order, commission: commission.total };
    const checkoutOrders = state.checkoutOrders.map((item) => item.orderId === order.orderId ? order : item);
    return {
      inventory,
      checkoutOrders,
      sales: [sale, ...state.sales],
      commissions: [commission, ...state.commissions],
      processedPaymentOrders: [...state.processedPaymentOrders, payment.orderId],
    };
  }),
  addRestockRequest: (request) => set((state) => {
    const requestId = request.requestId ?? `${request.itemId}-${request.stationId}`;
    if (state.restockRequests.some((item) => item.requestId === requestId)) return {};
    return { restockRequests: [{ ...request, requestId }, ...state.restockRequests] };
  }),
}));

type Handler<K extends EventName> = (event: AppEvent<K>) => void;
const subscribers = new Map<EventName, Set<(event: AppEvent) => void>>();

function processEvent(event: AppEvent) {
  const store = useBarberStore.getState();
  switch (event.type) {
    case "booking:created":
      store.createAppointment(event.payload, new Date(`${event.payload.date}T${event.payload.time}:00`).toISOString());
      break;
    case "queue:check-in":
      {
        const payload = event.payload;
        const client: ReceptionClient = {
          id: payload.clientId,
          name: payload.name ?? "Cliente",
          initials: payload.initials ?? (payload.name ?? "CL").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
          phone: payload.phone ?? "",
          serviceId: payload.serviceId ?? "unknown",
          serviceName: payload.serviceName ?? "Servicio por confirmar",
          barberId: payload.barberId ?? "barber_01",
          barberName: payload.barberName ?? "Marco Rivera",
          channel: payload.channel,
          status: "waiting",
          checkedInAt: new Date().toISOString(),
        };
        store.setClientQueueStatus(client);
      }
      break;
    case "CLIENT_CHECKED_IN":
    case "RECEPTION_CLIENT_UPDATED":
      store.setClientQueueStatus(event.payload.client);
      break;
    case "chair:service-started":
      store.receiveOrder(event.payload.order);
      break;
    case "chair:line-added":
    case "ORDER_SENT_TO_CHECKOUT":
    case "checkout:order-ready":
      store.receiveOrder(event.payload.order);
      break;
    case "chair:service-completed":
    case "SERVICE_COMPLETED":
      store.finishService(event.payload.order, event.payload.usage);
      break;
    case "PAYMENT_COMPLETED":
      store.completePayment(event.payload);
      break;
    case "INSUMO_REQUESTED":
    case "inventory:restock-requested":
      store.addRestockRequest(event.payload);
      break;
    case "queue:status-updated":
      {
        const client = store.queue.find((item) => item.id === event.payload.clientId);
        if (client) store.setClientQueueStatus({ ...client, status: event.payload.status === "in-chair" ? "in-chair" : event.payload.status === "complete" ? "complete" : "waiting" });
      }
      break;
  }
  subscribers.get(event.type)?.forEach((handler) => handler(event));
}

/** In-memory application event bus. Events synchronously update Zustand then notify feature subscribers. */
export const eventBus = {
  emit<K extends EventName>(type: K, payload: EventPayloads[K], source: string, correlationId?: string): AppEvent<K> {
    const event = {
      type, payload, source, correlationId,
      eventId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      occurredAt: new Date().toISOString(),
    } as AppEvent<K>;
    processEvent(event);
    return event;
  },
  on<K extends EventName>(type: K, handler: Handler<K>): () => void {
    const handlers = subscribers.get(type) ?? new Set();
    handlers.add(handler as (event: AppEvent) => void);
    subscribers.set(type, handlers);
    return () => { handlers.delete(handler as (event: AppEvent) => void); if (!handlers.size) subscribers.delete(type); };
  },
};
