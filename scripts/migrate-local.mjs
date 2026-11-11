import { openLocalDatabase } from '../server/local-db.mjs';
const local=await openLocalDatabase();local.close();console.log('Local migrations applied.');
