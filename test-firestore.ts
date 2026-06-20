import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

async function test() {
  const serviceAccountPath = path.resolve(__dirname, 'firebase-service-account.json');
  console.log('Using service account at:', serviceAccountPath);
  
  const serviceAccount = require(serviceAccountPath);
  const app = initializeApp({
    credential: cert(serviceAccountPath),
    projectId: serviceAccount.project_id
  });

  console.log('Testing with "(default)"...');
  try {
    const db1 = getFirestore(app, '(default)');
    const snap1 = await db1.collection('random_id').limit(1).get();
    console.log('Success with (default)! Docs:', snap1.size);
  } catch (e: any) {
    console.error('Failed with (default):', e.code);
  }

  console.log('Testing with "default"...');
  try {
    const db2 = getFirestore(app, 'default');
    const snap2 = await db2.collection('random_id').limit(1).get();
    console.log('Success with "default"! Docs:', snap2.size);
  } catch (e: any) {
    console.error('Failed with "default":', e.code);
  }
}

test();
