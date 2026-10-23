import { Scissors } from "lucide-react";
import ClientLoyaltyPortal from "./ClientLoyaltyPortal";

export default function ClientApp() {
  const token = new URLSearchParams(window.location.search).get("token");
  return token ? <ClientLoyaltyPortal token={token}/> : <ClientQrLanding/>;
}

function ClientQrLanding() {
  return <main className="grid min-h-screen place-items-center bg-[#0d0d0e] px-5 text-center text-stone-100"><section className="max-w-sm"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-brass/30 bg-brass/10 text-brass"><Scissors size={26}/></div><p className="mt-6 text-xs font-bold uppercase tracking-[.22em] text-brass">Barber Lounge Club</p><h1 className="mt-2 text-2xl font-semibold">Escanea tu QR personal</h1><p className="mt-3 text-sm leading-6 text-muted">Esta dirección sin código no identifica tu ficha. Escanea el QR que te entregó recepción para ver tus puntos, historial y turno. No necesitas iniciar sesión.</p></section></main>;
}
