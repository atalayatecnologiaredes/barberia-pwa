create index if not exists loyalty_ledger_client_history_idx
  on public.loyalty_ledger (client_id, created_at desc);

create index if not exists loyalty_ledger_payment_fk_idx
  on public.loyalty_ledger (payment_id);
