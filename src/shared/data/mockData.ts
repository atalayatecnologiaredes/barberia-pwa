import type { ReceptionClient, ServiceOrder } from "../types/events.types";
import type { User } from "../auth/types";

const now = new Date();
const localDay = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000);
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

export const DEMO_USERS: { user: User; password: string; label: string }[] = [
  { user: { id: "usr_owner_01", name: "Sebastián Mendoza", email: "dueno@barberlounge.ec", role: "SUPER_ADMIN" }, password: "barber123", label: "Dueño" },
  { user: { id: "usr_reception_01", name: "Camila Torres", email: "recepcion@barberlounge.ec", role: "RECEPCION" }, password: "barber123", label: "Recepción" },
  { user: { id: "usr_barber_01", name: "Marco Rivera", email: "marco@barberlounge.ec", role: "BARBER", barberId: "barber_01" }, password: "barber123", label: "Barbero" },
  { user: { id: "usr_client_01", name: "Daniel Morales", email: "cliente@barberlounge.ec", role: "CLIENT", clientId: "client_205" }, password: "barber123", label: "Cliente" },
];

export const MOCK_BARBERS = [
  { id: "barber_01", name: "Marco Rivera", title: "Barbero senior", stationId: "chair_03", commissionService: 0.5, commissionProduct: 0.1, skills: ["Fade", "Barba ritual", "Corte clásico"] },
  { id: "barber_02", name: "Andrés Vega", title: "Barbero", stationId: "chair_01", commissionService: 0.5, commissionProduct: 0.1, skills: ["Fade", "Corte clásico"] },
  { id: "barber_03", name: "Leo Santos", title: "Barbero", stationId: "chair_02", commissionService: 0.5, commissionProduct: 0.1, skills: ["Barba ritual", "Corte clásico"] },
];

export const MOCK_SERVICES = [
  { id: "fade", name: "Corte Fade", description: "Degradado y acabado con navaja", durationMinutes: 35, price: 10 },
  { id: "beard-ritual", name: "Barba Ritual", description: "Toalla caliente, perfilado y bálsamo", durationMinutes: 30, price: 8 },
  { id: "combo-master", name: "Combo Master", description: "Corte premium + ritual de barba", durationMinutes: 60, price: 15 },
  { id: "classic", name: "Corte clásico", description: "Corte tradicional con acabado", durationMinutes: 30, price: 9 },
];

export const MOCK_CLIENTS = [
  { id: "client_205", name: "Daniel Morales", phone: "+593 99 123 4567", email: "daniel.morales@example.com", tier: "Gold", points: 380, visitCount: 24, preferredBarberId: "barber_01", notes: "Degradado bajo. Mantener largo superior y marcar contorno suave.", lastService: "Combo Master", lastVisit: minutesAgo(18) },
  { id: "client_182", name: "Mateo Cárdenas", phone: "+593 98 444 2081", email: "mateo.c@example.com", tier: "Silver", points: 170, visitCount: 11, preferredBarberId: "barber_02", notes: "Piel sensible en cuello. Preferencia por acabado natural.", lastService: "Corte Fade", lastVisit: minutesAgo(8 * 24 * 60) },
  { id: "client_141", name: "Santiago Paredes", phone: "+593 98 555 0101", email: "santi.p@example.com", tier: "Gold", points: 295, visitCount: 18, preferredBarberId: "barber_03", notes: "Raya lateral derecha. Sin producto con brillo.", lastService: "Corte clásico", lastVisit: minutesAgo(12 * 24 * 60) },
  { id: "client_119", name: "Valentina Zambrano", phone: "+593 96 771 2040", email: "valen.z@example.com", tier: "Member", points: 65, visitCount: 4, preferredBarberId: "barber_01", notes: "Corte en capas, mantener longitud al hombro.", lastService: "Corte clásico", lastVisit: minutesAgo(21 * 24 * 60) },
];

export const MOCK_STOCK = [
  { id: "pomade", name: "Pomada mate", category: "Retail", quantity: 18, unit: "unit" as const, minimum: 6, cost: 8.5, price: 18 },
  { id: "beard-oil", name: "Aceite de barba", category: "Retail", quantity: 14, unit: "unit" as const, minimum: 5, cost: 6.2, price: 14 },
  { id: "sea-salt", name: "Sea salt spray", category: "Retail", quantity: 12, unit: "unit" as const, minimum: 4, cost: 7.1, price: 16 },
  { id: "shampoo", name: "Champú premium", category: "Backbar", quantity: 2_400, unit: "ml" as const, minimum: 500, cost: 0.04, price: 0 },
  { id: "beard-balm", name: "Bálsamo de barba", category: "Backbar", quantity: 600, unit: "g" as const, minimum: 150, cost: 0.12, price: 0 },
  { id: "neck-strip", name: "Protectores de cuello", category: "Desechables", quantity: 80, unit: "unit" as const, minimum: 20, cost: 0.08, price: 0 },
  { id: "towels", name: "Toallas calientes", category: "Textiles", quantity: 24, unit: "unit" as const, minimum: 8, cost: 1.4, price: 0 },
];

export const MOCK_APPOINTMENTS = [
  { id: "apt_20261020_01", clientId: "client_205", serviceId: "combo-master", barberId: "barber_01", startsAt: hoursFromNow(-0.4).toISOString(), status: "in-chair" as const },
  { id: "apt_20261020_02", clientId: "client_182", serviceId: "fade", barberId: "barber_02", startsAt: hoursFromNow(0.5).toISOString(), status: "confirmed" as const },
  { id: "apt_20261020_03", clientId: "client_141", serviceId: "beard-ritual", barberId: "barber_03", startsAt: hoursFromNow(1.25).toISOString(), status: "confirmed" as const },
  { id: "apt_20261020_04", clientId: "client_119", serviceId: "classic", barberId: "barber_01", startsAt: hoursFromNow(2).toISOString(), status: "confirmed" as const },
];

export const MOCK_VISITS: ReceptionClient[] = [
  { id: "client_205", name: "Daniel Morales", initials: "DM", phone: "+593 99 123 4567", serviceId: "combo-master", serviceName: "Combo Master", barberId: "barber_01", barberName: "Marco Rivera", stationId: "chair_03", channel: "booking", status: "in-chair", checkedInAt: minutesAgo(25), startedAt: minutesAgo(18) },
  { id: "client_182", name: "Mateo Cárdenas", initials: "MC", phone: "+593 98 444 2081", serviceId: "fade", serviceName: "Corte Fade", barberId: "barber_02", barberName: "Andrés Vega", channel: "walk-in", status: "waiting", checkedInAt: minutesAgo(9) },
  { id: "client_141", name: "Santiago Paredes", initials: "SP", phone: "+593 98 555 0101", serviceId: "beard-ritual", serviceName: "Barba Ritual", barberId: "barber_03", barberName: "Leo Santos", channel: "booking", status: "waiting", checkedInAt: minutesAgo(5) },
  { id: "client_119", name: "Valentina Zambrano", initials: "VZ", phone: "+593 96 771 2040", serviceId: "classic", serviceName: "Corte clásico", barberId: "barber_01", barberName: "Marco Rivera", stationId: "chair_01", channel: "booking", status: "complete", checkedInAt: minutesAgo(75), startedAt: minutesAgo(65), completedAt: minutesAgo(35) },
];

export const MOCK_ORDERS: ServiceOrder[] = [];
export const BUSINESS_LOCATION = { city: "Manta", province: "Manabí", country: "Ecuador", currency: "USD", timezone: "America/Guayaquil", today: localDay(now) };
