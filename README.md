
<<<<<<< HEAD
Aplicación modular React + Vite para la gestión de una barbería. La autenticación usa Supabase Auth y carga permisos desde `public.profiles`. Los módulos operativos principales consultan y actualizan Supabase; algunos componentes auxiliares todavía conservan estado local o datos de demostración para desarrollo.

## Configuración local

Requiere Node.js 20.19+ y npm.

1. Instala dependencias con `npm install`.
2. Copia `.env.example` a `.env.local`.
3. Define `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con la URL y la clave pública/anon de tu proyecto Supabase.
4. Ejecuta `npm run dev`.

Scripts disponibles: `npm run dev`, `npm run typecheck`, `npm run build` y `npm run preview`.

El esquema de Supabase está versionado en `supabase/migrations/`. Para un proyecto nuevo, instala e inicializa Supabase CLI, vincúlalo con `supabase link` y despliega la secuencia con `supabase db push`. La secuencia incorpora Auth/SaaS, QR y fidelidad, agenda, recepción/cola, órdenes, caja, inventario, equipo, permisos y Realtime. La migración retirada de `supabase/pending-review/` no debe aplicarse automáticamente: contiene definiciones antiguas que se solapan con migraciones posteriores. La reparación aplicada al proyecto Barber Lounge está en `20261021145712_fix_signup_saas_plan_enum.sql`; reconoce `signup_type=shop_owner` y crea el tenant inicial. El registro crea usuario, perfil, barbería y periodo de prueba dentro de la misma transacción.

## Correo de confirmación y acceso del dueño SaaS

El navegador no envía correo directamente: `supabase.auth.signUp` solicita a Supabase Auth enviar la confirmación. En el proyecto Supabase revisa Authentication → URL Configuration: agrega la URL pública completa de producción y la URL local que uses a Site URL / Redirect URLs. Configura SMTP de producción en Authentication → SMTP Settings; el proveedor por defecto de Supabase puede tener límites de entrega. Revisa Authentication → Logs y los logs del SMTP, además de Spam/Promociones, para saber si Auth aceptó el envío o si el proveedor lo rechazó. El enlace vuelve a `/login?confirmed=1`, donde la app confirma que la cuenta está lista para iniciar sesión.

El dueño crea su cuenta en `/register`; la base crea la barbería con una prueba de la duración configurada (14 días al iniciar) y el plan mensual de USD 15. Durante la prueba no se cobra. Para renovar, contacta por WhatsApp al +593 989 253 675; una vez confirmada la transferencia o el efectivo, el administrador registra el pago en `/saas-admin`. La duración del periodo, precio, prueba, gracia y contacto de soporte se configuran desde esa consola. Analítica permite descargar CSV compatible con Excel o imprimir/guardar el reporte como PDF durante prueba y suscripción; las exportaciones quedan auditadas. Si una suscripción vence, el dueño aún puede descargar un respaldo JSON de sus datos. El propietario global del SaaS es una cuenta separada: crea primero su usuario en Supabase Auth, confirma el correo y ejecuta `supabase/bootstrap_saas_admin.sql` sustituyendo `admin@tu-dominio.com` por su correo. Esa concesión se guarda por UUID en `public.saas_admins.profile_id`; luego inicia sesión por `/login` y llega a `/saas-admin`. Nunca se asigna acceso global desde el formulario público.

Si aparece `Database error saving new user`, revisa el detalle en Authentication → Logs y Database → Logs: el trigger puede fallar antes de que Auth termine la transacción. En el proyecto Barber Lounge, la raíz del `SQLSTATE 42804` era el insert de un valor `text` en el enum `saas_plan_tier`; los intentos más recientes también caían en la rama de cliente porque el trigger viejo no reconocía `signup_type=shop_owner`, chocando con emails únicos ya presentes en clientes demo. El reemplazo está en `20261021145712_fix_signup_saas_plan_enum.sql`; los permisos de RPC de las funciones de trigger se cierran en `20261021145734_lock_down_auth_trigger_functions.sql`. La conexión confirmó que la base fue creada manualmente y no tenía historial de migraciones; solo estas dos correcciones quedaron registradas allí. No ejecutes `supabase db push` contra esa base hasta conciliar todo su historial y estructura; nunca marques migraciones antiguas como aplicadas sin verificarlas.

En Authentication → URL Configuration, incluye las URLs locales y de producción que utilizarás, incluyendo `/login/recovery` como redirect permitido para recuperación de contraseña e invitaciones de equipo (por ejemplo, `http://localhost:5173/login/recovery` en desarrollo). La Edge Function `invite-staff` redirige allí para que la persona establezca su contraseña; si configuras el secreto `APP_BASE_URL`, debe contener solo el origen de la app, como `https://app.tudominio.com`.

## Tarjeta del cliente por QR

El cliente no necesita contraseña. Recepción o el dueño crea una ficha desde CRM y el sistema genera el QR personal al guardarla; las fichas existentes también pueden recibir o renovar su QR. Al escanearlo, el cliente consulta puntos, movimientos y visitas, y puede escoger servicio y barbero para hacer check-in en la cola. Su posición se actualiza automáticamente mientras espera. Renovar el QR invalida el anterior; si lo pierde, recepción puede revocarlo. El QR funciona como una credencial privada: entrégalo directamente al cliente.

La migración `20261020202000_client_qr_loyalty.sql` activa esta función después del núcleo y SaaS. Requiere `tenant_id` en `clients` y `profiles` y `active` en `tenants`. Solo recepción y dueños con tenant asignado pueden emitir QR para clientes de su propia barbería.

La migración `20261020203000_hardening_multitenant_checkout.sql` aplica los límites de acceso por tenant, protege el checkout y complementa el flujo QR. Para una base existente creada antes de la adopción de migraciones, primero hay que conciliar su historial/estructura con la base remota antes de usar `db push`; no marques migraciones como aplicadas sin comparar el esquema real.

El portal QR lee puntos y movimientos guardados en `clients` y `loyalty_ledger`; el check-in QR escribe en `queue_visits`, la misma cola que usa Recepción. Los puntos se acumulan al completar un pago mediante `complete_checkout`. Las reservas y cancelaciones desde QR usan RPC persistentes y verifican disponibilidad; los canjes se aplican durante el checkout.

## Dominios

`src/modules/` contiene Auth, Recepción, Chair Station, Checkout, Inventario, PWA Cliente, CRM, Nómina y Analítica. `src/shared/auth/` administra sesión y rutas RBAC. `src/shared/store/useBarberStore.ts` conecta los eventos de los módulos en memoria.

La sesión, agenda, cola, órdenes, caja, inventario, CRM/QR, catálogo, equipo y analítica tienen integración con Supabase en el código. Las muestras de datos aparecen únicamente en ciertos estados vacíos durante desarrollo. Antes de usar el sistema en producción hay que confirmar que la base remota tenga la secuencia correcta de migraciones, validar los flujos con datos reales y terminar la configuración de despliegue y correo. Consulta `DEVELOPMENT_PLAN.md` para el estado y los siguientes pasos.
=======
>>>>>>> f9c8f7679e2916846bbff3914bd50e5369f2a96d
