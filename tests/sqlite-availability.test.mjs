/**
 * SQLite 可用性探测。
 *
 * 这条约束来自一次真实故障模式：`node:sqlite` 在 Node < 22.5 不存在，
 * 静态 import 会把整个插件带崩（不只是演练台）。
 * 现在要求：**加载不抛**，只在真正访问数据库时才报带指引的错。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sqliteStatus, requireDatabaseSync, HAS_FTS5 } from "../lib/redteam/schema.js";

test("导入 schema 不抛错（低版本 Node 也一样）", () => {
  assert.equal(typeof sqliteStatus, "function");
  assert.equal(typeof HAS_FTS5, "boolean");
});

test("sqliteStatus 返回结构化结果", () => {
  const s = sqliteStatus();
  assert.equal(typeof s.ok, "boolean");
  assert.equal(typeof s.reason, "string");
  assert.equal(s.node, process.version);
  if (!s.ok) assert.match(s.reason, /22\.5/);
});

test("可用时能拿到构造器", () => {
  const s = sqliteStatus();
  if (!s.ok) {
    assert.throws(() => requireDatabaseSync(), (e) => e.code === "DSH_SQLITE_UNAVAILABLE");
    return;
  }
  const Ctor = requireDatabaseSync();
  assert.equal(typeof Ctor, "function");
});

test("内存库可建表（可用时）", () => {
  const s = sqliteStatus();
  if (!s.ok) return;
  const Ctor = requireDatabaseSync();
  const db = new Ctor(":memory:");
  try {
    db.exec("CREATE TABLE t (a INTEGER)");
    db.exec("INSERT INTO t VALUES (1)");
    assert.ok(true);
  } finally {
    db.close();
  }
});
