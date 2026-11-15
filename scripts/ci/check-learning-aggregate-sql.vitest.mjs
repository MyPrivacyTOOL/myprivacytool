// MPC-9892: the learning-aggregate SQL lint accepts the real repo and rejects every way a per-scan row could get into the table.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findViolations, lintSql, statements } from "./check-learning-aggregate-sql.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DOOR = `create or replace function public.mpt_learning_count(p_day date, p_dimension text, p_key text, p_n bigint default 1) returns void language sql as $$
  insert into public.learning_aggregate_daily as a (day, dimension, key, n) values (p_day, p_dimension, p_key, p_n)
  on conflict (day, dimension, key) do update set n = a.n + p_n; $$;`;

describe("learning aggregate SQL lint", () => {
  it("the real repo is clean", () => { expect(findViolations(repoRoot)).toEqual([]); });
  it("accepts the single counter door", () => { expect(lintSql("m.sql", DOOR)).toEqual([]); });
  it("rejects INSERT ... SELECT from a scan table (a per-scan insert)", () => {
    const sql = `insert into public.learning_aggregate_daily (day, dimension, key, n) select current_date, 'scan', w.id::text, 1 from public.web_scans w on conflict (day, dimension, key) do update set n = learning_aggregate_daily.n + 1;`;
    expect(lintSql("m.sql", sql).join("\n")).toMatch(/INSERT \.\.\. SELECT/);
  });
  it("rejects an insert without ON CONFLICT ... n = n + ..., or one that overwrites the counter", () => {
    expect(lintSql("m.sql", `insert into public.learning_aggregate_daily values (current_date, 'scan', 'x', 1);`).join("\n")).toMatch(/ON CONFLICT/);
    expect(lintSql("m.sql", `insert into public.learning_aggregate_daily (day, dimension, key, n) values (current_date, 'scan', 'x', 1) on conflict (day, dimension, key) do update set n = 1;`).join("\n")).toMatch(/ON CONFLICT/);
  });
  it("rejects an insert outside mpt_learning_count even when it adds correctly", () => {
    const sql = `create function f() returns void language sql as $$ insert into public.learning_aggregate_daily as a (day, dimension, key, n) values (current_date, 'scan', 'x', 1) on conflict (day, dimension, key) do update set n = a.n + 1 $$;`;
    expect(lintSql("m.sql", sql).join("\n")).toMatch(/only mpt_learning_count/);
  });
  it("rejects an extra column, in the definition or by ALTER, and a per-scan column in an insert list", () => {
    expect(lintSql("m.sql", `create table public.learning_aggregate_daily (day date, dimension text, key text, n bigint, scan_id uuid, primary key (day, dimension, key));`).join("\n")).toMatch(/must be exactly/);
    expect(lintSql("m.sql", `alter table public.learning_aggregate_daily add column email text;`).join("\n")).toMatch(/ADD COLUMN/);
    expect(lintSql("m.sql", `insert into public.learning_aggregate_daily (day, dimension, key, n, scan_id) values (current_date, 'a', 'b', 1, 'u') on conflict (day, dimension, key) do update set n = learning_aggregate_daily.n + 1;`).join("\n")).toMatch(/per-scan identifier/);
  });
  it("ignores comments and splits statements outside dollar quotes only", () => {
    expect(lintSql("m.sql", `-- insert into public.learning_aggregate_daily select 1;\nselect 1;`)).toEqual([]);
    expect(statements("select 1; create function f() returns void as $$ select 1; select 2; $$ language sql; select 3;")).toHaveLength(3);
  });
});
