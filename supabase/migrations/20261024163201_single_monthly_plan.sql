begin;

update public.subscription_plans
set monthly_price = 15,
    capabilities = array[
      'reception','chair','checkout','inventory','client_pwa','crm',
      'appointments','catalog','analytics','exports'
    ]
where code = 'basic';

update public.subscription_plans
set active = false
where code = 'pro';

commit;
