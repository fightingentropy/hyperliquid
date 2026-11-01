import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// A D1Database look-alike over node:sqlite, so tests run the real migration SQL and real
// statements instead of matching SQL strings. Covers only the surface the app uses:
// prepare().bind().run/all/first and batch() (one transaction, rolled back on error).

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

class SqliteStatement {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new SqliteStatement(this.sqlite, this.sql, params);
  }

  execute() {
    const statement = this.sqlite.prepare(this.sql);
    const rows = statement.all(...this.params).map((row) => ({ ...row }));
    return { success: true, results: rows, meta: {} };
  }

  async run() {
    return this.execute();
  }

  async all() {
    return this.execute();
  }

  async first(column) {
    const row = this.execute().results[0] ?? null;
    return column && row ? row[column] : row;
  }
}

export function createSqliteD1({ migrations = ["0002_liquidation_positions.sql"] } = {}) {
  const sqlite = new DatabaseSync(":memory:");

  for (const file of migrations) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
  }

  return {
    sqlite,
    prepare: (sql) => new SqliteStatement(sqlite, sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
