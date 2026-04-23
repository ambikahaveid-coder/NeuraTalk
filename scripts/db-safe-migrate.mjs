import fs from "fs/promises";
import path from "path";
import {
  buildPool,
  getSchemaSnapshot,
  getTableCount,
  quoteIdent,
  withClient,
  writeJson,
} from "./db-sre-lib.mjs";

function normalizeSqlText(sqlText) {
  return sqlText.replace(/^\uFEFF/, "");
}

function parseCreateTableStatements(sqlText) {
  const normalized = normalizeSqlText(sqlText);
  const statements = new Map();
  const regex = /CREATE TABLE "([^"]+)" \(\r?\n[\s\S]*?\r?\n\);/g;

  for (const match of normalized.matchAll(regex)) {
    const fullStatement = match[0].replace(/\r/g, "");
    const tableName = match[1];
    statements.set(tableName, fullStatement);
  }

  return statements;
}

function parseConstraintStatements(sqlText) {
  const normalized = normalizeSqlText(sqlText);
  const statements = [];
  const regex = /ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"[\s\S]*?;/g;

  for (const match of normalized.matchAll(regex)) {
    statements.push({
      tableName: match[1],
      constraintName: match[2],
      statement: match[0].replace(/\r/g, ""),
    });
  }

  return statements;
}

function parseIndexStatements(sqlText) {
  const normalized = normalizeSqlText(sqlText);
  const statements = [];
  const regex = /CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"[\s\S]*?;/g;

  for (const match of normalized.matchAll(regex)) {
    const statement = match[0].replace(/\r/g, "");
    const indexName = match[2];
    const tableName = match[3];
    const ifNotExistsStatement = statement.startsWith("CREATE UNIQUE INDEX ")
      ? statement.replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ")
      : statement.replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ");

    statements.push({
      tableName,
      indexName,
      statement: ifNotExistsStatement,
    });
  }

  return statements;
}

async function verifyTablesExist(client, tableNames) {
  if (tableNames.length === 0) {
    return;
  }

  const { rows } = await client.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [tableNames],
  );

  const found = new Set(rows.map((row) => row.table_name));
  const missing = tableNames.filter((tableName) => !found.has(tableName));
  if (missing.length > 0) {
    throw new Error(`Table verification failed. Missing: ${missing.join(", ")}`);
  }
}

async function verifyColumnsExist(client, columns) {
  if (columns.length === 0) {
    return;
  }

  const grouped = columns.reduce((acc, item) => {
    if (!acc.has(item.tableName)) {
      acc.set(item.tableName, new Set());
    }

    acc.get(item.tableName).add(item.columnName);
    return acc;
  }, new Map());

  for (const [tableName, columnNames] of grouped.entries()) {
    const { rows } = await client.query(
      `
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = $1
          and column_name = any($2::text[])
      `,
      [tableName, [...columnNames]],
    );

    const found = new Set(rows.map((row) => row.column_name));
    const missing = [...columnNames].filter((columnName) => !found.has(columnName));
    if (missing.length > 0) {
      throw new Error(
        `Column verification failed for ${tableName}. Missing: ${missing.join(", ")}`,
      );
    }
  }
}

async function verifyConstraintsExist(client, constraintNames) {
  if (constraintNames.length === 0) {
    return;
  }

  const expectedNames = [...new Set(constraintNames.map((name) => name.slice(0, 63)))];
  const { rows } = await client.query(
    `
      select conname as constraint_name
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and conname = any($1::text[])
    `,
    [expectedNames],
  );

  const found = new Set(rows.map((row) => row.constraint_name));
  const missing = expectedNames.filter((constraintName) => !found.has(constraintName));
  if (missing.length > 0) {
    throw new Error(`Constraint verification failed. Missing: ${missing.join(", ")}`);
  }
}

async function verifyIndexesExist(client, indexNames) {
  if (indexNames.length === 0) {
    return;
  }

  const expectedNames = [...new Set(indexNames.map((name) => name.slice(0, 63)))];
  const { rows } = await client.query(
    `
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname = any($1::text[])
    `,
    [expectedNames],
  );

  const found = new Set(rows.map((row) => row.indexname));
  const missing = expectedNames.filter((indexName) => !found.has(indexName));
  if (missing.length > 0) {
    throw new Error(`Index verification failed. Missing: ${missing.join(", ")}`);
  }
}

function buildColumnStatements(missingColumns) {
  return missingColumns.map(({ tableName, columnName, definition }) => ({
    tableName,
    columnName,
    statement: `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN IF NOT EXISTS ${quoteIdent(columnName)} ${definition};`,
  }));
}

