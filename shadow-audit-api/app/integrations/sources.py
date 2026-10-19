"""Log sources. Real adapters (BigQuery / Cloud Logging) need GCP and are NOT tested here;
a source failure surfaces as an audit error -> INCOMPLETE, never 'clean'."""
from typing import Dict, List, Protocol


class LogSource(Protocol):
    def fetch(self, agent_id: str, lookback_days: int) -> List[Dict]: ...


class InMemorySource:
    def __init__(self, data: Dict[str, List[Dict]]):
        self.data = data

    def fetch(self, agent_id: str, lookback_days: int) -> List[Dict]:
        return list(self.data.get(agent_id, []))


class BigQuerySource:  # untested adapter; requires google-cloud-bigquery and credentials
    def __init__(self, table: str):
        self.table = table

    def fetch(self, agent_id: str, lookback_days: int) -> List[Dict]:
        from google.cloud import bigquery  # lazy import
        client = bigquery.Client()
        job = client.query(
            f"SELECT ts, text, tool, session, vault_start, vault_end FROM `{self.table}` "
            "WHERE agent_id=@a AND ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @d DAY)",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("a", "STRING", agent_id),
                bigquery.ScalarQueryParameter("d", "INT64", lookback_days)]))
        return [dict(r.items()) for r in job.result()]
