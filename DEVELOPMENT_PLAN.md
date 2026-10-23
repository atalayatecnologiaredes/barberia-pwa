# Plan de desarrollo — Barber Lounge

Estado revisado el 23 de octubre de 2026 contra el código local y el proyecto Supabase `Barber Lounge`.

## Estado confirmado

- La app local apunta al proyecto Supabase remoto activo `Barber Lounge`.
- La base registra 24 migraciones, desde `20261021145712` hasta `20261022040115`. Las 24 coinciden con archivos locales; las 6 que solo existen en el repositorio son `20261020200000`, `20261020201000`, `20261020202000`, `20261020203000`, `20261021090000` y `20261021100000`. **No ejecutar `supabase db push` hasta conciliar ese desfase**: la documentación del proyecto indica que la base original se creó manualmente y no tiene el baseline registrado.
- Agenda, recepción/cola, silla, caja, inventario, CRM/QR, catálogo, equipo y analítica usan consultas o RPC de Supabase. Las reservas QR y los canjes de recompensas también tienen funciones persistentes.
- Comparé los accesos del frontend con el esquema remoto: las 16 tablas y 24 RPC nombrados en el código existen; las 42 selecciones de columnas y las firmas/argumentos de RPC revisados no tienen campos faltantes ni nombres incompatibles. También revisé manualmente el objeto de argumentos compartido por ambos flujos de checkout. La base tiene 26 tablas públicas y RLS está habilitado en las 26. Esto confirma compatibilidad del frontend actual con la base, pero no sustituye la conciliación histórica de las seis migraciones antiguas.
- La Edge Function `invite-staff` está activa en versión 4 con verificación JWT; comparé su fuente remota con `supabase/functions/invite-staff/index.ts` y coinciden exactamente.
- La tabla `client_look_photos` no se usa desde el frontend actual; no encontré flujos de Storage para fotos, por lo que esos permisos no bloquean las funciones que sí utiliza la app.
- El código aún muestra datos de ejemplo en algunos estados vacíos de desarrollo.
- `npm run typecheck` pasó en esta sesión. No hay scripts de pruebas automatizadas declarados en `package.json`.
- Avance local del 23 de octubre: el formulario de agenda bloquea fechas pasadas; el alta Walk-In evita envíos duplicados, permite dejar el barbero sin asignar y filtra identificadores de barbero nulos. `npm run typecheck` pasó después de estos cambios.
- El reporte de seguridad señala 5 RPC QR `SECURITY DEFINER` ejecutables por `anon`. Revisé sus definiciones remotas: todas comprueban un token hexadecimal de 64 caracteres contra su hash guardado; las lecturas y escrituras se limitan al cliente y tenant asociados. El acceso anónimo es parte del diseño de la tarjeta QR, pero falta probar rechazo ante token inválido/revocado, enumeración y abuso automatizado. `client_qr_tokens` no tiene políticas ni permisos directos por diseño; los RPC hacen el acceso controlado. `client_look_photos` solo tiene políticas para `authenticated`; aunque existen grants a `anon`, RLS no tiene política anónima que permita filas. Confirmar después si hace falta conservar los grants explícitos.
- Supabase Auth tiene desactivada la protección contra contraseñas filtradas; conviene activarla desde la configuración de Auth.
- El reporte de rendimiento lista 34 claves foráneas sin índice dedicado, una política RLS que recalcula `auth.uid()` por fila, 12 tablas con políticas permisivas superpuestas y 16 índices no utilizados. Revisar con las consultas/uso real antes de modificar índices o políticas.
- La facturación de planes SaaS avanzados sigue pendiente según el README. No encontré una suite de tests ni un flujo documentado de despliegue/monitoreo que permita dar producción por cerrada.
- El directorio Git no tiene commits y el estado marca el proyecto entero como archivos sin seguimiento. Antes de cambios amplios conviene crear un primer punto de recuperación versionado.

## Fases propuestas

### 1. Cerrar la brecha entre migraciones y base remota

1. Comparar los 30 archivos locales con las 24 versiones remotas y revisar las migraciones retiradas en `supabase/pending-review/`.
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