async function assertSafeLegacyCleanup(client, driftReport) {
  for (const tableName of driftReport.extraTables) {
    if (tableName !== "credit_ledger") {
      throw new Error(`Unexpected extra table ${tableName}. Manual review required before cleanup.`);
    }

    const rowCount = await getTableCount(client, tableName);
    if (rowCount !== 0) {
      throw new Error(`Legacy table ${tableName} is not empty (${rowCount} rows). Cleanup aborted.`);
    }
  }

  const organizationCount = await getTableCount(client, "organizations");
  if (organizationCount !== 0 && driftReport.extraColumns.length > 0) {
    throw new Error(
      "organizations contains data while legacy extra columns still exist. Manual backfill required before cleanup.",
    );
  }
}

async function main() {
  const exportFilePath = process.argv[2] || path.resolve("tmp", "app-schema-export.sql");
  const driftFilePath = process.argv[3] || path.resolve("tmp", "db-drift-report.json");
  const sqlText = await fs.readFile(exportFilePath, "utf8");
  const driftReport = JSON.parse(await fs.readFile(driftFilePath, "utf8"));

  const createTables = parseCreateTableStatements(sqlText);
  const constraints = parseConstraintStatements(sqlText);
  const indexes = parseIndexStatements(sqlText);
  const missingTableSet = new Set(driftReport.missingTables);
  const affectedTableSet = new Set([
    ...driftReport.missingTables,
    ...driftReport.missingColumns.map((item) => item.tableName),
  ]);

  const tableStatements = driftReport.missingTables.map((tableName) => {
    const statement = createTables.get(tableName);
    if (!statement) {
      throw new Error(`Missing CREATE TABLE statement for ${tableName}`);
    }

    return { tableName, statement };
  });

  const columnStatements = buildColumnStatements(driftReport.missingColumns);
  const constraintStatements = constraints.filter((item) => missingTableSet.has(item.tableName));
  const indexStatements = indexes.filter((item) => affectedTableSet.has(item.tableName));

  const cleanupStatements = [];
  if (driftReport.extraTables.includes("credit_ledger")) {
    cleanupStatements.push({ statement: "DROP TABLE IF EXISTS public.credit_ledger;" });
  }

  for (const extraColumn of driftReport.extraColumns) {
    cleanupStatements.push({
      statement: `ALTER TABLE ${quoteIdent(extraColumn.tableName)} DROP COLUMN IF EXISTS ${quoteIdent(extraColumn.columnName)};`,
    });
  }

  const migrationPlan = {
    generatedAt: new Date().toISOString(),
    createTables: tableStatements,
    addColumns: columnStatements,
    addConstraints: constraintStatements,
    addIndexes: indexStatements,
    cleanup: cleanupStatements,
  };

  await writeJson(path.resolve("tmp", "db-safe-migration-plan.json"), migrationPlan);
  await fs.writeFile(
    path.resolve("tmp", "db-safe-migration.sql"),
    [
      ...tableStatements.map((item) => item.statement),
      ...columnStatements.map((item) => item.statement),
      ...constraintStatements.map((item) => item.statement),
      ...indexStatements.map((item) => item.statement),
      ...cleanupStatements.map((item) => item.statement),
    ].join("\n\n"),
    "utf8",
  );

  const pool = buildPool();
  try {
    await withClient(pool, async (client) => {
      await assertSafeLegacyCleanup(client, driftReport);
      await client.query("BEGIN");

      try {
        for (const item of tableStatements) {
          await client.query(item.statement);
        }
        await verifyTablesExist(client, driftReport.missingTables);

        for (const item of columnStatements) {
          await client.query(item.statement);
        }
        await verifyColumnsExist(client, driftReport.missingColumns);

        for (const item of constraintStatements) {
          await client.query(item.statement);
        }
        await verifyConstraintsExist(client, constraintStatements.map((item) => item.constraintName));

        for (const item of indexStatements) {
          await client.query(item.statement);
        }
        await verifyIndexesExist(client, indexStatements.map((item) => item.indexName));

        for (const item of cleanupStatements) {
          await client.query(item.statement);
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    const postSnapshot = await withClient(pool, async (client) => getSchemaSnapshot(client));
    console.log(
      JSON.stringify(
        {
          ok: true,
          migratedAt: new Date().toISOString(),
          publicTableCount: postSnapshot.tables.length,
          migrationPlan: path.resolve("tmp", "db-safe-migration-plan.json"),
          sqlFile: path.resolve("tmp", "db-safe-migration.sql"),
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
