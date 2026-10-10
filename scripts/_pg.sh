parse_database_url() {
  local re='^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)'
  if [[ ! "$1" =~ $re ]]; then
    echo "DATABASE_URL має бути у форматі postgres://user:pass@host:port/db" >&2
    exit 1
  fi
  PG_USER="${BASH_REMATCH[2]}"
  PG_PASSWORD="${BASH_REMATCH[4]}"
  PG_DB="${BASH_REMATCH[8]}"
}

control_sql() {
  cat <<'SQL'
SELECT coalesce((
  SELECT string_agg(t || '=' || n, ' ' ORDER BY t)
  FROM (
    SELECT table_name AS t,
           (xpath('/row/c/text()',
             query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text AS n
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ) s
), '(no tables)')
|| ' | orders(count|sum_total)=' ||
CASE WHEN to_regclass('public.orders') IS NULL THEN 'absent'
     ELSE (xpath('/row/v/text()',
             query_to_xml('SELECT count(*) || ''|'' || coalesce(sum(total), 0) AS v FROM public.orders', false, true, '')))[1]::text
END;
SQL
}
