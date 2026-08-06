import { seedIfEmpty, listTransactions } from "../src/db/transactions";

async function main() {
  const resourceId = process.argv[2] ?? "dev-local";

  await seedIfEmpty(resourceId);
  const transactions = await listTransactions(resourceId);

  console.log(`resourceId=${resourceId} now has ${transactions.length} transaction(s).`);
}

main();
