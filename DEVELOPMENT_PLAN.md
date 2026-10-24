# Plan de desarrollo — Barber Lounge

Estado revisado el 23 de octubre de 2026 contra el código local y el proyecto Supabase `Barber Lounge`.

## Estado confirmado

- La app local apunta al proyecto Supabase remoto activo `Barber Lounge`.
- La base registra 37 migraciones, incluyendo notificaciones, facturación manual, plan mensual y respaldo de salida. Persisten diferencias históricas entre el repositorio y el historial remoto; **no ejecutar `supabase db push` hasta conciliarlas**: la base original se creó manualmente y no tiene el baseline registrado.
- Agenda, recepción/cola, silla, caja, inventario, CRM/QR, catálogo, equipo y analítica usan consultas o RPC de Supabase. Las reservas QR y los canjes de recompensas también tienen funciones persistentes.
- Comparé los accesos del frontend con el esquema remoto: las 16 tablas y 24 RPC nombrados en el código existen; las 42 selecciones de columnas y las firmas/argumentos de RPC revisados no tienen campos faltantes ni nombres incompatibles. También revisé manualmente el objeto de argumentos compartido por ambos flujos de checkout. La base tiene 26 tablas públicas y RLS está habilitado en las 26. Esto confirma compatibilidad del frontend actual con la base, pero no sustituye la conciliación histórica de las seis migraciones antiguas.
- La Edge Function `invite-staff` está activa en versión 4 con verificación JWT; comparé su fuente remota con `supabase/functions/invite-staff/index.ts` y coinciden exactamente.
- La tabla `client_look_photos` no se usa desde el frontend actual; no encontré flujos de Storage para fotos, por lo que esos permisos no bloquean las funciones que sí utiliza la app.
- El código aún muestra datos de ejemplo en algunos estados vacíos de desarrollo.
- `npm run typecheck` pasó en esta sesión. No hay scripts de pruebas automatizadas declarados en `package.json`.
- Avance local del 23 de octubre: el formulario de agenda bloquea fechas pasadas; el alta Walk-In evita envíos duplicados, permite dejar el barbero sin asignar y filtra identificadores de barbero nulos. `npm run typecheck` pasó después de estos cambios.
- Avance de Equipo del 24 de octubre: las comisiones se vinculan por `profiles.barber_id` y el KPI usa la semana seleccionada. El panel distingue turnos cancelados y ausencias con motivo opcional; cancelar conserva historial. La entrada se permite desde 30 minutos antes y hasta el fin del turno; después, el propietario puede registrar ausencia. La migración `20261024153720_improve_staff_shift_attendance.sql` se aplicó en Supabase; columnas y permisos RPC verificados (`anon` sin ejecución, `authenticated` permitido). `npm run typecheck` pasó. Falta validar el flujo visualmente con una cuenta propietaria y datos reales de turnos.
- Auditoría de datos del 24 de octubre: el tenant `Mi barber` contiene registros persistidos cuyos IDs coinciden con los ejemplos de `mockData.ts` (clientes, barberos, servicios, artículos y citas); cuatro clientes usan `example.com`. El tenant `Mi barbería` solo tiene un perfil. Se conservaron ambos tenants y todos sus registros por indicación del usuario; verificar la limpieza de datos de prueba antes de usar métricas como datos de negocio.
- Notificaciones internas del 24 de octubre: campana en la cabecera para propietario, recepción y barberos; bandeja de 20 avisos, contador de no leídas, marcar uno/todos como leídos y actualización por Realtime. La migración `20261024160257_internal_notifications.sql` se aplicó con RLS por destinatario; solo permite actualizar `read_at`, sin inserción directa desde clientes. Seis triggers generan avisos para citas, cancelaciones, llegada a recepción, servicio listo para caja, reposición, turnos y cruce del mínimo de stock. No hubo backfill: la tabla quedó vacía al desplegarse. Permisos, seis triggers y publicación Realtime verificados. `npm run typecheck` y `git diff --check` pasaron. Push en segundo plano queda fuera de esta versión.
- SaaS manual del 24 de octubre: prueba configurable, periodo de pago de 1 a 12 meses, precio, gracia y contactos; valores iniciales 14 días, 3 días y USD 15/mes. El plan Básico ofrece Analítica/exportaciones y Pro queda inactivo para nuevos registros; las suscripciones existentes se conservaron. Renovar desde el panel usa `admin_record_subscription_payment`, que registra método, periodo, referencia, nota y administrador. WhatsApp inicial `+593 989 253 675`; Telegram queda configurable. CSV y PDF imprimible están disponibles durante prueba/suscripción y gracia, con auditoría. Si la cuenta vence, el propietario puede descargar un respaldo JSON de los datos de su barbería, también auditado. La base valida el acceso a escrituras operativas incluso en RPC, respetando la gracia configurada. Migraciones `20261024162712`, `20261024162849`, `20261024162930`, `20261024163201`, `20261024163507` y `20261024163851`. Falta asignar el primer administrador global: `saas_admins` sigue vacía, por lo que `/saas-admin` aún no es accesible.
- Gestión de integrantes: el directorio permite filtrar activos/inactivos, activar o desactivar perfiles y realizarlo en lote. “Eliminar acceso” bloquea la cuenta de Auth y da de baja al barbero conservando perfil y registros históricos; se puede reactivar desde la pestaña de inactivos. La función Edge `manage-staff` está desplegada con JWT obligatorio y autorización de propietario/tenant. `npm run typecheck` pasó.
- El reporte de seguridad señala 5 RPC QR `SECURITY DEFINER` ejecutables por `anon`. Revisé sus definiciones remotas: todas comprueban un token hexadecimal de 64 caracteres contra su hash guardado; las lecturas y escrituras se limitan al cliente y tenant asociados. El acceso anónimo es parte del diseño de la tarjeta QR, pero falta probar rechazo ante token inválido/revocado, enumeración y abuso automatizado. `client_qr_tokens` no tiene políticas ni permisos directos por diseño; los RPC hacen el acceso controlado. `client_look_photos` solo tiene políticas para `authenticated`; aunque existen grants a `anon`, RLS no tiene política anónima que permita filas. Confirmar después si hace falta conservar los grants explícitos.
- Supabase Auth tiene desactivada la protección contra contraseñas filtradas; conviene activarla desde la configuración de Auth.
- El reporte de rendimiento lista 34 claves foráneas sin índice dedicado, una política RLS que recalcula `auth.uid()` por fila, 12 tablas con políticas permisivas superpuestas y 16 índices no utilizados. Revisar con las consultas/uso real antes de modificar índices o políticas.
- La renovación está preparada para confirmación manual; cobro automático y recibos fiscales de suscripción siguen pendientes. No hay suite de pruebas ni un flujo documentado de despliegue/monitoreo para dar producción por cerrada.
- El directorio Git no tiene commits y el estado marca el proyecto entero como archivos sin seguimiento. Antes de cambios amplios conviene crear un primer punto de recuperación versionado.



