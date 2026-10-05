-- Replica-only range view (no leaseholder, no voter/non-voter).
-- Zones from replica_localities (us-east-1, eu-west-2, …).
-- Replace app.orders with the table you want.

WITH ranges AS (
  SELECT range_id, replicas, replica_localities
  FROM [SHOW RANGES FROM TABLE app.orders WITH DETAILS]
),
pairs AS (
  SELECT
    r.range_id,
    split_part(split_part(r.replica_localities[i], 'zone=', 2), ',', 1) AS zone
  FROM ranges r,
       generate_series(1, COALESCE(array_length(r.replicas, 1), 0)) AS i
)
SELECT r.range_id, ARRAY(SELECT p.zone FROM pairs p WHERE p.range_id = r.range_id) AS replicas
FROM ranges r
ORDER BY r.range_id;

-- Per-zone replica counts:
-- SELECT zone, count(*) AS replicas FROM pairs GROUP BY zone ORDER BY zone;
