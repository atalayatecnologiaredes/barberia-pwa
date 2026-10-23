# Migraciones retiradas de la cola automática

`20261021170000_complete_operations_modules.sql` no estaba aplicada en el proyecto remoto y redefine funciones de Agenda que ya fueron desplegadas de forma más segura en `migrations/20261021210911_harden_operational_workflows.sql`. Se conserva aquí como referencia, fuera de `supabase/migrations`, para impedir que `supabase db push` la aplique accidentalmente. Contiene cambios de otros módulos (turnos de personal, toolkit y QR) que deben revisarse y migrarse por separado si se necesitan.