- Fidelidad (23 de octubre): reglas versionadas y catálogo de recompensas se administran desde Configuración (solo propietario); CRM muestra tasa vigente, saldo, historial y ajustes individuales. La acumulación futura usa el subtotal después de descuentos (sin impuestos ni propina) y no recalcula saldos ya ganados. Hay recompensas de servicio gratis, descuento fijo o porcentual; las que tienen historial se archivan. Caja y base remota usan los tres tipos de beneficio; `npm run typecheck` pasó. Falta validar visualmente en caja/CRM con usuarios reales.

## Fases propuestas

### 1. Cerrar la brecha entre migraciones y base remota

1. Comparar los archivos locales con las 37 versiones remotas y revisar las migraciones retiradas en `supabase/pending-review/`.
2. Generar un informe de diferencias de esquema y RPC; identificar qué cambios existen solo en remoto, cuáles solo en archivos y cuáles coinciden.
3. Documentar un procedimiento seguro para una base nueva y otro para la base actual. No marcar versiones como aplicadas ni desplegar migraciones históricas sin verificar el SQL y el esquema resultante.

**Hecho cuando:** cada diferencia tiene una decisión explícita y el proceso se puede repetir en una base de prueba sin afectar los datos de Barber Lounge.

### 2. Revisar seguridad y terminar QA de los flujos principales

1. Auditar los RPC `SECURITY DEFINER` disponibles para `anon`, los permisos de Storage y las políticas RLS sobre fotos y tokens QR.
2. Recorrer registro, recuperación de contraseña, invitaciones, permisos por rol, citas/doble reserva, check-in QR, cola, servicio, checkout dividido/recompensas, movimientos de inventario y asistencia.
3. Añadir pruebas reproducibles para reglas críticas y recorridos de interfaz; corregir los hallazgos que aparezcan.
4. Corregir índices faltantes solo tras contrastarlos con las consultas reales y el volumen esperado. Consolidar políticas RLS únicamente si se conserva el mismo acceso efectivo.

**Hecho cuando:** los recorridos pasan con usuarios de distintos roles/tenants y los hallazgos de seguridad tienen explicación o corrección verificada.

### 3. Preparar el despliegue de producción

1. Elegir o confirmar hosting, dominio y entorno de producción.
2. Configurar URLs permitidas y SMTP de Supabase; desplegar y verificar `invite-staff` y sus secretos.
3. Configurar variables de entorno, HTTPS, reglas de SPA para React Router, política de copias de seguridad y un procedimiento de rollback.
4. Validar la PWA instalada en Android/iOS y comprobar el comportamiento cuando la conexión a Internet falla. La operación de caja requiere conexión con Supabase.

**Hecho cuando:** una cuenta nueva y el equipo pueden completar el flujo operativo en la URL pública y hay un procedimiento de recuperación documentado.

### 4. Definir y construir la monetización SaaS

1. Definir planes, precios, periodo de prueba, límites, moneda y reglas ante pagos vencidos.
2. Elegir el proveedor de pagos que opere para el negocio y los países objetivo.
3. Implementar checkout/webhooks con verificación del servidor, idempotencia, cambios de plan y sincronización del estado de suscripción.

**Hecho cuando:** una compra de prueba actualiza la suscripción y sus capacidades de forma confiable, incluyendo fallos, reintentos y cancelación.

### 5. Piloto y salida

1. Cargar catálogo, barberos, estaciones, inventario y usuarios reales; verificar saldos y precios iniciales.
2. Hacer un piloto con una barbería y recopilar errores y fricciones de uso.
3. Resolver errores de severidad alta, preparar guía corta para recepción/barberos y lanzar gradualmente.

## Cómo avanzar ahora

La fase 1 confirmó el desfase exacto de migraciones y que las tablas, columnas, RPC y Edge Function usados por la app coinciden con los objetos desplegados. El siguiente pendiente es documentar cómo reconstruir una instalación nueva y qué hacer con las seis migraciones de baseline para la base actual, sin registrarlas como aplicadas automáticamente. También falta probar los flujos de seguridad con usuarios reales de cada rol y contrastar los cambios históricos del baseline con una base de desarrollo. La revisión remota hecha hasta aquí fue de solo lectura.

Para las fases 3 y 4 necesito que confirmes las decisiones de negocio cuando lleguemos a ellas: dominio/hosting y proveedor de pagos, países y precios de los planes. Por ahora no bloquean la auditoría técnica.
