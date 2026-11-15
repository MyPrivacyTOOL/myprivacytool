-- MPC-9892 canary test, step 2: the deletion job. Its psql output is the "job log" the runner greps. Counts only are printed.
select public.mpt_purge_expired_web_scans(false) ->> 'scans' as scans_purged;
with gone as (delete from public.edge_visits where user_agent like '%canary-ua-token%' returning 1) select count(*) as edge_rows_removed from gone;
select dimension, key, n from public.learning_aggregate_daily order by dimension, key;
