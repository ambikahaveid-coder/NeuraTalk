import fs from "fs/promises";
import path from "path";
import {
  buildPool,
  getSchemaSnapshot,
  withClient,
  writeJson,
} from "./db-sre-lib.mjs";

function parseCreateTableBlocks(sqlText) {
  const normalizedSql = sqlText.replace(/^\uFEFF/, "");
  const tables = new Map();
  const createTableRegex = /CREATE TABLE "([^"]+)" \(\r?\n([\s\S]*?)\r?\n\);/g;

  for (const match of normalizedSql.matchAll(createTableRegex)) {
    const [, tableName, body] = match;
    const columns = new Map();

    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line.startsWith('"')) {
        continue;
      }

      const columnMatch = line.match(/^"([^"]+)"\s+(.+)$/);
      if (!columnMatch) {
        continue;
      }

      const [, columnName, definition] = columnMatch;
      columns.set(columnName, {
        columnName,
        definition,
        isNullable: !/\bNOT NULL\b/i.test(definition),
        hasDefault: /\bDEFAULT\b/i.test(definition),
        rawType: extractTypeFromDefinition(definition),
      });
    }

    tables.set(tableName, { tableName, columns });
  }

  return tables;
}

function extractTypeFromDefinition(definition) {
  const normalized = definition.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.+?)(?=\s+(?:DEFAULT|PRIMARY|NOT|REFERENCES|UNIQUE|CHECK|CONSTRAINT)\b|$)/i);
  return match ? match[1].trim() : normalized;
}

function normalizeType(rawType, columnDefault) {
  const type = rawType.toLowerCase().trim();

  if (type === "serial") {
    return columnDefault?.startsWith("nextval(") ? "serial" : "integer";
  }

  if (type === "bigserial") {
    return columnDefault?.startsWith("nextval(") ? "bigserial" : "bigint";
  }

  if (type === "timestamp") {
    return "timestamp without time zone";
  }

  return type;
}

async function main() {
  const exportFilePath = process.argv[2] || path.resolve("tmp", "app-schema-export.sql");
  const sqlText = await fs.readFile(exportFilePath, "utf8");
  const expectedTables = parseCreateTableBlocks(sqlText);
  const pool = buildPool();

  try {
    const snapshot = await withClient(pool, async (client) => getSchemaSnapshot(client));

    const liveTables = new Map();
    for (const tableName of snapshot.tables) {
      liveTables.set(tableName, { tableName, columns: new Map() });
    }

    for (const column of snapshot.columns) {
      const table = liveTables.get(column.table_name);
      table?.columns.set(column.column_name, {
        columnName: column.column_name,
        rawType: normalizeType(column.formatted_type, column.column_default),
        isNullable: column.is_nullable === "YES",
        columnDefault: column.column_default,
      });
    }

    const missingTables = [];
    const extraTables = [];
    const missingColumns = [];
    const extraColumns = [];
    const typeMismatches = [];
    const nullabilityMismatches = [];

    for (const [tableName, expectedTable] of expectedTables.entries()) {
      const liveTable = liveTables.get(tableName);
      if (!liveTable) {
        missingTables.push(tableName);
        continue;
      }

      for (const [columnName, expectedColumn] of expectedTable.columns.entries()) {
        const liveColumn = liveTable.columns.get(columnName);
        if (!liveColumn) {
          missingColumns.push({
            tableName,
            columnName,
            definition: expectedColumn.definition,
          });
          continue;
        }

        const expectedType = normalizeType(expectedColumn.rawType);
        const liveType = liveColumn.rawType;
        if (expectedType !== liveType) {
          typeMismatches.push({
            tableName,
            columnName,
            expectedType,
            liveType,
          });
        }

        if (expectedColumn.isNullable !== liveColumn.isNullable) {
          nullabilityMismatches.push({
            tableName,
            columnName,
            expectedNullable: expectedColumn.isNullable,
            liveNullable: liveColumn.isNullable,
          });
        }
      }

      for (const columnName of liveTable.columns.keys()) {
        if (!expectedTable.columns.has(columnName)) {
          extraColumns.push({ tableName, columnName });
        }
      }
    }

    for (const tableName of liveTables.keys()) {
      if (!expectedTables.has(tableName)) {
        extraTables.push(tableName);
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      exportFilePath,
      summary: {
        expectedTableCount: expectedTables.size,
        liveTableCount: liveTables.size,
        missingTables: missingTables.length,
        extraTables: extraTables.length,
        missingColumns: missingColumns.length,
        extraColumns: extraColumns.length,
        typeMismatches: typeMismatches.length,
        nullabilityMismatches: nullabilityMismatches.length,
      },
      missingTables,
      extraTables,
      missingColumns,
      extraColumns,
      typeMismatches,
      nullabilityMismatches,
    };

    const reportPath = path.resolve("tmp", "db-drift-report.json");
    await writeJson(reportPath, report);
    console.log(JSON.stringify({ ok: true, reportPath, summary: report.summary }, null, 2));
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
