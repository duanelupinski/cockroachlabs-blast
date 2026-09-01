WITH ranges AS (
  SELECT
    range_id,
    lease_holder_locality,
    voting_replicas,
    non_voting_replicas,
    replicas,
    replica_localities
  FROM [SHOW RANGES FROM TABLE app.customers WITH DETAILS]
),
pairs AS (
  SELECT
    r.range_id,
    r.replicas[i] AS node_id,
    split_part(split_part(r.replica_localities[i], 'region=', 2), ',', 1) AS region
  FROM ranges r,
       generate_series(1, COALESCE(array_length(r.replicas, 1), 0)) AS i
)
SELECT
  r.range_id,
  split_part(split_part(r.lease_holder_locality, 'region=', 2), ',', 1) AS lease_holder_locality,
  ARRAY(
    SELECT p.region FROM pairs p
    WHERE p.range_id = r.range_id AND p.node_id = ANY (r.voting_replicas)
  ) AS voting_replicas,
  ARRAY(
    SELECT p.region FROM pairs p
    WHERE p.range_id = r.range_id AND p.node_id = ANY (r.non_voting_replicas)
  ) AS non_voting_replicas
FROM ranges r
ORDER BY r.range_id;
