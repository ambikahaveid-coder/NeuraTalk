import path from "path";
import {
  buildPool,
  createBackupManifest,
  dumpTableToJsonlGzip,
  ensureDir,
  getDatabaseInfo,
  getKeyBusinessCounts,
  getPublicTables,
  getSchemaSnapshot,
  getTableCount,
  timestampId,
  verifyJsonlGzipFile,
  withClient,
  writeJson,
} from "./db-sre-lib.mjs";

const pool = buildPool();

async function main() {
  const backupId = `preprod_${timestampId()}`;
  const backupRoot = path.resolve("backups", backupId);
  const dataDir = path.join(backupRoot, "data");
  const metadataDir = path.join(backupRoot, "metadata");

  await ensureDir(dataDir);
  await ensureDir(metadataDir);

  const results = await withClient(pool, async (client) => {
    const databaseInfo = await getDatabaseInfo(client);

    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

    try {
      const tables = await getPublicTables(client);
      const schemaSnapshot = await getSchemaSnapshot(client);
      const tableCounts = {};
      const files = [];

      for (const tableName of tables) {
        tableCounts[tableName] = await getTableCount(client, tableName);
      }

      const keyBusinessCounts = await getKeyBusinessCounts(client, tables);

      await writeJson(path.join(metadataDir, "schema-snapshot.json"), schemaSnapshot);
      await writeJson(path.join(metadataDir, "table-counts.json"), tableCounts);
      await writeJson(path.join(metadataDir, "key-business-counts.json"), keyBusinessCounts);

      for (const tableName of tables) {
        const fileName = `${tableName}.jsonl.gz`;
        const filePath = path.join(dataDir, fileName);
        const dump = await dumpTableToJsonlGzip(client, tableName, filePath, tableCounts[tableName]);
        files.push({
          tableName,
          fileName,
          rowCount: dump.dumpedRows,
          sha256: dump.sha256,
        });
      }

      await client.query("COMMIT");

      return {
        databaseInfo,
        tables,
        schemaSnapshot,
        tableCounts,
        keyBusinessCounts,
        files,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  const verification = {};
  for (const file of results.files) {
    const filePath = path.join(dataDir, file.fileName);
    const { lineCount } = await verifyJsonlGzipFile(filePath);
    verification[file.tableName] = {
      verified: lineCount === file.rowCount,
      dumpedRows: file.rowCount,
      verifiedRows: lineCount,
    };

    if (lineCount !== file.rowCount) {
      throw new Error(
        `Backup verification failed for ${file.tableName}: expected ${file.rowCount}, verified ${lineCount}`,
      );
    }
  }

  const manifest = createBackupManifest({
    backupId,
    databaseInfo: results.databaseInfo,
    tables: results.tables,
    tableCounts: results.tableCounts,
    keyBusinessCounts: results.keyBusinessCounts,
    files: results.files,
    verification,
  });

  await writeJson(path.join(backupRoot, "manifest.json"), manifest);

  console.log(JSON.stringify({
    ok: true,
    backupId,
    backupRoot,
    tableCount: results.tables.length,
    keyBusinessCounts: results.keyBusinessCounts,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
